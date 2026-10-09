/**
 * Run a batch of gym exercises back to back and keep a results table.
 *
 *   STEP=build-nether-portal GYM_LAVA_D=6 RUNS=10 BATCH=b3 MOBS=off \
 *     node --env-file=.env --import ./typecraft-resolve.mjs gym-batch.ts
 *
 * Each run is one gym-cli.ts process (fresh bot, fresh random arena). After it
 * exits, the run's telemetry (race_id = gym-<slug>-<batch>-<n>) is read from the
 * local D1 to fill: deepest sub-phase (last heartbeat phase), last cast event,
 * obsidian count, death cause. One row per run goes to data/gym/batches.db and a
 * batch summary is printed at the end. Read the summary, not the console.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { connect } from "./src/lib/steve/lib/rcon.ts";
import { runMetrics, type TelemetryEvent } from "./src/lib/steve/ml/screen.ts";
import { fmtRate, quantile } from "./src/lib/steve/ml/stats.ts";
import { writeAttempt } from "./src/lib/steve/lib/attempts.ts";

import { applyServerProfile, headerError } from "./src/lib/steve/gym/server-profile.ts";

const SLUG = process.env.STEP ?? "build-nether-portal";
// Cycle 6: the server profile (GYM_SERVER, default box-a) and the header assertion run
// before anything touches a server.
const SERVER = applyServerProfile();
{
	const err = headerError(SLUG, process.env.GYM_LAVA_D);
	if (err) {
		console.log(`REFUSED: ${err}`);
		process.exit(4);
	}
}
const RUNS = parseInt(process.env.RUNS ?? "10", 10);
const BATCH = process.env.BATCH ?? `b${Date.now().toString(36)}`;
// Mobs stay ON for every batch: it is the race's condition, and a RUNS=0 smoke test
// with the old default ("off") silently turned spawn_mobs off on the race server.
const MOBS = "on";
const commit = execSync("git rev-parse --short HEAD").toString().trim();

mkdirSync("data/gym", { recursive: true });

// ONE batch at a time (b12: two concurrent batches took server ticks from 17 ms to
// 104 ms and polluted the cast). The runner holds data/gym/batch.lock for its life.
const LOCK = "data/gym/batch.lock";
if (existsSync(LOCK)) {
	const pid = parseInt(readFileSync(LOCK, "utf8"), 10);
	let alive = false;
	try {
		process.kill(pid, 0);
		alive = true;
	} catch {}
	if (alive) {
		console.log(`LOCKED by pid ${pid} — another batch is running; not starting`);
		process.exit(3);
	}
}
writeFileSync(LOCK, String(process.pid));
const releaseLock = () => {
	try {
		if (readFileSync(LOCK, "utf8") === String(process.pid)) unlinkSync(LOCK);
	} catch {}
};
process.on("exit", releaseLock);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
const db = new DatabaseSync("data/gym/batches.db");
db.exec(`CREATE TABLE IF NOT EXISTS runs (
	run_id TEXT PRIMARY KEY, batch TEXT, slug TEXT, commit_hash TEXT, started_at TEXT,
	seconds REAL, deepest_phase TEXT, last_cast_event TEXT, obsidian INTEGER,
	outcome TEXT, death_cause TEXT, message TEXT, mobs TEXT, note TEXT)`);
// Harness health per run, so harness damage shows in the table before it eats a
// batch (b13: 692 leaked forceloads, full heap, 7 of 10 runs lost).
for (const col of [
	"forceloads INTEGER", "mem_avail_mb INTEGER", "tick_ms REAL", "tick_p99_ms REAL",
	// cycle 4: replayable trials + the primary natural-cast metric
	"seed TEXT", "landing_x INTEGER", "landing_z INTEGER", "land_y INTEGER",
	"time_to_portal_s REAL", "dispatches INTEGER", "deaths INTEGER",
	// cycle 5: screening metrics (continuous) + per-fix diagnostic counters + tick time
	"best_frame INTEGER", "block_gap_med_s REAL", "counters TEXT", "game_ticks INTEGER", "tick_rate REAL",
]) {
	try {
		db.exec(`ALTER TABLE runs ADD COLUMN ${col}`);
	} catch {}
}

delete process.env.STEVE_INGEST_URL; // read the local D1 only
const { connectDb } = await import("./src/lib/steve/lib/db.ts");
const d1 = connectDb();
const q = (sql: string): Record<string, unknown>[] => d1.query(sql) as Record<string, unknown>[];
const esc = (s: string) => s.replace(/'/g, "''");

const rcon = await connect({ timeout: 30_000 });
// 26.x name is spawn_mobs; do_mob_spawning is rejected ("Incorrect argument"), so every
// batch before this fix ran with mobs ON regardless of MOBS.
const mobReply = await rcon.command(`gamerule spawn_mobs ${MOBS === "on" ? "true" : "false"}`);
if (/Incorrect/i.test(mobReply)) console.log(`WARN gamerule: ${mobReply}`);
console.log(`batch ${BATCH} slug=${SLUG} runs=${RUNS} commit=${commit} mobs=${MOBS} server=${SERVER} GYM_LAVA_D=${process.env.GYM_LAVA_D ?? "-"} landings=${process.env.GYM_LANDINGS ?? "-"}`);
// A killed batch never reaches the per-run release below, so its landing stays
// forceloaded; this runner owns server A's forceloads — clear leftovers up front.
console.log(`startup ${await rcon.command("forceload remove all").catch(() => "forceload remove failed")}`);

const memAvailMb = (): number | null => {
	try {
		const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
		return m ? Math.round(parseInt(m[1]!, 10) / 1024) : null;
	} catch {
		// macOS (local gym server): no /proc; free memory is the closest number.
		return Math.round(freemem() / 1048576);
	}
};
/** Server health before a run; null when RCON does not answer. */
const health = async (): Promise<{ forceloads: number; tickMs: number | null; p99: number | null } | null> => {
	try {
		const fl = await rcon.command("forceload query");
		const forceloads = /No force loaded/.test(fl) ? 0 : parseInt(/(\d+) force loaded/.exec(fl)?.[1] ?? "-1", 10);
		const tq = await rcon.command("tick query");
		const tickMs = parseFloat(/Average time per tick: ([\d.]+)ms/.exec(tq)?.[1] ?? "NaN");
		const p99 = parseFloat(/P99: ([\d.]+)ms/.exec(tq)?.[1] ?? "NaN");
		return { forceloads, tickMs: Number.isNaN(tickMs) ? null : tickMs, p99: Number.isNaN(p99) ? null : p99 };
	} catch {
		return null;
	}
};

