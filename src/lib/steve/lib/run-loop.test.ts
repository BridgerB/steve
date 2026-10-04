import { describe, expect, it } from "vitest";
import { initialRunState, reduce, type RunState } from "./run-loop.ts";

const fail = (rs: RunState, message: string) =>
	reduce(rs, { type: "stepDone", epoch: rs.epoch, result: { success: false, message } });

describe("run-loop reducer", () => {
	it("keeps the preempt fields across a death", () => {
		const { state } = reduce({ ...initialRunState, preemptAt: [1] }, { type: "death" });
		expect(state.preemptAt).toEqual([1]);
		expect(state.completeTicks).toBe(0);
	});

	it("escalates on the 4th identical failure (numbers ignored)", () => {
		let rs: RunState = { ...initialRunState, status: "running", currentStepId: "build_nether_portal" };
		for (let i = 0; i < 3; i++) {
			const r = fail(rs, `No lava pool found near ${i * 10},64`);
			expect(r.commands.some((c) => c.type === "escalate")).toBe(false);
			rs = { ...r.state, status: "running", currentStepId: "build_nether_portal" };
		}
		const r = fail(rs, "No lava pool found near 99,64");
		expect(r.commands.some((c) => c.type === "escalate")).toBe(true);
		expect(r.state.sameFails).toBe(0);
	});

	it("a different reason restarts the streak", () => {
		let rs: RunState = { ...initialRunState, status: "running", currentStepId: "x" };
		for (const m of ["a", "a", "b", "a"]) {
			const r = fail(rs, m);
			expect(r.commands.some((c) => c.type === "escalate")).toBe(false);
			rs = { ...r.state, status: "running", currentStepId: "x" };
		}
	});
});
