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
	// Cap the pool small: the Postgres server is shared and has limited slots, and
	// dev-server restarts can leave old pools lingering until they time out.
	return postgres(url, { onnotice: () => {}, max: 3, ...opts });
};

// Schema lives in Drizzle (src/lib/server/db/schema.ts) and is created with
// `npm run db:push`. The logger/readers just connect and use those tables.
