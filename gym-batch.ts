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
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { connect } from "./src/lib/steve/lib/rcon.ts";

const SLUG = process.env.STEP ?? "build-nether-portal";
const RUNS = parseInt(process.env.RUNS ?? "10", 10);
const BATCH = process.env.BATCH ?? `b${Date.now().toString(36)}`;
const MOBS = (process.env.MOBS ?? "off").toLowerCase();
const commit = execSync("git rev-parse --short HEAD").toString().trim();

mkdirSync("data/gym", { recursive: true });
const db = new DatabaseSync("data/gym/batches.db");
db.exec(`CREATE TABLE IF NOT EXISTS runs (
	run_id TEXT PRIMARY KEY, batch TEXT, slug TEXT, commit_hash TEXT, started_at TEXT,
	seconds REAL, deepest_phase TEXT, last_cast_event TEXT, obsidian INTEGER,
	outcome TEXT, death_cause TEXT, message TEXT, mobs TEXT, note TEXT)`);

delete process.env.STEVE_INGEST_URL; // read the local D1 only
const { connectDb } = await import("./src/lib/steve/lib/db.ts");
const d1 = connectDb();
const q = (sql: string): Record<string, unknown>[] => d1.query(sql) as Record<string, unknown>[];
const esc = (s: string) => s.replace(/'/g, "''");

const rcon = await connect();
await rcon.command(`gamerule do_mob_spawning ${MOBS === "on" ? "true" : "false"}`);
console.log(`batch ${BATCH} slug=${SLUG} runs=${RUNS} commit=${commit} mobs=${MOBS}`);

const runOne = (raceId: string): Promise<{ code: number | null; out: string }> =>
	new Promise((resolve) => {
		const p = spawn(
			process.execPath,
			["--env-file=.env", "--import", "./typecraft-resolve.mjs", "gym-cli.ts"],
			{ env: { ...process.env, STEP: SLUG, BOT: "Gym_cast", GYM_RUN_ID: raceId }, stdio: ["ignore", "pipe", "pipe"] },
		);
		let out = "";
		p.stdout.on("data", (d) => (out += d.toString()));
		p.stderr.on("data", (d) => (out += d.toString()));
		p.on("exit", (code) => resolve({ code, out }));
	});

for (let i = 1; i <= RUNS; i++) {
	const runId = `${BATCH}-${i}`;
	const raceId = `gym-${SLUG}-${runId}`;
	const startedAt = new Date().toISOString();
	const t0 = Date.now();
	const { out } = await runOne(raceId);
	const seconds = (Date.now() - t0) / 1000;
	const m = /GYMRESULT (\{.*\})/.exec(out);
	const res = m ? (JSON.parse(m[1]!) as { pass: boolean; durationMs: number; message: string }) : null;
	const hb = q(`SELECT detail FROM events WHERE race_id='${esc(raceId)}' AND category='hb' AND detail LIKE '%phase=%' ORDER BY id DESC LIMIT 1`)[0];
	const phase = hb ? (/phase=(.*?) last=/.exec(String(hb.detail))?.[1] ?? "") : "";
	const lastCast = q(`SELECT event, detail FROM events WHERE race_id='${esc(raceId)}' AND category='cast' AND event NOT IN ('pillar_step','pool','descend','shuffle') ORDER BY id DESC LIMIT 1`)[0];
	const obsidian = Number(q(`SELECT COUNT(*) n FROM events WHERE race_id='${esc(raceId)}' AND category='cast' AND event='obsidian'`)[0]?.n ?? 0);
	const death = q(`SELECT detail FROM events WHERE race_id='${esc(raceId)}' AND category='death' AND event='message' LIMIT 1`)[0];
	const deathCause = death ? (/\[(death\.[a-z._]+)\]/.exec(String(death.detail))?.[1] ?? "death") : "";
	const message = res?.message ?? (out.includes("TIMEOUT") ? "cli timeout" : "no result");
	const outcome = res?.pass ? "pass" : deathCause ? "death" : /timeout/i.test(message) ? "timeout" : "fail";
	const lastEv = lastCast ? `${lastCast.event} ${String(lastCast.detail ?? "").slice(0, 60)}` : "";
	db.prepare(`INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
		runId, BATCH, SLUG, commit, startedAt, seconds, phase, lastEv, obsidian, outcome, deathCause, message.slice(0, 300), MOBS, "",
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