// GYM_LANDINGS=<file>: a JSON array of [x, z] landings, slot i replays landings[i-1]
// (paired comparisons on the same terrain, cycle 4 Part 4).
const LANDINGS: [number, number][] = process.env.GYM_LANDINGS
	? (JSON.parse(readFileSync(process.env.GYM_LANDINGS, "utf8")) as [number, number][])
	: [];
let slotLanding: [number, number] | undefined;

const runOne = (raceId: string): Promise<{ code: number | null; out: string }> =>
	new Promise((resolve) => {
		const p = spawn(
			process.execPath,
			["--env-file=.env", "--import", "./typecraft-resolve.mjs", "gym-cli.ts"],
			{
				env: {
					...process.env,
					STEP: SLUG,
					BOT: process.env.BOT ?? "Gym_cast",
					MC_USERNAME: process.env.BOT ?? "Gym_cast",
					GYM_RUN_ID: raceId,
					...(slotLanding ? { GYM_LANDING: `${slotLanding[0]},${slotLanding[1]}` } : {}),
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let out = "";
		p.stdout.on("data", (d) => (out += d.toString()));
		p.stderr.on("data", (d) => (out += d.toString()));
		p.on("exit", (code) => resolve({ code, out }));
	});

for (let i = 1; i <= RUNS; i++) {
	slotLanding = LANDINGS[i - 1];
	const runId = `${BATCH}-${i}`;
	const raceId = `gym-${SLUG}-${runId}`;
	// Pre-run check: RCON must answer. A dead link makes every run a harness loss
	// that teaches nothing (b14: 6 runs). Pause up to 30 min, then record harness.
	let h = await health();
	for (let w = 0; !h && w < 30; w++) {
		console.log(`${runId}  RCON not answering — pausing 60s (${w + 1}/30)`);
		await new Promise((r) => setTimeout(r, 60_000));
		h = await health();
	}
	if (!h) {
		db.prepare(`INSERT OR REPLACE INTO runs (run_id,batch,slug,commit_hash,started_at,seconds,outcome,message,mobs,note) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
			runId, BATCH, SLUG, commit, new Date().toISOString(), 0, "harness", "HARNESS rcon down 30 min", MOBS, "",
		);
		console.log(`${runId}  harness  RCON down 30 min`);
		continue;
	}
	const memMb = memAvailMb();
	const startedAt = new Date().toISOString();
	const t0 = Date.now();
	// A dropped connection (server 'Timed out' after a client stall during the
	// spread teleport) says nothing about the step: rerun the slot, up to twice.
	let rid = raceId;
	let { out } = await runOne(raceId);
	for (let retry = 1; retry <= 2 && /DISCONNECTED /.test(out); retry++) {
		console.log(`${runId}  disconnect (${/DISCONNECTED (.*)/.exec(out)?.[1]}) — rerunning slot (${retry})`);
		rid = `${raceId}-r${retry}`;
		({ out } = await runOne(rid));
	}
	// Every run forceloads its spread cell + arena and never released them: 692
	// chunks were pinned on server A by 22:48, its 10G heap was full, RCON replies
	// lagged a command behind and 7 of b13's 10 spreads were misread (harness). The
	// runner owns server A's forceloads — clear them after every run.
	await rcon.command("forceload remove all").catch(() => "");
	mkdirSync("data/gym/logs", { recursive: true });
	writeFileSync(`data/gym/logs/${raceId}.log`, out);
	const seconds = (Date.now() - t0) / 1000;
	const m = /GYMRESULT (\{.*\})/.exec(out);
	const res = m
		? (JSON.parse(m[1]!) as {
				pass: boolean;
				durationMs: number;
				message: string;
				y?: number;
				seed?: string;
				landing?: [number, number];
				extra?: { time_to_portal_s?: number; dispatches?: number; deaths?: number; game_ticks?: number; tick_rate?: number; harness_respawns?: number };
			})
		: null;
	const hb = q(`SELECT detail FROM events WHERE race_id='${esc(rid)}' AND category='hb' AND detail LIKE '%phase=%' ORDER BY id DESC LIMIT 1`)[0];
	const phase = hb ? (/phase=(.*?) last=/.exec(String(hb.detail))?.[1] ?? "") : "";
	const lastCast = q(`SELECT event, detail FROM events WHERE race_id='${esc(rid)}' AND category='cast' AND event NOT IN ('pillar_step','pool','descend','shuffle') ORDER BY id DESC LIMIT 1`)[0];
	const obsidian = Number(q(`SELECT COUNT(*) n FROM events WHERE race_id='${esc(rid)}' AND category='cast' AND event='obsidian'`)[0]?.n ?? 0);
	const death = q(`SELECT detail FROM events WHERE race_id='${esc(rid)}' AND category='death' AND event='message' LIMIT 1`)[0];
	const deathCause = death ? (/\[(death\.[a-z._]+)\]/.exec(String(death.detail))?.[1] ?? "death") : "";
	const message = res?.message ?? (/DISCONNECTED (.*)/.exec(out)?.[1] ? `disconnected: ${/DISCONNECTED (.*)/.exec(out)?.[1]}` : out.includes("TIMEOUT") ? "cli timeout" : "no result");
	const disc = /DISCONNECTED (.*)/.exec(out)?.[1];
	// b4-5: the step's pass check found a LEFTOVER portal (stale world after a silent
	// disconnect) with 0 obsidian cast. A cast pass needs the cast to have happened.
	// n16-1: a natural run walked into an EXISTING portal (ruined or a leftover) in 59 s with 0
	// obsidian cast and was scored a pass. A cast pass needs the bot's own 10 obsidian.
	const castOk = (SLUG !== "build-nether-portal" && SLUG !== "portal-natural") || obsidian >= 10;
	const outcome = res?.pass && castOk ? "pass" : /^HARNESS/.test(message) ? "harness" : disc ? "disconnect" : deathCause ? "death" : /timeout/i.test(message) ? "timeout" : "fail";
	const metrics = runMetrics(
		q(`SELECT ts, category, event, detail FROM events WHERE race_id='${esc(rid)}' AND category IN ('cast','death') ORDER BY ts`) as unknown as TelemetryEvent[],
	);
	const lastEv = lastCast ? `${lastCast.event} ${String(lastCast.detail ?? "").slice(0, 60)}` : "";
	db.prepare(`INSERT OR REPLACE INTO runs (run_id,batch,slug,commit_hash,started_at,seconds,deepest_phase,last_cast_event,obsidian,outcome,death_cause,message,mobs,note,forceloads,mem_avail_mb,tick_ms,tick_p99_ms,seed,landing_x,landing_z,land_y,time_to_portal_s,dispatches,deaths,best_frame,block_gap_med_s,counters,game_ticks,tick_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
		runId, BATCH, SLUG, commit, startedAt, seconds, phase, lastEv, obsidian, outcome, deathCause, message.slice(0, 300), MOBS, "",
		h.forceloads, memMb, h.tickMs, h.p99,
		res?.seed ?? null, res?.landing?.[0] ?? null, res?.landing?.[1] ?? null, res?.y ?? null,
		outcome === "pass" ? (res?.extra?.time_to_portal_s ?? null) : null,
		res?.extra?.dispatches ?? null, res?.extra?.deaths ?? null,
		metrics.best_frame, metrics.block_gap_med_s,
		JSON.stringify({ ...metrics.counters, harness_respawns: res?.extra?.harness_respawns ?? 0 }),
		res?.extra?.game_ticks ?? null, res?.extra?.tick_rate ?? null,
	);
	writeAttempt({
		run_id: rid,
		bot_impl: "ts",
		build: commit,
		world_seed: res?.seed ?? null,
		skill: SLUG === "portal-natural" || SLUG === "build-nether-portal" ? "portal_cast" : SLUG,
		step_id: SLUG,
		source: "gym",
		bot: process.env.BOT ?? "Gym_cast",
		start_ms: Date.parse(startedAt),
		duration_s: seconds,
		outcome: outcome === "pass" ? "ok" : outcome === "death" ? "death" : outcome === "timeout" ? "timeout" : "failed",
		reason: message.slice(0, 200),
		death_cause: deathCause || null,
		pos: res?.landing ? [res.landing[0], res.y ?? 0, res.landing[1]] : null,
		deepest_phase: phase,
		progress: obsidian,
		params: {},
		context: {
			time_to_portal_s: res?.extra?.time_to_portal_s ?? null,
			dispatches: res?.extra?.dispatches ?? null,
			deaths: res?.extra?.deaths ?? null,
			forceloads: h.forceloads,
			mem_avail_mb: memMb,
			tick_ms: h.tickMs,
			harness: outcome === "harness" || outcome === "disconnect",
			best_frame: metrics.best_frame,
			lava_deaths: metrics.lava_deaths,
			block_gap_med_s: metrics.block_gap_med_s,
			game_ticks: res?.extra?.game_ticks ?? null,
			tick_rate: res?.extra?.tick_rate ?? null,
			harness_respawns: res?.extra?.harness_respawns ?? 0,
			...Object.fromEntries(Object.entries(metrics.counters).map(([k, v]) => [`n_${k}`, v])),
		},
	});
	console.log(`  best_frame=${metrics.best_frame} deaths=${metrics.deaths} gap_med=${metrics.block_gap_med_s ?? "-"} counters=${JSON.stringify(Object.fromEntries(Object.entries(metrics.counters).filter(([, v]) => v)))}`);
	console.log(`${runId}  ${outcome.padEnd(7)} ${seconds.toFixed(0).padStart(4)}s  obsidian=${obsidian}  phase='${phase}'  last='${lastEv}'  ${message.slice(0, 80)}`);
}

// Summary with honest numbers (cycle 4 Part 5.1): every rate with its Wilson 95%
// interval over the runs that measured the step (harness rows excluded and counted).
const rows = db.prepare(`SELECT outcome, seconds, deepest_phase, death_cause, obsidian, time_to_portal_s, best_frame, deaths FROM runs WHERE batch=?`).all(BATCH) as {
	outcome: string; seconds: number; deepest_phase: string; death_cause: string; obsidian: number; time_to_portal_s: number | null; best_frame: number | null; deaths: number | null;
}[];
const real = rows.filter((r) => r.outcome !== "harness" && r.outcome !== "disconnect");
const passN = real.filter((r) => r.outcome === "pass").length;
const ttp = real.map((r) => r.time_to_portal_s).filter((x): x is number => typeof x === "number");
const passSecs = real.filter((r) => r.outcome === "pass").map((r) => r.seconds);
const fmtT = (xs: number[]) => (xs.length ? `median ${quantile(xs, 0.5).toFixed(0)} s, p80 ${quantile(xs, 0.8).toFixed(0)} s (n=${xs.length})` : "n=0");
console.log(`\nSUMMARY ${BATCH} ${SLUG} @${commit} mobs=${MOBS}: pass ${fmtRate(passN, real.length)}; harness/disconnect ${rows.length - real.length}`);
if (ttp.length) console.log(`  time-to-portal: ${fmtT(ttp)}`);
{
	const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");
	const bf = real.map((r) => Number(r.best_frame ?? 0));
	console.log(`  screening: best_frame median ${bf.length ? quantile(bf, 0.5) : "-"} mean ${mean(bf)}; obsidian mean ${mean(real.map((r) => r.obsidian))}; deaths mean ${mean(real.map((r) => Number(r.deaths ?? 0)))}`);
}
console.log(`  pass duration: ${fmtT(passSecs)}`);
const tally = (key: (r: (typeof rows)[number]) => string, label: string) => {
	const m = new Map<string, number>();
	for (const r of real) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
	console.log(`  ${label}:`);
	for (const [k, n] of [...m].sort((x, y) => y[1] - x[1])) console.log(`    ${n}× ${k || "(none)"}`);
};
tally((r) => r.outcome, "outcome");
tally((r) => (r.deepest_phase || "").split(/[ ,]/)[0] ?? "", "deepest phase");
if (SLUG === "build-nether-portal" || SLUG === "portal-natural") tally((r) => String(r.obsidian ?? 0), "obsidian placed");
if (real.some((r) => r.death_cause)) tally((r) => r.death_cause || "-", "death cause");
await rcon.close?.();
process.exit(0);
