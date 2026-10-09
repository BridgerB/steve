/**
 * Merge downloaded gym artifacts into one set of data files (cycle 7, Parts 4.3 and 4.7).
 * Every merged row carries the GitHub run id. Idempotent: batches rows are keyed by run_id
 * (INSERT OR REPLACE), attempt lines already present are skipped.
 *
 *   node scripts/ci/aggregate.ts <artifacts-dir> <data-dir> <gh-run-id>
 *
 * <artifacts-dir> holds one directory per shard artifact (gh run download layout), each with
 * gym/attempts.jsonl and gym/batches.db (and gym.db). <data-dir> is a data/ directory: the
 * merged rows go to <data-dir>/gym/attempts.jsonl and <data-dir>/gym/batches.db. Prints the
 * batch labels merged, one per line, to stdout.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [src, dataDir, ghRun] = process.argv.slice(2);
if (!src || !dataDir || !ghRun) throw new Error("usage: aggregate.ts <artifacts-dir> <data-dir> <gh-run-id>");
mkdirSync(join(dataDir, "gym"), { recursive: true });
const outAttempts = join(dataDir, "gym", "attempts.jsonl");
const seen = new Set<string>(existsSync(outAttempts) ? readFileSync(outAttempts, "utf8").split("\n").filter(Boolean) : []);
const out = new DatabaseSync(join(dataDir, "gym", "batches.db"));
const batches = new Set<string>();

const find = (dir: string, name: string): string[] =>
	readdirSync(dir).flatMap((e) => {
		const p = join(dir, e);
		return statSync(p).isDirectory() ? find(p, name) : e === name ? [p] : [];
	});

for (const db of find(src, "batches.db")) {
	const inDb = new DatabaseSync(db, { readOnly: true });
	const cols = (inDb.prepare("PRAGMA table_info(runs)").all() as { name: string; type: string }[]).filter((c) => c.name !== "gh_run");
	out.exec(`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY)`);
	const have = new Set((out.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name));
	for (const c of [...cols, { name: "gh_run", type: "TEXT" }]) if (!have.has(c.name)) out.exec(`ALTER TABLE runs ADD COLUMN ${c.name} ${c.type || "TEXT"}`);
	const names = cols.map((c) => c.name);
	const ins = out.prepare(`INSERT OR REPLACE INTO runs (${[...names, "gh_run"].join(",")}) VALUES (${[...names, "gh_run"].map(() => "?").join(",")})`);
	for (const r of inDb.prepare(`SELECT ${names.join(",")} FROM runs`).all() as Record<string, unknown>[]) {
		ins.run(...(names.map((n) => r[n] ?? null) as never[]), ghRun);
		if (typeof r.batch === "string") batches.add(r.batch);
	}
}
let added = 0;
for (const f of find(src, "attempts.jsonl"))
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line.trim()) continue;
		let row: Record<string, unknown>;
		try {
			row = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		const tagged = JSON.stringify({ ...row, gh_run: ghRun });
		if (seen.has(tagged)) continue;
		seen.add(tagged);
		appendFileSync(outAttempts, `${tagged}\n`);
		added++;
	}
console.error(`merged ${batches.size} batches, ${added} new attempt rows into ${dataDir}/gym`);
for (const b of [...batches].sort()) console.log(b);
