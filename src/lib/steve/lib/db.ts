/**
 * Bot-side connection to the telemetry DB (Cloudflare D1).
 *
 * The Node bot process cannot use the Worker's D1 binding, so:
 *  - LOCAL dev: open the miniflare-managed local D1 SQLite file directly with
 *    Node's built-in `node:sqlite` (same pattern as the gym's data/gym.db). This
 *    is the exact file the local dashboard/Worker reads, so both see the same
 *    data. Create it first with `npm run db:apply:local`.
 *  - REMOTE (prod): STEVE_D1_REMOTE=1 → the D1 HTTP API (added in the deploy
 *    phase). Not wired here yet.
 *
 * All bots (and the read-only tools) share one DB via bot_id + race_id columns.
 * SQLite serialises concurrent writers via WAL + a busy timeout.
 */

import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type SteveDb = DatabaseSync;

/** Node does not auto-load `.env`; do it on demand for MC_* / STEVE_* vars. */
const ensureEnvLoaded = (): void => {
	if (process.env.MC_HOST || process.env.STEVE_D1_FILE) return;
	try {
		process.loadEnvFile();
	} catch {
		/* no .env — rely on the ambient environment */
	}
};

/** Locate the miniflare local D1 SQLite file (the 64-hex-named one, not metadata.sqlite). */
const findLocalD1File = (): string => {
	if (process.env.STEVE_D1_FILE) return process.env.STEVE_D1_FILE;
	const dir = join(
		process.cwd(),
		".wrangler",
		"state",
		"v3",
		"d1",
		"miniflare-D1DatabaseObject",
	);
	let entries: string[] = [];
	try {
		entries = readdirSync(dir);
	} catch {
		throw new Error(
			`Local D1 not found at ${dir}. Run \`npm run db:apply:local\` first (or set STEVE_D1_FILE).`,
		);
	}
	const dbFile = entries.find((f) => /^[0-9a-f]{64}\.sqlite$/.test(f));
	if (!dbFile)
		throw new Error(
			`No D1 database file in ${dir}. Run \`npm run db:apply:local\` first.`,
		);
	return join(dir, dbFile);
};

export const connectDb = (): SteveDb => {
	ensureEnvLoaded();
	const file = findLocalD1File();
	const db = new DatabaseSync(file);
	// WAL + a generous busy timeout so the orchestrator + N bot processes can
	// read/write the same file concurrently without SQLITE_BUSY errors.
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA busy_timeout = 8000");
	db.exec("PRAGMA synchronous = NORMAL");
	return db;
};
