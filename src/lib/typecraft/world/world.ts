import { loadChunk, saveChunk } from "../anvil/anvil.ts";
import type { AnvilWorld } from "../anvil/index.ts";
import {
	type BlockInfo,
	getBlock as chunkGetBlock,
	setBlock as chunkSetBlock,
} from "../block.ts";
import {
	type ChunkColumn,
	getBiomeId,
	getBlockLight,
	getBlockStateId,
	getSkyLight,
	setBiomeId,
	setBlockLight,
	setBlockStateId,
	setSkyLight,
} from "../chunk/index.ts";
import type { Registry } from "../registry/index.ts";
import type { Vec3 } from "../vec3/index.ts";

// ── Types ──

export type ChunkProvider = {
	readonly load: (
		chunkX: number,
		chunkZ: number,
	) => Promise<ChunkColumn | null>;
	readonly save: (
		chunkX: number,
		chunkZ: number,
		column: ChunkColumn,
	) => Promise<void>;
};

export type ChunkGenerator = (chunkX: number, chunkZ: number) => ChunkColumn;

export type WorldOptions = {
	readonly provider?: ChunkProvider;
	readonly generator?: ChunkGenerator;
	readonly savingIntervalMs?: number;
};

type WorldEventMap = {
	blockUpdate: [pos: Vec3, oldStateId: number, newStateId: number];
	chunkColumnLoad: [chunkX: number, chunkZ: number];
	chunkColumnUnload: [chunkX: number, chunkZ: number];
};

type EventCallback<K extends keyof WorldEventMap> = (
	...args: WorldEventMap[K]
) => void;

export type World = {
	readonly columns: Map<string, ChunkColumn>;
	readonly registry: Registry;
	readonly provider: ChunkProvider | null;
	readonly generator: ChunkGenerator | null;
	readonly savingQueue: Set<string>;
	readonly listeners: {
		[K in keyof WorldEventMap]: EventCallback<K>[];
	};
	autoSaveTimer: ReturnType<typeof setInterval> | null;
};

// ── Coordinate helpers ──

const toChunkX = (x: number): number => Math.floor(x) >> 4;
const toChunkZ = (z: number): number => Math.floor(z) >> 4;
const toLocalX = (x: number): number => ((Math.floor(x) % 16) + 16) % 16;
const toLocalZ = (z: number): number => ((Math.floor(z) % 16) + 16) % 16;
const columnKey = (cx: number, cz: number): string => `${cx},${cz}`;

// ── Events ──

const emit = <K extends keyof WorldEventMap>(
	world: World,
	event: K,
	...args: WorldEventMap[K]
): void => {
	for (const cb of world.listeners[event]) {
		(cb as (...a: unknown[]) => void)(...args);
	}
};

export const onWorldEvent = <K extends keyof WorldEventMap>(
	world: World,
	event: K,
	callback: EventCallback<K>,
): void => {
	world.listeners[event].push(callback);
};

export const offWorldEvent = <K extends keyof WorldEventMap>(
	world: World,
	event: K,
	callback: EventCallback<K>,
): void => {
	const arr = world.listeners[event];
	const idx = arr.indexOf(callback);
	if (idx >= 0) arr.splice(idx, 1);
};

// ── Lifecycle ──

export const createWorld = (
	registry: Registry,
	options: WorldOptions = {},
): World => {
	const world: World = {
		columns: new Map(),
		registry,
		provider: options.provider ?? null,
		generator: options.generator ?? null,
		savingQueue: new Set(),
		listeners: {
			blockUpdate: [],
			chunkColumnLoad: [],
			chunkColumnUnload: [],
		},
		autoSaveTimer: null,
	};

	if (options.savingIntervalMs && options.savingIntervalMs > 0) {
		startAutoSave(world, options.savingIntervalMs);
	}

	return world;
};

export const closeWorld = async (world: World): Promise<void> => {
	stopAutoSave(world);
	await saveAll(world);
};

// ── Column management ──

