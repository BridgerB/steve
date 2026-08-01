/**
 * World renderer — manages section meshes in a Babylon.js scene.
 * Dispatches meshing to a pool of web workers and handles dirty section tracking.
 */

import {
	Color3,
	Mesh,
	RawTexture,
	type Scene,
	StandardMaterial,
	Texture,
	VertexData,
} from "@babylonjs/core";
import type { Vec3 } from "../vec3/index.ts";
import type {
	BiomeTints,
	ResolvedBlockStates,
	TextureAtlas,
} from "./assets.ts";
import type { WorkerMessage, WorkerResponse } from "./workerEntry.ts";

// ── Types ──

export type WorldRenderer = {
	readonly scene: Scene;
	readonly material: StandardMaterial;
	readonly sectionMeshes: Map<string, Mesh>;
	readonly workers: Worker[];
	readonly loadedChunks: Set<string>;
	readonly sectionsOutstanding: Set<string>;
	readonly onRenderUpdate: Set<() => void>;
};

// ── Helpers ──

const mod = (x: number, n: number): number => ((x % n) + n) % n;

const expandRGBtoRGBA = (rgb: Float32Array): Float32Array => {
	const count = rgb.length / 3;
	const rgba = new Float32Array(count * 4);
	for (let i = 0; i < count; i++) {
		rgba[i * 4] = rgb[i * 3]!;
		rgba[i * 4 + 1] = rgb[i * 3 + 1]!;
		rgba[i * 4 + 2] = rgb[i * 3 + 2]!;
		rgba[i * 4 + 3] = 1.0;
	}
	return rgba;
};

// ── Lifecycle ──

export const createWorldRenderer = (
	scene: Scene,
	workerUrl: string | URL,
	numWorkers = 4,
): WorldRenderer => {
	const material = new StandardMaterial("terrain", scene);
	material.specularColor = Color3.Black();
	// The bot's first-person camera frequently sits inside/against terrain as it
	// tunnels; a culled back-face would let you see straight through the wall the
	// camera is embedded in. Render both sides so walls stay solid from any position.
	material.backFaceCulling = false;

	const sectionMeshes = new Map<string, Mesh>();
	const loadedChunks = new Set<string>();
	const sectionsOutstanding = new Set<string>();
	const onRenderUpdate = new Set<() => void>();
	const workers: Worker[] = [];

	for (let i = 0; i < numWorkers; i++) {
		const worker = new Worker(workerUrl, { type: "module" });

		worker.onmessage = ({ data }: { data: WorkerResponse }) => {
			if (data.type === "geometry") {
				const existing = sectionMeshes.get(data.key);
				if (existing) {
					existing.dispose();
					sectionMeshes.delete(data.key);
				}

				const [sx, , sz] = data.key.split(",").map(Number) as [
					number,
					number,
					number,
				];
				const chunkKey = `${Math.floor(sx / 16)},${Math.floor(sz / 16)}`;
				if (!loadedChunks.has(chunkKey)) return;

				const geo = data.geometry;
				if (geo.positions.length === 0) return;

				const vertexData = new VertexData();
				vertexData.positions = geo.positions;
				vertexData.normals = geo.normals;
				vertexData.uvs = geo.uvs;
				vertexData.colors = expandRGBtoRGBA(geo.colors);
				vertexData.indices = geo.indices;

				const mesh = new Mesh(`section_${data.key}`, scene);
				mesh.sideOrientation = Mesh.FRONTSIDE;
				vertexData.applyToMesh(mesh);
				mesh.material = material;
				mesh.position.set(geo.sx, geo.sy, geo.sz);
				mesh.freezeWorldMatrix();
				sectionMeshes.set(data.key, mesh);
			} else if (data.type === "sectionFinished") {
				sectionsOutstanding.delete(data.key);
				for (const cb of onRenderUpdate) cb();
			}
		};

		workers.push(worker);
	}

	return {
		scene,
		material,
		sectionMeshes,
		workers,
		loadedChunks,
		sectionsOutstanding,
		onRenderUpdate,
	};
};

// ── Version initialization ──

export const setWorldRendererVersion = (
	wr: WorldRenderer,
	version: string,
): void => {
	resetWorldRenderer(wr);
	for (const worker of wr.workers) {
		worker.postMessage({ type: "version", version } satisfies WorkerMessage);
	}
};

export const setWorldRendererBlockStates = (
	wr: WorldRenderer,
	blockStates: ResolvedBlockStates,
): void => {
	for (const worker of wr.workers) {
		worker.postMessage({
			type: "blockStates",
			json: blockStates,
		} satisfies WorkerMessage);
	}
};

export const setWorldRendererTints = (
	wr: WorldRenderer,
	tints: BiomeTints,
): void => {
	for (const worker of wr.workers) {
		worker.postMessage({ type: "tints", tints } satisfies WorkerMessage);
	}
};

