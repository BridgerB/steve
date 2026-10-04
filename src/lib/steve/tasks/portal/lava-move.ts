/**
 * lava_safe_move (cycle 4 §7.4): the one guarded primitive for any move that can end
 * within four blocks of lava.
 *   - the pathfinder runs with lava-adjacent cells refused (exclusionAreasStep: any
 *     lava in the 3×3 ring at floor, feet or head level of a step cell);
 *   - the last block is a sneaking, non-jumping settle;
 *   - post-condition from chunk data: solid non-lava footing, no lava in the 3×3×2 body
 *     ring, no floor missing beside the feet;
 *   - on failure it steps back toward where it came from, writes a `vetoed` primitive
 *     row, and returns false. The caller re-plans; it never improvises.
 */
import type { Bot } from "typecraft";
import { vec3, type Vec3 } from "typecraft";
import { buildId, writeAttempt } from "../../lib/attempts.ts";
import { getPathfinder, goTo, walkToXZ } from "../../lib/bot-utils.ts";
import { getRaceId, logEvent } from "../../lib/logger.ts";

const name = (bot: Bot, x: number, y: number, z: number): string =>
	(bot.blockAt(vec3(x, y, z)) as { name?: string } | null)?.name ?? "air";
const lava = (n: string) => n === "lava" || n === "flowing_lava";
const air = (n: string) => n === "air" || n === "cave_air" || n === "void_air";
// Non-solid plants and thin blocks by exact shape of name — s4n: a /grass/ match vetoed
// every stance on grass_block ("footing grass_block").
const NOT_SOLID = /^(short_grass|tall_grass|grass|fern|large_fern|dead_bush|snow|torch|wall_torch|.*_carpet|vine|.*_button|rail|.*_rail|.*_sapling|.*_flower|dandelion|poppy|.*_tulip|cornflower|azure_bluet|oxeye_daisy|allium|blue_orchid|lily_of_the_valley|seagrass|tall_seagrass|kelp|kelp_plant|sweet_berry_bush|.*_mushroom|fire)$/;
const solid = (n: string) => !air(n) && !lava(n) && n !== "water" && !NOT_SOLID.test(n);

/** Any lava in the 3×3 ring around (x,z) at floor, feet or head height of a cell at feet y. */
const lavaRing = (bot: Bot, x: number, y: number, z: number): boolean => {
	for (let dx = -1; dx <= 1; dx++)
		for (let dz = -1; dz <= 1; dz++)
			for (let dy = -1; dy <= 1; dy++) if (lava(name(bot, x + dx, y + dy, z + dz))) return true;
	return false;
};

/** Why the stance at the bot's feet is unsafe, or null when it is safe. */
export const stanceProblem = (bot: Bot): string | null => {
	const p = bot.entity.position;
	const x = Math.floor(p.x);
	const y = Math.floor(p.y);
	const z = Math.floor(p.z);
	const floor = name(bot, x, y - 1, z);
	if (!solid(floor)) return `footing ${floor}`;
	for (let dx = -1; dx <= 1; dx++)
		for (let dz = -1; dz <= 1; dz++)
			for (const dy of [0, 1]) if (lava(name(bot, x + dx, y + dy, z + dz))) return `lava in ring ${dx},${dy},${dz}`;
	// A drop beside the feet is a problem only when it is deep (> 3) or ends in lava: a
	// one-wide pillar or a frame-edge stance always has air beside it (s2a: the pour gate
	// vetoed every arena pour on "drop beside (air)").
	for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
		if (!air(name(bot, x + dx, y, z + dz))) continue;
		let d = 1;
		while (d <= 4 && air(name(bot, x + dx, y - d, z + dz))) d++;
		const land = name(bot, x + dx, y - d, z + dz);
		if (lava(land)) return `lava drop beside ${dx},${dz} (${d} down)`;
		if (d > 3) return `deep drop beside ${dx},${dz}`;
	}
	return null;
};

export const lavaSafeMove = async (
	bot: Bot,
	target: Vec3,
	opts: { range?: number; timeout?: number; why?: string } = {},
): Promise<boolean> => {
	const t0 = Date.now();
	const from = bot.entity.position.clone?.() ?? vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
	const pf = getPathfinder(bot);
	pf.setMovements({ exclusionAreasStep: [(x, y, z) => (lavaRing(bot, x, y, z) ? Number.POSITIVE_INFINITY : 0)] });
	try {
		await goTo(bot, target, { range: opts.range ?? 0.5, timeout: opts.timeout ?? 20000 }).catch(() => false);
	} finally {
		pf.setMovements({ exclusionAreasStep: [] });
	}
	// Sneaking settle onto the cell centre (no jumping on the last block) — only from close
	// by: a straight walk from afar can cross lava the pathfinder routed around.
	{
		const q = bot.entity.position;
		if (Math.hypot(q.x - (Math.floor(target.x) + 0.5), q.z - (Math.floor(target.z) + 0.5)) <= 1.5) {
			bot.setControlState("sneak", true);
			await walkToXZ(bot, Math.floor(target.x) + 0.5, Math.floor(target.z) + 0.5, { targetDist: 0.25, maxTime: 1500 }).catch(() => {});
			bot.setControlState("sneak", false);
		}
	}
	const p = bot.entity.position;
	const arrived = Math.hypot(p.x - (Math.floor(target.x) + 0.5), p.z - (Math.floor(target.z) + 0.5)) <= Math.max(0.8, opts.range ?? 0.5);
	const problem = stanceProblem(bot) ?? (arrived ? null : "not arrived");
	if (!problem) return true;
	// Stop where we are; the caller re-plans. (s4n: the old straight-line walk back toward
	// the start crossed lava — two deaths right after a veto.)
	bot.clearControlStates?.();
	void from;
	logEvent("cast", "move_vetoed", `${opts.why ?? "move"} to ${Math.floor(target.x)},${Math.floor(target.y)},${Math.floor(target.z)}: ${problem}`, bot.entity.position);
	writeAttempt({
		run_id: `${getRaceId()}-lsm-${t0}`,
		bot_impl: "ts",
		build: buildId(),
		world_seed: process.env.GYM_SEED ?? null,
		skill: "lava_safe_move",
		step_id: opts.why ?? "move",
		source: process.env.GYM_RUN_ID ? "gym" : "race",
		bot: bot.username,
		start_ms: t0,
		duration_s: Math.round((Date.now() - t0) / 100) / 10,
		outcome: "vetoed",
		reason: problem,
		death_cause: null,
		pos: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)],
		deepest_phase: "",
		progress: 0,
		params: {},
		context: {},
	});
	return false;
};
