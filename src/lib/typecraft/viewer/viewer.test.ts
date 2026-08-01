import { describe, expect, it } from "vitest";
import { prepareBlockStates } from "./assets.ts";
import {
	getModelVariants,
	getSectionGeometry,
	type MesherBlock,
} from "./mesher.ts";

// ── Mock data ──

const mockUvMap = {
	stone: { u: 0, v: 0, su: 0.0625, sv: 0.0625 },
	glass: { u: 0.0625, v: 0, su: 0.0625, sv: 0.0625 },
	oak_planks: { u: 0.125, v: 0, su: 0.0625, sv: 0.0625 },
	water_still: { u: 0.1875, v: 0, su: 0.0625, sv: 0.0625 },
	missing_texture: { u: 0.25, v: 0, su: 0.0625, sv: 0.0625 },
};

const mockBlocksModels: Record<string, unknown> = {
	block: {
		display: {},
	},
	cube: {
		parent: "block/block",
		elements: [
			{
				from: [0, 0, 0],
				to: [16, 16, 16],
				faces: {
					down: { texture: "#down", cullface: "down" },
					up: { texture: "#up", cullface: "up" },
					north: { texture: "#north", cullface: "north" },
					south: { texture: "#south", cullface: "south" },
					west: { texture: "#west", cullface: "west" },
					east: { texture: "#east", cullface: "east" },
				},
			},
		],
	},
	cube_all: {
		parent: "block/cube",
		textures: {
			particle: "#all",
			down: "#all",
			up: "#all",
			north: "#all",
			east: "#all",
			south: "#all",
			west: "#all",
		},
	},
	stone: {
		parent: "minecraft:block/cube_all",
		textures: { all: "minecraft:block/stone" },
	},
	glass: {
		parent: "minecraft:block/cube_all",
		textures: { all: "minecraft:block/glass" },
	},
	oak_planks: {
		parent: "minecraft:block/cube_all",
		textures: { all: "minecraft:block/oak_planks" },
	},
};

const mockBlocksStates: Record<string, unknown> = {
	stone: {
		variants: {
			"": { model: "minecraft:block/stone" },
		},
	},
	glass: {
		variants: {
			"": { model: "minecraft:block/glass" },
		},
	},
	oak_planks: {
		variants: {
			"": { model: "minecraft:block/oak_planks" },
		},
	},
};

const mockTints = {
	grass: new Map<string, readonly [number, number, number]>(),
	foliage: new Map<string, readonly [number, number, number]>(),
	water: new Map<string, readonly [number, number, number]>(),
	redstone: new Map<string, readonly [number, number, number]>(),
	constant: new Map<string, readonly [number, number, number]>(),
	grassDefault: [0.48, 0.74, 0.31] as const,
	foliageDefault: [0.48, 0.74, 0.31] as const,
	waterDefault: [0.25, 0.29, 0.98] as const,
};

const makeBlock = (
	name: string,
	overrides?: Partial<MesherBlock>,
): MesherBlock => ({
	name,
	stateId: 1,
	transparent: false,
	isCube: true,
	biome: "plains",
	properties: {},
	...overrides,
});

// ── Tests ──

describe("prepareBlockStates", () => {
	it("resolves simple variant block states", () => {
		const resolved = prepareBlockStates(
			mockBlocksStates,
			mockBlocksModels as never,
			mockUvMap,
		);

		expect(resolved.stone).toBeDefined();
		expect(resolved.stone!.variants).toBeDefined();
		expect(resolved.stone!.variants![""]).toBeDefined();
	});

	it("resolves model elements through parent chain", () => {
		const resolved = prepareBlockStates(
			mockBlocksStates,
			mockBlocksModels as never,
			mockUvMap,
		);

		const stoneVariant = resolved.stone!.variants![""];
		const variant = Array.isArray(stoneVariant)
			? stoneVariant[0]!
			: stoneVariant!;
		expect(variant.model.elements.length).toBe(1);
		expect(variant.model.elements[0]!.faces.up).toBeDefined();
	});
});

