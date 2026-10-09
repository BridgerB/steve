/**
 * Fleet planning, pure (cycle 7). No I/O, no clock, no randomness: the same plan always gives
 * the same trials, units and schedule, so the plan job and every worker can compute it
 * independently and agree. The GitHub matrix therefore carries only worker numbers; job
 * outputs are capped at 1 MB (UTF-16) and must not carry the trials.
 *
 *   parsePlan(json)          validated Plan (throws PlanError with the path of every problem)
 *   expandTrials(plan)       Trial[]  one per gym run per arm, one per race; ids are unique
 *   toUnits(trials)          Unit[]   trials that share one server at the same time
 *   schedule(plan)           Schedule units on workers, longest first, deterministic ties
 *   assignmentFor(plan, w)   Unit[]   worker w's units, in run order
 *   matrixFor(schedule)      { include: [{ worker, units, trials, load_s }] }  small
 */
import { z } from "zod";

const NAME = /^[A-Za-z0-9_]+$/;
const name = z.string().regex(NAME, "letters, digits and _ only");
const env = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/, "UPPER_SNAKE env names"), z.string()).default({});

const Arm = z.object({
	name,
	/** Full commit sha or a branch name; "" or absent = the dispatched ref. */
	ref: z
		.string()
		.refine((r) => r === "" || /^[0-9a-f]{40}$/.test(r) || /^[A-Za-z0-9._/-]+$/.test(r) && !/^[0-9a-f]{7,39}$/.test(r), "a full 40-char sha or a branch name (short shas cannot be fetched)")
		.default(""),
	env,
});

const GymExp = z.object({
	kind: z.literal("gym").default("gym"),
	name,
	slug: z.string().min(1),
	runs: z.number().int().min(1).max(256),
	est_s: z.number().positive(),
	lava_d: z.number().int().min(0).default(0),
	landing_set: z.string().default("A"),
	bot: z.string().regex(/^[A-Za-z0-9_]{1,16}$/).default("Gym_cast"),
	env,
	arms: z.array(Arm).min(1).default([{ name: "a", ref: "", env: {} }]),
	/** Bots sharing one server at the same time (capacity test). */
	per_server: z.number().int().min(1).max(12).default(1),
	/** Server heap in MB for this experiment's servers; absent = the script default. */
	heap_mb: z.number().int().min(1024).max(14336).optional(),
});

const RaceExp = z.object({
	kind: z.literal("race"),
	name,
	est_s: z.number().positive(),
	bots: z.number().int().min(1).max(12).default(5),
	minutes: z.number().int().min(1).max(330).default(240),
	landing_set: z.string().default("A"),
	env,
	arms: z.array(Arm).min(1).default([{ name: "a", ref: "", env: {} }]),
	heap_mb: z.number().int().min(1024).max(14336).optional(),
});

export const PlanSchema = z
	.object({
		label: name,
		/** Workers to use, at most 20 (the account's concurrent-job limit). */
		workers: z.number().int().min(1).max(20),
		/** A worker's planned seconds must fit a 6 h job with margin. */
		max_worker_s: z.number().positive().max(21_000).default(19_800),
		/** Seconds per unit for the world copy and server start/stop. */
		overhead_s: z.number().min(0).default(30),
		// A race needs kind "race"; anything else is a gym experiment.
		experiments: z.array(z.union([RaceExp, GymExp])).min(1),
	})
	.superRefine((p, ctx) => {
		const seen = new Set<string>();
		p.experiments.forEach((e, i) => {
			if (seen.has(e.name)) ctx.addIssue({ code: "custom", path: ["experiments", i, "name"], message: `duplicate experiment ${e.name}` });
			seen.add(e.name);
			const arms = new Set<string>();
			e.arms.forEach((a, j) => {
				if (arms.has(a.name)) ctx.addIssue({ code: "custom", path: ["experiments", i, "arms", j, "name"], message: `duplicate arm ${a.name}` });
				arms.add(a.name);
			});
		});
	});

export type Plan = z.infer<typeof PlanSchema>;
export type Experiment = Plan["experiments"][number];

export class PlanError extends Error {}

export const parsePlan = (input: unknown): Plan => {
	const r = PlanSchema.safeParse(input);
	if (r.success) return r.data;
	throw new PlanError(r.error.issues.map((i) => `${i.path.join(".") || "(plan)"}: ${i.message}`).join("; "));
};

