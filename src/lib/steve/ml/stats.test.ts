import { describe, expect, it } from "vitest";
import { betaSample, bootstrapMedianFaster, probBGreater, quantile, rngFrom, wilson } from "./stats.ts";

describe("stats", () => {
	it("Wilson 6/10 is about [31%, 83%]", () => {
		const w = wilson(6, 10);
		expect(w.lo).toBeCloseTo(0.313, 2);
		expect(w.hi).toBeCloseTo(0.832, 2);
	});
	it("Beta(3,7) mean of 10k draws is within 0.02 of 0.3", () => {
		const rng = rngFrom(42);
		let sum = 0;
		for (let i = 0; i < 10_000; i++) sum += betaSample(3, 7, rng);
		expect(Math.abs(sum / 10_000 - 0.3)).toBeLessThan(0.02);
	});
	it("P(B>A) separates 9/10 from 1/10 and is ~0.5 for equal records", () => {
		expect(probBGreater({ ok: 1, n: 10 }, { ok: 9, n: 10 })).toBeGreaterThan(0.99);
		expect(Math.abs(probBGreater({ ok: 5, n: 10 }, { ok: 5, n: 10 }) - 0.5)).toBeLessThan(0.03);
	});
	it("quantile and bootstrap behave", () => {
		expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
		expect(bootstrapMedianFaster([900, 1000, 1100, 1200], [400, 500, 600, 700])).toBeGreaterThan(0.95);
	});
});
