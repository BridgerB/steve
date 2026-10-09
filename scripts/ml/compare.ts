/**
 * Compare two builds on one skill from the shared event log (cycle 4 Part 5.2).
 *
 *   node --import ./typecraft-resolve.mjs scripts/ml/compare.ts <buildA> <buildB> [skill] [attempts.jsonl]
 *
 * Uses run-level gym rows (pos = landing, context.harness excluded). Prints each
 * build's rate with its Wilson interval, P(B > A) under Beta posteriors and the
 * sequential decision (stop > 0.95 / < 0.05, cap 30 each), the bootstrap probability
 * that B's median time-to-portal is lower, and landing-paired differences.
 *
 * Screening mode (cycle 5, decision 3): compare two gym batches on per-run continuous
 * metrics with a bootstrap of the difference in means. Run in the box gym clone:
 *
 *   node --import ./typecraft-resolve.mjs scripts/ml/compare.ts --means <A[@cap_s]> <B[@cap_s]>
 *
 * e.g. --means base3@1800 s5a; pool batches with commas: s5n,s8n@1800. Higher is better for best_frame and obsidian; lower is
 * better for deaths, lava_deaths and the per-block gap.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { bootstrapMeanDiff } from "../../src/lib/steve/ml/stats.ts";
import { runMetrics, type RunMetrics, type TelemetryEvent } from "../../src/lib/steve/ml/screen.ts";

if (process.argv[2] === "--means") {
	const [, , , A, B] = process.argv;
	if (!A || !B) {
		console.error("usage: compare.ts --means <A[@cap_s]> <B[@cap_s]>");
		process.exit(1);
	}
	const runsDb = new DatabaseSync("data/gym/batches.db");
	const tel = new DatabaseSync(process.env.STEVE_D1_FILE ?? "data/gym/telemetry.sqlite");
	const q = tel.prepare("SELECT ts, category, event, detail FROM events WHERE race_id = ? AND category IN ('cast','death') ORDER BY ts");
	const load = (spec: string): RunMetrics[] => {
		const [batches, capS] = spec.split("@");
		const runs = batches!.split(",").flatMap(
			(batch) =>
				runsDb
					.prepare("SELECT run_id, slug FROM runs WHERE batch = ? AND outcome NOT IN ('harness','disconnect') ORDER BY started_at")
					.all(batch) as { run_id: string; slug: string }[],
		);
		return runs.map((r) => runMetrics(q.all(`gym-${r.slug}-${r.run_id}`) as unknown as TelemetryEvent[], capS ? Number(capS) : undefined));
	};
	const ma = load(A);
	const mb = load(B);
	console.log(`A ${A}: n=${ma.length}   B ${B}: n=${mb.length}`);
	const metrics: [string, (m: RunMetrics) => number | null, "up" | "down"][] = [
		["best_frame", (m) => m.best_frame, "up"],
		["obsidian", (m) => m.obsidian, "up"],
		["deaths", (m) => m.deaths, "down"],
		["lava_deaths", (m) => m.lava_deaths, "down"],
		["block_gap_med_s", (m) => m.block_gap_med_s, "down"],
	];
	for (const [name, get, dir] of metrics) {
		const xa = ma.map(get).filter((x): x is number => x !== null);
		const xb = mb.map(get).filter((x): x is number => x !== null);
		const mean = (xs: number[]) => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : Number.NaN);
		const r = bootstrapMeanDiff(xa, xb);
		const pBetter = dir === "up" ? r.pBGreater : 1 - r.pBGreater;
		console.log(
			`${name.padEnd(16)} A ${mean(xa).toFixed(2)} (n=${xa.length})  B ${mean(xb).toFixed(2)} (n=${xb.length})  B−A 95% [${r.lo.toFixed(2)}, ${r.hi.toFixed(2)}]  P(B better) = ${pBetter.toFixed(3)}`,
		);
	}
	process.exit(0);
}
import { bootstrapMedianFaster, fmtRate, quantile, sequentialDecision } from "../../src/lib/steve/ml/stats.ts";
import type { AttemptRow } from "../../src/lib/steve/lib/attempts.ts";

const [buildA, buildB, skill = "portal_cast", file = "data/gym/attempts.jsonl"] = process.argv.slice(2);
if (!buildA || !buildB) {
	console.error("usage: compare.ts <buildA> <buildB> [skill] [attempts.jsonl]");
	process.exit(1);
}
const rows = readFileSync(file, "utf8")
	.split("\n")
	.filter(Boolean)
	.map((l) => JSON.parse(l) as AttemptRow)
	// run-level rows only: the gym runner writes the run id without a "-dN" dispatch suffix
	.filter((r) => r.skill === skill && r.source === "gym" && !/-d\d+$/.test(r.run_id) && !r.context?.harness);
const of = (build: string) => rows.filter((r) => r.build.startsWith(build));
const A = of(buildA);
const B = of(buildB);
const rec = (xs: AttemptRow[]) => ({ ok: xs.filter((r) => r.outcome === "ok").length, n: xs.length });
const ra = rec(A);
const rb = rec(B);
const ttp = (xs: AttemptRow[]) =>
	xs.map((r) => r.context?.time_to_portal_s).filter((x): x is number => typeof x === "number");
const fmtT = (xs: number[]) => (xs.length ? `median ${quantile(xs, 0.5).toFixed(0)} s, p80 ${quantile(xs, 0.8).toFixed(0)} s (n=${xs.length})` : "n=0");
console.log(`skill ${skill}`);
console.log(`A ${buildA}: ${fmtRate(ra.ok, ra.n)}; time-to-portal ${fmtT(ttp(A))}`);
console.log(`B ${buildB}: ${fmtRate(rb.ok, rb.n)}; time-to-portal ${fmtT(ttp(B))}`);
const d = sequentialDecision(ra, rb);
console.log(`P(B > A) = ${d.pBA.toFixed(3)} → ${d.decision}`);
const ta = ttp(A);
const tb = ttp(B);
if (ta.length && tb.length) console.log(`P(median time-to-portal B < A) = ${bootstrapMedianFaster(ta, tb).toFixed(3)} (bootstrap)`);
// Landing-paired comparison
const key = (r: AttemptRow) => (r.pos ? `${r.pos[0]},${r.pos[2]}` : "");
const bByLanding = new Map(B.map((r) => [key(r), r]));
let bBetter = 0;
let aBetter = 0;
let same = 0;
for (const a of A) {
	const b = bByLanding.get(key(a));
	if (!b || !key(a)) continue;
	const sa = a.outcome === "ok" ? 1 : 0;
	const sb = b.outcome === "ok" ? 1 : 0;
	if (sb > sa) bBetter++;
	else if (sa > sb) aBetter++;
	else same++;
}
if (bBetter + aBetter + same) console.log(`paired landings: B better ${bBetter}, A better ${aBetter}, same ${same}`);