export type Trial = {
	id: string;
	exp: string;
	arm: string;
	kind: "gym" | "race";
	/** batches.db batch id: <label>-<experiment>-<arm>. */
	batch: string;
	ref: string;
	env: Record<string, string>;
	est_s: number;
	set: string;
	heap_mb?: number;
	/** gym */
	slug?: string;
	lava_d?: number;
	/** Landing index in the set: the same index across arms is the pair. */
	index?: number;
	bot?: string;
	/** race */
	bots?: number;
	minutes?: number;
	/** Trials with one group id share a server at the same time. */
	group?: string;
};

export type Unit = { id: string; trials: Trial[]; est_s: number };

export const expandTrials = (plan: Plan): Trial[] =>
	plan.experiments.flatMap((e) =>
		e.arms.flatMap((arm): Trial[] => {
			const base = {
				exp: e.name,
				arm: arm.name,
				batch: `${plan.label}-${e.name}-${arm.name}`,
				ref: arm.ref,
				env: { ...e.env, ...arm.env },
				est_s: e.est_s,
				set: e.landing_set,
				...(e.heap_mb ? { heap_mb: e.heap_mb } : {}),
			};
			if (e.kind === "race") return [{ ...base, id: base.batch, kind: "race", bots: e.bots, minutes: e.minutes }];
			const k = e.per_server;
			return Array.from({ length: e.runs }, (_, i) => ({
				...base,
				id: `${base.batch}-${i + 1}`,
				kind: "gym" as const,
				slug: e.slug,
				lava_d: e.lava_d,
				index: i,
				// Bot names are unique within a shared server and at most 16 characters.
				bot: k > 1 ? `${e.bot.slice(0, 14)}${(i % k) + 1}` : e.bot,
				...(k > 1 ? { group: `${base.batch}-g${Math.floor(i / k) + 1}` } : {}),
			}));
		}),
	);

export const toUnits = (trials: Trial[]): Unit[] => {
	const byId = new Map<string, Trial[]>();
	for (const t of trials) {
		const key = t.group ?? t.id;
		byId.set(key, [...(byId.get(key) ?? []), t]);
	}
	return [...byId].map(([id, ts]) => ({ id, trials: ts, est_s: Math.max(...ts.map((t) => t.est_s)) }));
};

export type Schedule = { workers: Unit[][]; load_s: number[]; trials: number };

/**
 * Longest-processing-time-first: units sorted by estimated seconds (ties by id), each placed
 * on the worker with the least planned load (ties to the lowest worker number). The result
 * is within 4/3 of the optimal makespan. Throws if any worker exceeds max_worker_s.
 */
export const schedule = (plan: Plan): Schedule => {
	const units = toUnits(expandTrials(plan)).sort((a, b) => b.est_s - a.est_s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const W = plan.workers;
	const load = Array.from({ length: W }, () => 0);
	const workers: Unit[][] = Array.from({ length: W }, () => []);
	for (const u of units) {
		let k = 0;
		for (let j = 1; j < W; j++) if (load[j]! < load[k]!) k = j;
		workers[k]!.push(u);
		load[k]! += u.est_s + plan.overhead_s;
	}
	const max = Math.max(...load);
	if (max > plan.max_worker_s) throw new PlanError(`a worker needs ${max} s > max_worker_s ${plan.max_worker_s}; split the plan or add workers`);
	return { workers, load_s: load, trials: units.reduce((n, u) => n + u.trials.length, 0) };
};

/** Worker w's units (1-based), in the order they run. */
export const assignmentFor = (plan: Plan, worker: number): Unit[] => {
	const s = schedule(plan);
	if (!Number.isInteger(worker) || worker < 1 || worker > s.workers.length) throw new PlanError(`worker ${worker} out of range 1..${s.workers.length}`);
	return s.workers[worker - 1]!;
};

/** The GitHub matrix: one entry per worker that has work, with no trial payload. */
export const matrixFor = (s: Schedule) => ({
	include: s.workers
		.map((units, k) => ({ worker: k + 1, units: units.length, trials: units.reduce((n, u) => n + u.trials.length, 0), load_s: s.load_s[k]! }))
		.filter((w) => w.units > 0),
});
