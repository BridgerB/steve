/**
 * Embeddable viewer entry. Same streaming/render logic as client.ts, but
 * mountable into an ARBITRARY canvas and connecting to an ARBITRARY WebSocket
 * URL — so many independent bot views can live on one page (eye-of-steve's
 * 300px per-bot windows). Each call is its own viewer (own WS, own Babylon
 * engine, own render loop). Returns a cleanup function.
 *
 * Built by scripts/build-web.ts → dist/web/viewer.js, then copied into
 * eye-of-steve/static/web/. Block textures/models/tints arrive over the WS
 * `assets` message, so no extra static assets are needed.
 */

import {
	createChunkColumn,
	GLOBAL_BITS_PER_BIOME,
	GLOBAL_BITS_PER_BLOCK,
	loadChunkColumn,
} from "../chunk/index.ts";
import { vec3 } from "../vec3/index.ts";
import {
	type BiomeTints,
	createTextureAtlas,
	prepareBlockStates,
} from "../viewer/assets.ts";
import {
	type EntityModelDef,
	setEntityModels,
	updateEntityEquipment,
} from "../viewer/entityRenderer.ts";
import {
	addViewerColumn,
	addViewerEntity,
	clearViewerEntities,
	createViewer,
	removeViewerColumn,
	removeViewerEntity,
	renderViewer,
	resizeViewer,
	setViewerAssets,
	setViewerBlockStateId,
	setViewerCamera,
	setViewerPath,
	setViewerTime,
	updateViewerEntity,
	type Viewer,
} from "../viewer/viewer.ts";

// ── WS message types (mirror serve.ts output) ──

type BlockDef = {
	name: string;
	transparent: boolean;
	boundingBox: string;
	minStateId: number;
	states?: { name: string; values?: string[] }[];
};
type BiomeDef = { id: number; name: string };
type InitMessage = { type: "init"; version: string; minY: number; height: number };
type SerializedTints = {
	grass: Record<string, readonly [number, number, number]>;
	foliage: Record<string, readonly [number, number, number]>;
	water: Record<string, readonly [number, number, number]>;
	redstone: Record<string, readonly [number, number, number]>;
	constant: Record<string, readonly [number, number, number]>;
	grassDefault: readonly [number, number, number];
	foliageDefault: readonly [number, number, number];
	waterDefault: readonly [number, number, number];
};
type AssetsMessage = {
	type: "assets";
	blockStates: Record<string, unknown>;
	blockModels: Record<string, unknown>;
	blockEntityShapes: Record<string, unknown>;
	entitySheets?: { name: string; width: number; height: number }[];
	entitySheetData?: Record<string, string>;
	textureNames: string[];
	textureData: Record<string, string>;
	tints: SerializedTints;
	blocks: BlockDef[];
	biomes: BiomeDef[];
	entityModels: Record<
		string,
		{ texturewidth: number; textureheight: number; bones: unknown[] }
	>;
};
type PositionMessage = { type: "position"; x: number; y: number; z: number; yaw: number; pitch: number };
type ChunkMessage = { type: "chunk"; x: number; z: number; buf: string };
type UnloadChunkMessage = { type: "unloadChunk"; x: number; z: number };
type BlockUpdateMessage = { type: "blockUpdate"; x: number; y: number; z: number; stateId: number };
type TimeMessage = { type: "time"; time: number };
type EntitySpawnMessage = {
	type: "entitySpawn";
	id: number;
	entityName: string;
	username: string | null;
	skinUrl?: string;
	x: number;
	y: number;
	z: number;
	yaw: number;
};
type EntityMoveMessage = { type: "entityMove"; id: number; x: number; y: number; z: number; yaw: number };
type EntityGoneMessage = { type: "entityGone"; id: number };
type EntityEquipMessage = { type: "entityEquip"; id: number; slot: number; itemName: string | null };
type PathMessage = {
	type: "path";
	points: {
		x: number;
		y: number;
		z: number;
		dig?: boolean;
		place?: boolean;
		jump?: boolean;
	}[];
	breaks?: { x: number; y: number; z: number }[];
	places?: { x: number; y: number; z: number }[];
};

