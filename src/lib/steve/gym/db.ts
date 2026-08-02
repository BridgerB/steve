/**
 * Persistent gym results in SQLite (node:sqlite, built-in). One row per run with
 * everything needed to REPRODUCE it: the exact teleport location (x,y,z), the
 * prerequisites granted, pass/fail, duration, and the task's message. File lives at
 * data/gym.db.  (node:sqlite is synchronous; the async callers just await the value.)
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

let db: DatabaseSync | null = null;
const getDb = (): DatabaseSync => {
	if (db) return db;
	const dir = join(process.cwd(), 'data');
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		/* exists */
	}
	db = new DatabaseSync(join(dir, 'gym.db'));
	db.exec(`
		CREATE TABLE IF NOT EXISTS gym_runs (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			ts       INTEGER NOT NULL,
			slug     TEXT NOT NULL,
			pass     INTEGER NOT NULL,
			duration_ms INTEGER NOT NULL,
			x        INTEGER,
			y        INTEGER,
			z        INTEGER,
			prereq   TEXT,
			message  TEXT
		);
		CREATE INDEX IF NOT EXISTS gym_runs_slug_ts ON gym_runs (slug, ts);
	`);
	return db;
};

export interface GymRunRow {
	slug: string;
	pass: boolean;
	duration_ms: number;
	x: number;
	y: number;
	z: number;
	prereq: string[];
	message: string;
}

export const recordGymRun = (r: GymRunRow): void => {
	getDb()
		.prepare(
			`INSERT INTO gym_runs (ts, slug, pass, duration_ms, x, y, z, prereq, message)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			Date.now(),
			r.slug,
			r.pass ? 1 : 0,
			r.duration_ms,
			r.x,
			r.y,
			r.z,
			JSON.stringify(r.prereq),
			r.message.slice(0, 400)
		);
};

/** Per-run history for one step (oldest→newest) — full rows, reproducible. */
export const gymHistory = (slug: string, limit = 300) =>
	(
		getDb()
			.prepare(
				`SELECT ts, pass, duration_ms, x, y, z, prereq, message
				 FROM gym_runs WHERE slug = ? ORDER BY ts DESC LIMIT ?`
			)
			.all(slug, limit) as Record<string, unknown>[]
	).reverse();

/** Rolling summary per step — pass%, timing, and location spread. */
export const gymSummary = () =>
	getDb()
		.prepare(
			`SELECT slug,
				COUNT(*)                                            AS runs,
				CAST(ROUND(100.0 * SUM(pass) / COUNT(*)) AS INT)    AS pass_pct,
				CAST(ROUND(AVG(duration_ms)) AS INT)                AS avg_ms,
				CAST(ROUND(AVG(CASE WHEN pass=1 THEN duration_ms END)) AS INT) AS avg_ms_pass,
				MIN(CASE WHEN pass=1 THEN duration_ms END)          AS min_ms_pass,
				MAX(CASE WHEN pass=1 THEN duration_ms END)          AS max_ms_pass
			 FROM gym_runs GROUP BY slug`
		)
		.all() as Record<string, unknown>[];

/** All recent runs (for the location scatter + over-time charts). */
export const gymAllRuns = (limit = 4000) =>
	getDb()
		.prepare(
			`SELECT ts, slug, pass, duration_ms, x, z FROM gym_runs ORDER BY ts DESC LIMIT ?`
		)
		.all(limit) as Record<string, unknown>[];
