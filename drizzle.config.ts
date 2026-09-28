import { defineConfig } from 'drizzle-kit';

// One schema (src/lib/server/db/schema.ts) drives everything: `db:generate`
// emits SQLite DDL into ./drizzle (needs no credentials), which we apply to the
// local D1 with `wrangler d1 execute --local` and to remote D1 with
// `wrangler d1 migrations apply --remote`. The d1-http driver below is only used
// by `db:push`/`db:studio` against remote D1, so it's added conditionally.
const remote =
	process.env.CLOUDFLARE_ACCOUNT_ID &&
	process.env.CLOUDFLARE_DATABASE_ID &&
	process.env.CLOUDFLARE_D1_TOKEN;

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	verbose: true,
	strict: true,
	...(remote
		? {
				driver: 'd1-http' as const,
				dbCredentials: {
					accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
					databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
					token: process.env.CLOUDFLARE_D1_TOKEN!
				}
			}
		: {})
});
