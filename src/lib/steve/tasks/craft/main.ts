/**
 * Crafting tasks - create items from materials
 */

import type { Bot, Recipe } from "typecraft";
import { windowItems } from "typecraft";
import {
	countItems,
	craftItem,
	failure,
	findItem,
	getCraftingTable,
	goTo,
	reclaimCraftingGrid,
	sleep,
	success,
} from "../../lib/bot-utils.ts";
import type { StepResult } from "../../types.ts";
import { gatherFlint } from "./gather-flint.ts";

export const craftPlanks = async (bot: Bot): Promise<StepResult> => {
	// Recover logs/planks stranded in the 2x2 craft grid before reading inventory:
	// bot.craft can leave items there, invisible to windowItems (which reads only the
	// inventory section), so the bot loops "No logs in inventory" while holding logs
	// (and mis-crafts junk buttons from the grid leftovers).
	await reclaimCraftingGrid(bot);
	const logs = windowItems(bot.inventory).filter((i) =>
		i.name.includes("_log"),
	);
	if (logs.length === 0) {
		return failure("No logs in inventory");
	}

	try {
		// Craft planks - 1 log = 4 planks, no crafting table needed
		for (const log of logs) {
			const plankName = log.name.replace("_log", "_planks");
			const plankId =
				bot.registry?.itemsByName.get(plankName)?.id ??
				bot.registry?.itemsByName.get("oak_planks")?.id;
			if (!plankId) continue;

			let recipes: Recipe[];
			try {
				recipes = bot.recipesFor(plankId, null, 1, null);
			} catch {
				continue;
			}
			const recipe = recipes[0];
			if (!recipe) continue;
			// bot.craft can DESYNC on a dirty 2x2 grid ("Missing ingredient id=…") or HANG
			// ("Promise timed out") — both stall the whole mid-game (leader stuck crafting the
			// planks it needs for a table→buckets). Race a timeout, and on any failure close the
			// window + re-reclaim the grid to resync, then retry once. Failure-path only.
			const before = windowItems(bot.inventory)
				.filter((i) => i.name === plankName)
				.reduce((n, i) => n + i.count, 0);
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					await Promise.race([
						bot.craft(recipe, Math.min(log.count, 8)),
						new Promise((_, rej) =>
							setTimeout(() => rej(new Error("craft timeout")), 8000),
						),
					]);
					break;
				} catch {
					if (bot.currentWindow) {
						try {
							bot.closeWindow(bot.currentWindow);
						} catch {}
						await sleep(250);
					}
					await reclaimCraftingGrid(bot);
					await sleep(150);
				}
			}
			const after = windowItems(bot.inventory)
				.filter((i) => i.name === plankName)
				.reduce((n, i) => n + i.count, 0);
			if (after > before) break; // got planks — stop; don't burn every log type
		}
		return success("Crafted planks from logs");
	} catch (err) {
		console.error(err);
		return failure(
			err instanceof Error ? err.message : "Failed to craft planks",
		);
	}
};

export const craftCraftingTable = (bot: Bot): Promise<StepResult> => {
	return craftItem(bot, "crafting_table", 1);
};

export const craftSticks = async (bot: Bot): Promise<StepResult> => {
	// Craft twice to get enough for tools (2 calls = 8 sticks)
	const r = await craftItem(bot, "stick", 1);
	if (!r.success) return r;
	return craftItem(bot, "stick", 1);
};

export const craftWoodenPickaxe = async (bot: Bot): Promise<StepResult> => {
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "wooden_pickaxe", 1, table);
};

export const craftStonePickaxe = async (bot: Bot): Promise<StepResult> => {
	if (countItems(bot, "stick") < 2) {
		const r = await craftItem(bot, "stick", 1);
		if (!r.success) return r;
	}
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "stone_pickaxe", 1, table);
};

export const craftStoneSword = async (bot: Bot): Promise<StepResult> => {
	if (countItems(bot, "stick") < 1) {
		const r = await craftItem(bot, "stick", 1);
		if (!r.success) return r;
	}
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "stone_sword", 1, table);
};

export const craftFurnace = async (bot: Bot): Promise<StepResult> => {
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "furnace", 1, table);
};

export const craftIronPickaxe = async (bot: Bot): Promise<StepResult> => {
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "iron_pickaxe", 1, table);
};

export const craftBucket = async (bot: Bot): Promise<StepResult> => {
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "bucket", 1, table);
};

export const craftFlintAndSteel = async (bot: Bot): Promise<StepResult> => {
	// Flint only drops from gravel (~10%/block) and there's no pickaxe here, so we
	// can't tunnel to buried gravel — we find EXPOSED gravel (surface patches,
	// beaches, ravine/cave walls) and flood-fill-mine whole pockets by hand until a
	// flint drops. See gather-flint.ts. Leave ~28s of the 120s step for the craft.
	await gatherFlint(bot, Date.now() + 92_000);

	if (!findItem(bot, "flint")) return failure("Need flint (dig gravel)");

	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");

	return craftItem(bot, "flint_and_steel", 1, table);
};

export const craftEyesOfEnder = async (
	bot: Bot,
	count: number,
): Promise<StepResult> => {
	try {
		// First craft blaze powder from rods
		const blazeRods = windowItems(bot.inventory).filter(
			(i) => i.name === "blaze_rod",
		);
		if (blazeRods.length > 0) {
			const powderId = bot.registry?.itemsByName.get("blaze_powder")?.id;
			if (powderId) {
				const powderRecipes = bot.recipesFor(powderId, null, 1, null);
				const powderRecipe = powderRecipes[0];
				if (powderRecipe) {
					await bot.craft(powderRecipe, Math.min(blazeRods[0]?.count ?? 1, 7));
				}
			}
		}

		// Craft eyes
		return craftItem(bot, "ender_eye", count);
	} catch (err) {
		return failure(err instanceof Error ? err.message : "Failed to craft eyes");
	}
};

export const craftBowAndArrows = async (bot: Bot): Promise<StepResult> => {
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");

	try {
		// Craft bow
		const bowResult = await craftItem(bot, "bow", 1, table);
		if (!bowResult.success) {
			console.log(`  Bow craft: ${bowResult.message}`);
		}

		// Craft arrows
		const arrowResult = await craftItem(bot, "arrow", 64, table);
		if (!arrowResult.success) {
			console.log(`  Arrow craft: ${arrowResult.message}`);
		}

		return success("Crafted bow and arrows");
	} catch (err) {
		return failure(err instanceof Error ? err.message : "Failed to craft");
	}
};
