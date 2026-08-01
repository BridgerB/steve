// Reads the live steve race data from the shared Postgres DB (written by the
// bots) and shapes it into the per-bot / per-step structure the dashboard
// renders. Because it reads a shared Postgres server (not a local SQLite file),
// the dashboard can run anywhere — it no longer has to live on the race box.

import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import { STEP_IDX } from '$lib/steps';

// Console keeps a rolling tail of at most this many most-recent events.
const LOG_TAIL = 200;

let sql: ReturnType<typeof postgres> | null = null;
function getSql(): ReturnType<typeof postgres> {
	if (!sql) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
		// Small pool — shared Postgres with limited slots (see lib/steve/lib/db.ts).
		sql = postgres(env.DATABASE_URL, { max: 3 });
	}
	return sql;
}

export type BotInfo = {
	id: string;
	done: number[]; // step indices with a 'success' event
	doneAt: Record<number, number>; // step index -> epoch ms of first completion
	current: number; // step index currently in progress (-1 = none)
	stepRoundStartMs: number | null; // epoch ms of the latest 'start' of the current step
	stepPriorMs: number; // ms spent on the current step in prior (completed) rounds
	stepReturning: boolean; // current step has ≥2 'start's → bot regressed back to it
	x: string;
	y: string;
	z: string;
	health: string;
	dim: string;
	dead: boolean;
	deaths: number; // how many times this bot has died this race
	inWater: boolean; // latest tick had the bot in water → get-out-of-water override is active
	inv: { name: string; count: number }[]; // latest inventory snapshot, count-desc
	ev: Record<string, Record<string, number>>; // category → event name → latest epoch ms (drives step sub-tasks + times)
};

export type LogLine = {
	ts: string;
	category: string;
	event: string;
	detail: string | null;
	x: number | null;
	y: number | null;
	z: number | null;
	yaw: number | null;
	pitch: number | null;
};

export type RaceData = {
	raceId: string;
	raceStartMs: number | null;
	bots: BotInfo[];
	log?: LogLine[]; // recent events (chronological) for the live console
	error?: string;
};

type StepRow = { bot_id: string; event: string; detail: string | null; ts: string };
type LastRow = { bot_id: string; category: string; event: string };
type TickRow = {
	bot_id: string;
	health: number | null;
	x: number | null;
	y: number | null;
	z: number | null;
	dimension: string | null;
	is_in_water: number | null;
};

const str = (n: number | null): string => (n == null ? '?' : String(n));

