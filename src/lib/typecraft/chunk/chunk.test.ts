import { describe, expect, it } from "vitest";
import {
	biomeSectionFromLocalPalette,
	bitArrayFromLongArray,
	bitArrayToLongArray,
	createBiomeSection,
	createBitArray,
	createChunkColumn,
	createChunkSection,
	dumpChunkColumn,
	getBiomeId,
	getBitValue,
	getBlockEntity,
	getBlockLight,
	getBlockStateId,
	getSectionBiome,
	getSectionBlock,
	getSkyLight,
	isSectionEmpty,
	loadChunkColumn,
	neededBits,
	removeBlockEntity,
	resizeBitArray,
	resizeBitArrayCapacity,
	sectionFromLocalPalette,
	setBiomeId,
	setBitValue,
	setBlockEntity,
	setBlockLight,
	setBlockStateId,
	setSectionBiome,
	setSectionBlock,
	setSkyLight,
} from "./index.ts";

// ── neededBits ──

describe("neededBits", () => {
	it("returns correct bit counts", () => {
		expect(neededBits(0)).toBe(0);
		expect(neededBits(1)).toBe(1);
		expect(neededBits(2)).toBe(2);
		expect(neededBits(3)).toBe(2);
		expect(neededBits(4)).toBe(3);
		expect(neededBits(15)).toBe(4);
		expect(neededBits(16)).toBe(5);
		expect(neededBits(255)).toBe(8);
		expect(neededBits(256)).toBe(9);
		expect(neededBits(65535)).toBe(16);
	});
});

// ── BitArray ──

describe("BitArray", () => {
	it("stores and retrieves values", () => {
		const arr = createBitArray(4, 16);
		setBitValue(arr, 0, 5);
		setBitValue(arr, 1, 10);
		setBitValue(arr, 15, 15);

		expect(getBitValue(arr, 0)).toBe(5);
		expect(getBitValue(arr, 1)).toBe(10);
		expect(getBitValue(arr, 15)).toBe(15);
	});

	it("initializes all values to zero", () => {
		const arr = createBitArray(8, 100);
		for (let i = 0; i < 100; i++) {
			expect(getBitValue(arr, i)).toBe(0);
		}
	});

	it("handles various bits per value", () => {
		for (const bits of [1, 2, 4, 5, 8, 14, 16]) {
			const maxVal = (1 << bits) - 1;
			const arr = createBitArray(bits, 64);
			for (let i = 0; i < 64; i++) {
				setBitValue(arr, i, i % (maxVal + 1));
			}
			for (let i = 0; i < 64; i++) {
				expect(getBitValue(arr, i)).toBe(i % (maxVal + 1));
			}
		}
	});

	it("resizes to new bits per value", () => {
		const arr = createBitArray(4, 16);
		for (let i = 0; i < 16; i++) {
			setBitValue(arr, i, i);
		}
		const resized = resizeBitArray(arr, 8);
		for (let i = 0; i < 16; i++) {
			expect(getBitValue(resized, i)).toBe(i);
		}
	});

	it("resizes capacity", () => {
		const arr = createBitArray(4, 16);
		for (let i = 0; i < 16; i++) {
			setBitValue(arr, i, i);
		}
		const resized = resizeBitArrayCapacity(arr, 32);
		for (let i = 0; i < 16; i++) {
			expect(getBitValue(resized, i)).toBe(i);
		}
		for (let i = 16; i < 32; i++) {
			expect(getBitValue(resized, i)).toBe(0);
		}
	});

	it("roundtrips through long array", () => {
		const arr = createBitArray(5, 100);
		for (let i = 0; i < 100; i++) {
			setBitValue(arr, i, i % 32);
		}
		const longs = bitArrayToLongArray(arr);
		const restored = bitArrayFromLongArray(longs, 5);
		for (let i = 0; i < 100; i++) {
			expect(getBitValue(restored, i)).toBe(i % 32);
		}
	});
});

// ── ChunkSection ──

describe("ChunkSection", () => {
	it("creates empty section", () => {
		const section = createChunkSection();
		expect(isSectionEmpty(section)).toBe(true);
		expect(getSectionBlock(section, 0, 0, 0)).toBe(0);
	});

	it("sets and gets block state IDs", () => {
		const section = createChunkSection();
		setSectionBlock(section, 0, 0, 0, 1);
		expect(getSectionBlock(section, 0, 0, 0)).toBe(1);
		expect(isSectionEmpty(section)).toBe(false);
	});

	it("tracks solid block count", () => {
		const section = createChunkSection();
		setSectionBlock(section, 0, 0, 0, 1);
		setSectionBlock(section, 1, 0, 0, 2);
		expect(section.solidBlockCount).toBe(2);

		setSectionBlock(section, 0, 0, 0, 0);
		expect(section.solidBlockCount).toBe(1);
	});

	it("handles many different block types (palette upgrade)", () => {
		const section = createChunkSection();
		for (let i = 0; i < 16; i++) {
			setSectionBlock(section, i, 0, 0, i + 1);
		}
		for (let i = 0; i < 16; i++) {
			expect(getSectionBlock(section, i, 0, 0)).toBe(i + 1);
		}
	});

	it("handles >256 unique states (direct palette)", () => {
		const section = createChunkSection();
		for (let x = 0; x < 16; x++) {
			for (let z = 0; z < 16; z++) {
				setSectionBlock(section, x, 0, z, x * 16 + z + 1);
			}
		}
		for (let x = 0; x < 16; x++) {
			for (let z = 0; z < 16; z++) {
				expect(getSectionBlock(section, x, 0, z)).toBe(x * 16 + z + 1);
			}
		}
	});

	it("creates from local palette", () => {
		const data = createBitArray(4, 4096);
		setBitValue(data, 0, 0);
		setBitValue(data, 1, 1);
		setBitValue(data, 2, 2);

		const section = sectionFromLocalPalette([0, 10, 20], data);
		expect(getSectionBlock(section, 0, 0, 0)).toBe(0);
		expect(getSectionBlock(section, 1, 0, 0)).toBe(10);
		expect(getSectionBlock(section, 2, 0, 0)).toBe(20);
		expect(section.solidBlockCount).toBe(2);
	});
});

