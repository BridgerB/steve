import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';

// Telemetry ingest: the standalone Node bot POSTs batched rows here (it can't
// use the D1 binding), and we write them to D1 via platform.env.DB. Gated by a
// shared bearer secret (STEVE_INGEST_SECRET). Rows arrive already in column order.
type Cell = string | number | null;
type Body = {
	race?: { id: string; kind: string; botCount: number; timeoutSec: number | null; goal: string | null };
	events?: Cell[][];
	ticks?: Cell[][];
	inv?: Cell[][];
};

const EVENT_COLS = 'race_id, bot_id, ts, category, event, detail, x, y, z, yaw, pitch';
const TICK_COLS =
	'race_id, bot_id, ts, x, y, z, yaw, pitch, health, food, dimension, block_below, block_at_cursor, is_in_water, on_ground';
const INV_COLS = 'race_id, bot_id, ts, slot, item_name, count';

// Build chunked multi-row INSERTs (stay well under SQLite's 999-variable cap).
function inserts(db: D1Database, table: string, cols: string, perRow: number, rows: Cell[][]) {
	const maxRows = Math.max(1, Math.floor(900 / perRow));
	const stmts: D1PreparedStatement[] = [];
	for (let i = 0; i < rows.length; i += maxRows) {
		const chunk = rows.slice(i, i + maxRows);
		const ph = chunk.map(() => `(${Array(perRow).fill('?').join(',')})`).join(',');
		stmts.push(db.prepare(`INSERT INTO ${table} (${cols}) VALUES ${ph}`).bind(...chunk.flat()));
	}
	return stmts;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const db = platform?.env?.DB;
	if (!db) throw error(503, 'D1 binding not available');

	const secret = (platform?.env as { STEVE_INGEST_SECRET?: string })?.STEVE_INGEST_SECRET;
	const auth = request.headers.get('authorization') ?? '';
	if (!secret || auth !== `Bearer ${secret}`) throw error(401, 'unauthorized');

	let body: Body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}

	const stmts: D1PreparedStatement[] = [];
	if (body.race) {
		const r = body.race;
		stmts.push(
			db
				.prepare(
					`INSERT INTO races (race_id, kind, started_at, bot_count, timeout_sec, goal)
					 VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (race_id) DO NOTHING`
				)
				.bind(r.id, r.kind, new Date().toISOString(), r.botCount, r.timeoutSec, r.goal)
		);
	}
	if (body.events?.length) stmts.push(...inserts(db, 'events', EVENT_COLS, 11, body.events));
	if (body.ticks?.length) stmts.push(...inserts(db, 'ticks', TICK_COLS, 15, body.ticks));
	if (body.inv?.length) stmts.push(...inserts(db, 'inventory_snapshots', INV_COLS, 6, body.inv));

	if (stmts.length) await db.batch(stmts);
	return json({ ok: true, wrote: stmts.length });
};
