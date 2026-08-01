import { join } from "node:path";
import type { ChunkColumn } from "../chunk/index.ts";
import type { Registry } from "../registry/index.ts";
import { chunkColumnToNbt, nbtToChunkColumn } from "./chunkNbt.ts";
import {
	closeRegionFile,
	hasChunk,
	openRegionFile,
	type RegionFile,
	readRegionChunk,
	writeRegionChunk,
} from "./region.ts";

export type AnvilWorld = {
	readonly path: string;
	readonly registry: Registry;
	readonly regions: Map<string, RegionFile>;
};

/** Open an anvil world directory for reading/writing chunks. */
export const openAnvilWorld = (
	path: string,
	registry: Registry,
): AnvilWorld => ({
	path,
	registry,
	regions: new Map(),
});

/** Load a chunk at (x, z) chunk coordinates. Returns null if not generated. */
export const loadChunk = async (
	world: AnvilWorld,
	chunkX: number,
	chunkZ: number,
): Promise<ChunkColumn | null> => {
	const region = await getRegion(world, chunkX, chunkZ);
	const localX = ((chunkX % 32) + 32) % 32;
	const localZ = ((chunkZ % 32) + 32) % 32;

	if (!hasChunk(region, localX, localZ)) return null;

	const nbtData = await readRegionChunk(region, localX, localZ);
	if (!nbtData) return null;

	return nbtToChunkColumn(nbtData, world.registry);
};

/** Save a chunk at (x, z) chunk coordinates. */
export const saveChunk = async (
	world: AnvilWorld,
	chunkX: number,
	chunkZ: number,
	column: ChunkColumn,
): Promise<void> => {
	const region = await getRegion(world, chunkX, chunkZ);
	const localX = ((chunkX % 32) + 32) % 32;
	const localZ = ((chunkZ % 32) + 32) % 32;

	const dataVersion = world.registry.version.dataVersion ?? 0;
	const nbtData = chunkColumnToNbt(
		column,
		chunkX,
		chunkZ,
		world.registry,
		dataVersion,
	);

	await writeRegionChunk(region, localX, localZ, nbtData);
};

/** Close all open region files. */
export const closeAnvilWorld = async (world: AnvilWorld): Promise<void> => {
	for (const region of world.regions.values()) {
		await closeRegionFile(region);
	}
	world.regions.clear();
};

const regionFileName = (
	worldPath: string,
	chunkX: number,
	chunkZ: number,
): string => {
	const regionX = chunkX >> 5;
	const regionZ = chunkZ >> 5;
	return join(worldPath, "region", `r.${regionX}.${regionZ}.mca`);
};

const getRegion = async (
	world: AnvilWorld,
	chunkX: number,
	chunkZ: number,
): Promise<RegionFile> => {
	const name = regionFileName(world.path, chunkX, chunkZ);
	let region = world.regions.get(name);
	if (!region) {
		region = await openRegionFile(name);
		world.regions.set(name, region);
	}
	return region;
};
