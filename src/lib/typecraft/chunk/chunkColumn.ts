import {
	type BiomeSection,
	biomeSectionFromLocalPalette,
	createBiomeSection,
	getSectionBiome,
	readBiomeSection,
	setSectionBiome,
	writeBiomeSection,
} from "./biomeSection.ts";
import {
	type BitArray,
	bitArrayFromLongArray,
	bitArrayToLongArray,
	createBitArray,
	createBitArrayFromData,
	getBitValue,
	readBitArrayData,
	setBitValue,
	writeBitArrayData,
} from "./bitArray.ts";
import {
	type ChunkSection,
	createChunkSection,
	getSectionBlock,
	readChunkSection,
	sectionFromLocalPalette,
	setSectionBlock,
	writeChunkSection,
} from "./chunkSection.ts";

const DEFAULT_MIN_Y = -64;
const DEFAULT_WORLD_HEIGHT = 384;

export type ChunkColumn = {
	minY: number;
	worldHeight: number;
	numSections: number;
	maxBitsPerBlock: number;
	maxBitsPerBiome: number;

	sections: ChunkSection[];
	biomes: BiomeSection[];

	skyLightMask: BitArray;
	emptySkyLightMask: BitArray;
	skyLightSections: (BitArray | null)[];

	blockLightMask: BitArray;
	emptyBlockLightMask: BitArray;
	blockLightSections: (BitArray | null)[];

	blockEntities: Record<string, unknown>;
};

export type ChunkColumnOptions = {
	minY?: number;
	worldHeight?: number;
	maxBitsPerBlock: number;
	maxBitsPerBiome: number;
};

export const createChunkColumn = (options: ChunkColumnOptions): ChunkColumn => {
	const minY = options.minY ?? DEFAULT_MIN_Y;
	const worldHeight = options.worldHeight ?? DEFAULT_WORLD_HEIGHT;
	const numSections = worldHeight >> 4;

	return {
		minY,
		worldHeight,
		numSections,
		maxBitsPerBlock: options.maxBitsPerBlock,
		maxBitsPerBiome: options.maxBitsPerBiome,
		sections: Array.from({ length: numSections }, () =>
			createChunkSection(options.maxBitsPerBlock),
		),
		biomes: Array.from({ length: numSections }, () => createBiomeSection()),
		skyLightMask: createBitArray(1, numSections + 2),
		emptySkyLightMask: createBitArray(1, numSections + 2),
		skyLightSections: Array(numSections + 2).fill(null) as (BitArray | null)[],
		blockLightMask: createBitArray(1, numSections + 2),
		emptyBlockLightMask: createBitArray(1, numSections + 2),
		blockLightSections: Array(numSections + 2).fill(
			null,
		) as (BitArray | null)[],
		blockEntities: {},
	};
};

// ── Block access ──

export const getBlockStateId = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
): number => {
	const section = col.sections[(y - col.minY) >> 4];
	return section ? getSectionBlock(section, x, (y - col.minY) & 0xf, z) : 0;
};

export const setBlockStateId = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
	stateId: number,
): void => {
	const section = col.sections[(y - col.minY) >> 4];
	if (section) {
		setSectionBlock(section, x, (y - col.minY) & 0xf, z, stateId);
	}
};

// ── Light access ──

const lightSectionIndex = (y: number, minY: number): number =>
	Math.floor((y - minY) / 16) + 1;

const sectionBlockIndex = (
	y: number,
	z: number,
	x: number,
	minY: number,
): number => (((y - minY) & 15) << 8) | (z << 4) | x;

export const getBlockLight = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
): number => {
	const section = col.blockLightSections[lightSectionIndex(y, col.minY)];
	return section
		? getBitValue(section, sectionBlockIndex(y, z, x, col.minY))
		: 0;
};

export const setBlockLight = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
	light: number,
): void => {
	const idx = lightSectionIndex(y, col.minY);
	let section = col.blockLightSections[idx];

	if (section === null || section === undefined) {
		if (light === 0) return;
		section = createBitArray(4, 4096);
		setBitValue(col.blockLightMask, idx, 1);
		col.blockLightSections[idx] = section;
	}

	setBitValue(section, sectionBlockIndex(y, z, x, col.minY), light);
};

export const getSkyLight = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
): number => {
	const section = col.skyLightSections[lightSectionIndex(y, col.minY)];
	return section
		? getBitValue(section, sectionBlockIndex(y, z, x, col.minY))
		: 0;
};

export const setSkyLight = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
	light: number,
): void => {
	const idx = lightSectionIndex(y, col.minY);
	let section = col.skyLightSections[idx];

	if (section === null || section === undefined) {
		if (light === 0) return;
		section = createBitArray(4, 4096);
		setBitValue(col.skyLightMask, idx, 1);
		col.skyLightSections[idx] = section;
	}

	setBitValue(section, sectionBlockIndex(y, z, x, col.minY), light);
};

// ── Biome access ──

export const getBiomeId = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
): number => {
	const biome = col.biomes[(y - col.minY) >> 4];
	return biome
		? getSectionBiome(biome, x >> 2, ((y - col.minY) & 0xf) >> 2, z >> 2)
		: 0;
};

export const setBiomeId = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
	biomeId: number,
): void => {
	const biome = col.biomes[(y - col.minY) >> 4];
	if (biome) {
		setSectionBiome(
			biome,
			x >> 2,
			((y - col.minY) & 0xf) >> 2,
			z >> 2,
			biomeId,
		);
	}
};

// ── Block entities ──

const posKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export const getBlockEntity = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
): unknown => col.blockEntities[posKey(x, y, z)];

