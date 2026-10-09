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
import { castAttempt } from "../tasks/portal/attempt.ts";
import { bedDragon } from "../tasks/end/bed.ts";

// Dragon gym (cycle 4 Part 8): the setup's RCON, kept for the run's truth check.
let endRcon: ((cmd: string) => Promise<string>) | null = null;
const DRAGON_KIT = ["white_bed 6", "obsidian 32", "iron_sword 1", "cooked_beef 16", "cobblestone 64", "cobblestone 64", "water_bucket 1"];
let dragonDead = false;
const inEnd = (cmd: string) => `execute in minecraft:the_end run ${cmd}`;
import { enterPortal } from "../tasks/portal/enter.ts";
import { countInventoryItems } from "../lib/test-utils.ts";
import { logEvent, setPhase } from "../lib/logger.ts";
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
	/** Optional pass decided from server truth by RCON (overrides `pass`). */
	truthPass?: (rcon: (cmd: string) => Promise<string>, name: string) => Promise<boolean>;
	/** Optional RCON cleanup after the run (e.g. release forceloads the setup added). */
	teardown?: (rcon: (cmd: string) => Promise<string>) => Promise<void>;
	timeoutMs: number;
	/** The landing is meant to be in water (a lake-shore landing set); placement accepts it. */
	waterStart?: boolean;
}

const has = (bot: Bot, pat: string, n: number): boolean =>
	countInventoryItems(bot, pat) >= n;

const NATURAL_TOTAL_MS = Number(process.env.GYM_TOTAL_S ?? 2700) * 1000;

// Cycle 6, decision 6: the craft-window slug. The bot places a table, opens it, walks away
// from it with the window open, dies once (RCON kill, keep_inventory), then crafts sticks in
// its 2×2 grid. Pass is the server's count of sticks, not the client's.
let craftRcon: ((cmd: string) => Promise<string>) | null = null;
const serverCount = async (rcon: (cmd: string) => Promise<string>, name: string, item: string): Promise<number> =>
	Number(/Found (\d+)/.exec(await rcon(`clear ${name} ${item} 0`).catch(() => ""))?.[1] ?? 0);
const craftStaleTable = async (b: Bot): Promise<StepResult> => {
	const { getCraftingTable, goTo } = await import("../lib/bot-utils.ts");
	const table = await getCraftingTable(b);
	if (!table) return { success: false, message: "HARNESS no table placed" };
	try {
		await b.openBlock(table.position);
	} catch (e) {
		logEvent("gym", "craft_stale", `table did not open: ${e instanceof Error ? e.message : e}`);
	}
	logEvent("gym", "craft_stale", `open window=${b.currentWindow?.id ?? "none"}`);
	const p = b.entity.position;
	const away = { x: Math.floor(p.x) + 12, y: Math.floor(p.y), z: Math.floor(p.z) };
	await goTo(b, away as never, { range: 2, timeout: 20_000 }).catch(() => false);
	logEvent("gym", "craft_stale", `walked ${Math.round(Math.hypot(b.entity.position.x - table.position.x, b.entity.position.z - table.position.z))} away, window=${b.currentWindow?.id ?? "none"}`);
	if (craftRcon) {
		const respawned = new Promise<void>((r) => (b as unknown as { once: (e: string, f: () => void) => void }).once("respawn", () => r()));
		await craftRcon(`kill ${b.username}`).catch(() => "");
		await Promise.race([respawned, new Promise((r) => setTimeout(r, 15_000))]);
		await new Promise((r) => setTimeout(r, 2000));
		logEvent("gym", "craft_stale", `respawned, window=${b.currentWindow?.id ?? "none"}`);
	}
	// Race c5 808: a preempted plank craft still clicking while the next one started minted an
	// oak_button, and the grid desync behind it failed every stick craft for 19 minutes. Two
	// plank crafts at once, then sticks.
	const both = await Promise.all([craftPlanks(b), craftPlanks(b)]);
	logEvent("gym", "craft_stale", `overlapping plank crafts: ${both.map((r) => r.message).join(" | ")}`);
	return craftSticks(b);
};