export async function getRaceData(): Promise<RaceData> {
	try {
		const sql = getSql();
		// The interactive steve-mcp bot logs into the SAME db under a `mcp-…` race_id;
		// exclude it so its ticks never hijack the main dashboard (it has its own /mcp page).
		const latest = (await sql`
			SELECT race_id FROM events WHERE race_id NOT LIKE 'mcp%' ORDER BY id DESC LIMIT 1
		`) as unknown as { race_id: string }[];
		if (latest.length === 0) return { raceId: '?', raceStartMs: null, bots: [] };
		const raceId = latest[0].race_id;

		const startRow = (await sql`
			SELECT MIN(ts) AS t FROM events WHERE race_id = ${raceId}
		`) as unknown as { t: string | null }[];
		const raceStartMs = startRow[0]?.t ? Date.parse(startRow[0].t) : null;

		const stepRows = (await sql`
			SELECT bot_id, event, detail, ts FROM events
			WHERE race_id = ${raceId} AND category = 'step' AND event IN ('start', 'success')
			ORDER BY id
		`) as unknown as StepRow[];

		const lastRows = (await sql`
			SELECT bot_id, category, event FROM events
			WHERE id IN (SELECT MAX(id) FROM events WHERE race_id = ${raceId} GROUP BY bot_id)
		`) as unknown as LastRow[];

		const tickRows = (await sql`
			SELECT bot_id, CAST(health AS INT) AS health, CAST(x AS INT) AS x,
			       CAST(y AS INT) AS y, CAST(z AS INT) AS z, dimension, is_in_water FROM ticks
			WHERE id IN (SELECT MAX(id) FROM ticks WHERE race_id = ${raceId} GROUP BY bot_id)
		`) as unknown as TickRow[];

		const bots = new Map<string, BotInfo>();
		const get = (id: string): BotInfo => {
			let b = bots.get(id);
			if (!b) {
				b = { id, done: [], doneAt: {}, current: -1, stepRoundStartMs: null, stepPriorMs: 0, stepReturning: false, x: '?', y: '?', z: '?', health: '?', dim: '', dead: false, deaths: 0, inWater: false, inv: [], ev: {} };
				bots.set(id, b);
			}
			return b;
		};

		// Per-bot walk over step events (chronological) to time each step: close the
		// active round when a different step starts or the step succeeds, accumulating
		// per-step totals + start counts so we can show current-round + total time.
		const walks = new Map<
			string,
			{
				active: number | null;
				activeStartMs: number;
				perStep: Map<number, { totalMs: number; starts: number }>;
			}
		>();
		const getWalk = (id: string) => {
			let w = walks.get(id);
			if (!w) {
				w = { active: null, activeStartMs: 0, perStep: new Map() };
				walks.set(id, w);
			}
			return w;
		};
		const closeRound = (w: ReturnType<typeof getWalk>, ms: number) => {
			if (w.active === null || Number.isNaN(ms)) return;
			const ps = w.perStep.get(w.active);
			if (ps) ps.totalMs += Math.max(0, ms - w.activeStartMs);
			w.active = null;
		};

		for (const r of stepRows) {
			const b = get(r.bot_id);
			const w = getWalk(r.bot_id);
			const ms = Date.parse(r.ts);
			if (r.event === 'success') {
				const name = (r.detail ?? '').split(': ')[0];
				const i = STEP_IDX.get(name);
				if (i !== undefined) {
					if (!b.done.includes(i)) b.done.push(i);
					if (b.doneAt[i] === undefined && !Number.isNaN(ms)) b.doneAt[i] = ms;
				}
				closeRound(w, ms);
			} else if (r.event === 'start') {
				const i = STEP_IDX.get(r.detail ?? '');
				if (i !== undefined) {
					b.current = i;
					closeRound(w, ms); // a new round begins (same or different step)
					w.active = i;
					w.activeStartMs = Number.isNaN(ms) ? Date.now() : ms;
					const ps = w.perStep.get(i) ?? { totalMs: 0, starts: 0 };
					ps.starts += 1;
					w.perStep.set(i, ps);
				}
			}
		}
		for (const [id, w] of walks) {
			const b = get(id);
			if (b.current < 0) continue;
			const ps = w.perStep.get(b.current);
			b.stepReturning = (ps?.starts ?? 0) >= 2;
			b.stepPriorMs = ps?.totalMs ?? 0;
			b.stepRoundStartMs = w.active === b.current ? w.activeStartMs : null;
		}
		for (const r of lastRows) {
			const b = get(r.bot_id);
			if (r.category === 'lifecycle' && (r.event === 'disconnected' || r.event === 'kicked'))
				b.dead = true;
		}
		for (const r of tickRows) {
			const b = get(r.bot_id);
			b.health = str(r.health);
			b.x = str(r.x);
			b.y = str(r.y);
			b.z = str(r.z);
			b.dim = r.dimension ?? '';
			b.inWater = r.is_in_water === 1;
		}

		// The get-out-of-water override is authoritative via its own events (it also
		// fires for lily-pad/bobbing cases a tick's is_in_water flag misses). Latest
		// 'override' event per bot: escape_water = active, escape_done = cleared.
		const ovRows = (await sql`
			SELECT bot_id, event FROM events
			WHERE category = 'override'
			  AND id IN (
			    SELECT MAX(id) FROM events
			    WHERE race_id = ${raceId} AND category = 'override' GROUP BY bot_id
			  )
		`) as unknown as { bot_id: string; event: string }[];
		for (const r of ovRows) get(r.bot_id).inWater = r.event === 'escape_water';

		// Death count per bot this race (lifecycle 'death' events).
		const deathRows = (await sql`
			SELECT bot_id, COUNT(*)::int AS deaths FROM events
			WHERE race_id = ${raceId} AND category = 'lifecycle' AND event = 'death'
			GROUP BY bot_id
		`) as unknown as { bot_id: string; deaths: number }[];
		for (const r of deathRows) get(r.bot_id).deaths = r.deaths;

		// Each bot's latest inventory snapshot: all rows at its most recent ts,
		// summed per item, count-desc. (Each tick writes a full snapshot of the
		// bot's non-empty slots, so the newest ts is its current inventory.)
		const invRows = (await sql`
			WITH latest AS (
				SELECT bot_id, MAX(ts) AS ts FROM inventory_snapshots
				WHERE race_id = ${raceId} GROUP BY bot_id
			)
			SELECT i.bot_id, i.item_name AS name, SUM(i.count)::int AS count
			FROM inventory_snapshots i
			JOIN latest l ON l.bot_id = i.bot_id AND l.ts = i.ts
			WHERE i.race_id = ${raceId}
			GROUP BY i.bot_id, i.item_name
			ORDER BY count DESC
		`) as unknown as { bot_id: string; name: string; count: number }[];
		for (const r of invRows) get(r.bot_id).inv.push({ name: r.name, count: r.count });

		// Latest timestamp of each event per (category) per bot — drives the per-step
		// sub-task views and the time shown on each sub-task.
		const evRows = (await sql`
			SELECT bot_id, category, event, MAX(ts) AS ts FROM events
			WHERE race_id = ${raceId}
			  AND (category IN ('wood', 'smelt') OR category LIKE 'mine:%')
			GROUP BY bot_id, category, event
		`) as unknown as { bot_id: string; category: string; event: string; ts: string }[];
		for (const r of evRows) {
			const ms = Date.parse(r.ts);
			if (Number.isNaN(ms)) continue;
			const b = get(r.bot_id);
			(b.ev[r.category] ??= {})[r.event] = ms;
		}

		// Recent events for the live log console (newest first from the DB → reverse
		// to chronological so the console reads top→bottom oldest→newest).
		const logRows = (await sql`
			SELECT ts, category, event, detail, x, y, z FROM events
			WHERE race_id = ${raceId}
			ORDER BY id DESC LIMIT ${LOG_TAIL}
		`) as unknown as LogLine[];
		const log = logRows.reverse();

		return {
			raceId,
			raceStartMs,
			log,
			bots: [...bots.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
		};
	} catch (e) {
		return { raceId: '?', raceStartMs: null, bots: [], error: e instanceof Error ? e.message : 'query failed' };
	}
}
