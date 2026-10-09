/**
 * Create an empty telemetry database from the D1 schema (drizzle/*.sql), for runners and any
 * machine without a local wrangler D1. Point STEVE_D1_FILE at it.
 *   node scripts/ci/init-telemetry.ts data/gym/telemetry.sqlite
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = process.argv[2] ?? "data/gym/telemetry.sqlite";
if (existsSync(file)) {
	console.log(`${file} exists`);
	process.exit(0);
}
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
for (const f of readdirSync("drizzle").filter((n) => n.endsWith(".sql")).sort())
	for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
console.log(`${file}: ${(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name).join(", ")}`);