// Cycle 7: race c5's steve-race-809 deadlocked 98 minutes ("no executable step", 169,773
// events) holding 1 raw iron, 3 buckets and 0 ingots: smelting wanted 3 ore, flint and steel
// wanted an ingot. The kit is its last inventory before the deadlock (snapshot 13:07:16,
// telemetry on the box); the real step machine runs from it. Pass is flint and steel from the
// server's view. Measures the smelt gate (d27933a), never raced.
let ironRcon: ((cmd: string) => Promise<string>) | null = null;
const IRON_DEADLOCK_BUDGET_MS = 600_000;

// Cycle 7 Part 6.6: blaze rods, never measured. The harness finds a fortress by RCON locate,
// generates its area and puts the kitted bot on a nether-brick floor with headroom; the bot
// then runs tasks/nether findFortress + killBlazes. Pass is a blaze rod from the server's
// view. The baseline is the point.
let blazeRcon: ((cmd: string) => Promise<string>) | null = null;
const BLAZE_BUDGET_MS = 600_000;
const inNether = (cmd: string) => `execute in minecraft:the_nether run ${cmd}`;

// Cycle 7 Part 6.2: water. The bot lands in a lake (landing set W: swimmable water 2+ deep,
// a bank 3-5 blocks away at most one block above the water) and runs escapeWater. Pass is
// dry land from the server's view: feet not in water, standing on something solid. 120 s.
// Measures the ledge-lift port fix (fa76014) and the lily-pad break (3e1f231).
const WATER_BUDGET_MS = 120_000;
// Dry land from the server's view: on the ground, feet and head out of water. The block
// under the bot's centre is not the test: on a bank edge the centre overhangs the water
// while the hitbox stands on the lip (wfail-l1: "still in water" for a bot on the bank).
const onDryLand = async (rcon: (cmd: string) => Promise<string>, name: string): Promise<boolean> => {
	const dry = /passed/i.test(await rcon(`execute as ${name} at @s unless block ~ ~ ~ minecraft:water unless block ~ ~1 ~ minecraft:water unless block ~ ~ ~ minecraft:lava`).catch(() => ""));
	if (!dry) return false;
	return /entity data:\s*1b/.test(await rcon(`data get entity ${name} OnGround`).catch(() => ""));
};
let waterRcon: ((cmd: string) => Promise<string>) | null = null;