type ServerMessage =
	| InitMessage
	| AssetsMessage
	| PositionMessage
	| ChunkMessage
	| UnloadChunkMessage
	| BlockUpdateMessage
	| TimeMessage
	| EntitySpawnMessage
	| EntityMoveMessage
	| EntityGoneMessage
	| EntityEquipMessage
	| PathMessage;

// ── pure asset helpers (copied from client.ts) ──

const objToMap = (
	obj: Record<string, readonly [number, number, number]>,
): Map<string, readonly [number, number, number]> => {
	const m = new Map<string, readonly [number, number, number]>();
	for (const [k, v] of Object.entries(obj)) m.set(k, v);
	return m;
};

const deserializeTints = (raw: SerializedTints): BiomeTints => ({
	grass: objToMap(raw.grass),
	foliage: objToMap(raw.foliage),
	water: objToMap(raw.water),
	redstone: objToMap(raw.redstone),
	constant: objToMap(raw.constant),
	grassDefault: raw.grassDefault,
	foliageDefault: raw.foliageDefault,
	waterDefault: raw.waterDefault,
});

const decodeTextures = async (
	textureNames: string[],
	textureData: Record<string, string>,
): Promise<Map<string, ImageBitmap>> => {
	const images = new Map<string, ImageBitmap>();
	const BATCH = 50;
	const entries = textureNames.filter((n) => textureData[n]);
	for (let i = 0; i < entries.length; i += BATCH) {
		const batch = entries.slice(i, i + BATCH);
		await Promise.all(
			batch.map((name) =>
				fetch(`data:image/png;base64,${textureData[name]}`)
					.then((r) => r.blob())
					.then((blob) => createImageBitmap(blob))
					.then((bmp) => {
						images.set(name, bmp);
					})
					.catch(() => {}),
			),
		);
	}
	return images;
};

export type LiveState = {
	type: "state";
	health: number | null;
	food: number | null;
	x: number;
	y: number;
	z: number;
	yaw: number;
	time: number;
	held: string | null;
	window: {
		kind: string;
		n: number;
		slots: { s: number; n: string; c: number }[];
		open?: boolean;
		sel?: number;
	} | null;
	steve: {
		step: number;
		done: number[];
		phase: string;
		progress: number;
	} | null;
};

export type MountOptions = {
	workerUrl?: string;
	/** Live dashboard state pushed ~2×/s (vitals, inventory, run status). */
	onState?: (state: LiveState) => void;
	/** Bot pose on every move (fast) — for a snappy compass etc. */
	onPose?: (pose: { x: number; y: number; z: number; yaw: number; pitch: number }) => void;
	/** Bot swung its arm (digging/attacking) — for a first-person swing animation. */
	onSwing?: () => void;
};

/**
 * Mount a live bot viewer into `canvas`, streaming from `wsUrl`. Returns a
 * disposer that closes the socket and stops the render loop.
 */
