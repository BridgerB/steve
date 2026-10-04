/**
 * The shared event log (cycle 4, Part 4): one row per skill attempt and one per
 * guarded-primitive call, the dataset every learned component trains on. Both bots
 * write the same schema (docs/events-schema.md).
 *
 * Canonical file: STEVE_ATTEMPTS_FILE (default data/gym/attempts.jsonl), append-only,
 * mirrored into an sqlite table `attempts` in the telemetry file (STEVE_D1_FILE) for
 * queries. Writing never throws into the bot.
 *
 * Discipline: `context` holds only what the bot legitimately sensed (own state,
 * inventory, blocks it has SEEN exposed, entities it can see, time of day). The harness
 * may grade outcomes with RCON truth; features may not use unexposed world data.
 */
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bot } from "typecraft";

export type AttemptOutcome = "ok" | "timeout" | "death" | "failed" | "vetoed";

export interface AttemptRow {
	run_id: string;
	bot_impl: "ts";
	build: string;
	world_seed: string | null;
	skill: string;
	step_id: string;
	source: "gym" | "race";
	bot: string;
	start_ms: number;
	duration_s: number;
	outcome: AttemptOutcome;
	reason: string;
	death_cause: string | null;
	pos: [number, number, number] | null;
	deepest_phase: string;
	progress: number;
	params: Record<string, string | number>;
	context: Record<string, number | boolean | null>;
}

let build: string | null = null;
/** The checked-out commit (short), cached: every row says which build produced it. */
export const buildId = (): string => {
	if (build) return build;
	try {
		build = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
	} catch {
		build = "unknown";
	}
	return build;
};

const attemptsPath = (): string => process.env.STEVE_ATTEMPTS_FILE ?? "data/gym/attempts.jsonl";

let db: DatabaseSync | null = null;
let dbTried = false;
const mirror = (): DatabaseSync | null => {
	if (dbTried) return db;
	dbTried = true;
	const file = process.env.STEVE_D1_FILE;
	if (!file) return null;
	try {
		db = new DatabaseSync(file);
		db.exec("PRAGMA busy_timeout = 8000");
		db.exec(`CREATE TABLE IF NOT EXISTS attempts (
			id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, bot_impl TEXT, build TEXT, world_seed TEXT,
			skill TEXT, step_id TEXT, source TEXT, bot TEXT, start_ms INTEGER, duration_s REAL, outcome TEXT,
			reason TEXT, death_cause TEXT, pos TEXT, deepest_phase TEXT, progress REAL, params TEXT, context TEXT)`);
	} catch {
		db = null;
	}
	return db;
};

/** Append one attempt (or primitive) row. Never throws. */
export const writeAttempt = (row: AttemptRow): void => {
	try {
		const path = attemptsPath();
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, `${JSON.stringify(row)}\n`);
	} catch {}
	try {
		mirror()
			?.prepare(
				`INSERT INTO attempts (run_id,bot_impl,build,world_seed,skill,step_id,source,bot,start_ms,duration_s,outcome,reason,death_cause,pos,deepest_phase,progress,params,context)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			)
			.run(
				row.run_id, row.bot_impl, row.build, row.world_seed, row.skill, row.step_id, row.source, row.bot,
				row.start_ms, row.duration_s, row.outcome, row.reason, row.death_cause,
				row.pos ? JSON.stringify(row.pos) : null, row.deepest_phase, row.progress,
				JSON.stringify(row.params), JSON.stringify(row.context),
			);
	} catch {}
};

const HOSTILE = new Set(["zombie", "skeleton", "creeper", "spider", "cave_spider", "enderman", "witch", "drowned", "husk", "stray", "slime", "magma_cube", "blaze", "ghast", "piglin_brute", "zombified_piglin", "phantom", "pillager"]);

/**
 * What the bot sensed at the start of an attempt. Lava/water counts use findBlocks with
 * the default (line-of-sight / exposed) check — blocks the bot can see, not chunk truth.
 */
export const senseContext = (bot: Bot): Record<string, number | boolean | null> => {
	const b = bot as Bot & {
		health?: number;
		food?: number;
		oxygenLevel?: number;
		time?: { timeOfDay?: number };
		entities?: Record<string, { name?: string; position?: { x: number; y: number; z: number } }>;
		inventory?: { items?: () => { name: string; count: number }[] };
	};
	const p = bot.entity?.position;
	const countSeen = (name: string): number => {
		try {
			return (bot.findBlocks({ matching: (n: string) => n === name, maxDistance: 8, count: 64 } as never) as unknown[]).length;
		} catch {
			return 0;
		}
	};
	const inv = (name: string): number => {
		try {
			return (b.inventory?.items?.() ?? []).filter((i) => i.name === name).reduce((a, i) => a + i.count, 0);
		} catch {
			return 0;
		}
	};
	let hostiles = 0;
	try {
		for (const e of Object.values(b.entities ?? {})) {
			if (!e?.name || !HOSTILE.has(e.name) || !e.position || !p) continue;
			if (Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) <= 16) hostiles++;
		}
	} catch {}
	// Ground unevenness: spread of the walkable surface height over the 5×5 around the
	// bot, from the blocks next to it (all within plain sight).
	let unevenness: number | null = null;
	try {
		if (p) {
			const ys: number[] = [];
			for (let dx = -2; dx <= 2; dx++)
				for (let dz = -2; dz <= 2; dz++)
					for (let dy = 3; dy >= -4; dy--) {
						const blk = bot.blockAt({ x: Math.floor(p.x) + dx, y: Math.floor(p.y) + dy, z: Math.floor(p.z) + dz } as never);
						const n = (blk as { name?: string } | null)?.name ?? "air";
						if (n !== "air" && n !== "cave_air" && n !== "water" && n !== "lava") {
							ys.push(dy);
							break;
						}
					}
			if (ys.length) unevenness = Math.max(...ys) - Math.min(...ys);
		}
	} catch {}
	return {
		y: p ? Math.floor(p.y) : null,
		health: b.health ?? null,
		food: b.food ?? null,
		air: b.oxygenLevel ?? null,
		time_of_day: b.time?.timeOfDay ?? null,
		in_water: !!(bot.entity as { isInWater?: boolean } | undefined)?.isInWater,
		cobble: inv("cobblestone"),
		buckets: inv("bucket"),
		lava_buckets: inv("lava_bucket"),
		water_buckets: inv("water_bucket"),
		lava_cells_8: countSeen("lava"),
		water_cells_8: countSeen("water"),
		hostiles_seen: hostiles,
		ground_unevenness: unevenness,
	};
};