// ── BiomeSection ──

describe("BiomeSection", () => {
	it("creates with default biome 0", () => {
		const section = createBiomeSection();
		expect(getSectionBiome(section, 0, 0, 0)).toBe(0);
	});

	it("sets and gets biome IDs", () => {
		const section = createBiomeSection();
		setSectionBiome(section, 0, 0, 0, 5);
		expect(getSectionBiome(section, 0, 0, 0)).toBe(5);
	});

	it("creates from local palette", () => {
		const data = createBitArray(1, 64);
		setBitValue(data, 0, 0);
		setBitValue(data, 1, 1);

		const section = biomeSectionFromLocalPalette([1, 7], data);
		expect(getSectionBiome(section, 0, 0, 0)).toBe(1);
		expect(getSectionBiome(section, 1, 0, 0)).toBe(7);
	});
});

// ── ChunkColumn ──

describe("ChunkColumn", () => {
	const makeColumn = () =>
		createChunkColumn({ maxBitsPerBlock: 15, maxBitsPerBiome: 7 });

	it("creates with correct dimensions", () => {
		const col = makeColumn();
		expect(col.minY).toBe(-64);
		expect(col.worldHeight).toBe(384);
		expect(col.numSections).toBe(24);
		expect(col.sections.length).toBe(24);
		expect(col.biomes.length).toBe(24);
	});

	it("gets/sets block state IDs", () => {
		const col = makeColumn();
		setBlockStateId(col, 0, 0, 0, 1);
		expect(getBlockStateId(col, 0, 0, 0)).toBe(1);
	});

	it("handles negative Y", () => {
		const col = makeColumn();
		setBlockStateId(col, 5, -64, 5, 42);
		expect(getBlockStateId(col, 5, -64, 5)).toBe(42);
	});

	it("handles positive Y", () => {
		const col = makeColumn();
		setBlockStateId(col, 0, 319, 0, 99);
		expect(getBlockStateId(col, 0, 319, 0)).toBe(99);
	});

	it("gets/sets biome IDs", () => {
		const col = makeColumn();
		setBiomeId(col, 0, 0, 0, 5);
		expect(getBiomeId(col, 0, 0, 0)).toBe(5);
	});

	it("gets/sets block light", () => {
		const col = makeColumn();
		expect(getBlockLight(col, 0, 0, 0)).toBe(0);
		setBlockLight(col, 0, 0, 0, 15);
		expect(getBlockLight(col, 0, 0, 0)).toBe(15);
	});

	it("gets/sets sky light", () => {
		const col = makeColumn();
		expect(getSkyLight(col, 0, 0, 0)).toBe(0);
		setSkyLight(col, 0, 0, 0, 12);
		expect(getSkyLight(col, 0, 0, 0)).toBe(12);
	});

	it("skips setting light 0 on null section", () => {
		const col = makeColumn();
		setBlockLight(col, 0, 0, 0, 0);
		expect(col.blockLightSections[1]).toBeNull();
	});

	it("gets/sets/removes block entities", () => {
		const col = makeColumn();
		const entity = { id: "minecraft:chest", Items: [] };
		setBlockEntity(col, 5, 10, 3, entity);
		expect(getBlockEntity(col, 5, 10, 3)).toEqual(entity);

		removeBlockEntity(col, 5, 10, 3);
		expect(getBlockEntity(col, 5, 10, 3)).toBeUndefined();
	});
});

// ── Network roundtrip ──

describe("ChunkColumn network roundtrip", () => {
	it("roundtrips empty chunk", () => {
		const col = createChunkColumn({
			maxBitsPerBlock: 15,
			maxBitsPerBiome: 7,
		});
		const data = dumpChunkColumn(col);
		const col2 = createChunkColumn({
			maxBitsPerBlock: 15,
			maxBitsPerBiome: 7,
		});
		loadChunkColumn(col2, data);

		for (let x = 0; x < 16; x++) {
			for (let z = 0; z < 16; z++) {
				expect(getBlockStateId(col2, x, 0, z)).toBe(0);
			}
		}
	});

	it("roundtrips chunk with blocks", () => {
		const col = createChunkColumn({
			maxBitsPerBlock: 15,
			maxBitsPerBiome: 7,
		});

		setBlockStateId(col, 0, 0, 0, 1);
		setBlockStateId(col, 5, 100, 5, 42);
		setBlockStateId(col, 15, -64, 15, 999);
		setBiomeId(col, 0, 0, 0, 3);

		const data = dumpChunkColumn(col);
		const col2 = createChunkColumn({
			maxBitsPerBlock: 15,
			maxBitsPerBiome: 7,
		});
		loadChunkColumn(col2, data);

		expect(getBlockStateId(col2, 0, 0, 0)).toBe(1);
		expect(getBlockStateId(col2, 5, 100, 5)).toBe(42);
		expect(getBlockStateId(col2, 15, -64, 15)).toBe(999);
		expect(getBiomeId(col2, 0, 0, 0)).toBe(3);
	});
});
