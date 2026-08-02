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
	getBlock,
	getCraftingTable,
	goTo,
	interactReliably,
	reclaimCraftingGrid,
	success,
} from "../../lib/bot-utils.ts";
import type { StepResult } from "../../types.ts";

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
			if (recipe) {
				await bot.craft(recipe, Math.min(log.count, 8));
			}
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
	// Flint drops from gravel only ~10% per block, so dig MANY until we get one —
	// a single dig (the old behavior) failed ~90% of the time in one call.
	const deadline = Date.now() + 90_000;
	const giveUp = new Set<string>();
	while (!findItem(bot, "flint") && Date.now() < deadline) {
		const gravel = bot.findBlock({
			matching: (name) => name === "gravel",
			maxDistance: 32,
		});
		if (!gravel) break;
		const key = `${gravel.position.x},${gravel.position.y},${gravel.position.z}`;
		// Move into reach + face + dig + verify the gravel is gone — keep trying
		// other gravel on failure rather than bailing on the first hiccup.
		const dug = await interactReliably(bot, {
			target: gravel.position,
			reach: 3,
			attempts: 3,
			action: async () => {
				await bot.dig(gravel);
			},
			verify: () => getBlock(bot, gravel.position)?.name !== "gravel",
		});
		if (dug) {
			await bot.collectDrops(6, 3000, async (p) => {
				await goTo(bot, p, { range: 1.4, timeout: 3000 });
			});
		} else {
			if (giveUp.has(key)) break; // same block won't dig twice — stop
			giveUp.add(key);
		}
	}

	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	if (!findItem(bot, "flint")) return failure("Need flint (dig gravel)");

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
