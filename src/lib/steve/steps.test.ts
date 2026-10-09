import { describe, expect, it } from "vitest";
import { getNextStep, steps } from "./steps.ts";

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

describe("smelt fuel (cycle 7 f4 iron-deadlock gate arm)", () => {
	// The exact deadlock state from 10 of 12 gate trials: the planks went into a table and the
	// furnace; the bucket kit is in hand, so gather_wood counted itself done.
	const deadlock = {
		equipment: { hasFurnace: true, hasCraftingTable: true, pickaxe: "stone" },
		world: { dimension: "overworld" },
		alive: true,
		inventory: { ironOre: 1, ironIngots: 0, buckets: 2, waterBuckets: 1, lavaBuckets: 0, flintAndSteel: 0, coal: 0, planks: 0, logs: 0 },
	} as never;
	it("gather_wood is not done while raw iron needs fuel", () => {
		expect(step("gather_wood").isComplete(deadlock)).toBe(false);
		expect(step("gather_wood").canExecute(deadlock)).toBe(true);
	});
	it("gather_wood stays done once there is fuel", () => {
		const s = { ...(deadlock as object), inventory: { ...(deadlock as { inventory: object }).inventory, logs: 2 } } as never;
		expect(step("gather_wood").isComplete(s)).toBe(true);
	});
	it("smelt_iron burns logs: f6 fuel arm held 5 logs, 0 planks and 0 coal for 600 s", () => {
		const s = { ...(deadlock as object), inventory: { ...(deadlock as { inventory: object }).inventory, logs: 5 } } as never;
		expect(step("smelt_iron").canExecute(s)).toBe(true);
	});
});

describe("a lit portal comes first (race c8b steve-race-004)", () => {
	it("enter_nether beats a regressed iron step once a portal is built", () => {
		const s = {
			equipment: { hasFurnace: true, hasCraftingTable: true, pickaxe: "stone" },
			world: { dimension: "overworld", portalBuilt: true, portalLocation: { x: 0, y: 64, z: 0 } },
			alive: true,
			inventory: { ironOre: 3, ironIngots: 0, buckets: 1, waterBuckets: 0, lavaBuckets: 0, flintAndSteel: 1, coal: 4, planks: 8, logs: 2 },
		} as never;
		expect(step("smelt_iron").canExecute(s)).toBe(true);
		expect(getNextStep(s)?.id).toBe("enter_nether");
	});
});
