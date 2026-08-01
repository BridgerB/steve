/**
 * Web worker entrypoint for chunk meshing.
 * Maintains a local copy of chunk data, processes dirty sections on a timer,
 * and sends geometry back to the main thread via transferable buffers.
 */

import {
	type ChunkColumn,
	getBiomeId,
	getBlockStateId,
	setBlockStateId,
} from "../chunk/index.ts";
import { createRegistry, type Registry } from "../registry/index.ts";
import type { BiomeTints, ResolvedBlockStates } from "./assets.ts";
import {
	type GetBlock,
	getSectionGeometry,
	type MesherBlock,
} from "./mesher.ts";

// ── Worker-local state ──

type WorkerWorld = {
	registry: Registry;
	columns: Map<string, ChunkColumn>;
	blockCache: Map<number, Omit<MesherBlock, "biome">>;
};

const columnKey = (x: number, z: number): string =>
	`${Math.floor(x / 16) * 16},${Math.floor(z / 16) * 16}`;

const isCube = (bb: string): boolean => bb === "block";

const createWorkerWorld = (version: string): WorkerWorld => ({
	registry: createRegistry(version),
	columns: new Map(),
	blockCache: new Map(),
});

const workerGetBlock = (world: WorkerWorld): GetBlock => {
	return (x: number, y: number, z: number): MesherBlock | null => {
		const key = columnKey(x, z);
		const column = world.columns.get(key);
		if (!column) return null;

		const lx = ((x % 16) + 16) % 16;
		const lz = ((z % 16) + 16) % 16;
		const stateId = getBlockStateId(column, lx, y, lz);

		let cached = world.blockCache.get(stateId);
		if (!cached) {
			const blockDef = world.registry.blocksByStateId.get(stateId);
			if (!blockDef) {
				cached = {
					name: "air",
					stateId,
					transparent: true,
					isCube: false,
					properties: {},
				};
			} else {
				// Compute properties from state offset
				const properties: Record<string, string> = {};
				if (blockDef.states) {
					let offset = stateId - blockDef.minStateId;
					for (let i = blockDef.states.length - 1; i >= 0; i--) {
						const state = blockDef.states[i]!;
						if (state.values) {
							const idx = offset % state.values.length;
							properties[state.name] = state.values[idx]!;
							offset = Math.floor(offset / state.values.length);
						}
					}
				}

				cached = {
					name: blockDef.name,
					stateId,
					transparent: blockDef.transparent,
					isCube: isCube(blockDef.boundingBox),
					properties,
				};
			}
			world.blockCache.set(stateId, cached);
		}

		// Attach biome per-call (varies by position)
		const biomeId = getBiomeId(column, lx, y, lz);
		const biomeDef = world.registry.biomesById.get(biomeId);

		return {
			...cached,
			biome: biomeDef?.name ?? "plains",
		};
	};
};

// ── Message handling ──

export type WorkerMessage =
	| { type: "version"; version: string }
	| { type: "blockStates"; json: ResolvedBlockStates }
	| { type: "tints"; tints: BiomeTints }
	| { type: "chunk"; x: number; z: number; sections: unknown }
	| { type: "unloadChunk"; x: number; z: number }
	| { type: "blockUpdate"; x: number; y: number; z: number; stateId: number }
	| { type: "dirty"; x: number; y: number; z: number; value: boolean }
	| { type: "reset" };

export type WorkerResponse =
	| {
			type: "geometry";
			key: string;
			geometry: {
				sx: number;
				sy: number;
				sz: number;
				positions: Float32Array;
				normals: Float32Array;
				colors: Float32Array;
				uvs: Float32Array;
				indices: Uint32Array;
			};
	  }
	| { type: "sectionFinished"; key: string };

/** Initialize the worker message handler. Call this from the worker script. */
export const initMesherWorker = (ctx: {
	onmessage: ((e: { data: WorkerMessage }) => void) | null;
	postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void;
}): void => {
	let world: WorkerWorld | null = null;
	let blockStates: ResolvedBlockStates | null = null;
	let tints: BiomeTints | null = null;
	const dirtySections = new Map<string, boolean>();

	const sectionKey = (x: number, y: number, z: number): string => {
		const sx = Math.floor(x / 16) * 16;
		const sy = Math.floor(y / 16) * 16;
		const sz = Math.floor(z / 16) * 16;
		return `${sx},${sy},${sz}`;
	};

	ctx.onmessage = ({ data: msg }) => {
		if (msg.type === "version") {
			world = createWorkerWorld(msg.version);
		} else if (msg.type === "blockStates") {
			blockStates = msg.json;
		} else if (msg.type === "tints") {
			tints = msg.tints;
		} else if (msg.type === "chunk") {
			if (!world) return;
			const key = `${msg.x},${msg.z}`;
			world.columns.set(key, msg.sections as ChunkColumn);
		} else if (msg.type === "unloadChunk") {
			if (!world) return;
			world.columns.delete(`${msg.x},${msg.z}`);
		} else if (msg.type === "blockUpdate") {
			if (!world) return;
			const key = columnKey(msg.x, msg.z);
			const column = world.columns.get(key);
			if (!column) return;
			const lx = ((msg.x % 16) + 16) % 16;
			const lz = ((msg.z % 16) + 16) % 16;
			setBlockStateId(column, lx, msg.y, lz, msg.stateId);
		} else if (msg.type === "dirty") {
			const key = sectionKey(msg.x, msg.y, msg.z);
			if (msg.value) {
				dirtySections.set(key, true);
			} else {
				dirtySections.delete(key);
				ctx.postMessage({ type: "sectionFinished", key });
			}
		} else if (msg.type === "reset") {
			world = null;
			blockStates = null;
			tints = null;
			dirtySections.clear();
		}
	};

	// Process dirty sections every 50ms
	setInterval(() => {
		if (!world || !blockStates || !tints) return;
		if (dirtySections.size === 0) return;

		const keys = [...dirtySections.keys()];
		const getBlock = workerGetBlock(world);

		for (const key of keys) {
			dirtySections.delete(key);
			const [sx, sy, sz] = key.split(",").map(Number) as [
				number,
				number,
				number,
			];

			const geometry = getSectionGeometry(
				sx,
				sy,
				sz,
				getBlock,
				blockStates,
				tints,
			);

			const transferable = [
				geometry.positions.buffer,
				geometry.normals.buffer,
				geometry.colors.buffer,
				geometry.uvs.buffer,
				geometry.indices.buffer,
			];

			ctx.postMessage({ type: "geometry", key, geometry }, transferable);
			ctx.postMessage({ type: "sectionFinished", key });
		}
	}, 50);
};
