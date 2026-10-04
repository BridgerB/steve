/**
 * Race funnel from the event log (cycle 5): per bot, the first minute each stage was
 * reached, and the count of bots reaching it. Stages: stone pick, bucket, water, flint,
 * site anchor, obsidian (max per bot), portal lit, in the Nether.
 *
 *   node --import ./typecraft-resolve.mjs scripts/ml/race-funnel.ts <raceId-prefix> [attempts.jsonl]
 *
 * Step stages come from the run-loop's per-dispatch rows (outcome ok); the cast stages
 * from portal_cast rows (deepest_phase / progress).
 */
import { readFileSync } from "node:fs";
import type { AttemptRow } from "../../src/lib/steve/lib/attempts.ts";

const [prefix, file = "data/gym/attempts.jsonl"] = process.argv.slice(2);
if (!prefix) {
	console.error("usage: race-funnel.ts <raceId-prefix> [attempts.jsonl]");
	process.exit(1);
}
const rows = readFileSync(file, "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l) as AttemptRow)
	.filter((r) => r.source === "race" && r.run_id.startsWith(prefix));
const bots = [...new Set(rows.map((r) => r.bot))].sort();
const t0 = Math.min(...rows.map((r) => r.start_ms));
const STAGES: [string, (r: AttemptRow) => boolean][] = [
	["stone pick", (r) => r.skill === "craft_stone_pickaxe" && r.outcome === "ok"],
	["bucket", (r) => r.skill === "craft_bucket" && r.outcome === "ok"],
	["water", (r) => r.skill === "get_water_buckets" && r.outcome === "ok"],
	["flint & steel", (r) => r.skill === "get_flint_and_steel" && r.outcome === "ok"],
	["site anchor", (r) => r.skill === "portal_cast" && ["chamber", "lava_fill", "portal_start", "mold", "lava", "water", "verify"].includes(String(r.deepest_phase).split(/[ ,]/)[0]!)],
	["obsidian ≥1", (r) => r.skill === "portal_cast" && r.progress > 0],
	["portal lit", (r) => r.skill === "portal_cast" && r.outcome === "ok"],
	["in Nether", (r) => r.skill === "enter_nether" && r.outcome === "ok"],
];
console.log(`race ${prefix}: ${bots.length} bots, ${rows.length} rows`);
for (const [name, hit] of STAGES) {
	const per = bots.map((b) => {
		const r = rows.filter((x) => x.bot === b && hit(x)).sort((a, z) => a.start_ms - z.start_ms)[0];
		return r ? Math.round((r.start_ms + r.duration_s * 1000 - t0) / 60000) : null;
	});
	const n = per.filter((x) => x !== null).length;
	console.log(`${name.padEnd(14)} ${n}/${bots.length}   minutes: ${per.map((x) => (x === null ? "-" : x)).join(", ")}`);
}
const obs = bots.map((b) => Math.max(0, ...rows.filter((x) => x.bot === b && x.skill === "portal_cast").map((x) => x.progress)));
console.log(`max obsidian per bot: ${obs.join(", ")}`);
const deaths = rows.filter((r) => r.outcome === "death");
const causes = new Map<string, number>();
for (const d of deaths) causes.set(String(d.death_cause), (causes.get(String(d.death_cause)) ?? 0) + 1);
console.log(`death rows: ${deaths.length} — ${[...causes].map(([k, v]) => `${v}× ${k}`).join(", ")}`);
