/**
 * Step definitions for the Ender Dragon speedrun
 * Each step has conditions to check and an execute function
 */

import { getPickaxeTier } from "./state.ts";
import type { GameState, Step, StepResult } from "./types.ts";

// Re-export types for convenience
export type { Step, StepResult };

// ============================================
// STEP DEFINITIONS
// ============================================

export const steps: readonly Step[] = [
	// === PHASE 1: WOOD ===
	{
		id: "gather_wood",
		name: "Gather Wood",
		priority: 1,
		canExecute: (s) => s.world.dimension === "overworld" && s.alive,
		isComplete: (s) =>
			s.inventory.logs >= 5 ||
			s.inventory.planks >= 12 ||
			s.equipment.hasCraftingTable,
		execute: async (bot, _state) => {
			const { gatherWood } = await import("./tasks/gather-wood/main.ts");
			return gatherWood(bot, 5);
		},
	},

	{
		id: "craft_planks",
		name: "Craft Planks",
		priority: 2,
		canExecute: (s) => s.inventory.logs >= 2,
		isComplete: (s) => s.inventory.planks >= 8 || s.equipment.hasCraftingTable,
		execute: async (bot, _state) => {
			const { craftPlanks } = await import("./tasks/craft/main.ts");
			return craftPlanks(bot);
		},
	},

	{
		id: "craft_crafting_table",
		name: "Craft Crafting Table",
		priority: 3,
		canExecute: (s) => s.inventory.planks >= 4,
		isComplete: (s) => s.equipment.hasCraftingTable,
		execute: async (bot, _state) => {
			const { craftCraftingTable } = await import("./tasks/craft/main.ts");
			return craftCraftingTable(bot);
		},
	},

	{
		id: "craft_sticks",
		name: "Craft Sticks",
		priority: 4,
		canExecute: (s) => s.inventory.planks >= 2,
		isComplete: (s) => s.inventory.sticks >= 4,
		execute: async (bot, _state) => {
			const { craftSticks } = await import("./tasks/craft/main.ts");
			return craftSticks(bot);
		},
	},

	{
		id: "craft_wooden_pickaxe",
		name: "Craft Wooden Pickaxe",
		priority: 5,
		canExecute: (s) => s.inventory.planks >= 3 && s.inventory.sticks >= 2,
		isComplete: (s) => getPickaxeTier(s.equipment.pickaxe) >= 1,
		execute: async (bot, _state) => {
			const { craftWoodenPickaxe } = await import("./tasks/craft/main.ts");
			return craftWoodenPickaxe(bot);
		},
	},

	// === PHASE 2: STONE ===
	{
		id: "mine_stone",
		name: "Mine Cobblestone",
		priority: 6,
		canExecute: (s) => getPickaxeTier(s.equipment.pickaxe) >= 1,
		isComplete: (s) => s.inventory.cobblestone >= 16,
		execute: async (bot, _state) => {
			const { mineBlock } = await import("./tasks/mining/main.ts");
			return mineBlock(bot, "stone", 16);
		},
	},

	{
		id: "craft_stone_pickaxe",
		name: "Craft Stone Pickaxe",
		priority: 7,
		canExecute: (s) => s.inventory.cobblestone >= 3 && s.inventory.sticks >= 2,
		isComplete: (s) => getPickaxeTier(s.equipment.pickaxe) >= 2,
		execute: async (bot, _state) => {
			const { craftStonePickaxe } = await import("./tasks/craft/main.ts");
			return craftStonePickaxe(bot);
		},
	},

	{
		id: "craft_stone_sword",
		name: "Craft Stone Sword",
		priority: 8,
		canExecute: (s) => s.inventory.cobblestone >= 2 && s.inventory.sticks >= 1,
		isComplete: (s) => s.equipment.sword !== "none",
		execute: async (bot, _state) => {
			const { craftStoneSword } = await import("./tasks/craft/main.ts");
			return craftStoneSword(bot);
		},
	},

	{
		id: "craft_furnace",
		name: "Craft Furnace",
		priority: 9,
		canExecute: (s) => s.inventory.cobblestone >= 8,
		isComplete: (s) => s.equipment.hasFurnace,
		execute: async (bot, _state) => {
			const { craftFurnace } = await import("./tasks/craft/main.ts");
			return craftFurnace(bot);
		},
	},

	// === PHASE 3: IRON ===
	{
		id: "mine_coal",
		name: "Mine Coal",
		priority: 10,
		canExecute: (s) => getPickaxeTier(s.equipment.pickaxe) >= 1,
		isComplete: (s) => s.inventory.coal >= 10,
		execute: async (bot, _state) => {
			const { mineBlock } = await import("./tasks/mining/main.ts");
			return mineBlock(bot, "coal_ore", 10);
		},
	},

	{
		id: "mine_iron",
		name: "Mine Iron Ore",
		priority: 11,
		canExecute: (s) => getPickaxeTier(s.equipment.pickaxe) >= 2,
		isComplete: (s) => s.inventory.ironOre + s.inventory.ironIngots >= 11,
		execute: async (bot, _state) => {
			const { mineBlock } = await import("./tasks/mining/main.ts");
			return mineBlock(bot, "iron_ore", 11);
		},
	},

	{
		id: "smelt_iron",
		name: "Smelt Iron",
		priority: 12,
		canExecute: (s) =>
			s.equipment.hasFurnace &&
			s.inventory.ironOre >= 3 &&
			(s.inventory.coal >= 2 || s.inventory.planks >= 4),
		isComplete: (s) => s.inventory.ironIngots >= 11,
		execute: async (bot, _state) => {
			const { smeltItems } = await import("./tasks/smelt/main.ts");
			return smeltItems(bot, "raw_iron", 11);
		},
	},

	{
		id: "craft_iron_pickaxe",
		name: "Craft Iron Pickaxe",
		priority: 13,
		canExecute: (s) => s.inventory.ironIngots >= 3 && s.inventory.sticks >= 2,
		isComplete: (s) => getPickaxeTier(s.equipment.pickaxe) >= 3,
		execute: async (bot, _state) => {
			const { craftIronPickaxe } = await import("./tasks/craft/main.ts");
			return craftIronPickaxe(bot);
		},
	},

	{
		id: "craft_bucket",
		name: "Craft Buckets",
		priority: 14,
		canExecute: (s) => s.inventory.ironIngots >= 3,
		isComplete: (s) => s.inventory.buckets + s.inventory.waterBuckets >= 2,
		execute: async (bot, _state) => {
			const { craftBucket } = await import("./tasks/craft/main.ts");
			const r1 = await craftBucket(bot);
			if (!r1.success) return r1;
			return craftBucket(bot);
		},
	},

	{
		id: "get_water_buckets",
		name: "Fill Water Buckets",
		priority: 15,
		canExecute: (s) => s.inventory.buckets >= 1,
		isComplete: (s) => s.inventory.waterBuckets >= 2,
		execute: async (bot, _state) => {
			const { fillWaterBucket } = await import("./tasks/bucket/main.ts");
			const r1 = await fillWaterBucket(bot);
			if (!r1.success) return r1;
			return fillWaterBucket(bot);
		},
	},

	{
		id: "gather_food",
		name: "Gather Food",
		priority: 16,
		canExecute: (s) => s.equipment.sword !== "none",
		isComplete: (s) => s.inventory.food >= 5,
		execute: async (bot, _state) => {
			const { gatherFood } = await import("./tasks/food/main.ts");
			return gatherFood(bot, 5);
		},
	},

	// === PHASE 4: NETHER PREP ===
	{
		id: "get_flint_and_steel",
		name: "Get Flint and Steel",
		priority: 17,
		canExecute: (s) => s.inventory.ironIngots >= 1,
		isComplete: (s) => s.inventory.flintAndSteel >= 1,
		execute: async (bot, _state) => {
			const { craftFlintAndSteel } = await import("./tasks/craft/main.ts");
			return craftFlintAndSteel(bot);
		},
	},

	{
		id: "build_nether_portal",
		name: "Build Nether Portal",
		priority: 18,
		canExecute: (s) =>
			s.equipment.hasWaterBucket &&
			s.inventory.flintAndSteel >= 1 &&
			s.world.dimension === "overworld",
		isComplete: (s) => s.world.portalBuilt,
		execute: async (bot, _state) => {
			const { buildNetherPortal } = await import("./tasks/portal/build.ts");
			return buildNetherPortal(bot);
		},
	},

	// === PHASE 5: NETHER ===
	{
		id: "enter_nether",
		name: "Enter Nether",
		priority: 19,
		canExecute: (s) => s.world.portalBuilt && s.world.dimension === "overworld",
		isComplete: (s) => s.world.dimension === "nether",
		execute: async (bot, _state) => {
			const { enterPortal } = await import("./tasks/portal/enter.ts");
			return enterPortal(bot);
		},
	},

	{
		id: "find_fortress",
		name: "Find Nether Fortress",
		priority: 20,
		canExecute: (s) => s.world.dimension === "nether",
		isComplete: (s) => s.world.fortressFound,
		execute: async (bot, _state) => {
			const { findFortress } = await import("./tasks/nether/main.ts");
			return findFortress(bot);
		},
	},

	{
		id: "kill_blazes",
		name: "Kill Blazes",
		priority: 21,
		canExecute: (s) => s.world.fortressFound && s.equipment.sword !== "none",
		isComplete: (s) => s.inventory.blazeRods >= 7,
		execute: async (bot, _state) => {
			const { killBlazes } = await import("./tasks/nether/main.ts");
			return killBlazes(bot, 7);
		},
	},

	{
		id: "hunt_endermen",
		name: "Hunt Endermen",
		priority: 22,
		canExecute: (s) => s.equipment.sword !== "none",
		isComplete: (s) => s.inventory.enderPearls >= 14,
		execute: async (bot, _state) => {
			const { huntEndermen } = await import("./tasks/combat/main.ts");
			return huntEndermen(bot, 14);
		},
	},

	{
		id: "return_overworld",
		name: "Return to Overworld",
		priority: 23,
		canExecute: (s) =>
			s.world.dimension === "nether" &&
			s.inventory.blazeRods >= 6 &&
			s.inventory.enderPearls >= 12,
		isComplete: (s) =>
			s.world.dimension === "overworld" &&
			s.inventory.blazeRods >= 6 &&
			s.inventory.enderPearls >= 12,
		execute: async (bot, _state) => {
			const { enterPortal } = await import("./tasks/portal/enter.ts");
			return enterPortal(bot);
		},
	},

	// === PHASE 6: STRONGHOLD ===
	{
		id: "craft_eyes_of_ender",
		name: "Craft Eyes of Ender",
		priority: 24,
		canExecute: (s) =>
			s.inventory.blazeRods >= 6 && s.inventory.enderPearls >= 12,
		isComplete: (s) => s.inventory.eyesOfEnder >= 12,
		execute: async (bot, _state) => {
			const { craftEyesOfEnder } = await import("./tasks/craft/main.ts");
			return craftEyesOfEnder(bot, 12);
		},
	},

	{
		id: "find_stronghold",
		name: "Find Stronghold",
		priority: 25,
		canExecute: (s) =>
			s.inventory.eyesOfEnder >= 12 && s.world.dimension === "overworld",
		isComplete: (s) => s.world.strongholdFound,
		execute: async (bot, _state) => {
			const { findStronghold } = await import("./tasks/stronghold/find.ts");
			return findStronghold(bot);
		},
	},

	{
		id: "activate_portal",
		name: "Activate End Portal",
		priority: 26,
		canExecute: (s) => s.world.strongholdFound && s.inventory.eyesOfEnder >= 10,
		isComplete: (s) => s.world.portalActivated,
		execute: async (bot, _state) => {
			const { activateEndPortal } = await import(
				"./tasks/stronghold/activate.ts"
			);
			return activateEndPortal(bot);
		},
	},

	// === PHASE 7: END ===
	{
		id: "craft_bow",
		name: "Craft Bow and Arrows",
		priority: 27,
		canExecute: (s) => s.inventory.sticks >= 3 && s.inventory.string >= 3,
		isComplete: (s) => s.equipment.hasBow && s.inventory.arrows >= 64,
		execute: async (bot, _state) => {
			const { craftBowAndArrows } = await import("./tasks/craft/main.ts");
			return craftBowAndArrows(bot);
		},
	},

	{
		id: "enter_end",
		name: "Enter The End",
		priority: 28,
		canExecute: (s) =>
			s.world.portalActivated &&
			s.equipment.hasBow &&
			s.equipment.sword !== "none",
		isComplete: (s) => s.world.dimension === "end",
		execute: async (bot, _state) => {
			const { enterEndPortal } = await import("./tasks/portal/enter.ts");
			return enterEndPortal(bot);
		},
	},

	{
		id: "destroy_crystals",
		name: "Destroy End Crystals",
		priority: 29,
		canExecute: (s) => s.world.dimension === "end" && s.equipment.hasBow,
		isComplete: (s) => s.world.crystalsDestroyed >= 10,
		execute: async (bot, _state) => {
			const { destroyCrystals } = await import("./tasks/end/main.ts");
			return destroyCrystals(bot);
		},
	},

	{
		id: "kill_dragon",
		name: "Kill Ender Dragon",
		priority: 30,
		canExecute: (s) =>
			s.world.dimension === "end" &&
			s.world.crystalsDestroyed >= 10 &&
			s.equipment.sword !== "none",
		isComplete: (s) => s.world.dragonDead,
		execute: async (bot, _state) => {
			const { killDragon } = await import("./tasks/end/main.ts");
			return killDragon(bot);
		},
	},
];

// ============================================
// STEP FUNCTIONS
// ============================================

export const getNextStep = (
	state: GameState,
	completed?: Set<string>,
): Step | null => {
	const sortedSteps = [...steps].sort((a, b) => a.priority - b.priority);
	return (
		sortedSteps.find(
			(step) =>
				!completed?.has(step.id) &&
				step.canExecute(state) &&
				!step.isComplete(state),
		) ?? null
	);
};

export const getCompletedSteps = (state: GameState): Step[] =>
	steps.filter((step) => step.isComplete(state));

export const getProgress = (
	state: GameState,
): { completed: number; total: number; percent: number } => {
	const completed = getCompletedSteps(state).length;
	const total = steps.length;
	return { completed, total, percent: Math.round((completed / total) * 100) };
};