export const setBlockEntity = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
	entity: unknown,
): void => {
	col.blockEntities[posKey(x, y, z)] = entity;
};

export const removeBlockEntity = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
): void => {
	delete col.blockEntities[posKey(x, y, z)];
};

// ── Anvil section loading ──

export const loadChunkSectionFromAnvil = (
	col: ChunkColumn,
	sectionY: number,
	blockPalette: number[],
	blockData: BitArray,
	biomePalette: number[],
	biomeData: BitArray,
	blockLight?: Buffer,
	skyLight?: Buffer,
): void => {
	const minCY = Math.abs(col.minY >> 4);
	const idx = sectionY + minCY;

	col.sections[idx] = sectionFromLocalPalette(blockPalette, blockData);
	col.biomes[idx] = biomeSectionFromLocalPalette(biomePalette, biomeData);

	if (blockLight) {
		loadLightNibbles(
			col.blockLightMask,
			col.blockLightSections,
			idx + 1,
			blockLight,
		);
	}
	if (skyLight) {
		loadLightNibbles(col.skyLightMask, col.skyLightSections, idx + 1, skyLight);
	}
};

const loadLightNibbles = (
	mask: BitArray,
	sections: (BitArray | null)[],
	index: number,
	buffer: Buffer,
): void => {
	setBitValue(mask, index, 1);
	sections[index] = createBitArrayFromData(
		new Uint32Array(new Int8Array(buffer).buffer),
		4,
		4096,
	);
};

// ── Network I/O ──

/** Serialize chunk data to the network protocol format. */
export const dumpChunkColumn = (
	col: ChunkColumn,
	noArrayLength = false,
): Buffer => {
	const buffer = Buffer.alloc(512 * 1024); // 512KB should be plenty
	let offset = 0;

	for (let i = 0; i < col.numSections; i++) {
		offset = writeChunkSection(col.sections[i]!, buffer, offset, noArrayLength);
		offset = writeBiomeSection(col.biomes[i]!, buffer, offset, noArrayLength);
	}

	return buffer.subarray(0, offset);
};

/** Load chunk data from the network protocol format. */
export const loadChunkColumn = (
	col: ChunkColumn,
	data: Buffer,
	noArrayLength = false,
): void => {
	let offset = 0;

	for (let i = 0; i < col.numSections; i++) {
		[col.sections[i], offset] = readChunkSection(
			data,
			offset,
			col.maxBitsPerBlock,
			noArrayLength,
		);
		[col.biomes[i], offset] = readBiomeSection(data, offset, noArrayLength);
	}
};

/** Serialize light data for the network protocol. */
export const dumpChunkLight = (col: ChunkColumn) => {
	const skyLight: Uint8Array[] = [];
	const blockLight: Uint8Array[] = [];

	for (let i = 0; i < col.skyLightSections.length; i++) {
		const section = col.skyLightSections[i];
		if (section != null && getBitValue(col.skyLightMask, i)) {
			const buf = Buffer.alloc(section.data.length * 4);
			writeBitArrayData(section, buf, 0);
			skyLight.push(new Uint8Array(buf));
		}
	}

	for (let i = 0; i < col.blockLightSections.length; i++) {
		const section = col.blockLightSections[i];
		if (section != null && getBitValue(col.blockLightMask, i)) {
			const buf = Buffer.alloc(section.data.length * 4);
			writeBitArrayData(section, buf, 0);
			blockLight.push(new Uint8Array(buf));
		}
	}

	return {
		skyLight,
		blockLight,
		skyLightMask: bitArrayToLongArray(col.skyLightMask),
		blockLightMask: bitArrayToLongArray(col.blockLightMask),
		emptySkyLightMask: bitArrayToLongArray(col.emptySkyLightMask),
		emptyBlockLightMask: bitArrayToLongArray(col.emptyBlockLightMask),
	};
};

/** Load parsed light data from the network protocol. */
export const loadChunkLight = (
	col: ChunkColumn,
	skyLightData: Buffer[],
	blockLightData: Buffer[],
	skyLightMaskLongs: [number, number][],
	blockLightMaskLongs: [number, number][],
	emptySkyLightMaskLongs: [number, number][],
	emptyBlockLightMaskLongs: [number, number][],
): void => {
	loadLightSections(
		col.skyLightSections,
		col.skyLightMask,
		col.emptySkyLightMask,
		skyLightData,
		skyLightMaskLongs,
		emptySkyLightMaskLongs,
	);
	loadLightSections(
		col.blockLightSections,
		col.blockLightMask,
		col.emptyBlockLightMask,
		blockLightData,
		blockLightMaskLongs,
		emptyBlockLightMaskLongs,
	);
};

const loadLightSections = (
	sections: (BitArray | null)[],
	lightMask: BitArray,
	emptyMask: BitArray,
	data: Buffer[],
	incomingLightMaskLongs: [number, number][],
	incomingEmptyMaskLongs: [number, number][],
): void => {
	const incomingLightMask = bitArrayFromLongArray(incomingLightMaskLongs, 1);
	const incomingEmptyMask = bitArrayFromLongArray(incomingEmptyMaskLongs, 1);
	let currentSectionIndex = 0;

	for (let y = 0; y < sections.length; y++) {
		const isEmpty = getBitValue(incomingEmptyMask, y);
		if (!getBitValue(incomingLightMask, y) && !isEmpty) continue;

		setBitValue(emptyMask, y, isEmpty);
		setBitValue(lightMask, y, 1 - isEmpty);

		const arr = createBitArray(4, 4096);
		sections[y] = arr;

		if (!isEmpty) {
			const buf = data[currentSectionIndex++]!;
			readBitArrayData(arr, buf, 0, arr.data.length / 2);
		}
	}
};
