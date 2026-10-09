import { describe, expect, it } from "vitest";
import { launchFor, type LaunchCtx } from "./launch.ts";
import { expandTrials, parsePlan } from "./plan.ts";

const ctx: LaunchCtx = {
	root: "/w",
	dirForRef: (r) => `/w/refs/${r}`,
	envDir: "/w/env",
	dataDir: "/w/data",
	mcPort: "25565",
	rconPort: "25575",
	rconPass: "p",
	raceBase: () => "-20256,20000",
	shared: 1,
};
const plan = parsePlan({
	label: "f9",
	workers: 3,
	experiments: [
		{ name: "arena", slug: "build-nether-portal", lava_d: 6, runs: 2, est_s: 420, arms: [{ name: "base", ref: "exp/x" }, { name: "new", env: { K: "V" } }] },
		{ name: "nat", slug: "portal-natural", runs: 1, est_s: 1900 },
		{ name: "c8", kind: "race", est_s: 15000, bots: 4, minutes: 60 },
	],
});
const ts = expandTrials(plan);

describe("launchFor", () => {
	it("arena: GYM_LAVA_D set, landing by index, arm ref worktree, arm env merged", () => {
		const base2 = launchFor(ts.find((t) => t.id === "f9-arena-base-2")!, ctx);
		expect(base2.cwd).toBe("/w/refs/exp/x");
		expect(base2.env.GYM_LAVA_D).toBe("6");
		expect(base2.env.GYM_LANDING_OFFSET).toBe("1");
		expect(base2.env.BATCH).toBe("f9-arena-base");
		expect(base2.env.GYM_LANDINGS).toBe("/w/env/worlds/A/landings-A.json");
		const new1 = launchFor(ts.find((t) => t.id === "f9-arena-new-1")!, ctx);
		expect(new1.cwd).toBe("/w");
		expect(new1.env.K).toBe("V");
	});
	it("natural: GYM_LAVA_D removed from the inherited environment", () => {
		const n = launchFor(ts.find((t) => t.exp === "nat")!, ctx);
		expect(n.env.GYM_LAVA_D).toBeUndefined();
		expect(n.unset).toContain("GYM_LAVA_D");
	});
	it("race: server and RCON settings, race base, bots and timeout", () => {
		const r = launchFor(ts.find((t) => t.kind === "race")!, ctx);
		expect(r.argv.slice(-4)).toEqual(["--bots", "4", "--timeout", "3600"]);
		expect(r.env.RACE_BASE).toBe("-20256,20000");
		expect(r.env.MC_RCON_PASS).toBe("p");
		expect(r.env.STEVE_NUM_VIEWERS).toBe("0");
	});
	it("shared server: per-bot lock and no global forceload release", () => {
		const s = launchFor(ts[0]!, { ...ctx, shared: 3 });
		expect(s.env.GYM_SHARED_SERVER).toBe("1");
		expect(s.env.GYM_BATCH_LOCK).toMatch(/batch-Gym_cast\.lock$/);
	});
	it("time limit is the larger of 3× and estimate + 30 min", () => {
		expect(launchFor(ts[0]!, ctx).limitMs).toBe((420 + 1800) * 1000);
		expect(launchFor(ts.find((t) => t.kind === "race")!, ctx).limitMs).toBe(45000 * 1000);
	});
});
