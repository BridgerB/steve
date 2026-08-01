import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import {
	nbtCompound,
	nbtInt,
	nbtLong,
	nbtString,
	parseNbt,
	simplifyNbt,
	writeUncompressedNbt,
} from "../nbt/index.ts";

const gzipAsync = promisify(gzip);

export type LevelData = {
	readonly levelName: string;
	readonly version: string;
	readonly generatorName: string;
	readonly randomSeed: [number, number];
	readonly [key: string]: unknown;
};

/** Read level.dat from a Minecraft world save. */
export const readLevelDat = async (path: string): Promise<LevelData> => {
	const content = await fs.readFile(path);
	const { parsed } = parseNbt(content);
	const data = simplifyNbt(parsed) as Record<string, unknown>;
	const levelData = data.Data as Record<string, unknown>;

	const version = levelData.Version as Record<string, unknown> | undefined;

	return {
		...levelData,
		levelName: (levelData.LevelName as string) ?? "Unknown",
		version: (version?.Name as string) ?? "unknown",
		generatorName: (levelData.generatorName as string) ?? "default",
		randomSeed: (levelData.RandomSeed as [number, number]) ?? [0, 0],
	};
};

/** Write a level.dat file. */
export const writeLevelDat = async (
	path: string,
	data: LevelData,
): Promise<void> => {
	const root = nbtCompound(
		{
			Data: nbtCompound({
				Version: nbtCompound({
					Name: nbtString(data.version),
				}),
				LevelName: nbtString(data.levelName),
				generatorName: nbtString(data.generatorName),
				version: nbtInt(19133),
				RandomSeed: nbtLong(data.randomSeed),
			}),
		},
		"",
	);

	const uncompressed = writeUncompressedNbt(root);
	const compressed = await gzipAsync(uncompressed);
	await fs.writeFile(path, compressed);
};