/** Load a chunk, from memory, provider, or generator. */
export const getColumn = async (
	world: World,
	chunkX: number,
	chunkZ: number,
): Promise<ChunkColumn | null> => {
	const key = columnKey(chunkX, chunkZ);
	const existing = world.columns.get(key);
	if (existing) return existing;

	let column: ChunkColumn | null = null;

	if (world.provider) {
		column = await world.provider.load(chunkX, chunkZ);
	}

	if (!column && world.generator) {
		column = world.generator(chunkX, chunkZ);
	}

	if (column) {
		setColumn(world, chunkX, chunkZ, column);
	}

	return column;
};

/** Get a column only if already loaded. */
export const getLoadedColumn = (
	world: World,
	chunkX: number,
	chunkZ: number,
): ChunkColumn | null => world.columns.get(columnKey(chunkX, chunkZ)) ?? null;

/** Register a column in memory. */
export const setColumn = (
	world: World,
	chunkX: number,
	chunkZ: number,
	column: ChunkColumn,
): void => {
	world.columns.set(columnKey(chunkX, chunkZ), column);
	emit(world, "chunkColumnLoad", chunkX, chunkZ);
};

/** Save (if provider exists) and unload a column. */
export const unloadColumn = async (
	world: World,
	chunkX: number,
	chunkZ: number,
): Promise<void> => {
	const key = columnKey(chunkX, chunkZ);
	const column = world.columns.get(key);
	if (!column) return;

	if (world.provider && world.savingQueue.has(key)) {
		await world.provider.save(chunkX, chunkZ, column);
		world.savingQueue.delete(key);
	}

	world.columns.delete(key);
	emit(world, "chunkColumnUnload", chunkX, chunkZ);
};

/** List all loaded columns. */
export const getLoadedColumns = (
	world: World,
): { chunkX: number; chunkZ: number; column: ChunkColumn }[] => {
	const result: { chunkX: number; chunkZ: number; column: ChunkColumn }[] = [];
	for (const [key, column] of world.columns) {
		const [cx, cz] = key.split(",").map(Number) as [number, number];
		result.push({ chunkX: cx, chunkZ: cz, column });
	}
	return result;
};

// ── Block access (world coordinates) ──

const getColumnAt = (world: World, pos: Vec3): ChunkColumn | null =>
	getLoadedColumn(world, toChunkX(pos.x), toChunkZ(pos.z));

export const worldGetBlockStateId = (
	world: World,
	pos: Vec3,
): number | null => {
	const col = getColumnAt(world, pos);
	if (!col) return null;
	return getBlockStateId(
		col,
		toLocalX(pos.x),
		Math.floor(pos.y),
		toLocalZ(pos.z),
	);
};

export const worldSetBlockStateId = (
	world: World,
	pos: Vec3,
	stateId: number,
): void => {
	const col = getColumnAt(world, pos);
	if (!col) return;
	const lx = toLocalX(pos.x);
	const y = Math.floor(pos.y);
	const lz = toLocalZ(pos.z);
	const oldStateId = getBlockStateId(col, lx, y, lz);
	setBlockStateId(col, lx, y, lz, stateId);
	queueSave(world, toChunkX(pos.x), toChunkZ(pos.z));
	emit(world, "blockUpdate", pos, oldStateId, stateId);
};

export const worldGetBlock = (world: World, pos: Vec3): BlockInfo | null => {
	const col = getColumnAt(world, pos);
	if (!col) return null;
	return chunkGetBlock(
		col,
		toLocalX(pos.x),
		Math.floor(pos.y),
		toLocalZ(pos.z),
		world.registry,
	);
};

export const worldSetBlock = (
	world: World,
	pos: Vec3,
	name: string,
	properties?: Readonly<Record<string, string>>,
): void => {
	const col = getColumnAt(world, pos);
	if (!col) return;
	const lx = toLocalX(pos.x);
	const y = Math.floor(pos.y);
	const lz = toLocalZ(pos.z);
	const oldStateId = getBlockStateId(col, lx, y, lz);
	chunkSetBlock(col, lx, y, lz, world.registry, name, properties);
	const newStateId = getBlockStateId(col, lx, y, lz);
	queueSave(world, toChunkX(pos.x), toChunkZ(pos.z));
	emit(world, "blockUpdate", pos, oldStateId, newStateId);
};

