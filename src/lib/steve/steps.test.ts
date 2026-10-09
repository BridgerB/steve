import { describe, expect, it } from "vitest";
import { steps } from "./steps.ts";

const step = (id: string) => steps.find((s) => s.id === id)!;
const state = (inv: Record<string, number>) =>
	({
		equipment: { hasFurnace: true },
		inventory: { ironOre: 0, ironIngots: 0, buckets: 0, waterBuckets: 0, lavaBuckets: 0, flintAndSteel: 0, coal: 0, planks: 20, ...inv },
	}) as never;

describe("iron kit steps", () => {
	it("smelts a single raw iron when that is all the kit still needs (race c5 deadlock)", () => {
		// steve-race-809: 2 buckets + 1 water bucket + 1 raw_iron + 0 ingots
		const s = state({ ironOre: 1, buckets: 2, waterBuckets: 1 });
		expect(step("mine_iron").isComplete(s)).toBe(true);
		expect(step("smelt_iron").isComplete(s)).toBe(false);
		expect(step("smelt_iron").canExecute(s)).toBe(true);
	});
	it("still waits for 3 ore when the kit needs more", () => {
		const s = state({ ironOre: 2 });
		expect(step("smelt_iron").canExecute(s)).toBe(false);
	});
});