export function mountViewer(
	canvas: HTMLCanvasElement,
	wsUrl: string,
	opts: MountOptions = {},
): () => void {
	const workerUrl = opts.workerUrl ?? "/web/worker.js";

	let viewer: Viewer | null = null;
	let assetsReady = false;
	let minY = -64;
	let worldHeight = 384;
	let chunkCount = 0;
	const pendingMessages: ServerMessage[] = [];
	let es: EventSource | null = null;
	let closed = false;
	let raf = 0;

	const sizeCanvas = () => {
		const w = canvas.clientWidth || 300;
		const h = canvas.clientHeight || 200;
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
			if (viewer) resizeViewer(viewer, w, h);
		}
	};

	const processMessage = (msg: ServerMessage): void => {
		if (!viewer) return;
		if (msg.type === "position") {
			setViewerCamera(viewer, vec3(msg.x, msg.y, msg.z), msg.yaw, msg.pitch);
			opts.onPose?.({ x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch });
		} else if (msg.type === "chunk") {
			const raw = Buffer.from(msg.buf, "base64");
			const col = createChunkColumn({
				minY,
				worldHeight,
				maxBitsPerBlock: GLOBAL_BITS_PER_BLOCK,
				maxBitsPerBiome: GLOBAL_BITS_PER_BIOME,
			});
			loadChunkColumn(col, raw, true);
			addViewerColumn(viewer, msg.x, msg.z, col, minY, worldHeight);
			chunkCount++;
		} else if (msg.type === "unloadChunk") {
			removeViewerColumn(viewer, msg.x, msg.z);
			chunkCount--;
		} else if (msg.type === "blockUpdate") {
			setViewerBlockStateId(viewer, vec3(msg.x, msg.y, msg.z), msg.stateId);
		} else if (msg.type === "time") {
			setViewerTime(viewer, msg.time);
		} else if (msg.type === "entitySpawn") {
			addViewerEntity(
				viewer,
				msg.id,
				msg.entityName ?? "player",
				msg.username,
				msg.x,
				msg.y,
				msg.z,
				msg.yaw,
				msg.skinUrl,
			);
		} else if (msg.type === "entityMove") {
			updateViewerEntity(viewer, msg.id, msg.x, msg.y, msg.z, msg.yaw);
		} else if (msg.type === "entityGone") {
			removeViewerEntity(viewer, msg.id);
		} else if (msg.type === "entityEquip") {
			updateEntityEquipment(viewer.entityRenderer, msg.id, msg.slot, msg.itemName);
		} else if (msg.type === "path") {
			setViewerPath(viewer, msg.points, msg.breaks ?? [], msg.places ?? []);
		}
	};

	const connect = () => {
		if (closed) return;
		// One-directional SSE stream (server → browser). EventSource auto-reconnects;
		// the server replays init/assets/chunks on each (re)open, so reset on open.
		es = new EventSource(wsUrl);

		es.onopen = () => {
			assetsReady = false;
			chunkCount = 0;
			pendingMessages.length = 0;
			if (viewer) clearViewerEntities(viewer);
		};

		es.onmessage = async (event) => {
			const msg: ServerMessage = JSON.parse(event.data as string);
			if ((msg as { type: string }).type === "state") {
				opts.onState?.(msg as unknown as LiveState);
				return;
			}
			if ((msg as { type: string }).type === "swing") {
				opts.onSwing?.();
				return;
			}
			if (msg.type === "init") {
				minY = msg.minY;
				worldHeight = msg.height;
				if (!viewer) {
					sizeCanvas();
					viewer = createViewer(canvas, { workerUrl });
				}
			} else if (msg.type === "assets") {
				if (!viewer) return;
				try {
					const images = await decodeTextures(msg.textureNames, msg.textureData);
					const atlas = createTextureAtlas(
						msg.textureNames,
						(name: string) => images.get(name.replace(".png", ""))!,
					);
					const blockStates = prepareBlockStates(
						msg.blockStates,
						msg.blockModels as Parameters<typeof prepareBlockStates>[1],
						atlas.uvMap,
					);
					for (const worker of viewer.worldRenderer.workers) {
						worker.postMessage({ type: "registryData", blocks: msg.blocks, biomes: msg.biomes });
					}
					setViewerAssets(viewer, atlas, blockStates, deserializeTints(msg.tints));
					setEntityModels(msg.entityModels as Record<string, EntityModelDef>);
					assetsReady = true;
					for (const queued of pendingMessages) processMessage(queued);
					pendingMessages.length = 0;
				} catch (err) {
					console.error("[viewer] asset error:", err);
				}
			} else if (!assetsReady) {
				pendingMessages.push(msg);
			} else {
				processMessage(msg);
			}
		};

		es.onerror = () => {
			// EventSource reconnects on its own; nothing to do.
		};
	};

	const loop = () => {
		try {
			if (viewer) renderViewer(viewer);
		} catch (_) {
			// entity mesh hiccups must not kill the loop
		}
		raf = requestAnimationFrame(loop);
	};

	const ro = new ResizeObserver(sizeCanvas);
	ro.observe(canvas);
	connect();
	raf = requestAnimationFrame(loop);

	return () => {
		closed = true;
		cancelAnimationFrame(raf);
		ro.disconnect();
		try {
			es?.close();
		} catch (_) {
			/* ignore */
		}
	};
}
