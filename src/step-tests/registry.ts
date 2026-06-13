/**
 * Isolation-test registry: one descriptor per race step (and a few sub-steps).
 *
 * Each entry sets up the prerequisite kit + local arena via RCON (reliable —
 * `bot.chat` drops commands under load and gives false failures), then runs ONE
 * step and checks it passed. The default run/pass come straight from the real
 * `Step` in steps.ts — so a passing isolation test means that step works given
 * its inputs, no multi-hour chain required.
 *
 * Arenas are built with ABSOLUTE coords around the bot's platform spot (x,y,z),
 * because RCON commands have no position for relative `~`. The runner places the
 * bot on a flat stone platform (top at y, feet at y) before setup runs.
 *
 * See src/step-test.ts for the runner.
 */
import type { Bot } from "typecraft";
import { syncFromBot } from "../state.ts";
import { type Step, steps } from "../steps.ts";
import type { StepResult } from "../types.ts";

/** Bound to one bot: `cmd` runs a raw RCON command, `give`/`clear` target this
 * bot's username, and x/y/z is the bot's floored platform position (arena
 * origin — feet at y, on a stone platform whose top is y). */
export interface SetupContext {
	cmd: (s: string) => Promise<void>;
	give: (item: string, n: number) => Promise<void>;
	clear: () => Promise<void>;
	x: number;
	y: number;
	z: number;
}

export interface StepTest {
	id: string;
	name: string;
	/** The real Step this exercises — provides the default run + pass. */
	step?: Step;
	/** Prereq kit + arena. Runs after the bot is on its platform, before `run`. */
	setup: (ctx: SetupContext) => Promise<void>;
	/** Action under test. Default: step.execute(bot, syncFromBot(bot)). */
	run?: (bot: Bot) => Promise<StepResult>;
	/** Pass check. Default: step.isComplete(syncFromBot(bot)). */
	pass?: (bot: Bot) => boolean;
	/** Per-test timeout (ms). Default 120_000. */
	timeout?: number;
}

const byStepId = (id: string): Step => {
	const s = steps.find((s) => s.id === id);
	if (!s) throw new Error(`registry: no step with id "${id}"`);
	return s;
};

