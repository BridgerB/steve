/**
 * Dev-tool watcher: tails the local D1 telemetry of the current race and prints
 * every bot event as it lands (deduping tight loops as "×N"), plus a per-bot
 * status header every few seconds (position, health, water, current step and
 * how long it's been on it). Run it in a terminal pane and read it to learn
 * what the bots are actually doing.
 *
 *   node --env-file=.env --import ./typecraft-resolve.mjs scripts/watch-bot.ts
 *
 * Reads the LOCAL D1 file (races must write locally: no STEVE_INGEST_URL, or
 * STEVE_D1_TEE=1). STEVE_INGEST_URL is deliberately ignored here.
 */

delete process.env.STEVE_INGEST_URL;
import { connectDb } from "../src/lib/steve/lib/db.ts";

const db = connectDb();
const q = <T,>(sql: string, ...p: (string | number | null)[]): T[] => db.query<T>(sql, ...p);

type Ev = { id: number; ts: string; bot_id: string; category: string; event: string; detail: string | null; x: number | null; y: number | null; z: number | null };
type Tick = { bot_id: string; ts: string; x: number; y: number; z: number; health: number; food: number; dimension: string; is_in_water: number };

const hhmmss = (ts: string) => ts.slice(11, 19);
const short = (id: string) => id.replace("steve-race-", "#");
const SKIP = new Set(["threat"]); // periodic hostile scans are noise here

let lastId = 0;
let lastHeader = 0;
let raceId: string | null = null;
let prevKey = "";
let repeat = 0;
let prevLine = "";

const flushRepeat = () => {
	if (repeat > 1) process.stdout.write(`   ↑ ×${repeat}\n`);
	repeat = 0;
};

const printEvent = (e: Ev) => {
	const key = `${e.bot_id}|${e.category}|${e.event}|${(e.detail ?? "").slice(0, 40)}`;
	if (key === prevKey) {
		repeat++;
		return;
	}
	flushRepeat();
	prevKey = key;
	repeat = 1;
	const pos = e.x != null ? ` @${Math.round(e.x)},${Math.round(e.y ?? 0)},${Math.round(e.z ?? 0)}` : "";
	const detail = (e.detail ?? "").replace(/\s+/g, " ").slice(0, 110);
	prevLine = `${hhmmss(e.ts)} ${short(e.bot_id).padEnd(5)} ${e.category}/${e.event}${pos}  ${detail}`;
	console.log(prevLine);
};

const header = () => {
	if (!raceId) return;
	const ticks = q<Tick>(
		`SELECT bot_id, ts, x, y, z, health, food, dimension, is_in_water FROM ticks
		 WHERE id IN (SELECT MAX(id) FROM ticks WHERE race_id = ? GROUP BY bot_id) ORDER BY bot_id`,
		raceId,
	);
	const steps = q<{ bot_id: string; detail: string; ts: string }>(
		`SELECT bot_id, detail, ts FROM events WHERE id IN (
		   SELECT MAX(id) FROM events WHERE race_id = ? AND category = 'step' AND event = 'start' GROUP BY bot_id)`,
		raceId,
	);
	const stepOf = new Map(steps.map((s) => [s.bot_id, s]));
	console.log(`\n══ ${raceId}  ${new Date().toTimeString().slice(0, 8)} ═══════════════════════════════════════`);
	for (const t of ticks) {
		const s = stepOf.get(t.bot_id);
		const onStep = s ? Math.round((Date.now() - Date.parse(s.ts)) / 1000) : 0;
		const age = Math.round((Date.now() - Date.parse(t.ts)) / 1000);
		console.log(
			`${short(t.bot_id).padEnd(5)} ${String(Math.round(t.x)).padStart(6)},${String(Math.round(t.y)).padStart(4)},${String(Math.round(t.z)).padStart(6)}  hp ${t.health}${t.is_in_water ? " 💧" : "   "} ${t.dimension.padEnd(9)} step: ${(s?.detail ?? "—").padEnd(24)} ${onStep}s${age > 15 ? `  (tick ${age}s old ⚠)` : ""}`,
		);
	}
	console.log("");
};

const tick = () => {
	const latest = q<{ race_id: string }>(
		`SELECT race_id FROM events WHERE race_id NOT LIKE 'mcp%' ORDER BY id DESC LIMIT 1`,
	)[0]?.race_id;
	if (!latest) return;
	if (latest !== raceId) {
		raceId = latest;
		lastId = q<{ m: number }>(`SELECT COALESCE(MAX(id), 0) AS m FROM events WHERE race_id = ?`, raceId)[0]?.m ?? 0;
		lastId = Math.max(0, lastId - 40); // show a little history on (re)start
		console.log(`\n### watching race ${raceId}`);
	}
	const evs = q<Ev>(
		`SELECT id, ts, bot_id, category, event, detail, x, y, z FROM events WHERE race_id = ? AND id > ? ORDER BY id LIMIT 300`,
		raceId,
		lastId,
	);
	for (const e of evs) {
		lastId = e.id;
		if (SKIP.has(e.category)) continue;
		printEvent(e);
	}
	if (Date.now() - lastHeader > 8000) {
		flushRepeat();
		prevKey = "";
		header();
		lastHeader = Date.now();
	}
};

console.log("watch-bot: tailing local D1 …");
setInterval(tick, 1500);