export const GYM_STEPS: GymStep[] = [
	{
		slug: "water-escape",
		label: "From a lake to dry land",
		order: 0.5,
		waterStart: true,
		prereq: ["stone_pickaxe 1", "dirt 16"],
		setup: async (_b, rcon) => {
			waterRcon = rcon;
		},
		run: async (b) => {
			const { escapeWater } = await import("../lib/bot-utils.ts");
			const t0 = Date.now();
			// The race re-dispatches escape_water (priority 0) every tick the bot is wet, so
			// the slug calls escapeWater again until dry or the budget runs out.
			const dryNow = async () => (waterRcon ? await onDryLand(waterRcon, b.username) : !b.entity?.isInWater);
			let calls = 0;
			let dry = false;
			while (Date.now() - t0 < WATER_BUDGET_MS) {
				calls++;
				const left = WATER_BUDGET_MS - (Date.now() - t0);
				await Promise.race([escapeWater(b).catch(() => false), new Promise((r) => setTimeout(r, left))]);
				await new Promise((r) => setTimeout(r, 1000));
				if ((dry = await dryNow())) break;
			}
			logEvent("water", "escape_calls", `${calls} call(s), dry=${dry}`, b.entity?.position);
			return { success: dry, message: `${dry ? "on dry land" : "still in water"} after ${Math.round((Date.now() - t0) / 1000)} s, ${calls} escape call(s)` };
		},
		pass: (b) => !b.entity?.isInWater,
		truthPass: (rcon, name) => onDryLand(rcon, name),
		timeoutMs: WATER_BUDGET_MS + 60_000,
	},
	{
		slug: "blaze-rod",
		label: "Kitted bot at a Nether fortress to a blaze rod",
		order: 30,
		prereq: ["iron_sword 1", "iron_helmet 1", "iron_chestplate 1", "iron_leggings 1", "iron_boots 1", "cooked_beef 16", "cobblestone 64", "iron_pickaxe 1"],
		setup: async (b, rcon) => {
			blazeRcon = rcon;
			const loc = await rcon("execute in minecraft:the_nether positioned 0 64 0 run locate structure minecraft:fortress");
			const m = /\[(-?\d+), (?:~|-?\d+), (-?\d+)\]/.exec(loc);
			if (!m) throw new Error(`HARNESS no fortress: ${loc}`);
			const fx = Number(m[1]);
			const fz = Number(m[2]);
			await rcon(inNether(`forceload add ${fx - 48} ${fz - 48} ${fx + 48} ${fz + 48}`));
			for (let i = 0; i < 120; i++) {
				if (/passed/i.test(await rcon(`execute in minecraft:the_nether if loaded ${fx} 64 ${fz}`).catch(() => ""))) break;
				await new Promise((r) => setTimeout(r, 500));
			}
			// A nether-brick floor with two air blocks above, searched around the located start.
			let spot: [number, number, number] | null = null;
			search: for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0], [0, 8], [0, -8], [12, 0], [-12, 0], [0, 12], [0, -12]] as const)
				for (let y = 90; y >= 40; y--) {
					const x = fx + dx;
					const z = fz + dz;
					if (
						/passed/i.test(await rcon(`execute in minecraft:the_nether if block ${x} ${y} ${z} minecraft:nether_bricks`).catch(() => "")) &&
						/passed/i.test(await rcon(`execute in minecraft:the_nether if block ${x} ${y + 1} ${z} minecraft:air`).catch(() => "")) &&
						/passed/i.test(await rcon(`execute in minecraft:the_nether if block ${x} ${y + 2} ${z} minecraft:air`).catch(() => ""))
					) {
						spot = [x, y + 1, z];
						break search;
					}
				}
			if (!spot) throw new Error(`HARNESS no brick floor near fortress ${fx},${fz}`);
			await rcon(`execute in minecraft:the_nether run tp ${b.username} ${spot[0] + 0.5} ${spot[1]} ${spot[2] + 0.5}`);
			logEvent("gym", "blaze_setup", `fortress ${fx},${fz} spot ${spot.join(",")}`);
			await new Promise((r) => setTimeout(r, 4000));
		},
		run: async (b) => {
			const { findFortress, killBlazes } = await import("../tasks/nether/main.ts");
			const t0 = Date.now();
			const f = await findFortress(b);
			logEvent("gym", "blaze_fortress", f.message);
			const left = BLAZE_BUDGET_MS - (Date.now() - t0);
			const k = await Promise.race([killBlazes(b, 1), new Promise<StepResult>((r) => setTimeout(() => r({ success: false, message: "blaze budget spent" }), Math.max(0, left)))]);
			return k;
		},
		pass: (b) => has(b, "blaze_rod", 1),
		truthPass: async (rcon, name) => (await serverCount(rcon, name, "minecraft:blaze_rod")) >= 1,
		teardown: async (rcon) => {
			await rcon(inNether("forceload remove all")).catch(() => "");
		},
		timeoutMs: BLAZE_BUDGET_MS + 120_000,
	},
	{
		slug: "iron-deadlock",
		label: "From race c5 809's deadlock inventory to flint and steel",
		order: 16.5,
		prereq: ["raw_iron 1", "bucket 2", "water_bucket 1", "furnace 1", "oak_planks 12", "stick 10", "cobblestone 64", "cobblestone 18", "stone_pickaxe 1", "wooden_pickaxe 1"],
		setup: async (_b, rcon) => {
			ironRcon = rcon;
		},
		run: async (b) => {
			const { runStepMachine } = await import("./step-machine.ts");
			const r = await runStepMachine(
				b,
				async () => (ironRcon ? (await serverCount(ironRcon, b.username, "minecraft:flint_and_steel")) >= 1 : has(b, "flint_and_steel", 1)),
				IRON_DEADLOCK_BUDGET_MS,
			);
			return { success: r.ok, message: r.ok ? `flint and steel in ${r.seconds} s` : `no flint and steel after ${r.seconds} s` };
		},
		pass: (b) => has(b, "flint_and_steel", 1),
		truthPass: async (rcon, name) => (await serverCount(rcon, name, "minecraft:flint_and_steel")) >= 1,
		timeoutMs: IRON_DEADLOCK_BUDGET_MS + 60_000,
	},
	{
		slug: "craft-stale-table",
		label: "Craft sticks after an open table and a death",
		order: 4.5,
		// Logs, not planks: the sticks depend on planks surviving two overlapping crafts.
		prereq: ["oak_log 6", "crafting_table 1"],
		setup: async (_b, rcon) => {
			craftRcon = rcon;
		},
		run: (b) => craftStaleTable(b),
		pass: (b) => has(b, "stick", 4),
		truthPass: async (rcon, name) => (await serverCount(rcon, name, "minecraft:stick")) >= 4,
		timeoutMs: 120_000,
	},
	{
		slug: "dragon",
		label: "Kill the Dragon (beds)",
		order: 40,
		// Skill 12 starts with the crystals gone. Kit per Part 8, given in the End by setup
		// (cycle 6, decision 3): d1–d6 gave it in the overworld before the teleport and the
		// server held no beds once the bot was in the End.
		prereq: [],
		setup: async (b, rcon) => {
			endRcon = rcon;
			dragonDead = false;
			await rcon(inEnd("forceload add -64 -64 64 64"));
			for (let i = 0; i < 60; i++) {
				if (/passed/i.test(await rcon("execute in minecraft:the_end if loaded 0 0 0").catch(() => ""))) break;
				await new Promise((r) => setTimeout(r, 1000));
			}
			await rcon(inEnd("kill @e[type=minecraft:end_crystal]")).catch(() => "");
			const alive = /passed/i.test(await rcon("execute in minecraft:the_end if entity @e[type=minecraft:ender_dragon]").catch(() => ""));
			if (!alive) await rcon(inEnd("summon minecraft:ender_dragon 0 100 0")).catch(() => "");
			// Stand on the end stone 8 south of the fountain, on the heightmap.
			await rcon(`execute in minecraft:the_end positioned 0 0 8 positioned over motion_blocking_no_leaves run tp ${b.username} ~0.5 ~ ~0.5 180 0`);
			await rcon(`effect clear ${b.username}`).catch(() => "");
			await new Promise((r) => setTimeout(r, 3000));
			// Decision 3 order: the server says the bot is in the End and the client agrees,
			// then give, then confirm the kit from the server's view before the attempt.
			const name = b.username;
			const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
			const serverInEnd = async () => /passed/i.test(await rcon(`execute as ${name} at @s if dimension minecraft:the_end`).catch(() => ""));
			const clientInEnd = () => /the_end/.test(String(b.game?.dimension ?? ""));
			for (let i = 0; i < 30 && !((await serverInEnd()) && clientInEnd()); i++) await sleep(1000);
			logEvent("end", "kit_order", `server_in_end=${await serverInEnd()} client_dim=${b.game?.dimension}`);
			const beds = async () => Number(/Found (\d+)/.exec(await rcon(`clear ${name} #minecraft:beds 0`).catch(() => ""))?.[1] ?? 0);
			const giveKit = async () => {
				await rcon(`clear ${name}`).catch(() => "");
				for (const item of DRAGON_KIT) await rcon(`give ${name} ${item}`).catch(() => "");
				await sleep(1500);
			};
			await giveKit();
			let n = await beds();
			const inv = await rcon(`data get entity ${name} Inventory`).catch((e) => String(e));
			logEvent("end", "kit_order", `gave in End: server beds=${n}; Inventory ${inv.slice(0, 160)}`);
			if (n < 6) {
				// Fallback: give in the overworld, confirm, teleport, confirm again.
				await rcon(`execute in minecraft:overworld run tp ${name} 0 200 0`).catch(() => "");
				for (let i = 0; i < 30 && /passed/i.test(await rcon(`execute as ${name} at @s if dimension minecraft:the_end`).catch(() => "")); i++) await sleep(1000);
				await giveKit();
				const before = await beds();
				await rcon(`execute in minecraft:the_end positioned 0 0 8 positioned over motion_blocking_no_leaves run tp ${name} ~0.5 ~ ~0.5 180 0`);
				for (let i = 0; i < 30 && !((await serverInEnd()) && clientInEnd()); i++) await sleep(1000);
				n = await beds();
				logEvent("end", "kit_order", `fallback: overworld beds=${before}, after tp beds=${n}`);
			}
			await sleep(1000);
		},
		run: async (b) => {
			const res = await bedDragon(b, 900_000);
			// Server's view of the bot for the placement diagnosis (client vs server desync).
			if (endRcon)
				for (const q of ["Pos", "SelectedItem", "SelectedItemSlot", "Dimension", "playerGameType"])
					logEvent("end", "server_view", `${q}: ${await endRcon(`data get entity ${b.username} ${q}`).catch((e) => String(e))}`);
			if (endRcon) logEvent("end", "server_view", `beds: ${await endRcon(`clear ${b.username} #minecraft:beds 0`).catch((e) => String(e))}`);
			const alive = endRcon
				? /passed/i.test(await endRcon("execute in minecraft:the_end if entity @e[type=minecraft:ender_dragon]").catch(() => "passed"))
				: true;
			dragonDead = !alive;
			return { success: dragonDead, message: `${dragonDead ? "DRAGON DEAD" : "dragon alive"} — ${res.message}` };
		},
		pass: () => dragonDead,
		teardown: async (rcon) => {
			await rcon(inEnd("forceload remove -64 -64 64 64")).catch(() => "");
		},
		timeoutMs: 960_000,
	},
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
	{ slug: "fill-water", label: "Fill Water Buckets", order: 15, prereq: ["bucket 3"], run: (b) => fillWaterBucket(b), pass: (b) => has(b, "water_bucket", 1), timeoutMs: 360000 },
	{ slug: "gather-food", label: "Gather Food", order: 16, prereq: ["stone_sword 1"], run: (b) => gatherFood(b, 3), pass: (b) => countInventoryItems(b, "beef") + countInventoryItems(b, "mutton") + countInventoryItems(b, "chicken") + countInventoryItems(b, "porkchop") >= 1, timeoutMs: 90000 },
	{ slug: "flint-and-steel", label: "Get Flint and Steel", order: 17, prereq: ["iron_ingot 1", "crafting_table 1", "stone_pickaxe 1", "cobblestone 32"], run: (b) => craftFlintAndSteel(b), pass: (b) => has(b, "flint_and_steel", 1), timeoutMs: 120000 },
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
			"bucket 2",
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
			// GYM_TERRAIN=natural: keep the real terrain (no stone floor, no cleared air) so
			// the chamber clear, reach, pick wear and anchor code run against what a race
			// meets. Only the lava lake is scaffolded, sunk to the landing's surface height.
			if (process.env.GYM_TERRAIN === "natural") {
				await rcon(
					`fill ${lx - 4} ${by - 2} ${lz - 4} ${lx + 4} ${by + 3} ${lz + 4} air`,
				).catch(() => {});
				await rcon(
					`fill ${lx - 4} ${by - 2} ${lz - 4} ${lx + 4} ${by - 1} ${lz + 4} lava`,
				).catch(() => {});
				return;
			}
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
		// Same guarded attempt as the race and the natural gym (stall detector, death
		// ends it, one portal_cast row), with the arena's old 30-min budget.
		run: (b) => castAttempt(b, { budgetMs: 1_800_000, source: "gym" }),
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
		// THE natural-terrain gym (hours 48+ main instrument). Random landing, the race
		// kit, NO scaffold: the harness places and clears nothing. The bot runs the
		// race's own portal step (find lava → anchor → prep → cast → light) under the
		// race's 900 s step budget, then the race's enter step. Pass = in the Nether.
		slug: "portal-natural",
		label: "Portal on natural terrain (find lava → cast → enter)",
		order: 20,
		prereq: [
			"stone_pickaxe 2",
			"bucket 2",
			"water_bucket 1",
			"flint_and_steel 1",
			"cobblestone 64",
			"oak_planks 16",
		],
		// Cycle-4 budget semantics (decision 1): the race gives the portal step 900 s PER
		// DISPATCH and re-dispatches it (escape_water first when wet); R5 keeps the frame
		// across dispatches. So: 900 s per dispatch, re-dispatched, 2700 s TOTAL including
		// the walk into the portal; the primary metric is time_to_portal_s (first dispatch
		// → standing in the Nether). A run that dies 5 times is over.
		run: async (b) => {
			const t0 = Date.now();
			// Cycle 5: screening batches cap a run at 1800 s (GYM_TOTAL_S), confirmation at 2700.
			const total = NATURAL_TOTAL_MS;
			const perDispatch = 900_000;
			// Cycle 5: the same failed(reason) 4 times in one run ends the run (base2-1 burned
			// 102 dispatches on "Pickaxe worn out" — the gym loop has no planner to escalate to).
			let lastKey = "";
			let sameN = 0;
			let res: StepResult = { success: false, message: "Build Nether Portal never dispatched" };
			let dispatches = 0;
			let deaths = 0;
			const onDeath = () => {
				deaths++;
			};
			b.on("death", onDeath);
			const extra = (): Record<string, unknown> => ({
				dispatches,
				deaths,
				elapsed_s: Math.round((Date.now() - t0) / 1000),
			});
			try {
				while (Date.now() - t0 < total && deaths < 5) {
					if (b.entity?.isInWater) {
						const { escapeWater } = await import("../lib/bot-utils.ts");
						await escapeWater(b).catch(() => false);
						await new Promise((r) => setTimeout(r, 1000));
						continue;
					}
					dispatches++;
					// Each dispatch runs guarded (cycle 4 Part 6): its own 900 s budget (or what is
					// left of the 2700 s), a stall detector on the ratcheted progress, and death
					// ending the dispatch (the site is forgotten; the next dispatch re-sites).
					const cap = Math.min(perDispatch, total - (Date.now() - t0));
					res = await castAttempt(b, { budgetMs: cap, source: "gym" });
					if (res.success) break;
					const key = res.message.replace(/-?\d+(\.\d+)?/g, "#");
					sameN = key === lastKey ? sameN + 1 : 1;
					lastKey = key;
					if (sameN >= 4) {
						logEvent("step", "escalate", `4× ${res.message}`);
						return { success: false, message: `escalated: ${res.message} ×4 [${dispatches} dispatches]`, extra: extra() } as StepResult;
					}
					await new Promise((r) => setTimeout(r, 1000));
				}
				if (!res.success) {
					const why = deaths >= 5 ? "died 5 times" : res.message;
					return { success: false, message: `${why} [${dispatches} dispatches]`, extra: extra() } as StepResult;
				}
				setPhase("enter");
				const left = total - (Date.now() - t0);
				let timer: ReturnType<typeof setTimeout> | undefined;
				const enter = await Promise.race([
					enterPortal(b),
					new Promise<StepResult>((r) => {
						timer = setTimeout(() => r({ success: false, message: "enter timed out (2700s total)" }), Math.max(1000, left));
					}),
				]);
				clearTimeout(timer);
				const inNether = String(b.game?.dimension ?? "").includes("nether");
				return {
					...enter,
					extra: { ...extra(), ...(inNether ? { time_to_portal_s: Math.round((Date.now() - t0) / 1000) } : {}) },
				} as StepResult;
			} finally {
				b.removeListener?.("death", onDeath);
			}
		},
		pass: (b) => String(b.game?.dimension ?? "").includes("nether"),
		// Cycle 5: "in the Nether" from server truth, not the client's dimension.
		truthPass: async (rcon, name) =>
			/passed/i.test(await rcon(`execute as ${name} at @s if dimension minecraft:the_nether`).catch(() => "")),
		timeoutMs: NATURAL_TOTAL_MS + 100_000,
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
			// run.ts forceloads only the spread-centre chunk; a frame 4 blocks out often
			// sits in the next chunk and the fills silently fail (gym e1: 3/10 "No portal
			// found nearby"). Keep the whole scaffold resident.
			await rcon(`forceload add ${x - 8} ${z - 8} ${px + 8} ${pz + 8}`).catch(() => {});
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
