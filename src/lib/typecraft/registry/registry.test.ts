import { describe, expect, it } from "vitest";
import { createRegistry } from "./index.ts";

describe("createRegistry", () => {
	it("loads 1.21.11 registry", () => {
		const reg = createRegistry("1.21.11");
		expect(reg.version.type).toBe("pc");
		expect(reg.version.majorVersion).toBe("1.21");
		expect(reg.blocksArray.length).toBeGreaterThan(0);
	});

	it("loads biomes when biomes-raw data exists", () => {
		const reg = createRegistry("1.21.11");
		// Biomes are loaded from biomes-raw/ if present; may be empty
		if (reg.biomesArray.length > 0) {
			expect(reg.biomesByName.size).toBeGreaterThan(0);
		}
	});
});

describe("block lookups", () => {
	const reg = createRegistry("1.21.11");

	it("looks up air by name", () => {
		const air = reg.blocksByName.get("air");
		expect(air).toBeDefined();
		expect(air!.id).toBe(0);
		expect(air!.name).toBe("air");
	});

	it("looks up stone by name", () => {
		const stone = reg.blocksByName.get("stone");
		expect(stone).toBeDefined();
		expect(stone!.name).toBe("stone");
		expect(stone!.defaultState).toBe(stone!.minStateId);
	});

	it("looks up block by state ID", () => {
		const stone = reg.blocksByName.get("stone")!;
		const found = reg.blocksByStateId.get(stone.defaultState);
		expect(found).toBeDefined();
		expect(found!.name).toBe("stone");
	});

	it("looks up block by ID", () => {
		const stone = reg.blocksByName.get("stone")!;
		const found = reg.blocksById.get(stone.id);
		expect(found).toBeDefined();
		expect(found!.name).toBe("stone");
	});

	it("maps all state IDs in range", () => {
		const oakStairs = reg.blocksByName.get("oak_stairs")!;
		expect(oakStairs.maxStateId).toBeGreaterThan(oakStairs.minStateId);
		for (let s = oakStairs.minStateId; s <= oakStairs.maxStateId; s++) {
			expect(reg.blocksByStateId.get(s)?.name).toBe("oak_stairs");
		}
	});

	it("includes block state properties", () => {
		const oakStairs = reg.blocksByName.get("oak_stairs")!;
		expect(oakStairs.states.length).toBeGreaterThan(0);
		const facingProp = oakStairs.states.find((s) => s.name === "facing");
		expect(facingProp).toBeDefined();
		expect(facingProp!.type).toBe("enum");
	});
});

describe("biome lookups", () => {
	const reg = createRegistry("1.21.11");

	it("looks up plains by name", () => {
		if (reg.biomesArray.length === 0) return; // skip if no biome data
		const plains = reg.biomesByName.get("plains");
		expect(plains).toBeDefined();
		expect(plains!.name).toBe("plains");
	});

	it("looks up biome by ID", () => {
		if (reg.biomesArray.length === 0) return;
		const plains = reg.biomesByName.get("plains")!;
		const found = reg.biomesById.get(plains.id);
		expect(found).toBeDefined();
		expect(found!.name).toBe("plains");
	});

	it("has temperature and category", () => {
		if (reg.biomesArray.length === 0) return;
		const desert = reg.biomesByName.get("desert")!;
		expect(desert.temperature).toBeGreaterThan(0);
		expect(desert.category).toBeDefined();
	});
});

describe("version utilities", () => {
	const reg = createRegistry("1.21.11");

	it("isNewerOrEqualTo works", () => {
		expect(reg.isNewerOrEqualTo("1.18")).toBe(true);
		expect(reg.isNewerOrEqualTo("1.20")).toBe(true);
		expect(reg.isNewerOrEqualTo("1.21")).toBe(true);
	});

	it("isOlderThan works", () => {
		expect(reg.isOlderThan("1.18")).toBe(false);
		expect(reg.isOlderThan("1.21")).toBe(false);
		expect(reg.isOlderThan("1.21.11")).toBe(false);
	});

	it("supportFeature works", () => {
		expect(reg.supportFeature("usesBlockStates")).toBe(true);
		expect(reg.supportFeature("shieldSlot")).toBe(true);
		expect(typeof reg.supportFeature("nbtNameForEnchant")).toBe("string");
	});
});

describe("common blocks exist", () => {
	const reg = createRegistry("1.21.11");

	it("has air, stone, dirt", () => {
		expect(reg.blocksByName.get("air")).toBeDefined();
		expect(reg.blocksByName.get("stone")).toBeDefined();
		expect(reg.blocksByName.get("dirt")).toBeDefined();
	});

	it("has common items", () => {
		expect(reg.itemsByName.get("stone")).toBeDefined();
		expect(reg.itemsByName.get("diamond")).toBeDefined();
	});
});
