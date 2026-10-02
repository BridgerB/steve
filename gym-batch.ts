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
import { DatabaseSync } from "node:sqlite";
import { connect } from "./src/lib/steve/lib/rcon.ts";

const SLUG = process.env.STEP ?? "build-nether-portal";
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
for (const col of ["forceloads INTEGER", "mem_avail_mb INTEGER", "tick_ms REAL", "tick_p99_ms REAL"]) {
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
console.log(`batch ${BATCH} slug=${SLUG} runs=${RUNS} commit=${commit} mobs=${MOBS}`);

const memAvailMb = (): number | null => {
	try {
		const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
		return m ? Math.round(parseInt(m[1]!, 10) / 1024) : null;
	} catch {
		return null;
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

const runOne = (raceId: string): Promise<{ code: number | null; out: string }> =>
	new Promise((resolve) => {
		const p = spawn(
			process.execPath,
			["--env-file=.env", "--import", "./typecraft-resolve.mjs", "gym-cli.ts"],
			{ env: { ...process.env, STEP: SLUG, BOT: process.env.BOT ?? "Gym_cast", GYM_RUN_ID: raceId }, stdio: ["ignore", "pipe", "pipe"] },
		);
		let out = "";
		p.stdout.on("data", (d) => (out += d.toString()));
		p.stderr.on("data", (d) => (out += d.toString()));
		p.on("exit", (code) => resolve({ code, out }));
	});

for (let i = 1; i <= RUNS; i++) {
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
	const res = m ? (JSON.parse(m[1]!) as { pass: boolean; durationMs: number; message: string }) : null;
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
	const castOk = SLUG !== "build-nether-portal" || obsidian >= 10;
	const outcome = res?.pass && castOk ? "pass" : /^HARNESS/.test(message) ? "harness" : disc ? "disconnect" : deathCause ? "death" : /timeout/i.test(message) ? "timeout" : "fail";
	const lastEv = lastCast ? `${lastCast.event} ${String(lastCast.detail ?? "").slice(0, 60)}` : "";
	db.prepare(`INSERT OR REPLACE INTO runs (run_id,batch,slug,commit_hash,started_at,seconds,deepest_phase,last_cast_event,obsidian,outcome,death_cause,message,mobs,note,forceloads,mem_avail_mb,tick_ms,tick_p99_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
		runId, BATCH, SLUG, commit, startedAt, seconds, phase, lastEv, obsidian, outcome, deathCause, message.slice(0, 300), MOBS, "",
		h.forceloads, memMb, h.tickMs, h.p99,
	);
	console.log(`${runId}  ${outcome.padEnd(7)} ${seconds.toFixed(0).padStart(4)}s  obsidian=${obsidian}  phase='${phase}'  last='${lastEv}'  ${message.slice(0, 80)}`);
}

const summary = db.prepare(`SELECT outcome, COUNT(*) n FROM runs WHERE batch=? GROUP BY outcome`).all(BATCH) as { outcome: string; n: number }[];
const phases = db.prepare(`SELECT deepest_phase p, COUNT(*) n FROM runs WHERE batch=? GROUP BY p ORDER BY n DESC`).all(BATCH) as { p: string; n: number }[];
const passes = (db.prepare(`SELECT seconds FROM runs WHERE batch=? AND outcome='pass' ORDER BY seconds`).all(BATCH) as { seconds: number }[]).map((r) => r.seconds);
const median = passes.length ? passes[Math.floor(passes.length / 2)]! : null;
const passN = summary.find((s) => s.outcome === "pass")?.n ?? 0;
console.log(`\nSUMMARY ${BATCH} ${SLUG} @${commit} mobs=${MOBS}: pass ${passN}/${RUNS}` + (median != null ? ` median ${median.toFixed(0)}s` : ""));
for (const s of summary) console.log(`  ${s.outcome}: ${s.n}`);
console.log("  deepest phase:");
for (const p of phases) console.log(`    ${p.n}x ${p.p || "(none)"}`);
await rcon.close?.();
process.exit(0);
