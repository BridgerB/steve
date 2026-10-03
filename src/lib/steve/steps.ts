/**
 * Step definitions for the Ender Dragon speedrun
 * Each step has conditions to check and an execute function
 */

import { getPickaxeTier } from "./state.ts";
import type { GameState, Step, StepResult } from "./types.ts";

// Cycle 4 (decision 5): the race kit carries lava — 3 buckets (two for lava, one for
// water) so the cast front-loads lava. Iron need = 3 buckets × 3 + flint&steel 1.
export const KIT_BUCKETS = 3;
export const IRON_NEED = KIT_BUCKETS * 3 + 1;
const kitBuckets = (s: GameState): number =>
	s.inventory.buckets + s.inventory.waterBuckets + s.inventory.lavaBuckets;

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
			// Iron kit done (2 buckets in hand): nothing left on the critical path needs
			// wood, so never climb 80 levels out of the mine for logs again (race41 723:
			// 2 buckets + 2 ingots, spent 4+ min on Gather Wood from y28).
			// …but only while a stone pickaxe can still be re-crafted (race46 743: the
			// pick wore out, 0 planks, no table → 'Need crafting table' every 3s forever).
			(kitBuckets(s) >= KIT_BUCKETS &&
				(s.equipment.hasCraftingTable || s.inventory.planks >= 4)) ||
			s.inventory.logs >= 5 ||
			s.inventory.planks >= 20 ||
			// With a table already placed, 12 planks covers the whole early tool chain
			// (sticks 2 + wooden pick 3 + spare table 4) — the same reserve Craft
			// Planks targets. Demanding 20 sent a bot with 16 planks back to a savanna
			// tree whose only logs left were canopy branches it couldn't reach (race
			// 586: 3+ min blacklisting logs one at a time while holding a full kit).
			(s.equipment.hasCraftingTable && s.inventory.planks >= 12) ||
			getPickaxeTier(s.equipment.pickaxe) >= 3 ||
			// Past the wood phase (iron in hand / a furnace built) → stop re-gathering,
			// BUT only while we can still actually craft: a reachable crafting table, or
			// ENOUGH wood to make one. A table costs 4 planks (= 1 log), so `planks > 0`
			// was too lenient — a bot with 1-3 planks and no table would stop gathering
			// yet couldn't craft a table, deadlocking forever on "Craft Stone Pickaxe →
			// Need crafting table" (observed live). Require enough wood for a table.
			// Once smelting is on the table, WOOD is also fuel (smelt with planks), so a bot
			// that has a table but few planks must KEEP gathering — else it deadlocks: won't
			// gather wood, can't smelt with wood (needs ~6 planks), and coal-mining stalls
			// (live race-11 leader: table + 2 planks + no coal, stuck). Done only when it has
			// real fuel: coal, OR enough planks for a table + a wood-smelt (>=12), OR an iron
			// pickaxe / 20 planks (handled above).
			// AND it can still (re)craft a crafting table — buckets are crafted at a table, so
			// a bot that smelted (planks burned as fuel) and has coal but 0 wood + no reachable
			// table deadlocks forever on "Craft Buckets/Stone Pickaxe → Need crafting table"
			// (race31/178, race32/181). Require a table already, or wood to make one (1 log =
			// 4 planks), else keep gathering so the table (hence buckets) can be crafted.
			((s.inventory.ironOre + s.inventory.ironIngots >= 1 ||
				s.equipment.hasFurnace) &&
				// Enough smelt fuel to STOP re-gathering wood and let Smelt Iron run. The old
				// `coal>=2||planks>=12` was too strict AND ignored logs: 1 coal smelts a full
				// 8-item furnace load, ~6 planks smelt 8 iron, and 2 logs = 8 planks — yet a
				// bot with 1 coal (or 2-3 logs) + furnace + raw_iron stayed "not done", so
				// gather_wood (priority 1) preempted Smelt Iron every tick and, on a cell whose
				// near trees were depleted, oscillated forever chasing far wood (`Gather Wood
				// timed out 210s`) with 6-8 raw iron it never smelted (race123/299, race124/303
				// — the deepest wall). Count coal, planks, OR logs as valid fuel.
				// … and fuel only matters while there is RAW iron to smelt: a bot with 8
				// ingots and 6 planks (race34 692, after losing 25 planks to junk buttons)
				// climbed 57 blocks for firewood it would never burn.
				// … and a stray raw_iron with the ingot kit already in hand (race37 707:
				// 8 ingots + 1 reclaimed raw_iron + 6 planks → an 85-block climb for
				// firewood) doesn't count either.
				(s.inventory.ironOre === 0 ||
					s.inventory.ironIngots >= IRON_NEED ||
					s.inventory.coal >= 1 ||
					s.inventory.planks >= 8 ||
					s.inventory.logs >= 2) &&
				(s.equipment.hasCraftingTable ||
					s.inventory.logs >= 1 ||
					s.inventory.planks >= 4)),
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
			s.inventory.ironIngots >= IRON_NEED ||
			s.inventory.planks >= 16 ||
			// Bucket kit already crafted → nothing left to smelt, coal is dead weight.
			// Race 606 had 2 buckets + 2 ingots (< 7) and spent 6 min relocate-looping
			// on Mine Coal instead of going to fill water.
			kitBuckets(s) >= KIT_BUCKETS ||
			// READY TO SMELT → stop mining coal and go smelt with wood. Without this, a bot
			// whose plank count dips below 16 (after crafting a table/tools) re-triggers
			// Mine Coal, which relocate-LOOPS on sparse ore ("Relocated toward X,Y" forever)
			// — the live race-8 leader froze at 6 raw_iron for 20 min thrashing coal despite
			// having furnace+iron+21 planks. If it can smelt now, it should.
			(s.equipment.hasFurnace &&
				s.inventory.ironOre >= 3 &&
				s.inventory.planks >= 6) ||
			// Furnace + enough WOOD fuel to smelt the 8-ingot kit (~6 planks; logs
			// smelt too) → coal is optional. Race26 661 and race27 666/667 spent
			// their whole runs relocate-looping for coal at y50 while holding a
			// furnace and a stack of planks, never reaching iron.
			(s.equipment.hasFurnace && s.inventory.planks + s.inventory.logs * 4 >= 10),
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
		// 7 is enough for the cast kit: 2 buckets (6) + flint&steel (1). No iron
		// pickaxe needed (obsidian is cast, not mined), so we don't need 11.
		// Count iron already INVESTED in the kit (each bucket = 3 iron, flint&steel = 1):
		// otherwise, after crafting buckets the loose iron drops below 8 and the bot
		// re-mines iron it already gathered — timing out forever (higher priority than
		// fill-water/flint&steel) instead of finishing the kit it already has.
		isComplete: (s) =>
			s.inventory.ironOre +
				s.inventory.ironIngots +
				kitBuckets(s) * 3 +
				(s.inventory.flintAndSteel >= 1 ? 1 : 0) >=
			IRON_NEED,
		execute: async (bot, _state) => {
			const { mineBlock } = await import("./tasks/mining/main.ts");
			// Only the iron still MISSING from the kit — the band loop otherwise mines
			// until 8 loose raw_iron (race28 669 went back to y24 after buckets + flint
			// and steel were already crafted).
			const kit =
				kitBuckets(_state) * 3 +
				(_state.inventory.flintAndSteel >= 1 ? 1 : 0);
			// 7 = 2 buckets (6) + flint&steel (1). race39 712 sat 20 min in a flooded
			// band hunting an 8th ore it never needed.
			const need = IRON_NEED - kit - _state.inventory.ironIngots;
			if (need <= 0) return { success: true, message: "Iron kit already complete" };
			return mineBlock(bot, "iron_ore", Math.max(1, need));
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
				kitBuckets(s) * 3 >=
			IRON_NEED,
		execute: async (bot, _state) => {
			const { smeltItems } = await import("./tasks/smelt/main.ts");
			return smeltItems(bot, "raw_iron", IRON_NEED);
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
		isComplete: (s) => kitBuckets(s) >= KIT_BUCKETS,
		execute: async (bot, state) => {
			const { craftBucket } = await import("./tasks/craft/main.ts");
			// Craft up to the kit size (3), one at a time while ingots last.
			let r: StepResult = { success: false, message: "no bucket crafted" };
			for (let have = kitBuckets(state); have < KIT_BUCKETS; have++) {
				r = await craftBucket(bot);
				if (!r.success) return r;
			}
			return r;
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
			const { castAttempt } = await import("./tasks/portal/attempt.ts");
			// Clear a site next to a lava pool, then cast the 10-obsidian frame and light it
			// (no diamond, no cheats) — one guarded attempt: 900 s budget, stall detector,
			// death ends it (cycle 4 Part 6). Writes a portal_cast row to the event log.
			return castAttempt(bot, { budgetMs: 900_000, source: "race" });
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
