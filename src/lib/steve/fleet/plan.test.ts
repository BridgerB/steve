import { describe, expect, it } from "vitest";
import { assignmentFor, expandTrials, matrixFor, parsePlan, PlanError, schedule, toUnits } from "./plan.ts";

const base = {
	label: "t1",
	workers: 4,
	experiments: [
		{ name: "nat", slug: "portal-natural", runs: 12, est_s: 1900, arms: [{ name: "a" }, { name: "b", env: { X: "1" } }] },
		{ name: "c7", kind: "race", est_s: 15000 },
	],
};

describe("parsePlan", () => {
	it("fills defaults", () => {
		const p = parsePlan(base);
		const nat = p.experiments[0]!;
		expect(nat.kind).toBe("gym");
		expect(nat.kind === "gym" && nat.bot).toBe("Gym_cast");
		expect(nat.landing_set).toBe("A");
		expect(p.overhead_s).toBe(30);
		const race = p.experiments[1]!;
		expect(race.kind === "race" && race.bots).toBe(5);
	});
	it("rejects a short sha, duplicate arms, too many workers, bad names", () => {
		expect(() => parsePlan({ ...base, experiments: [{ ...base.experiments[0], arms: [{ name: "a", ref: "a390916" }] }] })).toThrow(/full 40-char sha/);
		expect(() => parsePlan({ ...base, experiments: [{ ...base.experiments[0], arms: [{ name: "a" }, { name: "a" }] }] })).toThrow(/duplicate arm/);
		expect(() => parsePlan({ ...base, workers: 21 })).toThrow(PlanError);
		expect(() => parsePlan({ ...base, label: "f-1" })).toThrow(/label/);
	});
	it("accepts a full sha and a branch name", () => {
		const sha = "a390916737529fb21f41daaf2f72c58d85874ab5";
		expect(() => parsePlan({ ...base, experiments: [{ ...base.experiments[0], arms: [{ name: "a", ref: sha }, { name: "b", ref: "exp/craft-base" }] }] })).not.toThrow();
	});
});

describe("expandTrials", () => {
	it("one trial per run per arm, one per race, unique ids, paired by landing index", () => {
		const ts = expandTrials(parsePlan(base));
		expect(ts).toHaveLength(12 * 2 + 1);
		expect(new Set(ts.map((t) => t.id)).size).toBe(ts.length);
		const a = ts.filter((t) => t.arm === "a" && t.kind === "gym").map((t) => t.index);
		const b = ts.filter((t) => t.arm === "b").map((t) => t.index);
		expect(a).toEqual(b);
		expect(ts.find((t) => t.arm === "b")!.env).toEqual({ X: "1" });
		expect(ts.find((t) => t.kind === "race")!.batch).toBe("t1-c7-a");
	});
	it("per_server groups consecutive landings and gives unique bot names", () => {
		const p = parsePlan({ label: "cap", workers: 2, experiments: [{ name: "k3", slug: "build-nether-portal", runs: 6, est_s: 420, per_server: 3, heap_mb: 6144 }] });
		const ts = expandTrials(p);
		expect(ts.map((t) => t.group)).toEqual(["cap-k3-a-g1", "cap-k3-a-g1", "cap-k3-a-g1", "cap-k3-a-g2", "cap-k3-a-g2", "cap-k3-a-g2"]);
		expect(ts.slice(0, 3).map((t) => t.bot)).toEqual(["Gym_cast1", "Gym_cast2", "Gym_cast3"]);
		expect(toUnits(ts)).toHaveLength(2);
		expect(ts.every((t) => t.heap_mb === 6144)).toBe(true);
	});
});

describe("schedule", () => {
	it("balances longest first and is deterministic", () => {
		const p = parsePlan(base);
		const s1 = schedule(p);
		const s2 = schedule(p);
		expect(s1).toEqual(s2);
		expect(s1.trials).toBe(25);
		// The race is alone on one worker; the 24 gym trials spread over the other three.
		const raceWorker = s1.workers.findIndex((w) => w.some((u) => u.trials[0]!.kind === "race"));
		expect(s1.workers[raceWorker]).toHaveLength(1);
		const others = s1.load_s.filter((_, k) => k !== raceWorker);
		expect(Math.max(...others) - Math.min(...others)).toBeLessThanOrEqual(1930);
	});
	it("never splits a shared-server group across workers", () => {
		const p = parsePlan({ label: "cap", workers: 3, experiments: [{ name: "k4", slug: "x", runs: 8, est_s: 400, per_server: 4 }] });
		const s = schedule(p);
		for (const w of s.workers) for (const u of w) expect(new Set(u.trials.map((t) => t.group)).size).toBe(1);
		expect(s.workers.filter((w) => w.length).length).toBe(2);
	});
	it("throws when a worker would exceed max_worker_s", () => {
		expect(() => schedule(parsePlan({ label: "big", workers: 1, experiments: [{ name: "n", slug: "x", runs: 12, est_s: 1900 }] }))).toThrow(/max_worker_s/);
	});
	it("every trial is assigned exactly once across workers", () => {
		const p = parsePlan(base);
		const all = Array.from({ length: p.workers }, (_, k) => assignmentFor(p, k + 1)).flat().flatMap((u) => u.trials.map((t) => t.id));
		expect(all.sort()).toEqual(expandTrials(p).map((t) => t.id).sort());
	});
});

describe("matrixFor", () => {
	it("carries no trial payload and stays tiny for the largest plan", () => {
		const p = parsePlan({ label: "max", workers: 15, experiments: [{ name: "n", slug: "x", runs: 192, est_s: 400, arms: [{ name: "a" }, { name: "b" }, { name: "c" }] }] });
		const m = matrixFor(schedule(p));
		expect(m.include).toHaveLength(15);
		expect(Object.keys(m.include[0]!)).toEqual(["worker", "units", "trials", "load_s"]);
		expect(JSON.stringify(m).length).toBeLessThan(4000);
	});
});

describe("capacity defaults", () => {
	const raw = { label: "d1", workers: 4, experiments: [{ name: "ar", slug: "build-nether-portal", lava_d: 6, runs: 12, est_s: 450 }, { name: "nat", slug: "portal-natural", runs: 12, est_s: 1900 }, { name: "x", slug: "build-nether-portal", lava_d: 6, runs: 2, est_s: 450, per_server: 1 }] };
	it("fills bots per server and heap from the capacity result; natural is capped at 6", async () => {
		const { withCapacity } = await import("./plan.ts");
		const ts = expandTrials(parsePlan(withCapacity(raw, { k: 8, heap_mb: 6144 })));
		const groups = (exp: string) => new Set(ts.filter((t) => t.exp === exp).map((t) => t.group)).size;
		expect(groups("ar")).toBe(2); // 12 runs in groups of 8
		expect(groups("nat")).toBe(2); // natural capped at 6 → 2 groups
		expect(ts.find((t) => t.exp === "x")!.group).toBeUndefined(); // explicit per_server 1 wins
		expect(ts.every((t) => t.heap_mb === 6144)).toBe(true);
	});
	it("without capacity, one bot per server", async () => {
		const { withCapacity } = await import("./plan.ts");
		expect(expandTrials(parsePlan(withCapacity(raw, null))).some((t) => t.group)).toBe(false);
	});
});
