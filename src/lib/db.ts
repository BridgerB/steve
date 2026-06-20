/**
 * Shared Postgres connection for Steve.
 *
 * All bots (and the read-only tools: race-summary, MCP replay) talk to one
 * shared Postgres server so the eye-of-steve dashboard can read live race data
 * from anywhere — not just the box the bots run on.
 *
 * Connection string comes from DATABASE_URL (see .env / .env.example). It is a
 * secret and must never be committed.
 */

import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

/**
 * Node does not auto-load `.env` (the project's .envrc is `use flake`, not
 * dotenv), so load it here on demand. Idempotent and safe if the file is absent
 * or the var is already set in the environment.
 */
const ensureEnvLoaded = (): void => {
	if (process.env.DATABASE_URL) return;
	try {
		process.loadEnvFile();
	} catch {
		/* no .env file — rely on the ambient environment */
	}
};

export const connectDb = (opts: Record<string, unknown> = {}): Sql => {
	ensureEnvLoaded();
	const url = process.env.DATABASE_URL;
	if (!url)
		throw new Error(
			"DATABASE_URL is not set (see .env.example) — cannot connect to Postgres",
		);
	return postgres(url, { onnotice: () => {}, ...opts });
};

/**
 * Idempotent schema. Run via `sql.unsafe(SCHEMA_DDL)` (simple query protocol so
 * multiple statements run in one round trip). Shapes mirror the old SQLite
 * tables so reader queries stay unchanged; `id` is BIGSERIAL instead of
 * AUTOINCREMENT, and ISO-8601 timestamps stay TEXT (readers Date.parse them).
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS races (
  race_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  bot_count INTEGER NOT NULL DEFAULT 1,
  timeout_sec INTEGER,
  goal TEXT
);

CREATE TABLE IF NOT EXISTS ticks (
  id BIGSERIAL PRIMARY KEY,
  race_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION,
  yaw DOUBLE PRECISION, pitch DOUBLE PRECISION,
  health DOUBLE PRECISION,
  food INTEGER,
  dimension TEXT,
  block_below TEXT,
  block_at_cursor TEXT,
  is_in_water INTEGER,
  on_ground INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  race_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  category TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id BIGSERIAL PRIMARY KEY,
  race_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  slot INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_race ON events(race_id);
CREATE INDEX IF NOT EXISTS idx_events_cat ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_bot ON events(bot_id);
CREATE INDEX IF NOT EXISTS idx_ticks_race_bot ON ticks(race_id, bot_id);
CREATE INDEX IF NOT EXISTS idx_inv_race_bot ON inventory_snapshots(race_id, bot_id);
CREATE INDEX IF NOT EXISTS idx_inv_bot ON inventory_snapshots(bot_id);
`;

export const ensureSchema = async (sql: Sql): Promise<void> => {
	await sql.unsafe(SCHEMA_DDL);
};
