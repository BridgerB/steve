/**
 * Fleet planner (cycle 7): expand a plan of experiments into single trials and spread them
 * over W workers so every worker carries about the same wall time (longest-processing-time
 * first: trials sorted by estimated seconds, each to the least-loaded worker).
 *
 *   node scripts/ci/fleet-plan.ts ci/plans/<plan>.json            # prints matrix=<json>
 *
 * Plan: { label, workers, experiments: [ { name, kind: "gym" | "race", slug, runs, lava_d,
 * landing_set, bot, est_s, env, arms: [ { name, ref, env } ], bots, minutes } ] }.
 * Gym trial i of an arm replays landing i of the set (paired across arms). A race is one
 * trial. Every trial records its batch `<label>-<experiment>-<arm>`.
 */
import { readFileSync } from "node:fs";

type Arm = { name: string; ref?: string; env?: Record<string, string> };
type Exp = {
	name: string;
	kind?: "gym" | "race";
	slug?: string;
	runs?: number;
	lava_d?: number;
	landing_set?: string;
	bot?: string;
	est_s: number;
	env?: Record<string, string>;
	arms?: Arm[];
	bots?: number;
	minutes?: number;
};
type Plan = { label: string; workers: number; max_worker_s?: number; experiments: Exp[] };
export type Trial = {
	id: string;
	exp: string;
	arm: string;
	kind: "gym" | "race";
	batch: string;
	ref: string;
	env: Record<string, string>;
	est_s: number;
	slug?: string;
	lava_d?: number;
	set?: string;
	index?: number;
	bot?: string;
	bots?: number;
	minutes?: number;
};

const file = process.argv[2];
if (!file) throw new Error("usage: fleet-plan.ts <plan.json>");
const plan = JSON.parse(readFileSync(file, "utf8")) as Plan;
const ok = (s: string) => /^[A-Za-z0-9_]+$/.test(s);
if (!ok(plan.label)) throw new Error(`bad label ${plan.label}`);

const trials: Trial[] = [];
for (const e of plan.experiments) {
	if (!ok(e.name)) throw new Error(`bad experiment name ${e.name}`);
	const arms = e.arms?.length ? e.arms : [{ name: "a" }];
	for (const arm of arms) {
		if (!ok(arm.name)) throw new Error(`bad arm name ${arm.name}`);
		const base = { exp: e.name, arm: arm.name, batch: `${plan.label}-${e.name}-${arm.name}`, ref: arm.ref ?? "", env: { ...e.env, ...arm.env }, est_s: e.est_s };
		if (e.kind === "race") {
			trials.push({ ...base, id: `${base.batch}`, kind: "race", bots: e.bots ?? 5, minutes: e.minutes ?? 240, set: e.landing_set ?? "A" });
			continue;
		}
		for (let i = 0; i < (e.runs ?? 1); i++)
			trials.push({ ...base, id: `${base.batch}-${i + 1}`, kind: "gym", slug: e.slug, lava_d: e.lava_d ?? 0, set: e.landing_set ?? "A", index: i, bot: e.bot ?? "Gym_cast" });
	}
}

const W = Math.max(1, Math.min(20, plan.workers));
const load = Array.from({ length: W }, () => 0);
const work: Trial[][] = Array.from({ length: W }, () => []);
for (const t of [...trials].sort((a, b) => b.est_s - a.est_s)) {
	const k = load.indexOf(Math.min(...load));
	work[k]!.push(t);
	load[k]! += t.est_s + 30; // per-trial overhead: world copy, server start and stop
}
const maxS = plan.max_worker_s ?? 19_800;
if (Math.max(...load) > maxS) throw new Error(`plan too big: a worker needs ${Math.max(...load)} s > ${maxS} s; split it`);
const include = work.map((ts, k) => ({ worker: k + 1, load_s: load[k], n: ts.length, trials: JSON.stringify(ts) })).filter((w) => w.n > 0);
console.log(`matrix=${JSON.stringify({ include })}`);
console.error(`${trials.length} trials on ${include.length} workers; load ${Math.min(...load)}–${Math.max(...load)} s (total ${load.reduce((a, b) => a + b, 0)} s)`);
for (const w of include) console.error(`  worker ${w.worker}: ${w.n} trials, ${w.load_s} s`);
