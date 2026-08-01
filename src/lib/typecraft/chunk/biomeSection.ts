import type { BitArray } from "./bitArray.ts";
import {
	BIOME_SECTION_VOLUME,
	GLOBAL_BITS_PER_BIOME,
	MAX_BITS_PER_BIOME,
	MIN_BITS_PER_BIOME,
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

export type BiomeSection = {
	data: PaletteContainer;
};

const biomeIndex = (x: number, y: number, z: number): number =>
	(y << 4) | (z << 2) | x;

const BIOME_CONFIG: PaletteConfig = {
	bitsPerValue: MIN_BITS_PER_BIOME,
	capacity: BIOME_SECTION_VOLUME,
	maxBits: MAX_BITS_PER_BIOME,
	globalBits: GLOBAL_BITS_PER_BIOME,
};

export const createBiomeSection = (initialValue: number = 0): BiomeSection => ({
	data: createSingleValueContainer(initialValue, BIOME_CONFIG),
});

export const getSectionBiome = (
	section: BiomeSection,
	x: number,
	y: number,
	z: number,
): number => getContainerValue(section.data, biomeIndex(x, y, z));

export const setSectionBiome = (
	section: BiomeSection,
	x: number,
	y: number,
	z: number,
	biomeId: number,
): void => {
	section.data = setContainerValue(section.data, biomeIndex(x, y, z), biomeId);
};

/** Create a biome section from a local palette + BitArray (anvil loading). */
export const biomeSectionFromLocalPalette = (
	palette: number[],
	data: BitArray,
): BiomeSection => {
	const container =
		palette.length === 1
			? createSingleValueContainer(palette[0]!, BIOME_CONFIG)
			: createIndirectContainer(
					palette,
					data,
					MAX_BITS_PER_BIOME,
					GLOBAL_BITS_PER_BIOME,
				);

	return { data: container };
};

/** Read a biome section from the network binary format. */
export const readBiomeSection = (
	buffer: Buffer,
	offset: number,
	noArrayLength = false,
): [BiomeSection, number] => {
	let data: PaletteContainer;
	[data, offset] = readPaletteContainer(
		buffer,
		offset,
		BIOME_CONFIG,
		noArrayLength,
	);
	return [{ data }, offset];
};

/** Write a biome section to the network binary format. */
export const writeBiomeSection = (
	section: BiomeSection,
	buffer: Buffer,
	offset: number,
	noArrayLength = false,
): number => writePaletteContainer(section.data, buffer, offset, noArrayLength);