export const setWorldRendererTexture = (
	wr: WorldRenderer,
	atlas: TextureAtlas,
): void => {
	const ctx = (atlas.canvas as OffscreenCanvas).getContext("2d")!;
	const imageData = ctx.getImageData(
		0,
		0,
		atlas.canvas.width,
		atlas.canvas.height,
	);
	const texture = RawTexture.CreateRGBATexture(
		imageData.data,
		atlas.canvas.width,
		atlas.canvas.height,
		wr.scene,
		false,
		false,
		Texture.NEAREST_SAMPLINGMODE,
	);
	texture.hasAlpha = true;
	wr.material.diffuseTexture = texture;
	wr.material.useAlphaFromDiffuseTexture = true;
	wr.material.transparencyMode = 1; // MATERIAL_ALPHATEST
};

// ── Column management ──

export const addRendererColumn = (
	wr: WorldRenderer,
	chunkX: number,
	chunkZ: number,
	chunkData: unknown,
	minY: number,
	worldHeight: number,
): void => {
	const key = `${chunkX},${chunkZ}`;
	wr.loadedChunks.add(key);

	for (const worker of wr.workers) {
		worker.postMessage({
			type: "chunk",
			x: chunkX * 16,
			z: chunkZ * 16,
			sections: chunkData,
		} satisfies WorkerMessage);
	}

	for (let y = minY; y < minY + worldHeight; y += 16) {
		const loc = { x: chunkX * 16, y, z: chunkZ * 16 };
		setSectionDirty(wr, loc.x, loc.y, loc.z);
		setSectionDirty(wr, loc.x - 16, loc.y, loc.z);
		setSectionDirty(wr, loc.x + 16, loc.y, loc.z);
		setSectionDirty(wr, loc.x, loc.y, loc.z - 16);
		setSectionDirty(wr, loc.x, loc.y, loc.z + 16);
	}
};

export const removeRendererColumn = (
	wr: WorldRenderer,
	chunkX: number,
	chunkZ: number,
): void => {
	const key = `${chunkX},${chunkZ}`;
	wr.loadedChunks.delete(key);

	for (const worker of wr.workers) {
		worker.postMessage({
			type: "unloadChunk",
			x: chunkX * 16,
			z: chunkZ * 16,
		} satisfies WorkerMessage);
	}

	for (const [meshKey, mesh] of wr.sectionMeshes) {
		const [sx, , sz] = meshKey.split(",").map(Number) as [
			number,
			number,
			number,
		];
		if (Math.floor(sx / 16) === chunkX && Math.floor(sz / 16) === chunkZ) {
			mesh.dispose();
			wr.sectionMeshes.delete(meshKey);
		}
	}
};

// ── Block updates ──

export const setRendererBlockStateId = (
	wr: WorldRenderer,
	pos: Vec3,
	stateId: number,
): void => {
	for (const worker of wr.workers) {
		worker.postMessage({
			type: "blockUpdate",
			x: pos.x,
			y: pos.y,
			z: pos.z,
			stateId,
		} satisfies WorkerMessage);
	}

	setSectionDirty(wr, pos.x, pos.y, pos.z);
	if ((pos.x & 15) === 0) setSectionDirty(wr, pos.x - 16, pos.y, pos.z);
	if ((pos.x & 15) === 15) setSectionDirty(wr, pos.x + 16, pos.y, pos.z);
	if ((pos.y & 15) === 0) setSectionDirty(wr, pos.x, pos.y - 16, pos.z);
	if ((pos.y & 15) === 15) setSectionDirty(wr, pos.x, pos.y + 16, pos.z);
	if ((pos.z & 15) === 0) setSectionDirty(wr, pos.x, pos.y, pos.z - 16);
	if ((pos.z & 15) === 15) setSectionDirty(wr, pos.x, pos.y, pos.z + 16);
};

// ── Dirty section dispatch ──

const setSectionDirty = (
	wr: WorldRenderer,
	x: number,
	y: number,
	z: number,
	value = true,
): void => {
	const sx = Math.floor(x / 16);
	const sy = Math.floor(y / 16);
	const sz = Math.floor(z / 16);
	const hash = mod(sx + sy + sz, wr.workers.length);
	const key = `${sx * 16},${sy * 16},${sz * 16}`;

	wr.workers[hash]!.postMessage({
		type: "dirty",
		x,
		y,
		z,
		value,
	} satisfies WorkerMessage);
	if (value) wr.sectionsOutstanding.add(key);
};

// ── Wait for rendering ──

export const waitForRender = (wr: WorldRenderer): Promise<void> =>
	new Promise((resolve) => {
		if (wr.sectionsOutstanding.size === 0) {
			resolve();
			return;
		}

		const handler = () => {
			if (wr.sectionsOutstanding.size === 0) {
				wr.onRenderUpdate.delete(handler);
				resolve();
			}
		};
		wr.onRenderUpdate.add(handler);
	});

// ── Cleanup ──

export const resetWorldRenderer = (wr: WorldRenderer): void => {
	for (const mesh of wr.sectionMeshes.values()) {
		mesh.dispose();
	}
	wr.sectionMeshes.clear();
	wr.loadedChunks.clear();
	wr.sectionsOutstanding.clear();

	for (const worker of wr.workers) {
		worker.postMessage({ type: "reset" } satisfies WorkerMessage);
	}
};

export const disposeWorldRenderer = (wr: WorldRenderer): void => {
	resetWorldRenderer(wr);
	for (const worker of wr.workers) {
		worker.terminate();
	}
	wr.workers.length = 0;
	wr.material.dispose();
};
