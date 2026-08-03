/**
 * IDEA B — arg fix (Idea A) PLUS furnace-placement robustness.
 *
 * After the arg fix, the only remaining failures are instant "Cannot find place for
 * furnace" (placeStationBlock returns null). Two causes: (1) a chunk-load race right
 * after teleport (neighbor blocks not yet resident → scan sees nothing), and (2) genuinely
 * awkward ground (mountain peak / 1-wide ledge). Fix: retry placement a few times with a
 * short settle (kills the race), and as a last resort nudge to flatter ground and retry.
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

const SMELTABLES = [
	"raw_iron", "raw_gold", "raw_copper", "sand", "cobblestone",
	"beef", "porkchop", "chicken", "mutton", "cod", "salmon", "potato",
];
const pickSmeltable = (bot: Bot): string => {
	const items = windowItems(bot.inventory);
	for (const s of SMELTABLES) if (items.some((i) => i.name.includes(s))) return s;
	return "raw_iron";
};

/** Scan adjacent + nearby for an existing furnace block. */
const findFurnace = (bot: Bot): Block | null => {
	const pos = bot.entity.position;
	for (const [dx, dy, dz] of [
		[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0],
		[0, 1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
		[1, 1, 0], [-1, 1, 0], [0, 1, 1],
	] as const) {
		const b = bot.blockAt(
			vec3(Math.floor(pos.x) + dx, Math.floor(pos.y) + dy, Math.floor(pos.z) + dz),
		);
		if (b && isFurnace(b.name)) return b;
	}
	const found = bot.findBlock({ matching: (n) => isFurnace(n), maxDistance: 32 });
	return found ?? null;
};

/** Gently walk toward flatter ground so the next placement scan has valid neighbors. */
const nudgeToFlatGround = async (bot: Bot): Promise<void> => {
	const yaw = Math.random() * Math.PI * 2;
	await bot.look(yaw, 0, true);
	bot.setControlState("forward", true);
	bot.setControlState("jump", true); // climb 1-high steps rather than get stuck
	await sleep(900);
	bot.setControlState("forward", false);
	bot.setControlState("jump", false);
	await sleep(700); // settle + let the new chunk column resolve
};

/** Find an existing furnace or place one, retrying through races / awkward ground. */
const ensureFurnace = async (bot: Bot): Promise<Block | null> => {
	for (let attempt = 0; attempt < 4; attempt++) {
		const existing = findFurnace(bot);
		if (existing) return existing;

		await reclaimCraftingGrid(bot);
		const furnaceItem = windowItems(bot.inventory).find((i) => i.name === "furnace");
		if (!furnaceItem) {
			getMemory(bot).furnacePos = null;
			return null; // truly none to place
		}
		const placed = await placeStationBlock(bot, "furnace");
		if (placed) return placed;

		// Placement failed — settle (chunk-load race) and, past the first retry,
		// relocate to flatter ground before trying again.
		if (attempt === 0) await sleep(1500);
		else await nudgeToFlatGround(bot);
	}
	return null;
};

export const smeltItems = async (
	bot: Bot,
	inputItem?: string | number,
	count = 8,
): Promise<StepResult> => {
	if (typeof inputItem !== "string" || inputItem.length === 0) {
		if (typeof inputItem === "number") count = inputItem;
		inputItem = pickSmeltable(bot);
	}
	const smeltName = inputItem;

	const furnace = await ensureFurnace(bot);
	if (!furnace) {
		return {
			success: false,
			message: findFurnace(bot)
				? "Cannot open furnace"
				: "No furnace to place (no spot / not in inventory)",
		};
	}

	getMemory(bot).furnacePos = {
		x: furnace.position.x,
		y: furnace.position.y,
		z: furnace.position.z,
	};

	const furnaceDist = distance(bot.entity.position, furnace.position);
	if (furnaceDist > 4) await goTo(bot, furnace.position, { range: 2, timeout: 10000 });

	try {
		const furnaceWindow = await bot.openFurnace(furnace);
		await sleep(500);

		const moveToSlot = async (pred: (n: string) => boolean, dest: number): Promise<boolean> => {
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
			const hasFuel = await moveToSlot((n) => n === "coal" || n === "charcoal", 1);
			if (!hasFuel) await moveToSlot((n) => n.includes("planks") || n.includes("_log"), 1);
		}
		if (!furnaceWindow.slots[0]) await moveToSlot((n) => n.includes(smeltName), 0);
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

export const run = (bot: Bot): Promise<StepResult> =>
	smeltItems(bot, 8 as unknown as string);