export const stepTests: StepTest[] = [
	// ── Wood / crafting (inventory + placed table) ──────────────────────────
	{
		id: "gather_wood",
		name: "Gather Wood",
		step: byStepId("gather_wood"),
		setup: async ({ cmd, clear, x, y, z }) => {
			await clear();
			// Two small trees on the platform within reach (trunk + a leaf cap so
			// the foliage finder has something to walk toward).
			await cmd(`fill ${x + 3} ${y} ${z} ${x + 3} ${y + 4} ${z} oak_log`);
			await cmd(
				`fill ${x + 2} ${y + 3} ${z - 1} ${x + 4} ${y + 5} ${z + 1} oak_leaves`,
			);
			await cmd(`fill ${x - 3} ${y} ${z} ${x - 3} ${y + 4} ${z} oak_log`);
			await cmd(
				`fill ${x - 4} ${y + 3} ${z - 1} ${x - 2} ${y + 5} ${z + 1} oak_leaves`,
			);
		},
	},
	{
		id: "craft_planks",
		name: "Craft Planks",
		step: byStepId("craft_planks"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("oak_log", 3);
		},
	},
	{
		id: "craft_crafting_table",
		name: "Craft Crafting Table",
		step: byStepId("craft_crafting_table"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("oak_planks", 4);
		},
	},
	{
		id: "craft_sticks",
		name: "Craft Sticks",
		step: byStepId("craft_sticks"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("oak_planks", 4);
		},
	},
	{
		id: "craft_wooden_pickaxe",
		name: "Craft Wooden Pickaxe",
		step: byStepId("craft_wooden_pickaxe"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("oak_planks", 3);
			await give("stick", 2);
			await give("crafting_table", 1);
		},
	},
	{
		id: "craft_stone_pickaxe",
		name: "Craft Stone Pickaxe",
		step: byStepId("craft_stone_pickaxe"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("cobblestone", 3);
			await give("stick", 2);
			await give("crafting_table", 1);
		},
	},

	// ── Stone / iron ────────────────────────────────────────────────────────
	{
		id: "mine_stone",
		name: "Mine Cobblestone",
		step: byStepId("mine_stone"),
		// The platform itself is stone — the bot mines it. Just needs a pickaxe.
		setup: async ({ give, clear }) => {
			await clear();
			await give("stone_pickaxe", 1);
		},
	},
	{
		id: "craft_furnace",
		name: "Craft Furnace",
		step: byStepId("craft_furnace"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("cobblestone", 8);
			await give("crafting_table", 1);
		},
	},
	{
		id: "smelt_iron",
		name: "Smelt Iron",
		step: byStepId("smelt_iron"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("raw_iron", 8);
			await give("coal", 4);
			await give("furnace", 1);
		},
	},
	{
		id: "craft_bucket",
		name: "Craft Buckets",
		step: byStepId("craft_bucket"),
		setup: async ({ give, clear }) => {
			await clear();
			await give("iron_ingot", 6);
			await give("crafting_table", 1);
		},
	},
	{
		id: "get_water_buckets",
		name: "Fill Water Buckets",
		step: byStepId("get_water_buckets"),
		setup: async ({ cmd, give, clear, x, y, z }) => {
			await clear();
			await give("bucket", 1);
			// A contained 2-deep water pool set into the platform, 2 blocks away
			// (deeper than 1 block so the scoop has an unambiguous surface to hit).
			await cmd(`fill ${x + 2} ${y - 2} ${z - 2} ${x + 4} ${y - 1} ${z + 2} water`);
		},
	},
	{
		id: "get_flint_and_steel",
		name: "Get Flint and Steel",
		step: byStepId("get_flint_and_steel"),
		setup: async ({ cmd, give, clear, x, y, z }) => {
			await clear();
			await give("iron_ingot", 1);
			await give("crafting_table", 1);
			// A gravel pile big enough that ~10% flint drops yield at least one.
			await cmd(`fill ${x + 2} ${y} ${z - 2} ${x + 4} ${y + 2} ${z + 2} gravel`);
		},
	},

	// ── Build Nether Portal — broken into sub-tests ─────────────────────────
	{
		id: "portal_cast",
		name: "Build Nether Portal (cast obsidian + light)",
		setup: async ({ cmd, give, clear, x, y, z }) => {
			await clear();
			await give("water_bucket", 1);
			await give("bucket", 1);
			await give("flint_and_steel", 1);
			await give("dirt", 64);
			// A small lava pool set into the platform a few blocks away, contained
			// by the surrounding stone, for prepareCastSite to find + draw from.
			await cmd(`fill ${x + 4} ${y - 1} ${z - 1} ${x + 6} ${y - 1} ${z + 1} lava`);
		},
		run: async (bot) => {
			const { prepareCastSite, buildPortalByCasting } = await import(
				"../tasks/portal/cast.ts"
			);
			const prep = await prepareCastSite(bot);
			if (!prep.success) return prep;
			return buildPortalByCasting(bot);
		},
		pass: (bot) => syncFromBot(bot).world.portalBuilt,
		timeout: 240_000,
	},
	{
		id: "enter_nether",
		name: "Enter Nether",
		step: byStepId("enter_nether"),
		setup: async ({ cmd, clear, x, y, z }) => {
			await clear();
			// Build + light a portal beside the bot so we isolate ONLY the entry.
			await cmd(`fill ${x + 2} ${y} ${z - 1} ${x + 2} ${y + 4} ${z + 2} obsidian`);
			await cmd(`fill ${x + 2} ${y + 1} ${z} ${x + 2} ${y + 3} ${z + 1} air`);
			await cmd(
				`setblock ${x + 2} ${y + 1} ${z} minecraft:nether_portal[axis=z]`,
			);
			await cmd(
				`fill ${x + 2} ${y + 1} ${z} ${x + 2} ${y + 3} ${z + 1} minecraft:nether_portal[axis=z]`,
			);
		},
	},
];

export const byId = new Map(stepTests.map((t) => [t.id, t]));
export const allIds = (): string[] => stepTests.map((t) => t.id);
