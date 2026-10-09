/**
 * Fleet planner CLI (cycle 7): validate a plan and print the worker matrix for
 * $GITHUB_OUTPUT. The matrix carries worker numbers only; each worker recomputes its own
 * units from the same plan file (src/lib/steve/fleet/plan.ts is pure and deterministic).
 *
 *   node scripts/ci/fleet-plan.ts ci/plans/<plan>.json      # stdout: matrix=<json>
 *                                                           # stderr: the schedule
 */
import { readFileSync } from "node:fs";
import { matrixFor, parsePlan, schedule } from "../../src/lib/steve/fleet/plan.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: fleet-plan.ts <plan.json>");
const plan = parsePlan(JSON.parse(readFileSync(file, "utf8")));
const s = schedule(plan);
const m = matrixFor(s);
console.log(`matrix=${JSON.stringify(m)}`);
console.error(`${plan.label}: ${s.trials} trials in ${s.workers.flat().length} units on ${m.include.length} workers; planned load ${Math.min(...m.include.map((w) => w.load_s))}–${Math.max(...m.include.map((w) => w.load_s))} s`);
for (const [k, units] of s.workers.entries())
	if (units.length) console.error(`  worker ${k + 1}: ${s.load_s[k]} s  ${units.map((u) => (u.trials.length > 1 ? `${u.id}×${u.trials.length}` : u.id)).join(" ")}`);
