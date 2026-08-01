export const SECTION_WIDTH = 16;
export const SECTION_HEIGHT = 16;
export const BLOCK_SECTION_VOLUME =
	SECTION_WIDTH * SECTION_WIDTH * SECTION_HEIGHT;
export const BIOME_SECTION_VOLUME = (BLOCK_SECTION_VOLUME / (4 * 4 * 4)) | 0; // 64

export const MIN_BITS_PER_BLOCK = 4;
export const MAX_BITS_PER_BLOCK = 8;
export const GLOBAL_BITS_PER_BLOCK = 16;

export const MIN_BITS_PER_BIOME = 1;
export const MAX_BITS_PER_BIOME = 3;
export const GLOBAL_BITS_PER_BIOME = 6;
