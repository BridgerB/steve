import type { BitArray } from "./bitArray.ts";
import {
	BLOCK_SECTION_VOLUME,
	GLOBAL_BITS_PER_BLOCK,
	MAX_BITS_PER_BLOCK,
	MIN_BITS_PER_BLOCK,
} from "./constants.ts";
import {
	createIndirectContainer,
	createSingleValueContainer,
	getContainerValue,
	type PaletteConfig,
	type PaletteContainer,
	readPaletteContainer,
	setContainerValue,
	writePaletteContainer,
} from "./paletteContainer.ts";

export type ChunkSection = {
	data: PaletteContainer;
	solidBlockCount: number;
	// 26.1.2 added a second section-header short (fluid block count)
	fluidCount: number;
};

const blockIndex = (x: number, y: number, z: number): number =>
	(y << 8) | (z << 4) | x;

const makeBlockConfig = (maxBitsPerBlock: number): PaletteConfig => ({
	bitsPerValue: MIN_BITS_PER_BLOCK,
	capacity: BLOCK_SECTION_VOLUME,
	maxBits: MAX_BITS_PER_BLOCK,
	globalBits: maxBitsPerBlock,
});

export const createChunkSection = (
	maxBitsPerBlock: number = GLOBAL_BITS_PER_BLOCK,
	initialValue: number = 0,
): ChunkSection => ({
	data: createSingleValueContainer(
		initialValue,
		makeBlockConfig(maxBitsPerBlock),
	),
	solidBlockCount: initialValue ? BLOCK_SECTION_VOLUME : 0,
	fluidCount: 0,
});

export const getSectionBlock = (
	section: ChunkSection,
	x: number,
	y: number,
	z: number,
): number => getContainerValue(section.data, blockIndex(x, y, z));

export const setSectionBlock = (
	section: ChunkSection,
	x: number,
	y: number,
	z: number,
	stateId: number,
): void => {
	const idx = blockIndex(x, y, z);
	const oldBlock = getContainerValue(section.data, idx);

	if (stateId === 0 && oldBlock !== 0) {
		section.solidBlockCount--;
	} else if (stateId !== 0 && oldBlock === 0) {
		section.solidBlockCount++;
	}

	section.data = setContainerValue(section.data, idx, stateId);
};

export const isSectionEmpty = (section: ChunkSection): boolean =>
	section.solidBlockCount === 0;

/** Create a section from a local palette + BitArray (anvil loading). */
export const sectionFromLocalPalette = (
	palette: number[],
	data: BitArray,
): ChunkSection => {
	const container =
		palette.length === 1
			? createSingleValueContainer(palette[0]!, {
					bitsPerValue: MIN_BITS_PER_BLOCK,
					capacity: BLOCK_SECTION_VOLUME,
					maxBits: MAX_BITS_PER_BLOCK,
					globalBits: GLOBAL_BITS_PER_BLOCK,
				})
			: createIndirectContainer(
					palette,
					data,
					MAX_BITS_PER_BLOCK,
					GLOBAL_BITS_PER_BLOCK,
				);

	let solidBlockCount = 0;
	for (let i = 0; i < BLOCK_SECTION_VOLUME; i++) {
		if (getContainerValue(container, i) !== 0) {
			solidBlockCount++;
		}
	}

	return { data: container, solidBlockCount, fluidCount: 0 };
};

/** Read a section from the network binary format. */
export const readChunkSection = (
	buffer: Buffer,
	offset: number,
	maxBitsPerBlock: number = GLOBAL_BITS_PER_BLOCK,
	noArrayLength = false,
): [ChunkSection, number] => {
	const solidBlockCount = buffer.readInt16BE(offset);
	offset += 2;
	// 26.1.2: section header is two shorts (nonEmptyBlockCount, fluidCount)
	const fluidCount = buffer.readInt16BE(offset);
	offset += 2;

	let data: PaletteContainer;
	[data, offset] = readPaletteContainer(
		buffer,
		offset,
		makeBlockConfig(maxBitsPerBlock),
		noArrayLength,
	);

	return [{ data, solidBlockCount, fluidCount }, offset];
};

/** Write a section to the network binary format. */
export const writeChunkSection = (
	section: ChunkSection,
	buffer: Buffer,
	offset: number,
	noArrayLength = false,
): number => {
	offset = buffer.writeInt16BE(section.solidBlockCount, offset);
	offset = buffer.writeInt16BE(section.fluidCount ?? 0, offset);
	offset = writePaletteContainer(section.data, buffer, offset, noArrayLength);
	return offset;
};
