/**
 * Compare two builds on one skill from the shared event log (cycle 4 Part 5.2).
 *
 *   node --import ./typecraft-resolve.mjs scripts/ml/compare.ts <buildA> <buildB> [skill] [attempts.jsonl]
 *
 * Uses run-level gym rows (pos = landing, context.harness excluded). Prints each
 * build's rate with its Wilson interval, P(B > A) under Beta posteriors and the
 * sequential decision (stop > 0.95 / < 0.05, cap 30 each), the bootstrap probability
 * that B's median time-to-portal is lower, and landing-paired differences.
 */
import { readFileSync } from "node:fs";
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
