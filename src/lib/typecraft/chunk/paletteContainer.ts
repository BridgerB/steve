import {
	type BitArray,
	bitArrayLongCount,
	createBitArray,
	getBitValue,
	neededBits,
	readBitArrayData,
	resizeBitArray,
	setBitValue,
	writeBitArrayData,
} from "./bitArray.ts";
import {
	BLOCK_SECTION_VOLUME,
	GLOBAL_BITS_PER_BLOCK,
	MAX_BITS_PER_BLOCK,
	MIN_BITS_PER_BLOCK,
} from "./constants.ts";
import { readVarint, writeVarint } from "./varint.ts";

// ── Types ──

export type SingleValueContainer = {
	readonly type: "single";
	value: number;
	bitsPerValue: number;
	capacity: number;
	maxBits: number;
	globalBits: number;
};

export type IndirectContainer = {
	readonly type: "indirect";
	data: BitArray;
	palette: number[];
	maxBits: number;
	globalBits: number;
};

export type DirectContainer = {
	readonly type: "direct";
	data: BitArray;
};

export type PaletteContainer =
	| SingleValueContainer
	| IndirectContainer
	| DirectContainer;

// ── Config ──

export type PaletteConfig = {
	bitsPerValue: number;
	capacity: number;
	maxBits: number;
	globalBits: number;
};

export const BLOCK_PALETTE_CONFIG: PaletteConfig = {
	bitsPerValue: MIN_BITS_PER_BLOCK,
	capacity: BLOCK_SECTION_VOLUME,
	maxBits: MAX_BITS_PER_BLOCK,
	globalBits: GLOBAL_BITS_PER_BLOCK,
};

// ── Constructors ──

export const createSingleValueContainer = (
	value: number,
	config: PaletteConfig,
): SingleValueContainer => ({
	type: "single",
	value,
	bitsPerValue: config.bitsPerValue,
	capacity: config.capacity,
	maxBits: config.maxBits,
	globalBits: config.globalBits,
});

export const createIndirectContainer = (
	palette: number[],
	data: BitArray,
	maxBits: number,
	globalBits: number,
): IndirectContainer => ({
	type: "indirect",
	data,
	palette,
	maxBits,
	globalBits,
});

export const createDirectContainer = (data: BitArray): DirectContainer => ({
	type: "direct",
	data,
});

// ── Get / Set ──

export const getContainerValue = (
	container: PaletteContainer,
	index: number,
): number => {
	switch (container.type) {
		case "single":
			return container.value;
		case "indirect":
			return container.palette[getBitValue(container.data, index)]!;
		case "direct":
			return getBitValue(container.data, index);
	}
};

/**
 * Set a value in the container. May return a new container if the type
 * needs to upgrade (single → indirect, indirect → direct).
 */
export const setContainerValue = (
	container: PaletteContainer,
	index: number,
	value: number,
): PaletteContainer => {
	switch (container.type) {
		case "single":
			return setSingleValue(container, index, value);
		case "indirect":
			return setIndirectValue(container, index, value);
		case "direct": {
			setBitValue(container.data, index, value);
			return container;
		}
	}
};

const setSingleValue = (
	c: SingleValueContainer,
	index: number,
	value: number,
): PaletteContainer => {
	if (value === c.value) return c;

	const data = createBitArray(c.bitsPerValue, c.capacity);
	setBitValue(data, index, 1);

	return createIndirectContainer(
		[c.value, value],
		data,
		c.maxBits,
		c.globalBits,
	);
};

const setIndirectValue = (
	c: IndirectContainer,
	index: number,
	value: number,
): PaletteContainer => {
	let paletteIndex = c.palette.indexOf(value);
	if (paletteIndex < 0) {
		paletteIndex = c.palette.length;
		c.palette.push(value);
		const bits = neededBits(paletteIndex);
		if (bits > c.data.bitsPerValue) {
			if (bits <= c.maxBits) {
				c.data = resizeBitArray(c.data, bits);
			} else {
				return convertToDirect(c, c.globalBits, index, value);
			}
		}
	}
	setBitValue(c.data, index, paletteIndex);
	return c;
};