// ── Light access (world coordinates) ──

export const worldGetBlockLight = (world: World, pos: Vec3): number | null => {
	const col = getColumnAt(world, pos);
	if (!col) return null;
	return getBlockLight(
		col,
		toLocalX(pos.x),
		Math.floor(pos.y),
		toLocalZ(pos.z),
	);
};

export const worldSetBlockLight = (
	world: World,
	pos: Vec3,
	light: number,
): void => {
	const col = getColumnAt(world, pos);
	if (!col) return;
	setBlockLight(
		col,
		toLocalX(pos.x),
		Math.floor(pos.y),
		toLocalZ(pos.z),
		light,
	);
	queueSave(world, toChunkX(pos.x), toChunkZ(pos.z));
};

export const worldGetSkyLight = (world: World, pos: Vec3): number | null => {
	const col = getColumnAt(world, pos);
	if (!col) return null;
	return getSkyLight(col, toLocalX(pos.x), Math.floor(pos.y), toLocalZ(pos.z));
};

export const worldSetSkyLight = (
	world: World,
	pos: Vec3,
	light: number,
): void => {
	const col = getColumnAt(world, pos);
	if (!col) return;
	setSkyLight(col, toLocalX(pos.x), Math.floor(pos.y), toLocalZ(pos.z), light);
	queueSave(world, toChunkX(pos.x), toChunkZ(pos.z));
};

// ── Biome access (world coordinates) ──

export const worldGetBiomeId = (world: World, pos: Vec3): number | null => {
	const col = getColumnAt(world, pos);
	if (!col) return null;
	return getBiomeId(col, toLocalX(pos.x), Math.floor(pos.y), toLocalZ(pos.z));
};

export const worldSetBiomeId = (
	world: World,
	pos: Vec3,
	biomeId: number,
): void => {
	const col = getColumnAt(world, pos);
	if (!col) return;
	setBiomeId(col, toLocalX(pos.x), Math.floor(pos.y), toLocalZ(pos.z), biomeId);
	queueSave(world, toChunkX(pos.x), toChunkZ(pos.z));
};

// ── Saving ──

const queueSave = (world: World, chunkX: number, chunkZ: number): void => {
	if (world.provider) {
		world.savingQueue.add(columnKey(chunkX, chunkZ));
	}
};

export const saveColumn = async (
	world: World,
	chunkX: number,
	chunkZ: number,
): Promise<void> => {
	if (!world.provider) return;
	const key = columnKey(chunkX, chunkZ);
	const column = world.columns.get(key);
	if (!column) return;
	await world.provider.save(chunkX, chunkZ, column);
	world.savingQueue.delete(key);
};

export const saveAll = async (world: World): Promise<void> => {
	if (!world.provider) return;
	const keys = [...world.savingQueue];
	for (const key of keys) {
		const column = world.columns.get(key);
		if (column) {
			const [cx, cz] = key.split(",").map(Number) as [number, number];
			await world.provider.save(cx, cz, column);
		}
	}
	world.savingQueue.clear();
};

export const startAutoSave = (world: World, intervalMs: number): void => {
	stopAutoSave(world);
	world.autoSaveTimer = setInterval(() => {
		saveAll(world);
	}, intervalMs);
};

export const stopAutoSave = (world: World): void => {
	if (world.autoSaveTimer) {
		clearInterval(world.autoSaveTimer);
		world.autoSaveTimer = null;
	}
};

// ── Anvil provider adapter ──

/** Wrap an AnvilWorld as a ChunkProvider for use with createWorld. */
export const anvilProvider = (anvilWorld: AnvilWorld): ChunkProvider => ({
	load: (chunkX, chunkZ) => loadChunk(anvilWorld, chunkX, chunkZ),
	save: (chunkX, chunkZ, column) =>
		saveChunk(anvilWorld, chunkX, chunkZ, column),
});
