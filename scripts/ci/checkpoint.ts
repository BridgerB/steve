/**
 * Fold a SQLite write-ahead log into its database before the file is packed. Bot processes exit
 * without closing the telemetry database, so with several bots on one runner every event stayed
 * in telemetry.sqlite-wal, which the pack step then deleted (f5 shared units: 0 events).
 *
 *   node scripts/ci/checkpoint.ts data/gym/telemetry.sqlite
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const file = process.argv[2] ?? "data/gym/telemetry.sqlite";
if (!existsSync(file)) process.exit(0);
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 30000");
const r = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, number>;
const n = (db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n;
db.close();
console.log(`${file}: checkpoint ${JSON.stringify(r)}; ${n} events`);
