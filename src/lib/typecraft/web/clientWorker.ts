/**
 * Browser web worker for chunk meshing.
 * Unlike the Node.js workerEntry, this receives registry data (blocks, biomes)
 * via postMessage instead of calling createRegistry (which requires src/data/).
 */

import {
	type ChunkColumn,
	getBiomeId,
	getBlockStateId,
	setBlockStateId,
} from "../chunk/index.ts";
import type { BiomeTints, ResolvedBlockStates } from "../viewer/assets.ts";
import {
	type GetBlock,
	getSectionGeometry,
	type MesherBlock,
} from "../viewer/mesher.ts";

// ── Types ──

type BlockDef = {
	readonly name: string;
	readonly transparent: boolean;
	readonly boundingBox: string;
	readonly minStateId: number;
	readonly states?: readonly {
		readonly name: string;
		readonly values?: readonly string[];
	}[];
};

type BiomeDef = {
	readonly id: number;
	readonly name: string;
};

type WorkerWorld = {
	blocksByStateId: Map<number, BlockDef>;
	biomesById: Map<number, BiomeDef>;
	columns: Map<string, ChunkColumn>;
	blockCache: Map<number, Omit<MesherBlock, "biome">>;
};

type WorkerMessage =
	| { type: "registryData"; blocks: BlockDef[]; biomes: BiomeDef[] }
	| { type: "blockStates"; json: ResolvedBlockStates }
	| { type: "tints"; tints: BiomeTints }
	| { type: "chunk"; x: number; z: number; sections: unknown }
	| { type: "unloadChunk"; x: number; z: number }
	| { type: "blockUpdate"; x: number; y: number; z: number; stateId: number }
	| { type: "dirty"; x: number; y: number; z: number; value: boolean }
	| { type: "reset" };

type WorkerResponse =
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

// ── Helpers ──

const columnKey = (x: number, z: number): string =>
	`${Math.floor(x / 16) * 16},${Math.floor(z / 16) * 16}`;

const isCube = (bb: string): boolean => bb === "block";

const sectionKey = (x: number, y: number, z: number): string => {
	const sx = Math.floor(x / 16) * 16;
	const sy = Math.floor(y / 16) * 16;
	const sz = Math.floor(z / 16) * 16;
	return `${sx},${sy},${sz}`;
};

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
			const blockDef = world.blocksByStateId.get(stateId);
			if (!blockDef) {
				cached = {
					name: "air",
					stateId,
					transparent: true,
					isCube: false,
					properties: {},
				};
			} else {
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

		const biomeId = getBiomeId(column, lx, y, lz);
		const biomeDef = world.biomesById.get(biomeId);

		return { ...cached, biome: biomeDef?.name ?? "plains" };
	};
};

// ── Message handler ──

const ctx = self as unknown as {
	onmessage: ((e: { data: WorkerMessage }) => void) | null;
	postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void;
};

let world: WorkerWorld | null = null;
let blockStates: ResolvedBlockStates | null = null;
let tints: BiomeTints | null = null;
const dirtySections = new Map<string, boolean>();

ctx.onmessage = ({ data: msg }) => {
	if (msg.type === "registryData") {
		const blocksByStateId = new Map<number, BlockDef>();
		for (const block of msg.blocks) {
			const maxState = block.states
				? block.states.reduce((n, s) => n * (s.values?.length ?? 1), 1)
				: 1;
			for (let i = 0; i < maxState; i++) {
				blocksByStateId.set(block.minStateId + i, block);
			}
		}
		const biomesById = new Map<number, BiomeDef>();
		for (const biome of msg.biomes) {
			biomesById.set(biome.id, biome);
		}
		world = {
			blocksByStateId,
			biomesById,
			columns: new Map(),
			blockCache: new Map(),
		};
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
		const [sx, sy, sz] = key.split(",").map(Number) as [number, number, number];

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
