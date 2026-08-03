/**
 * IDEA A — fix the input-item argument mismatch (+ minor robustness).
 *
 * Root cause: the gym registry calls `smeltItems(b, 8)`, but the real signature is
 * `smeltItems(bot, inputItem, count)`. So inputItem becomes the NUMBER 8 and count is
 * undefined. `n.includes(inputItem)` coerces 8 → "8", no item name contains "8", the
 * input slot is never loaded → the task bails with "No 8 to smelt".
 *
 * Fix: make the second arg tolerant. If it isn't a usable item-name string, treat it
 * as the count (when numeric) and AUTO-DETECT the smeltable in inventory. Production's
 * `smeltItems(bot, "raw_iron", 8)` is unaffected.
 *
 * This module is a standalone COPY of the task with the fix so we can measure it
 * without touching the shared production file.
 */
import type { Bot } from "typecraft";
import { distance, offset, vec3, windowItems } from "typecraft";
import {
	getMemory,
	goTo,
	placeStationBlock,
	reclaimCraftingGrid,
	sleep,
} from "../src/lib/steve/lib/bot-utils.ts";
import { logEvent } from "../src/lib/steve/lib/logger.ts";
import type { Block, StepResult } from "../src/lib/steve/types.ts";

const isFurnace = (name: string) =>
	name === "furnace" || name === "lit_furnace";

// Ores / raw items a furnace turns into ingots, in priority order, plus foods.
const SMELTABLES = [
	"raw_iron",
	"raw_gold",
	"raw_copper",
	"sand",
	"cobblestone",
	"beef",
	"porkchop",
	"chicken",
	"mutton",
	"cod",
	"salmon",
	"potato",
];

/** Pick the first smeltable actually present in the bot's inventory. */
const pickSmeltable = (bot: Bot): string => {
	const items = windowItems(bot.inventory);
	for (const s of SMELTABLES) {
		if (items.some((i) => i.name.includes(s))) return s;
	}
	return "raw_iron"; // sensible default for the speedrun
};

export const smeltItems = async (
	bot: Bot,
	inputItem?: string | number,
	count = 8,
): Promise<StepResult> => {
	// Normalize the args. The gym calls smeltItems(bot, 8); production calls
	// smeltItems(bot, "raw_iron", 8). A non-string (or empty) first data arg means
	// "auto-detect what to smelt", and a numeric one is really the count.
	if (typeof inputItem !== "string" || inputItem.length === 0) {
		if (typeof inputItem === "number") count = inputItem;
		inputItem = pickSmeltable(bot);
	}
	const smeltName = inputItem;

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

	if (!furnace) {
		const found = bot.findBlock({
			matching: (name) => isFurnace(name),
			maxDistance: 32,
		});
		if (found) furnace = found;
	}

	if (!furnace) {
		await reclaimCraftingGrid(bot);
		const furnaceItem = windowItems(bot.inventory).find(
			(i) => i.name === "furnace",
		);
		if (!furnaceItem) {
			getMemory(bot).furnacePos = null;
			return { success: false, message: "No furnace in inventory or nearby" };
		}

		const placed = await placeStationBlock(bot, "furnace");
		if (!placed) {
			return { success: false, message: "Cannot find place for furnace" };
		}
		furnace = placed;
	}

	getMemory(bot).furnacePos = {
		x: furnace.position.x,
		y: furnace.position.y,
		z: furnace.position.z,
	};

	const furnaceDist = distance(bot.entity.position, furnace.position);
	if (furnaceDist > 4) {
		await goTo(bot, furnace.position, { range: 2, timeout: 10000 });
	}

	try {
		const furnaceWindow = await bot.openFurnace(furnace);
		await sleep(500);

		const moveToSlot = async (
			pred: (n: string) => boolean,
			dest: number,
		): Promise<boolean> => {
			const src = furnaceWindow.slots.findIndex(
				(s, i) => i >= furnaceWindow.inventoryStart && !!s && pred(s.name),
			);
			if (src < 0) return false;
			await bot.clickWindow(src, 0, 0);
			await sleep(350);
			await bot.clickWindow(dest, 0, 0);
			await sleep(350);
			if (furnaceWindow.selectedItem) {
				await bot.clickWindow(src, 0, 0);
				await sleep(200);
			}
			return true;
		};

		if (!furnaceWindow.slots[1]) {
			const hasFuel = await moveToSlot(
				(n) => n === "coal" || n === "charcoal",
				1,
			);
			if (!hasFuel) {
				await moveToSlot((n) => n.includes("planks") || n.includes("_log"), 1);
			}
		}
		if (!furnaceWindow.slots[0]) {
			await moveToSlot((n) => n.includes(smeltName), 0);
		}
		if (!furnaceWindow.slots[0] && !furnaceWindow.slots[2]) {
			bot.closeWindow(furnaceWindow);
			return { success: false, message: `No ${smeltName} to smelt` };
		}

		const target = Math.min(furnaceWindow.slots[0]?.count ?? 0, count);
		logEvent("smelt", "waiting", `target ${target}x ${smeltName}`);
		const waitDeadline = Date.now() + 120_000;
		while (Date.now() < waitDeadline) {
			await sleep(2500);
			const out = furnaceWindow.slots[2]?.count ?? 0;
			const inLeft = furnaceWindow.slots[0]?.count ?? 0;
			if (out >= target) break;
			if (inLeft === 0) {
				await sleep(9000);
				break;
			}
		}

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
				await bot.clickWindow(2, 0, 0);
				took = 0;
			}
		}

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
		return { success: true, message: `Smelted ${smeltName} (+${took})` };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Smelting failed",
		};
	}
};

// Called the SAME buggy way the gym registry calls it, to prove the fix.
export const run = (bot: Bot): Promise<StepResult> =>
	smeltItems(bot, 8 as unknown as string);
