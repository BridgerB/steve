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
import { buildPortalByCasting, prepareCastSite } from "../tasks/portal/cast.ts";
import { enterPortal } from "../tasks/portal/enter.ts";
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
	/**
	 * Optional post-teleport RCON scaffold — runs after the teleport/give, before `run`.
	 * Used by enter-nether to build a lit portal at the landing (a portal can't be
	 * /give-n). Most steps don't need it.
	 */
	setup?: (
		bot: Bot,
		rcon: (cmd: string) => Promise<string>,
		at: { x: number; y: number; z: number },
	) => Promise<void>;
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
	{ slug: "smelt-iron", label: "Smelt Iron", order: 12, prereq: ["raw_iron 8", "coal 8", "furnace 1"], run: (b) => smeltItems(b, "raw_iron", 8), pass: (b) => has(b, "iron_ingot", 3), timeoutMs: 120000 },
	{ slug: "craft-iron-pickaxe", label: "Craft Iron Pickaxe", order: 13, prereq: ["iron_ingot 3", "stick 2", "crafting_table 1"], run: (b) => craftIronPickaxe(b), pass: (b) => has(b, "iron_pickaxe", 1), timeoutMs: 40000 },
	{ slug: "craft-buckets", label: "Craft Buckets", order: 14, prereq: ["iron_ingot 6", "crafting_table 1"], run: (b) => craftBucket(b), pass: (b) => has(b, "bucket", 1), timeoutMs: 40000 },
	{ slug: "fill-water", label: "Fill Water Buckets", order: 15, prereq: ["bucket 2"], run: (b) => fillWaterBucket(b), pass: (b) => has(b, "water_bucket", 1), timeoutMs: 60000 },
	{ slug: "gather-food", label: "Gather Food", order: 16, prereq: ["stone_sword 1"], run: (b) => gatherFood(b, 3), pass: (b) => countInventoryItems(b, "beef") + countInventoryItems(b, "mutton") + countInventoryItems(b, "chicken") + countInventoryItems(b, "porkchop") >= 1, timeoutMs: 90000 },
	{ slug: "flint-and-steel", label: "Get Flint and Steel", order: 17, prereq: ["iron_ingot 1", "crafting_table 1"], run: (b) => craftFlintAndSteel(b), pass: (b) => has(b, "flint_and_steel", 1), timeoutMs: 120000 },
	{
		slug: "build-nether-portal",
		label: "Build Nether Portal",
		order: 18,
		// FULL autonomous — no scaffolded lava: the bot finds lava and fills its own
		// bucket via prepareCastSite, then casts the 10 obsidian. Long timeout because
		// prepareCastSite mines down to cave lava (up to ~6 min). Prereqs match what the
		// bot would hold entering the real step: 1 water bucket + 1 empty bucket (becomes
		// the lava bucket on-site) + flint&steel + ~30 dirt/cobble + a pickaxe. The pickaxe
		// is scaffolding for the mine-down-to-lava descent (the bot always has one by portal
		// time in a real run); without it prepareCastSite hand-mines stone (~7s/block) and
		// never reaches lava depth inside the 6-min budget. Iron so durability doesn't break
		// mid-descent and confound the lava-find/cast result under test.
		prereq: [
			"water_bucket 1",
			"bucket 1",
			"flint_and_steel 1",
			"dirt 64",
			"iron_pickaxe 1",
		],
		// DEV harness (env GYM_LAVA_D): scaffold a SURFACE lava pool GYM_LAVA_D blocks from
		// the bot on a cleared stone arena, to perfect find->scoop->cast->enter near, then
		// progressively move the pool farther (raise GYM_LAVA_D) and fine-tune the find/
		// approach code until it works from as far as the bot could realistically detect it.
		// Unset/0 GYM_LAVA_D = the real autonomous mine-to-lava (no scaffold).
		setup: async (_b, rcon, at) => {
			const d = Number(process.env.GYM_LAVA_D ?? 0);
			if (!d) return;
			const bx = at.x;
			const by = at.y;
			const bz = at.z;
			const lx = bx + d;
			const lz = bz;
			// FORCELOAD the whole bot->pool rectangle. run.ts only forceloads the single
			// spread-center chunk, so a pool D blocks away lands in an unloaded chunk: /fill
			// places it, but the server then drops that chunk from the bot's tracking and the
			// bot's world model never receives the lava (findLava=null → wrong descend). This
			// keeps the pool chunk resident so the bot actually SEES the surface lava.
			await rcon(
				`forceload add ${bx - 8} ${bz - 10} ${lx + 8} ${lz + 10}`,
			).catch(() => {});
			// Flat clean arena: stone floor at by-1, cleared air above, spanning bot->pool.
			await rcon(
				`fill ${bx - 4} ${by - 3} ${bz - 6} ${lx + 5} ${by - 1} ${lz + 6} stone`,
			).catch(() => {});
			await rcon(
				`fill ${bx - 4} ${by} ${bz - 6} ${lx + 5} ${by + 5} ${lz + 6} air`,
			).catch(() => {});
			// BIG exposed lava lake (9x9x2 = ~160 source blocks) flush with the floor. A 3x3
			// pool exhausted after ~2 scoops (scooping a source makes neighbours FLOW, and
			// flowing lava isn't scoopable) — the cast needs ~10 refills, so make it huge.
			await rcon(
				`fill ${lx - 4} ${by - 2} ${lz - 4} ${lx + 4} ${by - 1} ${lz + 4} lava`,
			).catch(() => {});
		},
		run: async (b) => {
			const prep = await prepareCastSite(b);
			if (!prep.success) return prep;
			return buildPortalByCasting(b);
		},
		pass: (b) =>
			!!b.findBlock?.({
				matching: (n: string) => n === "nether_portal",
				// Small radius: the bot ends AT the portal it just cast (~2 blocks). The shared
				// world accumulates portals from earlier passing runs, so a large radius false-
				// positives on a leftover. exposed:false so the freshly-lit blocks are seen.
				maxDistance: 4,
				exposed: false,
			} as never),
		timeoutMs: 1920000,
	},
	{
		slug: "enter-nether",
		label: "Enter Nether",
		order: 19,
		prereq: [],
		// A portal can't be /give-n, so scaffold a lit portal 4 blocks in front of the
		// landing (stone floor + cleared corridor + obsidian frame + nether_portal), then
		// run the real walk-in. Tests enterPortal, not the cast.
		setup: async (_b, rcon, at) => {
			const { x, y, z } = at;
			const px = x;
			const pz = z + 4;
			// Stone floor along the whole approach + frame, then clear a corridor+frame
			// air volume, build the 4x5 obsidian frame, and IGNITE with fire — the game
			// forms a valid portal from fire-in-a-frame (fill-placing nether_portal blocks
			// directly gets popped by portal validation).
			await rcon(`fill ${x - 1} ${y - 1} ${z} ${px + 2} ${y - 1} ${pz} stone`);
			await rcon(`fill ${x - 1} ${y} ${z} ${px + 2} ${y + 3} ${pz} air`);
			await rcon(`fill ${px - 1} ${y - 1} ${pz} ${px + 2} ${y - 1} ${pz} obsidian`);
			await rcon(`fill ${px - 1} ${y + 3} ${pz} ${px + 2} ${y + 3} ${pz} obsidian`);
			await rcon(`fill ${px - 1} ${y} ${pz} ${px - 1} ${y + 2} ${pz} obsidian`);
			await rcon(`fill ${px + 2} ${y} ${pz} ${px + 2} ${y + 2} ${pz} obsidian`);
			await rcon(`setblock ${px} ${y} ${pz} fire`);
			await new Promise((r) => setTimeout(r, 1500));
		},
		run: (b) => enterPortal(b),
		pass: (b) => String(b.game?.dimension ?? "").includes("nether"),
		timeoutMs: 40000,
	},
];

export const GYM_BY_SLUG = new Map(GYM_STEPS.map((s) => [s.slug, s]));

/** Client-safe view (no functions) for the web UI. */
export const gymStepMeta = () =>
	GYM_STEPS.map(({ slug, label, order }) => ({ slug, label, order }));
