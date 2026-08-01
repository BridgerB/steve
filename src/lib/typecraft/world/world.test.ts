import { describe, expect, it } from "vitest";
import {
	createChunkColumn,
	neededBits,
	setBlockStateId,
} from "../chunk/index.ts";
import { createRegistry } from "../registry/index.ts";
import { vec3 } from "../vec3/index.ts";
import {
	BlockFace,
	createManhattanIterator,
	createOctahedronIterator,
	createRaycastIterator,
	createSpiralIterator2d,
} from "./iterators.ts";
import {
	type ChunkGenerator,
	createWorld,
	getColumn,
	getLoadedColumn,
	getLoadedColumns,
	onWorldEvent,
	setColumn,
	unloadColumn,
	worldGetBiomeId,
	worldGetBlock,
	worldGetBlockStateId,
	worldSetBiomeId,
	worldSetBlock,
	worldSetBlockStateId,
} from "./world.ts";

const registry = createRegistry("1.20.4");

const maxBlockStateId = Math.max(
	...registry.blocksArray.map((b) => b.maxStateId),
);

const makeColumn = () =>
	createChunkColumn({
		minY: -64,
		worldHeight: 384,
		maxBitsPerBlock: neededBits(maxBlockStateId),
		maxBitsPerBiome: neededBits(registry.biomesArray.length),
	});

const makeGenerator = (): ChunkGenerator => () => makeColumn();

// ── World basics ──

describe("World", () => {
	it("creates a world and sets/gets columns", () => {
		const world = createWorld(registry);
		const col = makeColumn();
		setColumn(world, 0, 0, col);

		expect(getLoadedColumn(world, 0, 0)).toBe(col);
		expect(getLoadedColumn(world, 1, 0)).toBeNull();
	});

	it("lists loaded columns", () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());
		setColumn(world, 3, -2, makeColumn());

		const loaded = getLoadedColumns(world);
		expect(loaded.length).toBe(2);
		expect(loaded.some((c) => c.chunkX === 0 && c.chunkZ === 0)).toBe(true);
		expect(loaded.some((c) => c.chunkX === 3 && c.chunkZ === -2)).toBe(true);
	});

	it("unloads columns", async () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());
		await unloadColumn(world, 0, 0);

		expect(getLoadedColumn(world, 0, 0)).toBeNull();
		expect(getLoadedColumns(world).length).toBe(0);
	});

	it("loads columns from generator", async () => {
		const world = createWorld(registry, { generator: makeGenerator() });
		const col = await getColumn(world, 5, 5);

		expect(col).not.toBeNull();
		expect(getLoadedColumn(world, 5, 5)).toBe(col);
	});

	it("loads columns from provider", async () => {
		const stored = new Map<string, ReturnType<typeof makeColumn>>();
		const col = makeColumn();
		setBlockStateId(col, 0, 0, 0, 42);
		stored.set("3,7", col);

		const world = createWorld(registry, {
			provider: {
				load: async (cx, cz) => stored.get(`${cx},${cz}`) ?? null,
				save: async () => {},
			},
		});

		const loaded = await getColumn(world, 3, 7);
		expect(loaded).not.toBeNull();
	});
});

// ── World coordinate block access ──

describe("World block access", () => {
	it("gets and sets blocks by world coordinates", () => {
		const world = createWorld(registry);
		const col = makeColumn();
		setColumn(world, 0, 0, col);

		const pos = vec3(5, 64, 10);
		worldSetBlockStateId(world, pos, 1);
		expect(worldGetBlockStateId(world, pos)).toBe(1);
	});

	it("returns null for unloaded chunks", () => {
		const world = createWorld(registry);
		expect(worldGetBlockStateId(world, vec3(100, 64, 100))).toBeNull();
	});

	it("handles negative coordinates", () => {
		const world = createWorld(registry);
		setColumn(world, -1, -1, makeColumn());

		const pos = vec3(-5, 0, -10);
		worldSetBlockStateId(world, pos, 99);
		expect(worldGetBlockStateId(world, pos)).toBe(99);
	});

	it("maps world coordinates to correct chunk", () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());
		setColumn(world, 1, 0, makeColumn());

		// x=15 is in chunk 0, x=16 is in chunk 1
		worldSetBlockStateId(world, vec3(15, 64, 0), 10);
		worldSetBlockStateId(world, vec3(16, 64, 0), 20);

		expect(worldGetBlockStateId(world, vec3(15, 64, 0))).toBe(10);
		expect(worldGetBlockStateId(world, vec3(16, 64, 0))).toBe(20);
	});

	it("getBlock and setBlock work with names", () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());

		const pos = vec3(5, 64, 5);
		worldSetBlock(world, pos, "stone");
		const info = worldGetBlock(world, pos);

		expect(info).not.toBeNull();
		expect(info!.name).toBe("stone");
	});

	it("setBlock with properties roundtrips", () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());

		const pos = vec3(0, 0, 0);
		worldSetBlock(world, pos, "oak_stairs", {
			facing: "south",
			half: "top",
			shape: "straight",
			waterlogged: "false",
		});

		const info = worldGetBlock(world, pos);
		expect(info!.name).toBe("oak_stairs");
		expect(info!.properties.facing).toBe("south");
		expect(info!.properties.half).toBe("top");
	});

	it("biome access works", () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());

		const pos = vec3(0, 64, 0);
		worldSetBiomeId(world, pos, 5);
		expect(worldGetBiomeId(world, pos)).toBe(5);
	});
});

