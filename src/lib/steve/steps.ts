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
	// === PRIORITY 0: SURVIVAL — GET OUT OF THE WATER ===
	// The 0th step, evaluated every cycle like any other (no special override). The
	// instant the bot is in the water trap this is the top runnable step, so it wins
	// over whatever it was doing (mining, etc.); the instant it's on dry land it's
	// complete and the normal chain resumes. Mining/long tasks also self-bail when
	// inWaterTrap, so the running action stops fighting the escape immediately.
	{
		id: "escape_water",
		name: "Get Out Of Water",
		priority: 0,
		canExecute: (s) => s.inWaterTrap,
		isComplete: (s) => !s.inWaterTrap,
		execute: async (bot, _state) => {
			try {
				bot.clearControlStates();
			} catch {}
			try {
				bot.stopDigging();
			} catch {}
			const { escapeWater } = await import("./lib/bot-utils.ts");
			const ok = await escapeWater(bot);
			return {
				success: ok,
				message: ok ? "out of water — back to dry land" : "still escaping water",
			};
		},
	},

	// === PHASE 1: WOOD ===
	{
		id: "gather_wood",
		name: "Gather Wood",
		priority: 1,
		canExecute: (s) => s.world.dimension === "overworld" && s.alive,
		// Maintain a wood/plank reserve so later steps (sticks, tools, beds) can
		// always be crafted. Must NOT short-circuit on hasCraftingTable, or the
		// bot stops replenishing wood once it has a table and deadlocks when
		// planks run out. canExecute gates this to the overworld.
		// Once the iron pickaxe is crafted, nothing left (buckets/water/flint&steel/
		// portal) needs wood — stop forcing pointless re-gathering, which deadlocks
		// in tree-poor terrain.
		isComplete: (s) =>
			s.inventory.logs >= 5 ||
			s.inventory.planks >= 20 ||
			getPickaxeTier(s.equipment.pickaxe) >= 3 ||
			// Past the wood phase (iron in hand / a furnace built) → stop re-gathering,
			// BUT only while we can still actually craft: a reachable crafting table, or
			// ENOUGH wood to make one. A table costs 4 planks (= 1 log), so `planks > 0`
			// was too lenient — a bot with 1-3 planks and no table would stop gathering
			// yet couldn't craft a table, deadlocking forever on "Craft Stone Pickaxe →
			// Need crafting table" (observed live). Require enough wood for a table.
			((s.inventory.ironOre + s.inventory.ironIngots >= 1 ||
				s.equipment.hasFurnace) &&
				(s.equipment.hasCraftingTable ||
					s.inventory.planks >= 4 ||
					s.inventory.logs >= 1)),
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
		// Keep a plank reserve; do not short-circuit on hasCraftingTable (see
		// Gather Wood) — otherwise planks are never replenished after tools.
		// Reserve enough planks for the whole early tool chain (table 4 + sticks +
		// pickaxe 3 + sword + furnace cobble-crafting) but a REACHABLE amount — the old
		// `>= 20` could stall the bot in an infinite craft-planks loop when it couldn't
		// quite reach 20 (it sat at 16 for 1.5h), starving every later step.
		isComplete: (s) =>
			s.inventory.planks >= 12 ||
			getPickaxeTier(s.equipment.pickaxe) >= 3 ||
			s.inventory.ironOre + s.inventory.ironIngots >= 1 ||
			s.equipment.hasFurnace,
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
		isComplete: (s) =>
			s.inventory.sticks >= 8 || getPickaxeTier(s.equipment.pickaxe) >= 3,
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
		// Sword is only needed for hunting food; on a peaceful server we skip both.
		// Once past the wood phase (stone pickaxe), don't gate the run on it.
		isComplete: (s) =>
			s.equipment.sword !== "none" ||
			getPickaxeTier(s.equipment.pickaxe) >= 2,
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
		// Coal is only fuel for smelting (1 coal smelts 8 items). Once iron is
		// smelted, more coal is dead weight — short-circuit, or the bot grinds
		// sparse no-x-ray coal forever (coal drops <10 after smelting → refires)
		// and never advances to buckets/water/cast.
		// planks>=16: WOOD is also valid furnace fuel (smeltItems + smelt_iron accept
		// planks), so a bot that can't find coal (sparse ore / relocate-loop) but holds
		// AMPLE planks must NOT be trapped mining coal forever — fall through to smelt
		// with wood (race-4 leader stall: 0 coal, 12 planks, churned Mine Coal 25 min).
		// Threshold is 16 (not 8): smelting 8 iron burns ~6 planks, and buckets need a
		// crafting TABLE (4 planks) — at 8 the bot smelted away every plank and then
		// couldn't build the table, deadlocking at Craft Buckets with 9 ingots (race-5).
		// 16 keeps a ~10-plank reserve for the table + tools after wood-smelting.
		isComplete: (s) =>
			s.inventory.coal >= 6 ||
			s.inventory.ironIngots >= 7 ||
			s.inventory.planks >= 16 ||
			// READY TO SMELT → stop mining coal and go smelt with wood. Without this, a bot
			// whose plank count dips below 16 (after crafting a table/tools) re-triggers
			// Mine Coal, which relocate-LOOPS on sparse ore ("Relocated toward X,Y" forever)
			// — the live race-8 leader froze at 6 raw_iron for 20 min thrashing coal despite
			// having furnace+iron+21 planks. If it can smelt now, it should.
			(s.equipment.hasFurnace &&
				s.inventory.ironOre >= 3 &&
				s.inventory.planks >= 6),
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
		// 8 is enough for the cast kit: 2 buckets (6) + flint&steel (1). No iron
		// pickaxe needed (obsidian is cast, not mined), so we don't need 11.
		// Count iron already INVESTED in the kit (each bucket = 3 iron, flint&steel = 1):
		// otherwise, after crafting buckets the loose iron drops below 8 and the bot
		// re-mines iron it already gathered — timing out forever (higher priority than
		// fill-water/flint&steel) instead of finishing the kit it already has.
		isComplete: (s) =>
			s.inventory.ironOre +
				s.inventory.ironIngots +
				(s.inventory.buckets + s.inventory.waterBuckets) * 3 +
				(s.inventory.flintAndSteel >= 1 ? 1 : 0) >=
			8,
		execute: async (bot, _state) => {
			const { mineBlock } = await import("./tasks/mining/main.ts");
			return mineBlock(bot, "iron_ore", 8);
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
		// Count iron already invested in buckets (3 each) so a bot that smelted, then
		// spent ingots on buckets, doesn't loop back to re-smelt iron it no longer has.
		isComplete: (s) =>
			s.inventory.ironIngots +
				(s.inventory.buckets + s.inventory.waterBuckets) * 3 >=
			7,
		execute: async (bot, _state) => {
			const { smeltItems } = await import("./tasks/smelt/main.ts");
			return smeltItems(bot, "raw_iron", 8);
		},
	},

	{
		id: "craft_iron_pickaxe",
		name: "Craft Iron Pickaxe",
		priority: 13,
		// Defer the iron pickaxe until the portal kit is already in hand (2 buckets +
		// flint&steel). It is NOT needed to reach the nether — obsidian is CAST, not
		// mined — and crafting it early steals 3 of the ~7 iron the kit needs, stranding
		// the bot at iron_ingot ~4-8 unable to finish the buckets (the recurring stall).
		canExecute: (s) =>
			s.inventory.ironIngots >= 3 &&
			s.inventory.sticks >= 2 &&
			s.inventory.waterBuckets >= 1 &&
			s.inventory.buckets >= 1 &&
			s.inventory.flintAndSteel >= 1,
		isComplete: (s) => getPickaxeTier(s.equipment.pickaxe) >= 2,
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
		// Fill ONE bucket — the other stays empty for the cast to scoop lava from
		// the pool. Water is reused by the sealed-bowl cast, so one is enough.
		isComplete: (s) => s.inventory.waterBuckets >= 1,
		execute: async (bot, _state) => {
			const { fillWaterBucket } = await import("./tasks/bucket/main.ts");
			return fillWaterBucket(bot);
		},
	},

	{
		id: "gather_food",
		name: "Gather Food",
		priority: 16,
		canExecute: (s) => s.equipment.sword !== "none",
		// Peaceful server → no hunger damage, so food isn't needed to reach the
		// nether. Skip it once past the wood phase so it never blocks the cast.
		isComplete: (s) =>
			s.inventory.food >= 5 || getPickaxeTier(s.equipment.pickaxe) >= 2,
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
		// Needs a water bucket (reused via the sealed-bowl cast) + one empty bucket
		// (the cast fills it with lava from the pool, refilling each block) + flint.
		canExecute: (s) =>
			s.inventory.waterBuckets >= 1 &&
			s.inventory.buckets >= 1 &&
			s.inventory.flintAndSteel >= 1 &&
			s.world.dimension === "overworld",
		isComplete: (s) => s.world.portalBuilt,
		execute: async (bot, _state) => {
			const { prepareCastSite, buildPortalByCasting } = await import(
				"./tasks/portal/cast.ts"
			);
			// Clear a flat site next to a lava pool + fill the lava bucket, then
			// cast the 10-obsidian frame and light it (no diamond, no cheats).
			const prep = await prepareCastSite(bot);
			if (!prep.success) return prep;
			return buildPortalByCasting(bot);
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
	// Exclude the priority-0 escape_water survival step from the 30-step progress count.
	const chain = steps.filter((s) => s.id !== "escape_water");
	const completed = chain.filter((s) => s.isComplete(state)).length;
	const total = chain.length;
	return { completed, total, percent: Math.round((completed / total) * 100) };
};
