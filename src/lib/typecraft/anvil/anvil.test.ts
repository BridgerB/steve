import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	blockToStateId,
	getBlock,
	setBlock,
	stateIdToBlock,
} from "../block.ts";
import {
	createChunkColumn,
	getBiomeId,
	getBlockStateId,
	neededBits,
	setBiomeId,
	setBlockStateId,
} from "../chunk/index.ts";
import { nbtCompound, nbtInt, nbtString } from "../nbt/index.ts";
import type { NbtTag } from "../nbt/types.ts";
import { createRegistry } from "../registry/index.ts";
import {
	closeAnvilWorld,
	loadChunk,
	openAnvilWorld,
	saveChunk,
} from "./anvil.ts";
import { chunkColumnToNbt, nbtToChunkColumn } from "./chunkNbt.ts";
import { readLevelDat, writeLevelDat } from "./levelDat.ts";
import {
	closeRegionFile,
	hasChunk,
	openRegionFile,
	readRegionChunk,
	writeRegionChunk,
} from "./region.ts";

const registry = createRegistry("1.20.4");

const makeTmpDir = async () => {
	const dir = join(
		tmpdir(),
		`typecraft-test-${randomBytes(4).toString("hex")}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return dir;
};

const cleanDir = async (dir: string) => {
	await fs.rm(dir, { recursive: true, force: true });
};

// ── Region file ──

describe("RegionFile", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await makeTmpDir();
	});

	afterEach(async () => {
		await cleanDir(tmpDir);
	});

	it("creates a new region file", async () => {
		const path = join(tmpDir, "r.0.0.mca");
		const region = await openRegionFile(path);

		expect(region.offsets.length).toBe(1024);
		expect(region.chunkTimestamps.length).toBe(1024);

		for (let x = 0; x < 32; x++) {
			for (let z = 0; z < 32; z++) {
				expect(hasChunk(region, x, z)).toBe(false);
			}
		}

		await closeRegionFile(region);
	});

	it("writes and reads chunk NBT", async () => {
		const path = join(tmpDir, "r.0.0.mca");
		const region = await openRegionFile(path);

		const nbt = nbtCompound(
			{
				DataVersion: nbtInt(3700),
				Status: nbtString("full"),
				xPos: nbtInt(0),
				zPos: nbtInt(0),
			},
			"",
		);

		await writeRegionChunk(region, 0, 0, nbt);
		expect(hasChunk(region, 0, 0)).toBe(true);

		const read = await readRegionChunk(region, 0, 0);
		expect(read).not.toBeNull();

		await closeRegionFile(region);
	});

	it("writes chunks at different positions", async () => {
		const path = join(tmpDir, "r.0.0.mca");
		const region = await openRegionFile(path);

		for (const [x, z] of [
			[0, 0],
			[5, 3],
			[31, 31],
		] as const) {
			const nbt = nbtCompound(
				{
					xPos: nbtInt(x),
					zPos: nbtInt(z),
				},
				"",
			);
			await writeRegionChunk(region, x, z, nbt);
		}

		expect(hasChunk(region, 0, 0)).toBe(true);
		expect(hasChunk(region, 5, 3)).toBe(true);
		expect(hasChunk(region, 31, 31)).toBe(true);
		expect(hasChunk(region, 1, 0)).toBe(false);

		await closeRegionFile(region);
	});

	it("persists across open/close", async () => {
		const path = join(tmpDir, "r.0.0.mca");

		const region1 = await openRegionFile(path);
		const nbt = nbtCompound({ test: nbtInt(42) }, "");
		await writeRegionChunk(region1, 3, 7, nbt);
		await closeRegionFile(region1);

		const region2 = await openRegionFile(path);
		expect(hasChunk(region2, 3, 7)).toBe(true);
		const read = await readRegionChunk(region2, 3, 7);
		expect(read).not.toBeNull();
		await closeRegionFile(region2);
	});

	it("returns null for empty chunk slot", async () => {
		const path = join(tmpDir, "r.0.0.mca");
		const region = await openRegionFile(path);
		const result = await readRegionChunk(region, 10, 10);
		expect(result).toBeNull();
		await closeRegionFile(region);
	});
});

// ── Chunk NBT conversion ──

describe("chunkNbt", () => {
	const makeTestColumn = () => {
		const maxBlockStateId = Math.max(
			...registry.blocksArray.map((b) => b.maxStateId),
		);
		return createChunkColumn({
			minY: -64,
			worldHeight: 384,
			maxBitsPerBlock: neededBits(maxBlockStateId),
			maxBitsPerBiome: neededBits(registry.biomesArray.length),
		});
	};

	it("roundtrips an empty chunk", () => {
		const col = makeTestColumn();
		const nbt = chunkColumnToNbt(col, 0, 0, registry, 3700);
		const restored = nbtToChunkColumn(nbt, registry);

		expect(restored.minY).toBe(-64);
		expect(restored.worldHeight).toBe(384);

		for (let x = 0; x < 16; x++) {
			for (let z = 0; z < 16; z++) {
				expect(getBlockStateId(restored, x, 0, z)).toBe(0);
			}
		}
	});

	it("roundtrips a chunk with blocks set", () => {
		const col = makeTestColumn();

		// Set stone (state 1) at a few positions
		const stoneBlock = registry.blocksByName.get("stone")!;
		setBlockStateId(col, 0, 0, 0, stoneBlock.defaultState);
		setBlockStateId(col, 5, 10, 5, stoneBlock.defaultState);

		const dirtBlock = registry.blocksByName.get("dirt")!;
		setBlockStateId(col, 3, -60, 3, dirtBlock.defaultState);

		const nbt = chunkColumnToNbt(col, 0, 0, registry, 3700);
		const restored = nbtToChunkColumn(nbt, registry);

		expect(getBlockStateId(restored, 0, 0, 0)).toBe(stoneBlock.defaultState);
		expect(getBlockStateId(restored, 5, 10, 5)).toBe(stoneBlock.defaultState);
		expect(getBlockStateId(restored, 3, -60, 3)).toBe(dirtBlock.defaultState);
	});

	it("roundtrips biome data", () => {
		const col = makeTestColumn();

		const plains = registry.biomesByName.get("plains")!;
		const desert = registry.biomesByName.get("desert")!;
		setBiomeId(col, 0, 0, 0, plains.id);
		setBiomeId(col, 4, 64, 4, desert.id);

		const nbt = chunkColumnToNbt(col, 0, 0, registry, 3700);
		const restored = nbtToChunkColumn(nbt, registry);

		expect(getBiomeId(restored, 0, 0, 0)).toBe(plains.id);
		expect(getBiomeId(restored, 4, 64, 4)).toBe(desert.id);
	});

	it("preserves block state properties", () => {
		const col = makeTestColumn();

		// Oak stairs have facing, half, shape, waterlogged properties
		const oakStairs = registry.blocksByName.get("oak_stairs")!;
		// Use a non-default state (offset from minStateId)
		const stateId = oakStairs.minStateId + 3;
		setBlockStateId(col, 7, 7, 7, stateId);

		const nbt = chunkColumnToNbt(col, 0, 0, registry, 3700);
		const restored = nbtToChunkColumn(nbt, registry);

		expect(getBlockStateId(restored, 7, 7, 7)).toBe(stateId);
	});
});

// ── Level.dat ──

describe("levelDat", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await makeTmpDir();
	});

	afterEach(async () => {
		await cleanDir(tmpDir);
	});

	it("writes and reads level.dat", async () => {
		const path = join(tmpDir, "level.dat");

		await writeLevelDat(path, {
			levelName: "Test World",
			version: "1.20.4",
			generatorName: "default",
			randomSeed: [12345, 67890],
		});

		const data = await readLevelDat(path);

		expect(data.levelName).toBe("Test World");
		expect(data.version).toBe("1.20.4");
		expect(data.generatorName).toBe("default");
	});
});

// ── AnvilWorld high-level API ──

describe("AnvilWorld", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await makeTmpDir();
		await fs.mkdir(join(tmpDir, "region"), { recursive: true });
	});

	afterEach(async () => {
		await cleanDir(tmpDir);
	});

	it("saves and loads a chunk", async () => {
		const world = openAnvilWorld(tmpDir, registry);

		const maxBlockStateId = Math.max(
			...registry.blocksArray.map((b) => b.maxStateId),
		);
		const col = createChunkColumn({
			minY: -64,
			worldHeight: 384,
			maxBitsPerBlock: neededBits(maxBlockStateId),
			maxBitsPerBiome: neededBits(registry.biomesArray.length),
		});

		const stone = registry.blocksByName.get("stone")!;
		setBlockStateId(col, 0, 0, 0, stone.defaultState);
		setBlockStateId(col, 8, 64, 8, stone.defaultState);

		await saveChunk(world, 0, 0, col);

		const loaded = await loadChunk(world, 0, 0);
		expect(loaded).not.toBeNull();
		expect(getBlockStateId(loaded!, 0, 0, 0)).toBe(stone.defaultState);
		expect(getBlockStateId(loaded!, 8, 64, 8)).toBe(stone.defaultState);

		await closeAnvilWorld(world);
	});

	it("returns null for ungenerated chunk", async () => {
		const world = openAnvilWorld(tmpDir, registry);

		const loaded = await loadChunk(world, 5, 5);
		expect(loaded).toBeNull();

		await closeAnvilWorld(world);
	});

	it("saves chunks in different regions", async () => {
		const world = openAnvilWorld(tmpDir, registry);

		const maxBlockStateId = Math.max(
			...registry.blocksArray.map((b) => b.maxStateId),
		);
		const makeCol = () =>
			createChunkColumn({
				minY: -64,
				worldHeight: 384,
				maxBitsPerBlock: neededBits(maxBlockStateId),
				maxBitsPerBiome: neededBits(registry.biomesArray.length),
			});

		const col1 = makeCol();
		setBlockStateId(col1, 0, 0, 0, 1);
		await saveChunk(world, 0, 0, col1);

		// Chunk 33 is in the next region (33 >> 5 = 1)
		const col2 = makeCol();
		setBlockStateId(col2, 0, 0, 0, 2);
		await saveChunk(world, 33, 0, col2);

		const loaded1 = await loadChunk(world, 0, 0);
		const loaded2 = await loadChunk(world, 33, 0);

		expect(loaded1).not.toBeNull();
		expect(loaded2).not.toBeNull();
		expect(getBlockStateId(loaded1!, 0, 0, 0)).toBe(1);
		expect(getBlockStateId(loaded2!, 0, 0, 0)).toBe(2);

		await closeAnvilWorld(world);
	});
});

// ── Block entity roundtrip ──

describe("block entities", () => {
	const makeTestColumn = () => {
		const maxBlockStateId = Math.max(
			...registry.blocksArray.map((b) => b.maxStateId),
		);
		return createChunkColumn({
			minY: -64,
			worldHeight: 384,
			maxBitsPerBlock: neededBits(maxBlockStateId),
			maxBitsPerBiome: neededBits(registry.biomesArray.length),
		});
	};

	it("roundtrips block entities through NBT", () => {
		const col = makeTestColumn();

		// Store a block entity as raw NbtTag compound value
		const chestEntity: Record<string, NbtTag> = {
			id: nbtString("minecraft:chest"),
			x: nbtInt(5),
			y: nbtInt(10),
			z: nbtInt(3),
			Items: { type: "list", value: { type: "end", value: [] } },
			Lock: nbtString(""),
		};

		col.blockEntities["5,10,3"] = chestEntity;

		const nbt = chunkColumnToNbt(col, 0, 0, registry, 3700);
		const restored = nbtToChunkColumn(nbt, registry);

		const entity = restored.blockEntities["5,10,3"] as Record<string, NbtTag>;
		expect(entity).toBeDefined();
		expect(entity.id.value).toBe("minecraft:chest");
		expect(entity.x.value).toBe(5);
		expect(entity.y.value).toBe(10);
		expect(entity.z.value).toBe(3);
	});

	it("roundtrips multiple block entities", () => {
		const col = makeTestColumn();

		col.blockEntities["0,64,0"] = {
			id: nbtString("minecraft:sign"),
			x: nbtInt(0),
			y: nbtInt(64),
			z: nbtInt(0),
		} as Record<string, NbtTag>;

		col.blockEntities["15,0,15"] = {
			id: nbtString("minecraft:chest"),
			x: nbtInt(15),
			y: nbtInt(0),
			z: nbtInt(15),
		} as Record<string, NbtTag>;

		const nbt = chunkColumnToNbt(col, 0, 0, registry, 3700);
		const restored = nbtToChunkColumn(nbt, registry);

		const sign = restored.blockEntities["0,64,0"] as Record<string, NbtTag>;
		const chest = restored.blockEntities["15,0,15"] as Record<string, NbtTag>;

		expect(sign).toBeDefined();
		expect(sign.id.value).toBe("minecraft:sign");
		expect(chest).toBeDefined();
		expect(chest.id.value).toBe("minecraft:chest");
	});

	it("preserves empty block entities", () => {
		const col = makeTestColumn();

		const nbt = chunkColumnToNbt(col, 0, 0, registry, 3700);
		const restored = nbtToChunkColumn(nbt, registry);

		expect(Object.keys(restored.blockEntities).length).toBe(0);
	});
});

// ── getBlock / setBlock convenience ──

describe("getBlock / setBlock", () => {
	const makeTestColumn = () => {
		const maxBlockStateId = Math.max(
			...registry.blocksArray.map((b) => b.maxStateId),
		);
		return createChunkColumn({
			minY: -64,
			worldHeight: 384,
			maxBitsPerBlock: neededBits(maxBlockStateId),
			maxBitsPerBiome: neededBits(registry.biomesArray.length),
		});
	};

	it("stateIdToBlock returns name and empty properties for simple blocks", () => {
		const stone = registry.blocksByName.get("stone")!;
		const info = stateIdToBlock(registry, stone.defaultState);
		expect(info.name).toBe("stone");
		expect(Object.keys(info.properties).length).toBe(0);
	});

	it("stateIdToBlock returns properties for stateful blocks", () => {
		const stairs = registry.blocksByName.get("oak_stairs")!;
		const info = stateIdToBlock(registry, stairs.minStateId);
		expect(info.name).toBe("oak_stairs");
		expect(info.properties.facing).toBeDefined();
		expect(info.properties.half).toBeDefined();
		expect(info.properties.shape).toBeDefined();
	});

	it("blockToStateId roundtrips with stateIdToBlock", () => {
		const stairs = registry.blocksByName.get("oak_stairs")!;
		for (let offset = 0; offset < 20; offset++) {
			const stateId = stairs.minStateId + offset;
			const info = stateIdToBlock(registry, stateId);
			const recovered = blockToStateId(registry, info.name, info.properties);
			expect(recovered).toBe(stateId);
		}
	});

	it("blockToStateId with no properties returns default state", () => {
		const stone = registry.blocksByName.get("stone")!;
		expect(blockToStateId(registry, "stone")).toBe(stone.defaultState);
	});

	it("setBlock and getBlock work with names", () => {
		const col = makeTestColumn();
		setBlock(col, 5, 64, 5, registry, "stone");
		const info = getBlock(col, 5, 64, 5, registry);
		expect(info.name).toBe("stone");
	});

	it("setBlock with properties and getBlock roundtrips", () => {
		const col = makeTestColumn();
		setBlock(col, 0, 0, 0, registry, "oak_stairs", {
			facing: "south",
			half: "bottom",
			shape: "straight",
			waterlogged: "false",
		});
		const info = getBlock(col, 0, 0, 0, registry);
		expect(info.name).toBe("oak_stairs");
		expect(info.properties.facing).toBe("south");
		expect(info.properties.half).toBe("bottom");
		expect(info.properties.shape).toBe("straight");
		expect(info.properties.waterlogged).toBe("false");
	});

	it("setBlock with partial properties fills defaults", () => {
		const col = makeTestColumn();
		// Only specify facing, rest should use first value in each property's values array
		setBlock(col, 0, 0, 0, registry, "oak_stairs", { facing: "east" });
		const info = getBlock(col, 0, 0, 0, registry);
		expect(info.name).toBe("oak_stairs");
		expect(info.properties.facing).toBe("east");
	});
});
