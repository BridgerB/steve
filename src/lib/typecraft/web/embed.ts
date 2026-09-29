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
	/** Where to fetch the (static) assets blob. Default /web/assets.json. */
	assetsUrl?: string;
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
	const assetsUrl = opts.assetsUrl ?? "/web/assets.json";
	let ws: WebSocket | null = null;
	let assetsMsg: Extract<ServerMessage, { type: "assets" }> | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;
	let raf = 0;

	// Camera smoothing: position packets arrive ~20Hz with jitter over the relay
	// (p99 gaps >100ms), and hard-setting the camera per packet reads as stepping.
	// Keep the latest packet as a target and ease the camera toward it every frame.
	type Pose = { x: number; y: number; z: number; yaw: number; pitch: number };
	let camTarget: Pose | null = null;
	let camCur: Pose | null = null;
	const TWO_PI = Math.PI * 2;
	const lerpAngle = (a: number, b: number, t: number): number => {
		const d = ((((b - a) % TWO_PI) + TWO_PI + Math.PI) % TWO_PI) - Math.PI; // shortest arc
		return a + d * t;
	};
	// Same easing for entities: the relay batches their moves at ~10Hz, which
	// would otherwise step visibly. Keep a target + current pose per entity.
	type EntPose = { x: number; y: number; z: number; yaw: number };
	const entTarget = new Map<number, EntPose>();
	const entCur = new Map<number, EntPose>();
	const setEntTarget = (id: number, x: number, y: number, z: number, yaw: number) => {
		entTarget.set(id, { x, y, z, yaw });
		if (!entCur.has(id)) {
			entCur.set(id, { x, y, z, yaw });
			if (viewer) updateViewerEntity(viewer, id, x, y, z, yaw); // first fix: snap
		}
	};

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
			camTarget = { x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch };
			if (!camCur) {
				// First fix (or after a teleport-sized jump): snap instead of easing.
				camCur = { ...camTarget };
				setViewerCamera(viewer, vec3(msg.x, msg.y, msg.z), msg.yaw, msg.pitch);
			} else if (Math.hypot(msg.x - camCur.x, msg.y - camCur.y, msg.z - camCur.z) > 24) {
				camCur = { ...camTarget };
				setViewerCamera(viewer, vec3(msg.x, msg.y, msg.z), msg.yaw, msg.pitch);
			}
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
			setEntTarget(msg.id, msg.x, msg.y, msg.z, msg.yaw);
		} else if ((msg as { type: string }).type === "entityMoves") {
			// Relay-batched entity moves (latest position per entity, ~10Hz) — eased in the render loop.
			for (const m of (msg as unknown as { moves: { id: number; x: number; y: number; z: number; yaw: number }[] }).moves)
				setEntTarget(m.id, m.x, m.y, m.z, m.yaw);
		} else if (msg.type === "entityGone") {
			removeViewerEntity(viewer, msg.id);
			entTarget.delete(msg.id);
			entCur.delete(msg.id);
		} else if (msg.type === "entityEquip") {
			updateEntityEquipment(viewer.entityRenderer, msg.id, msg.slot, msg.itemName);
		} else if (msg.type === "path") {
			setViewerPath(viewer, msg.points, msg.breaks ?? [], msg.places ?? []);
		}
	};

	// Apply the (statically fetched) assets once the viewer exists. Idempotent.
	const applyAssets = async (): Promise<void> => {
		if (!viewer || !assetsMsg || assetsReady) return;
		const msg = assetsMsg;
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
	};

	// Fetch the big assets blob statically (it can't stream through the relay's
	// 1MB-capped WebSocket), then apply it once the viewer is up.
	fetch(assetsUrl)
		.then((r) => r.json())
		.then((m) => {
			assetsMsg = m as Extract<ServerMessage, { type: "assets" }>;
			void applyAssets();
		})
		.catch((err) => console.error("[viewer] assets fetch failed:", err));

	const connect = () => {
		if (closed) return;
		// Live WebSocket relay (Durable Object). On (re)connect the relay replays
		// init/chunks/entities, so reset chunk/queue state on open.
		ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			chunkCount = 0;
			pendingMessages.length = 0;
		};

		ws.onmessage = (event) => {
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
				void applyAssets();
			} else if (msg.type === "assets") {
				// The relay never forwards assets (served statically); ignore if it does.
			} else if (!assetsReady) {
				pendingMessages.push(msg);
			} else {
				processMessage(msg);
			}
		};

		ws.onclose = () => {
			if (closed) return;
			retryTimer = setTimeout(connect, 2000); // WebSocket doesn't auto-reconnect
		};
		ws.onerror = () => {
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
		};
	};

	let lastFrame = performance.now();
	const loop = () => {
		try {
			// Time-based easing (~90ms to converge) so it's frame-rate independent.
			const now = performance.now();
			const t = Math.min(1, (now - lastFrame) / 90);
			lastFrame = now;
			if (viewer && camTarget && camCur) {
				camCur.x += (camTarget.x - camCur.x) * t;
				camCur.y += (camTarget.y - camCur.y) * t;
				camCur.z += (camTarget.z - camCur.z) * t;
				camCur.yaw = lerpAngle(camCur.yaw, camTarget.yaw, t);
				camCur.pitch += (camTarget.pitch - camCur.pitch) * t;
				setViewerCamera(viewer, vec3(camCur.x, camCur.y, camCur.z), camCur.yaw, camCur.pitch);
			}
			if (viewer) {
				for (const [id, tg] of entTarget) {
					const c = entCur.get(id);
					if (!c) continue;
					c.x += (tg.x - c.x) * t;
					c.y += (tg.y - c.y) * t;
					c.z += (tg.z - c.z) * t;
					c.yaw = lerpAngle(c.yaw, tg.yaw, t);
					updateViewerEntity(viewer, id, c.x, c.y, c.z, c.yaw);
				}
			}
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
		if (retryTimer) clearTimeout(retryTimer);
		ro.disconnect();
		try {
			ws?.close();
		} catch (_) {
			/* ignore */
		}
	};
}
