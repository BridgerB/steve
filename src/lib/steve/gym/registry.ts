/**
 * GYM registry — each speedrun sub-task as an isolatable exercise. A gym run gives
 * the bot the prerequisites it would normally hold at that point, teleports it to a
 * RANDOM location, and runs just that one task, so we can measure how well each step
 * performs across terrain (and track it over time). Consumed by the /gym web UI and
 * by the node:test suite (each task's test.ts can call runGymStep).
 */
import type { Bot } from "typecraft";
import {
	craftBucket,
	craftCraftingTable,
	craftFlintAndSteel,
	craftFurnace,
	craftIronPickaxe,
	craftPlanks,
	craftStonePickaxe,
	craftStoneSword,
	craftSticks,
	craftWoodenPickaxe,
} from "../tasks/craft/main.ts";
import { fillWaterBucket } from "../tasks/bucket/main.ts";
import { gatherFood } from "../tasks/food/main.ts";
import { gatherWood } from "../tasks/gather-wood/main.ts";
import { mineBlock } from "../tasks/mining/main.ts";
import { smeltItems } from "../tasks/smelt/main.ts";
import { countInventoryItems } from "../lib/test-utils.ts";
import type { StepResult } from "../types.ts";

export interface GymStep {
	slug: string;
	label: string;
	order: number;
	/** Prereqs to `/give` (item + count) — what the bot would hold entering this step. */
	prereq: string[];
	/** Run just this task. */
	run: (bot: Bot) => Promise<StepResult>;
	/** Did it produce what it should? (checked on the real inventory after run) */
	pass: (bot: Bot) => boolean;
	timeoutMs: number;
}

const has = (bot: Bot, pat: string, n: number): boolean =>
	countInventoryItems(bot, pat) >= n;

export const GYM_STEPS: GymStep[] = [
	{ slug: "gather-wood", label: "Gather Wood", order: 1, prereq: [], run: (b) => gatherWood(b, 4), pass: (b) => has(b, "_log", 4), timeoutMs: 90000 },
	{ slug: "craft-planks", label: "Craft Planks", order: 2, prereq: ["oak_log 8"], run: (b) => craftPlanks(b), pass: (b) => has(b, "_planks", 4), timeoutMs: 25000 },
	{ slug: "craft-table", label: "Craft Crafting Table", order: 3, prereq: ["oak_planks 8"], run: (b) => craftCraftingTable(b), pass: (b) => has(b, "crafting_table", 1), timeoutMs: 25000 },
	{ slug: "craft-sticks", label: "Craft Sticks", order: 4, prereq: ["oak_planks 8"], run: (b) => craftSticks(b), pass: (b) => has(b, "stick", 4), timeoutMs: 25000 },
	{ slug: "craft-wooden-pickaxe", label: "Craft Wooden Pickaxe", order: 5, prereq: ["oak_planks 8", "stick 8", "crafting_table 1"], run: (b) => craftWoodenPickaxe(b), pass: (b) => has(b, "wooden_pickaxe", 1), timeoutMs: 40000 },
	{ slug: "mine-cobblestone", label: "Mine Cobblestone", order: 6, prereq: ["wooden_pickaxe 1"], run: (b) => mineBlock(b, "stone", 16), pass: (b) => has(b, "cobblestone", 16), timeoutMs: 120000 },
	{ slug: "craft-stone-pickaxe", label: "Craft Stone Pickaxe", order: 7, prereq: ["cobblestone 8", "stick 8", "crafting_table 1"], run: (b) => craftStonePickaxe(b), pass: (b) => has(b, "stone_pickaxe", 1), timeoutMs: 40000 },
	{ slug: "craft-stone-sword", label: "Craft Stone Sword", order: 8, prereq: ["cobblestone 4", "stick 4", "crafting_table 1"], run: (b) => craftStoneSword(b), pass: (b) => has(b, "stone_sword", 1), timeoutMs: 40000 },
	{ slug: "craft-furnace", label: "Craft Furnace", order: 9, prereq: ["cobblestone 16", "crafting_table 1"], run: (b) => craftFurnace(b), pass: (b) => has(b, "furnace", 1), timeoutMs: 40000 },
	{ slug: "mine-coal", label: "Mine Coal", order: 10, prereq: ["stone_pickaxe 1"], run: (b) => mineBlock(b, "coal_ore", 6), pass: (b) => has(b, "coal", 3), timeoutMs: 120000 },
	{ slug: "mine-iron", label: "Mine Iron Ore", order: 11, prereq: ["stone_pickaxe 1"], run: (b) => mineBlock(b, "iron_ore", 5), pass: (b) => has(b, "raw_iron", 3), timeoutMs: 150000 },
	{ slug: "smelt-iron", label: "Smelt Iron", order: 12, prereq: ["raw_iron 8", "coal 8", "furnace 1"], run: (b) => smeltItems(b, 8), pass: (b) => has(b, "iron_ingot", 3), timeoutMs: 90000 },
	{ slug: "craft-iron-pickaxe", label: "Craft Iron Pickaxe", order: 13, prereq: ["iron_ingot 3", "stick 2", "crafting_table 1"], run: (b) => craftIronPickaxe(b), pass: (b) => has(b, "iron_pickaxe", 1), timeoutMs: 40000 },
	{ slug: "craft-buckets", label: "Craft Buckets", order: 14, prereq: ["iron_ingot 6", "crafting_table 1"], run: (b) => craftBucket(b), pass: (b) => has(b, "bucket", 1), timeoutMs: 40000 },
	{ slug: "fill-water", label: "Fill Water Buckets", order: 15, prereq: ["bucket 2"], run: (b) => fillWaterBucket(b), pass: (b) => has(b, "water_bucket", 1), timeoutMs: 60000 },
	{ slug: "gather-food", label: "Gather Food", order: 16, prereq: ["stone_sword 1"], run: (b) => gatherFood(b, 3), pass: (b) => countInventoryItems(b, "beef") + countInventoryItems(b, "mutton") + countInventoryItems(b, "chicken") + countInventoryItems(b, "porkchop") >= 1, timeoutMs: 90000 },
	{ slug: "flint-and-steel", label: "Get Flint and Steel", order: 17, prereq: ["iron_ingot 1", "crafting_table 1"], run: (b) => craftFlintAndSteel(b), pass: (b) => has(b, "flint_and_steel", 1), timeoutMs: 120000 },
];

export const GYM_BY_SLUG = new Map(GYM_STEPS.map((s) => [s.slug, s]));

/** Client-safe view (no functions) for the web UI. */
export const gymStepMeta = () =>
	GYM_STEPS.map(({ slug, label, order }) => ({ slug, label, order }));