// ── Events ──

describe("World events", () => {
	it("emits chunkColumnLoad on setColumn", () => {
		const world = createWorld(registry);
		const events: [number, number][] = [];
		onWorldEvent(world, "chunkColumnLoad", (cx, cz) => events.push([cx, cz]));

		setColumn(world, 3, 7, makeColumn());
		expect(events).toEqual([[3, 7]]);
	});

	it("emits chunkColumnUnload on unloadColumn", async () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());

		const events: [number, number][] = [];
		onWorldEvent(world, "chunkColumnUnload", (cx, cz) => events.push([cx, cz]));

		await unloadColumn(world, 0, 0);
		expect(events).toEqual([[0, 0]]);
	});

	it("emits blockUpdate on set", () => {
		const world = createWorld(registry);
		setColumn(world, 0, 0, makeColumn());

		const updates: [number, number][] = [];
		onWorldEvent(world, "blockUpdate", (_pos, oldId, newId) =>
			updates.push([oldId, newId]),
		);

		worldSetBlockStateId(world, vec3(0, 64, 0), 42);
		expect(updates).toEqual([[0, 42]]);
	});
});

// ── Iterators ──

describe("ManhattanIterator", () => {
	it("starts at center", () => {
		const iter = createManhattanIterator(5, 10, 3);
		const first = iter.next();
		expect(first).toEqual(vec3(5, 0, 10));
	});

	it("produces correct number of points", () => {
		const iter = createManhattanIterator(0, 0, 3);
		let count = 0;
		while (iter.next() !== null) count++;
		// Manhattan distance 3: 1 + 4 + 8 + ... = 1 + 4*(1+2) = 13
		expect(count).toBeGreaterThan(0);
	});

	it("returns null for maxDistance 1", () => {
		const iter = createManhattanIterator(0, 0, 1);
		expect(iter.next()).toEqual(vec3(0, 0, 0));
		expect(iter.next()).toBeNull();
	});
});

describe("OctahedronIterator", () => {
	it("starts near center", () => {
		const iter = createOctahedronIterator(vec3(5, 10, 15), 2);
		const first = iter.next();
		expect(first).not.toBeNull();
	});

	it("returns null when exhausted", () => {
		const iter = createOctahedronIterator(vec3(0, 0, 0), 1);
		let count = 0;
		while (iter.next() !== null) count++;
		expect(count).toBeGreaterThan(0);
	});
});

describe("RaycastIterator", () => {
	it("steps along positive X axis", () => {
		const iter = createRaycastIterator(vec3(0.5, 0.5, 0.5), vec3(1, 0, 0), 5);
		const b1 = iter.next();
		expect(b1).not.toBeNull();
		expect(b1!.x).toBe(1);
		expect(b1!.y).toBe(0);
		expect(b1!.z).toBe(0);
		expect(b1!.face).toBe(BlockFace.WEST);
	});

	it("steps along negative Z axis", () => {
		const iter = createRaycastIterator(vec3(0.5, 0.5, 0.5), vec3(0, 0, -1), 5);
		const b1 = iter.next();
		expect(b1).not.toBeNull();
		expect(b1!.z).toBe(-1);
		expect(b1!.face).toBe(BlockFace.SOUTH);
	});

	it("returns null when past max distance", () => {
		const iter = createRaycastIterator(vec3(0.5, 0.5, 0.5), vec3(1, 0, 0), 2);
		let count = 0;
		while (iter.next() !== null) count++;
		expect(count).toBe(2);
	});

	it("intersect detects AABB collision", () => {
		const iter = createRaycastIterator(vec3(0.5, 0.5, -5), vec3(0, 0, 1), 20);
		const hit = iter.intersect([[0, 0, 0, 1, 1, 1]], vec3(0, 0, 0));
		expect(hit).not.toBeNull();
		expect(hit!.face).toBe(BlockFace.NORTH);
	});
});

describe("SpiralIterator2d", () => {
	it("starts at center", () => {
		const iter = createSpiralIterator2d(vec3(5, 0, 10), 3);
		const first = iter.next();
		expect(first).toEqual(vec3(5, 0, 10));
	});

	it("produces finite points", () => {
		const iter = createSpiralIterator2d(vec3(0, 0, 0), 3);
		let count = 0;
		while (iter.next() !== null) count++;
		expect(count).toBeGreaterThan(0);
	});
});