const convertToDirect = (
	c: IndirectContainer,
	globalBits: number,
	setIndex: number,
	setValue: number,
): DirectContainer => {
	const data = createBitArray(globalBits, c.data.capacity);
	for (let i = 0; i < c.data.capacity; i++) {
		setBitValue(data, i, c.palette[getBitValue(c.data, i)]!);
	}
	setBitValue(data, setIndex, setValue);
	return createDirectContainer(data);
};

// ── Binary I/O ──

/** Calculate the number of longs needed for a palette data array. */
const calcLongCount = (bitsPerValue: number, capacity: number): number =>
	Math.ceil(capacity / Math.floor(64 / bitsPerValue));

export const readPaletteContainer = (
	buffer: Buffer,
	offset: number,
	config: PaletteConfig,
	noArrayLength = false,
): [PaletteContainer, number] => {
	const bitsPerBlock = buffer.readUInt8(offset++);

	// Single value
	if (bitsPerBlock === 0) {
		let value: number;
		[value, offset] = readVarint(buffer, offset);
		if (!noArrayLength) {
			// Read and discard data array length (should be 0)
			[, offset] = readVarint(buffer, offset);
		}
		return [createSingleValueContainer(value, config), offset];
	}

	// Direct palette — use the wire bitsPerBlock (the server's global-palette bit
	// width), not a fixed constant. 26.1.2 has 133 biomes -> 8-bit direct biome
	// palette, so the old fixed GLOBAL_BITS_PER_BIOME (6) read too few longs.
	if (bitsPerBlock > config.maxBits) {
		const data = createBitArray(bitsPerBlock, config.capacity);
		let longCount: number;
		if (noArrayLength) {
			longCount = calcLongCount(bitsPerBlock, config.capacity);
		} else {
			[longCount, offset] = readVarint(buffer, offset);
		}
		offset = readBitArrayData(data, buffer, offset, longCount);
		return [createDirectContainer(data), offset];
	}

	// Indirect palette
	let paletteLength: number;
	[paletteLength, offset] = readVarint(buffer, offset);
	const palette: number[] = [];
	for (let i = 0; i < paletteLength; i++) {
		let entry: number;
		[entry, offset] = readVarint(buffer, offset);
		palette.push(entry);
	}

	const data = createBitArray(bitsPerBlock, config.capacity);
	let longCount: number;
	if (noArrayLength) {
		longCount = calcLongCount(bitsPerBlock, config.capacity);
	} else {
		[longCount, offset] = readVarint(buffer, offset);
	}
	offset = readBitArrayData(data, buffer, offset, longCount);

	return [
		createIndirectContainer(palette, data, config.maxBits, config.globalBits),
		offset,
	];
};

export const writePaletteContainer = (
	container: PaletteContainer,
	buffer: Buffer,
	offset: number,
	noArrayLength = false,
): number => {
	switch (container.type) {
		case "single":
			offset = buffer.writeUInt8(0, offset);
			offset = writeVarint(buffer, offset, container.value);
			if (!noArrayLength) {
				offset = buffer.writeUInt8(0, offset); // data array length = 0
			}
			return offset;

		case "indirect":
			offset = buffer.writeUInt8(container.data.bitsPerValue, offset);
			offset = writeVarint(buffer, offset, container.palette.length);
			for (const entry of container.palette) {
				offset = writeVarint(buffer, offset, entry);
			}
			if (!noArrayLength) {
				offset = writeVarint(buffer, offset, bitArrayLongCount(container.data));
			}
			offset = writeBitArrayData(container.data, buffer, offset);
			return offset;

		case "direct":
			offset = buffer.writeUInt8(container.data.bitsPerValue, offset);
			if (!noArrayLength) {
				offset = writeVarint(buffer, offset, bitArrayLongCount(container.data));
			}
			offset = writeBitArrayData(container.data, buffer, offset);
			return offset;
	}
};
