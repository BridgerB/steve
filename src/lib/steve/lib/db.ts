/**
 * Bot-side telemetry writer for the Cloudflare D1 database.
 *
 * The Node bot process can't use the Worker's D1 binding, so:
 *  - LOCAL dev: open the miniflare-managed local D1 SQLite file directly with
 *    Node's built-in `node:sqlite` (same file the local dashboard/Worker reads).
 *    Create it first with `npm run db:apply:local`.
 *  - REMOTE (prod): set STEVE_INGEST_URL to the deployed Worker; the writer
 *    POSTs batched rows to `${STEVE_INGEST_URL}/ingest`, which writes them to D1
 *    via the binding (bearer STEVE_INGEST_SECRET). No D1 API token needed.
 *
 * Row tuples are already in the target column order (see logger.ts).
 */

import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type Cell = string | number | null;
export type Row = Cell[];

export interface Writer {
	registerRace(
		id: string,
		kind: string,
		botCount: number,
		timeoutSec: number | null,
		goal: string | null,
	): void;
	/** Persist a batch of rows (already in column order). Fire-and-forget. */
	writeBatch(events: Row[], ticks: Row[], inv: Row[]): void;
	/** Read helper for the orchestrator's milestone/goal queries (local only). */
	query<T = Record<string, unknown>>(sql: string, ...params: Cell[]): T[];
	close(): void;
}

const ensureEnvLoaded = (): void => {
	if (process.env.MC_HOST || process.env.STEVE_D1_FILE || process.env.STEVE_INGEST_URL)
		return;
	try {
		process.loadEnvFile();
	} catch {
		/* rely on the ambient environment */
	}
};

// ── Local writer: node:sqlite against the miniflare D1 file ──────────
const findLocalD1File = (): string => {
	if (process.env.STEVE_D1_FILE) return process.env.STEVE_D1_FILE;
	const dir = join(process.cwd(), ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
	let entries: string[] = [];
	try {
		entries = readdirSync(dir);
	} catch {
		throw new Error(`Local D1 not found at ${dir}. Run \`npm run db:apply:local\` first.`);
	}
	const dbFile = entries.find((f) => /^[0-9a-f]{64}\.sqlite$/.test(f));
	if (!dbFile) throw new Error(`No D1 database file in ${dir}. Run \`npm run db:apply:local\` first.`);
	return join(dir, dbFile);
};

const EVENT_COLS = "race_id, bot_id, ts, category, event, detail, x, y, z, yaw, pitch";
const TICK_COLS =
	"race_id, bot_id, ts, x, y, z, yaw, pitch, health, food, dimension, block_below, block_at_cursor, is_in_water, on_ground";
const INV_COLS = "race_id, bot_id, ts, slot, item_name, count";

const createLocalWriter = (): Writer => {
	const db = new DatabaseSync(findLocalD1File());
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA busy_timeout = 8000");
	db.exec("PRAGMA synchronous = NORMAL");

	const insertMany = (table: string, cols: string, n: number, rows: Row[]) => {
		if (rows.length === 0) return;
		const ph = `(${Array(n).fill("?").join(",")})`;
		const stmt = db.prepare(`INSERT INTO ${table} (${cols}) VALUES ${ph}`);
		for (const r of rows) stmt.run(...r);
	};

	return {
		registerRace(id, kind, botCount, timeoutSec, goal) {
			try {
				db.prepare(
					`INSERT INTO races (race_id, kind, started_at, bot_count, timeout_sec, goal)
					 VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (race_id) DO NOTHING`,
				).run(id, kind, new Date().toISOString(), botCount, timeoutSec, goal);
			} catch {}
		},
		writeBatch(events, ticks, inv) {
			db.exec("BEGIN");
			try {
				insertMany("events", EVENT_COLS, 11, events);
				insertMany("ticks", TICK_COLS, 15, ticks);
				insertMany("inventory_snapshots", INV_COLS, 6, inv);
				db.exec("COMMIT");
			} catch (e) {
				try {
					db.exec("ROLLBACK");
				} catch {}
				throw e;
			}
		},
		query(sql, ...params) {
			return (params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all()) as never;
		},
		close() {
			try {
				db.close();
			} catch {}
		},
	};
};

// ── Remote writer: POST batches to the deployed Worker's /ingest ─────
const createRemoteWriter = (url: string): Writer => {
	const secret = process.env.STEVE_INGEST_SECRET ?? "";
	const endpoint = url.replace(/\/$/, "") + "/ingest";
	const post = (body: unknown) => {
		void fetch(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
			body: JSON.stringify(body),
		}).catch(() => {});
	};
	return {
		registerRace(id, kind, botCount, timeoutSec, goal) {
			post({ race: { id, kind, botCount, timeoutSec, goal } });
		},
		writeBatch(events, ticks, inv) {
			if (events.length || ticks.length || inv.length) post({ events, ticks, inv });
		},
		// Remote reads aren't wired for the orchestrator; return empty so milestone
		// polling is a no-op (the deployed dashboard shows progress instead).
		query() {
			return [] as never;
		},
		close() {},
	};
};

export const createWriter = (): Writer => {
	ensureEnvLoaded();
	const url = process.env.STEVE_INGEST_URL;
	return url ? createRemoteWriter(url) : createLocalWriter();
};

// Back-compat for the orchestrator (main.ts): a local read/write handle.
export type SteveDb = Writer;
export const connectDb = (): SteveDb => createWriter();
