/**
 * Smelting tasks - use furnace to process ores and food
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3, windowItems } from "typecraft";
import {
	getMemory,
	goTo,
	placeStationBlock,
	reclaimCraftingGrid,
	sleep,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { Block, StepResult } from "../../types.ts";

const isFurnace = (name: string) =>
	name === "furnace" || name === "lit_furnace";

/**
 * Place furnace if not already placed, then smelt items
 */
export const smeltItems = async (
	bot: Bot,
	inputItem: string,
	count: number,
): Promise<StepResult> => {
	// Find furnace — check adjacent blocks first (findBlock misses recently placed)
	let furnace: Block | null = null;
	const pos = bot.entity.position;
	for (const [dx, dy, dz] of [
		[0, 0, 0],
		[1, 0, 0],
		[-1, 0, 0],
		[0, 0, 1],
		[0, 0, -1],
		[0, -1, 0],
		[0, 1, 0],
		[1, 0, 1],
		[-1, 0, 1],
		[1, 0, -1],
		[-1, 0, -1],
		[1, 1, 0],
		[-1, 1, 0],
		[0, 1, 1],
	] as const) {
		const b = bot.blockAt(
			vec3(
				Math.floor(pos.x) + dx,
				Math.floor(pos.y) + dy,
				Math.floor(pos.z) + dz,
			),
		);
		if (b && isFurnace(b.name)) {
			furnace = b;
			break;
		}
	}

	// Fallback to findBlock
	if (!furnace) {
		const found = bot.findBlock({
			matching: (name) => isFurnace(name),
			maxDistance: 32,
		});
		if (found) furnace = found;
	}

	if (!furnace) {
		// Recover a furnace that crafting may have stranded in the craft grid —
		// windowItems can't see grid slots, which causes a phantom "no furnace"
		// hot-spin even though the bot holds one.
		await reclaimCraftingGrid(bot);
		// Place furnace from inventory
		const furnaceItem = windowItems(bot.inventory).find(
			(i) => i.name === "furnace",
		);
		if (!furnaceItem) {
			// No furnace nearby AND none to place — a remembered furnace is stale
			// (e.g. died + respawned far from it). Clear it so hasFurnace flips false
			// and the Craft Furnace step re-crafts one instead of deadlocking here.
			getMemory(bot).furnacePos = null;
			return { success: false, message: "No furnace in inventory or nearby" };
		}

		const placed = await placeStationBlock(bot, "furnace");
		if (!placed) {
			return { success: false, message: "Cannot find place for furnace" };
		}
		furnace = placed;
	}

	// Remember the furnace so the Craft Furnace step doesn't regress + re-craft a
	// new one the moment we walk off after smelting (the placed furnace leaves the
	// inventory). Mirrors the crafting-table memory.
	getMemory(bot).furnacePos = {
		x: furnace.position.x,
		y: furnace.position.y,
		z: furnace.position.z,
	};

	// Navigate to furnace
	const furnaceDist = distance(bot.entity.position, furnace.position);
	if (furnaceDist > 4) {
		await goTo(bot, furnace.position, { range: 2, timeout: 10000 });
	}

	try {
		// Open the furnace
		const furnaceWindow = await bot.openFurnace(furnace);
		// Let the window's slot contents sync before we start clicking, otherwise
		// picked-up items get lost (placed into an unsynced slot). Underground with a
		// cluttered inventory this sync is slower, so wait longer than on the surface.
		await sleep(1200);

		const isFuelName = (n: string) =>
			n === "coal" ||
			n === "charcoal" ||
			n.includes("planks") ||
			n.includes("_log");

		// Move a stack from the inventory portion to a furnace slot via clickWindow, then
		// VERIFY the intended item actually landed. bot.transfer/putInput are silent
		// no-ops on 26.1.2, and under load/clutter a single click can target a stale slot
		// and deposit the WRONG item — observed underground: 1 diorite stranded in the
		// input slot with no fuel, so the furnace sat idle until the 120s timeout, every
		// retry. Re-scan + retry (a swap-click self-corrects a wrong item in dest).
		const moveToSlot = async (
			pred: (n: string) => boolean,
			dest: number,
		): Promise<boolean> => {
			for (let attempt = 0; attempt < 3; attempt++) {
				const src = furnaceWindow.slots.findIndex(
					(s, i) => i >= furnaceWindow.inventoryStart && !!s && pred(s.name),
				);
				if (src < 0) return false;
				await bot.clickWindow(src, 0, 0);
				await sleep(400);
				await bot.clickWindow(dest, 0, 0);
				await sleep(400);
				if (furnaceWindow.selectedItem) {
					// Still holding something (dest occupied / click misaligned) — park it
					// in any empty inventory slot so it isn't dropped, then retry.
					const back = furnaceWindow.slots.findIndex(
						(s, i) => i >= furnaceWindow.inventoryStart && !s,
					);
					await bot.clickWindow(back >= 0 ? back : src, 0, 0);
					await sleep(300);
				}
				const landed = furnaceWindow.slots[dest];
				if (landed && pred(landed.name)) return true;
				await sleep(400); // let the window resync, then try a fresh scan
			}
			return false;
		};

		// Evict anything wrong that a prior (desynced) attempt stranded in a slot, so the
		// loads below place the real items instead of skipping a "non-empty" slot and
		// waiting forever on an unsmeltable input (e.g. diorite) with no fuel.
		const evict = async (slotIdx: number, keep: (n: string) => boolean) => {
			const cur = furnaceWindow.slots[slotIdx];
			if (!cur || keep(cur.name)) return;
			const back = furnaceWindow.slots.findIndex(
				(s, i) => i >= furnaceWindow.inventoryStart && !s,
			);
			if (back < 0) return;
			await bot.clickWindow(slotIdx, 0, 0);
			await sleep(350);
			await bot.clickWindow(back, 0, 0);
			await sleep(350);
		};
		await evict(0, (n) => n.includes(inputItem));
		await evict(1, isFuelName);

		// Load fuel if the fuel slot is empty. PREFER coal/charcoal over wood: burning
		// planks/logs here starves the downstream chain (the crafting_table + tools +
		// buckets all need wood), and on a deforested cell the bot then can't re-plank to
		// finish the smelt — the fuel-at-smelt deadlock that caps races at ~3 ingots. Coal
		// is mined right beside the iron, so spend that first and keep the wood.
		const isCoal = (n: string) => n === "coal" || n === "charcoal";
		if (!furnaceWindow.slots[1]) {
			const loadedCoal = await moveToSlot(isCoal, 1);
			if (!loadedCoal && !furnaceWindow.slots[1]) await moveToSlot(isFuelName, 1);
		}
		// Load input if the input slot is empty.
		if (!furnaceWindow.slots[0]) {
			await moveToSlot((n) => n.includes(inputItem), 0);
		}
		// Nothing queued and nothing waiting in the output — give up this call.
		if (!furnaceWindow.slots[0] && !furnaceWindow.slots[2]) {
			bot.closeWindow(furnaceWindow);
			return { success: false, message: `No ${inputItem} to smelt` };
		}

		// Wait for smelting — poll the output until every queued item is done (or
		// the furnace stalls / a hard cap). A single blind capped sleep
		// under-collected: 8 iron needs ~80s but the 60s cap took only 6, so the
		// step never reached its ironIngots>=7 target in one call.
		const target = Math.min(furnaceWindow.slots[0]?.count ?? 0, count);
		logEvent("smelt", "waiting", `target ${target}x ${inputItem}`);
		// Cap the in-call wait BELOW the run-loop's ~120s per-step timeout. Equal 120s
		// deadlines raced: the step was force-killed at 120s WHILE still in this loop, so
		// the take-output code below never ran and the finished ingots stayed stuck in the
		// furnace — a bot smelted 8 iron (smelt-preempt fix let Smelt Iron run) but 0 ingots
		// ever landed in its pack, looping `Smelt Iron timed out (120s)` (race127/312). 90s
		// covers 8 iron (~80s) and, if the furnace is slower, we still exit and COLLECT the
		// partial output, then the step re-enters to finish the rest next tick.
		const waitDeadline = Date.now() + 90_000;
		while (Date.now() < waitDeadline) {
			await sleep(2500);
			const out = furnaceWindow.slots[2]?.count ?? 0;
			const inLeft = furnaceWindow.slots[0]?.count ?? 0;
			if (out >= target) break;
			if (inLeft === 0) {
				await sleep(9000); // last item may still be cooking — let it finish
				break;
			}
		}

		// Take the finished output stack into inventory.
		let took = 0;
		if (furnaceWindow.slots[2]) {
			took = furnaceWindow.slots[2].count;
			await bot.clickWindow(2, 0, 0);
			await sleep(300);
			const empty = furnaceWindow.slots.findIndex(
				(s, i) => i >= furnaceWindow.inventoryStart && !s,
			);
			if (empty >= 0) {
				await bot.clickWindow(empty, 0, 0);
				await sleep(300);
			} else if (furnaceWindow.selectedItem) {
				await bot.clickWindow(2, 0, 0); // no inventory space — put it back
				took = 0;
			}
		}

		// Never close while carrying an item — it would be dropped on the ground.
		if (furnaceWindow.selectedItem) {
			const empty = furnaceWindow.slots.findIndex(
				(s, i) => i >= furnaceWindow.inventoryStart && !s,
			);
			if (empty >= 0) {
				await bot.clickWindow(empty, 0, 0);
				await sleep(200);
			}
		}
		bot.closeWindow(furnaceWindow);
		return { success: true, message: `Smelted ${inputItem} (+${took})` };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Smelting failed",
		};
	}
};