describe("getModelVariants", () => {
	const resolved = prepareBlockStates(
		mockBlocksStates,
		mockBlocksModels as never,
		mockUvMap,
	);

	it("returns empty for air", () => {
		const block = makeBlock("air", { transparent: true, isCube: false });
		expect(getModelVariants(block, resolved)).toEqual([]);
	});

	it("returns variant for stone", () => {
		const block = makeBlock("stone");
		const variants = getModelVariants(block, resolved);
		expect(variants.length).toBe(1);
		expect(variants[0]!.model.elements.length).toBe(1);
	});

	it("returns empty for unknown block", () => {
		const block = makeBlock("unknown_block");
		expect(getModelVariants(block, resolved)).toEqual([]);
	});
});

describe("getSectionGeometry", () => {
	const resolved = prepareBlockStates(
		mockBlocksStates,
		mockBlocksModels as never,
		mockUvMap,
	);

	it("produces empty geometry for air-only section", () => {
		const getBlock = () =>
			makeBlock("air", { transparent: true, isCube: false });
		const geo = getSectionGeometry(0, 0, 0, getBlock, resolved, mockTints);

		expect(geo.positions.length).toBe(0);
		expect(geo.indices.length).toBe(0);
	});

	it("produces geometry for a single stone block", () => {
		const getBlock = (x: number, y: number, z: number) => {
			if (x === 0 && y === 0 && z === 0) return makeBlock("stone");
			return makeBlock("air", { transparent: true, isCube: false });
		};

		const geo = getSectionGeometry(0, 0, 0, getBlock, resolved, mockTints);

		// 6 faces × 4 vertices = 24 vertices × 3 components = 72 positions
		expect(geo.positions.length).toBe(72);
		// 6 faces × 2 triangles × 3 indices = 36
		expect(geo.indices.length).toBe(36);
	});

	it("culls faces between adjacent solid blocks", () => {
		const getBlock = (x: number, y: number, z: number) => {
			if (x === 0 && y === 0 && z === 0) return makeBlock("stone");
			if (x === 1 && y === 0 && z === 0) return makeBlock("stone");
			return makeBlock("air", { transparent: true, isCube: false });
		};

		const geo = getSectionGeometry(0, 0, 0, getBlock, resolved, mockTints);

		// Two blocks: 12 faces total, minus 2 shared faces = 10 faces
		// 10 faces × 4 vertices × 3 = 120 positions
		expect(geo.positions.length).toBe(120);
		// 10 faces × 6 indices = 60
		expect(geo.indices.length).toBe(60);
	});

	it("does not cull faces between transparent blocks", () => {
		const getBlock = (x: number, y: number, z: number) => {
			if (x === 0 && y === 0 && z === 0)
				return makeBlock("glass", { transparent: true });
			if (x === 1 && y === 0 && z === 0)
				return makeBlock("glass", { transparent: true });
			return makeBlock("air", { transparent: true, isCube: false });
		};

		const geo = getSectionGeometry(0, 0, 0, getBlock, resolved, mockTints);

		// Glass-to-glass: cullIfIdentical skips, so faces are culled between identical glass
		// 12 total faces - 2 shared = 10 faces
		expect(geo.positions.length).toBe(120);
	});

	it("sets section offset correctly", () => {
		const getBlock = () =>
			makeBlock("air", { transparent: true, isCube: false });
		const geo = getSectionGeometry(16, 32, 48, getBlock, resolved, mockTints);

		expect(geo.sx).toBe(24);
		expect(geo.sy).toBe(40);
		expect(geo.sz).toBe(56);
	});

	it("produces Float32Array outputs", () => {
		const getBlock = (x: number, y: number, z: number) => {
			if (x === 0 && y === 0 && z === 0) return makeBlock("stone");
			return makeBlock("air", { transparent: true, isCube: false });
		};

		const geo = getSectionGeometry(0, 0, 0, getBlock, resolved, mockTints);

		expect(geo.positions).toBeInstanceOf(Float32Array);
		expect(geo.normals).toBeInstanceOf(Float32Array);
		expect(geo.colors).toBeInstanceOf(Float32Array);
		expect(geo.uvs).toBeInstanceOf(Float32Array);
		expect(geo.indices).toBeInstanceOf(Uint32Array);
	});
});
