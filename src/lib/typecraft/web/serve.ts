/**
 * Server-side bridge — serves static files + WebSocket for streaming
 * bot state (chunks, position, assets) to the browser viewer.
 * Assets loaded from src/data/assets/ (extracted from client JAR by datagen).
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type WebSocket, WebSocketServer } from "ws";
import type { Bot } from "../bot/types.ts";
import { dumpChunkColumn } from "../chunk/index.ts";
import type { Entity } from "../entity/types.ts";
import type { BiomeTints } from "../viewer/assets.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");

// ── Types ──

export type WebViewerOptions = {
	port?: number;
	viewDistance?: number;
};

export type WebViewer = {
	readonly server: ReturnType<typeof createServer>;
	readonly wss: WebSocketServer;
	readonly close: () => void;
};

// ── MIME types ──

const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".map": "application/json",
};

// ── Asset loading ──

type RegistryBlock = {
	name: string;
	transparent: boolean;
	boundingBox: string;
	minStateId: number;
	states?: { name: string; values?: string[] }[];
};

type RegistryBiome = {
	id: number;
	name: string;
};

type EntityModelDef = {
	texturewidth: number;
	textureheight: number;
	bones: unknown[];
};

type CachedAssets = {
	blockStates: Record<string, unknown>;
	blockModels: Record<string, unknown>;
	textureNames: string[];
	textureData: Record<string, string>;
	tints: SerializedTints;
	blocks: RegistryBlock[];
	biomes: RegistryBiome[];
	entityModels: Record<string, EntityModelDef>;
};

/** Parse a hex color string like "#3f76e4" to an integer. */
const hexToInt = (hex: string): number => parseInt(hex.replace("#", ""), 16);

/** Convert an integer color to GL [r, g, b] tuple. */
const tintToGl = (c: number): readonly [number, number, number] =>
	[
		((c >> 16) & 0xff) / 255,
		((c >> 8) & 0xff) / 255,
		(c & 0xff) / 255,
	] as const;

/** Compute redstone power level → color. */
const redstoneTint = (power: number): readonly [number, number, number] => {
	const f = power / 15;
	return [
		f * 0.6 + (f > 0 ? 0.4 : 0.3),
		f * f * 0.7 - 0.5,
		f * f * 0.6 - 0.7,
	].map((v) => Math.max(0, Math.min(1, v))) as unknown as readonly [
		number,
		number,
		number,
	];
};

type BiomeJson = {
	effects?: {
		water_color?: string;
		foliage_color?: string;
		grass_color_modifier?: string;
	};
	temperature?: number;
	downfall?: number;
};

/** Build tints from extracted biome data in src/data/biomes-raw/. */
const buildTints = (): BiomeTints => {
	const grass = new Map<string, readonly [number, number, number]>();
	const foliage = new Map<string, readonly [number, number, number]>();
	const water = new Map<string, readonly [number, number, number]>();

	const biomesDir = join(DATA_DIR, "biomes-raw");
	if (existsSync(biomesDir)) {
		for (const file of readdirSync(biomesDir)) {
			if (!file.endsWith(".json")) continue;
			const biomeName = file.replace(".json", "");
			const biome = JSON.parse(
				readFileSync(join(biomesDir, file), "utf8"),
			) as BiomeJson;
			const effects = biome.effects;
			if (!effects) continue;

			if (effects.water_color) {
				water.set(biomeName, tintToGl(hexToInt(effects.water_color)));
			}
			if (effects.foliage_color) {
				foliage.set(biomeName, tintToGl(hexToInt(effects.foliage_color)));
			}
		}
	}

	// Redstone: power levels 0–15
	const redstone = new Map<string, readonly [number, number, number]>();
	for (let i = 0; i <= 15; i++) {
		redstone.set(`${i}`, redstoneTint(i));
	}

	// Constant tints (lily pad, etc.)
	const constant = new Map<string, readonly [number, number, number]>();
	constant.set("attached_stem", [0.9, 0.9, 0.1]);
	constant.set("lily_pad", [0.135, 0.522, 0.18]);

	return {
		grass,
		foliage,
		water,
		redstone,
		constant,
		grassDefault: [0.48, 0.74, 0.31],
		foliageDefault: [0.48, 0.74, 0.31],
		waterDefault: [0.25, 0.29, 0.98],
	};
};

export const loadMcAssets = (_version: string, bot: Bot): CachedAssets => {
	// Load blockstates from individual JSON files
	const blockStates: Record<string, unknown> = {};
	const blockStatesDir = join(DATA_DIR, "assets/blockstates");
	if (existsSync(blockStatesDir)) {
		for (const file of readdirSync(blockStatesDir)) {
			if (!file.endsWith(".json")) continue;
			const name = file.replace(".json", "");
			blockStates[name] = JSON.parse(
				readFileSync(join(blockStatesDir, file), "utf8"),
			);
		}
	}

	// Load block models from individual JSON files
	const blockModels: Record<string, unknown> = {};
	const modelsDir = join(DATA_DIR, "assets/models/block");
	if (existsSync(modelsDir)) {
		for (const file of readdirSync(modelsDir)) {
			if (!file.endsWith(".json")) continue;
			const name = file.replace(".json", "");
			blockModels[name] = JSON.parse(
				readFileSync(join(modelsDir, file), "utf8"),
			);
		}
	}

	// Load block textures as base64
	const textureNames: string[] = [];
	const textureData: Record<string, string> = {};
	const texturesDir = join(DATA_DIR, "assets/textures/block");
	if (existsSync(texturesDir)) {
		for (const file of readdirSync(texturesDir)) {
			if (!file.endsWith(".png")) continue;
			const name = file.replace(".png", "");
			const b64 = readFileSync(join(texturesDir, file)).toString("base64");
			textureNames.push(name);
			textureData[name] = b64;
		}
	}

	const tints = buildTints();

	// Extract minimal block/biome data for the browser worker
	const blocks: RegistryBlock[] = [];
	for (const block of bot.registry!.blocksArray) {
		blocks.push({
			name: block.name,
			transparent: block.transparent,
			boundingBox: block.boundingBox,
			minStateId: block.minStateId,
			states: block.states?.map((s) => ({
				name: s.name,
				values: s.values ? [...s.values] : undefined,
			})),
		});
	}

	const biomes: RegistryBiome[] = [];
	for (const biome of bot.registry!.biomesArray) {
		biomes.push({ id: biome.id, name: biome.name });
	}

	// Load entity model geometry from upstream entities.json
	const entityModels: Record<string, EntityModelDef> = {};
	try {
		const entitiesJsonPath = resolve(
			import.meta.dirname,
			"../../upstream/prismarine-viewer/viewer/lib/entity/entities.json",
		);
		const raw = JSON.parse(readFileSync(entitiesJsonPath, "utf8")) as Record<
			string,
			{
				geometry?: {
					default?: {
						texturewidth?: number;
						textureheight?: number;
						bones?: unknown[];
					};
				};
			}
		>;
		for (const [name, def] of Object.entries(raw)) {
			if (def.geometry?.default) {
				entityModels[name] = {
					texturewidth: def.geometry.default.texturewidth ?? 64,
					textureheight: def.geometry.default.textureheight ?? 64,
					bones: def.geometry.default.bones ?? [],
				};
			}
		}
	} catch {
		/* entity models unavailable — non-player entities will use fallback box */
	}

	return {
		blockStates,
		blockModels,
		textureNames,
		textureData,
		tints: serializeTints(tints),
		blocks,
		biomes,
		entityModels,
	};
};

// Global asset cache — computed once, shared across all viewer instances
let _cachedAssets: CachedAssets | null = null;
let _cachedAssetsJson: string | null = null;

const getCachedAssets = (bot: Bot): { assets: CachedAssets; json: string } => {
	if (!_cachedAssets) {
		_cachedAssets = loadMcAssets(bot.version, bot);
		_cachedAssetsJson = JSON.stringify({ type: "assets", ..._cachedAssets });
	}
	return { assets: _cachedAssets, json: _cachedAssetsJson! };
};

// ── Chunk buffer cache ──

type ChunkCache = Map<string, Buffer>;

const chunkKey = (x: number, z: number) => `${x},${z}`;

// ── Tint serialization (Maps → plain objects for JSON) ──

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

const serializeTints = (tints: BiomeTints): SerializedTints => ({
	grass: Object.fromEntries(tints.grass),
	foliage: Object.fromEntries(tints.foliage),
	water: Object.fromEntries(tints.water),
	redstone: Object.fromEntries(tints.redstone),
	constant: Object.fromEntries(tints.constant),
	grassDefault: tints.grassDefault,
	foliageDefault: tints.foliageDefault,
	waterDefault: tints.waterDefault,
});

// ── Bot streamer (transport-agnostic) ──
//
// Subscribes to a bot's world/entity events and pushes JSON messages to any
// number of attached sinks (a sink is just `(json) => void`). Decouples the live
// stream from the transport, so the same bot can be served over a WebSocket
// (createWebViewer, below) OR over Server-Sent Events from a SvelteKit route,
// with no second copy of the streaming logic.

export type BotStreamSink = (json: string) => void;

export type BotStreamer = {
	/** Register a sink; immediately replays the current world to it. Returns a detach fn. */
	readonly attach: (sink: BotStreamSink) => () => void;
	/** (Re)bind to a live bot: subscribe, reset world state, replay to all sinks. Call
	    again after a reconnect to follow the new bot without dropping clients. */
	readonly bind: (bot: Bot) => void;
	/** Unsubscribe from the bot and drop all sinks. */
	readonly close: () => void;
};

export const createBotStreamer = (
	options: { viewDistance?: number } = {},
): BotStreamer => {
	const viewDistance = options.viewDistance ?? 6;
	const sinks = new Set<BotStreamSink>();
	let chunkCache: ChunkCache = new Map();
	const sentChunks = new Set<string>(); // chunk keys already broadcast to sinks
	let lastBotChunk: string | null = null;
	let assets: CachedAssets | null = null;
	let bot: Bot | null = null; // current bot — swapped on reconnect via bind()
	let liveTimer: ReturnType<typeof setInterval> | null = null;
	// Last server time-of-day (from set_time) + when we got it, so the live state can
	// report a smoothly-advancing time for the dashboard clock between syncs.
	let lastTime = 0;
	let lastTimeAt = 0;
	const nowTimeOfDay = () =>
		lastTimeAt
			? (lastTime + (Date.now() - lastTimeAt) / 50) % 24000
			: lastTime;

	const broadcast = (data: unknown) => {
		const json = JSON.stringify(data);
		for (const sink of sinks) sink(json);
	};

	// Live dashboard state — vitals, inventory/open-window slots, and the steve run
	// status (current step, completed steps, phase) that steve writes onto the bot.
	// Pushed on a fast interval so the page renders straight from the stream instead
	// of polling Postgres. Cheap (a few dozen slots of JSON).
	const broadcastLiveState = () => {
		const b = bot as
			| (Bot & {
					health?: number;
					food?: number;
					currentWindow?: { type?: unknown; slots: ({ name?: string; count: number; type: number } | null)[] } | null;
					registry?: { itemsById?: Map<number, { name: string }> };
					quickBarSlot?: number;
					heldItem?: { name: string } | null;
					steveStatus?: unknown;
			  })
			| null;
		if (!b?.entity) return;
		const win = b.currentWindow ?? b.inventory;
		const slots: { s: number; n: string; c: number }[] = [];
		if (win) {
			for (let i = 0; i < win.slots.length; i++) {
				const it = win.slots[i];
				if (it && it.count > 0) {
					let name = it.name ?? "unknown";
					if (name === "unknown" && b.registry?.itemsById) {
						const def = b.registry.itemsById.get(it.type);
						if (def) name = def.name;
					}
					slots.push({ s: i, n: name, c: it.count });
				}
			}
		}
		broadcast({
			type: "state",
			health: b.health ?? null,
			food: b.food ?? null,
			x: b.entity.position.x,
			y: b.entity.position.y,
			z: b.entity.position.z,
			yaw: (b.entity as { yaw?: number }).yaw ?? 0,
			time: nowTimeOfDay(),
			// Item in the SELECTED hotbar slot, derived from quickBarSlot (same source as
			// `sel` below) so the first-person hand always matches the hotbar selection
			// square. b.heldItem is updated on a separate packet stream and can briefly
			// disagree with the selected slot.
			held:
				b.inventory?.slots[(b.quickBarSlot ?? 0) + 36]?.name ??
				b.heldItem?.name ??
				null,
			window: win
				? {
						kind: String((win as { type?: unknown }).type ?? "inventory"),
						n: win.slots.length,
						slots,
						open: !!b.currentWindow, // a real container screen is open (table/furnace/chest)
						sel: b.quickBarSlot ?? 0, // selected hotbar slot 0-8 (always shown in the HUD)
					}
				: null,
			steve: b.steveStatus ?? null,
		});
	};

	const onMove = () => {
		if (!bot?.entity) return;
		broadcast({
			type: "position",
			x: bot.entity.position.x,
			y: bot.entity.position.y,
			z: bot.entity.position.z,
			yaw: bot.entity.yaw,
			pitch: bot.entity.pitch,
		});
		// Cover chunks that came into view as the bot moved. The server loads chunks
		// at a larger radius than the viewer, so onMapChunk filters out chunks that
		// load while the bot is far — they sit in chunkCache, never sent. When the bot
		// then moves into them they'd be missing (rendering see-through to the
		// underground). On each chunk-boundary crossing, send any in-view cached chunk
		// we haven't sent yet. Throttled to crossings so it doesn't fire every tick.
		const cx = Math.floor(bot.entity.position.x / 16);
		const cz = Math.floor(bot.entity.position.z / 16);
		const ck = `${cx},${cz}`;
		if (ck === lastBotChunk) return;
		lastBotChunk = ck;
		for (let dx = -viewDistance; dx <= viewDistance; dx++) {
			for (let dz = -viewDistance; dz <= viewDistance; dz++) {
				const x = cx + dx;
				const z = cz + dz;
				const key = chunkKey(x, z);
				if (sentChunks.has(key)) continue;
				const buf = chunkCache.get(key);
				if (!buf) continue;
				sentChunks.add(key);
				broadcast({ type: "chunk", x, z, buf: buf.toString("base64") });
			}
		}
	};
	const onMapChunk = (packet: Record<string, unknown>) => {
		const x = packet.x as number;
		const z = packet.z as number;
		const chunkData = packet.chunkData as Buffer;
		chunkCache.set(chunkKey(x, z), chunkData);
		const botPos = bot?.entity?.position;
		const botCx = botPos ? Math.floor(botPos.x / 16) : 0;
		const botCz = botPos ? Math.floor(botPos.z / 16) : 0;
		if (
			Math.abs(x - botCx) <= viewDistance &&
			Math.abs(z - botCz) <= viewDistance
		) {
			sentChunks.add(chunkKey(x, z));
			broadcast({ type: "chunk", x, z, buf: chunkData.toString("base64") });
		}
	};
	const onUnloadChunk = (packet: Record<string, unknown>) => {
		const x = packet.chunkX as number;
		const z = packet.chunkZ as number;
		chunkCache.delete(chunkKey(x, z));
		sentChunks.delete(chunkKey(x, z));
		broadcast({ type: "unloadChunk", x, z });
	};
	const onBlockChange = (packet: Record<string, unknown>) => {
		const loc = packet.location as Record<string, number>;
		if (!loc) return;
		broadcast({
			type: "blockUpdate",
			x: loc.x,
			y: loc.y,
			z: loc.z,
			stateId: packet.type as number,
		});
	};
	// Batched block changes — the bot's own mining and cave fluid updates arrive
	// here, not as single block_update packets. bot.world applies them; forward
	// them to the viewer too, or its world goes stale (see-through through
	// un-updated rock). Mirrors initBlocks' section_blocks_update decode.
	const onSectionBlocksUpdate = (packet: Record<string, unknown>) => {
		if (bot?.supportFeature("usesMultiblockSingleLong")) {
			const cc = packet.chunkCoordinates as
				| { x: number; y: number; z: number }
				| undefined;
			const records = packet.records as Array<bigint | number> | undefined;
			if (!cc || !records) return;
			const cx = cc.x * 16;
			const cy = cc.y * 16;
			const cz = cc.z * 16;
			for (const record of records) {
				const val = typeof record === "bigint" ? Number(record) : record;
				broadcast({
					type: "blockUpdate",
					x: cx + ((val >> 8) & 0xf),
					y: cy + (val & 0xf),
					z: cz + ((val >> 4) & 0xf),
					stateId: val >>> 12,
				});
			}
		}
	};
	const onExplodeBlocks = (packet: Record<string, unknown>) => {
		const x = packet.x as number;
		const y = packet.y as number;
		const z = packet.z as number;
		const offsets = packet.affectedBlockOffsets as
			| Array<{ x: number; y: number; z: number }>
			| undefined;
		if (!offsets) return;
		for (const o of offsets) {
			broadcast({ type: "blockUpdate", x: x + o.x, y: y + o.y, z: z + o.z, stateId: 0 });
		}
	};
	const onTimeUpdate = (packet: Record<string, unknown>) => {
		const raw = Number(packet.gameTime ?? packet.time ?? 0);
		const timeOfDay = (Number.isFinite(raw) ? raw : 0) % 24000;
		lastTime = timeOfDay < 0 ? timeOfDay + 24000 : timeOfDay;
		lastTimeAt = Date.now();
		broadcast({ type: "time", time: lastTime });
	};
	const onEntitySpawn = (entity: Entity) => {
		if (!bot || entity.id === bot.entity?.id) return;
		const username =
			entity.type === "player"
				? (entity.username ??
					(entity.uuid ? bot.uuidToUsername[entity.uuid] : null))
				: null;
		const skinUrl =
			entity.type === "player" && entity.uuid
				? `/skins/${entity.uuid}.png`
				: undefined;
		broadcast({
			type: "entitySpawn",
			id: entity.id,
			entityName: entity.name ?? entity.type ?? "unknown",
			username: username ?? entity.username,
			skinUrl,
			x: entity.position.x,
			y: entity.position.y,
			z: entity.position.z,
			yaw: entity.yaw,
		});
	};
	const onEntityMoved = (entity: Entity) => {
		if (!bot || entity.id === bot.entity?.id) return;
		broadcast({
			type: "entityMove",
			id: entity.id,
			x: entity.position.x,
			y: entity.position.y,
			z: entity.position.z,
			yaw: entity.yaw,
		});
	};
	const onEntityGone = (entity: Entity) => {
		broadcast({ type: "entityGone", id: entity.id });
	};
	const onEntityEquip = (entity: Entity) => {
		if (!bot || entity.id === bot.entity?.id) return;
		const mainHand = (entity as unknown as Record<string, unknown>)
			.equipment as Array<{ type?: number; name?: string } | null> | undefined;
		const item = mainHand?.[0];
		broadcast({
			type: "entityEquip",
			id: entity.id,
			slot: 0,
			itemName: item?.name ?? null,
		});
	};

	// Pathfinder route overlay: whenever the pathfinder (re)computes a path, push the
	// waypoints to viewers; clear it when the bot reaches/abandons the goal.
	const onPath = (result: {
		path: readonly {
			x: number;
			y: number;
			z: number;
			toBreak: readonly { x: number; y: number; z: number }[];
			toPlace: readonly { x: number; y: number; z: number }[];
			parkour: boolean;
		}[];
	}) => {
		// Per-waypoint "kind" so the viewer can colour the line: a clear walk vs the
		// hypothetical part that still needs blocks dug/placed. Also send the projected
		// block cells so the overlay can mark WHERE those blocks go.
		const breaks: { x: number; y: number; z: number }[] = [];
		const places: { x: number; y: number; z: number }[] = [];
		const points = result.path.map((m) => {
			for (const b of m.toBreak) breaks.push({ x: b.x, y: b.y, z: b.z });
			for (const p of m.toPlace) places.push({ x: p.x, y: p.y, z: p.z });
			return {
				x: m.x,
				y: m.y,
				z: m.z,
				dig: m.toBreak.length > 0,
				place: m.toPlace.length > 0,
				jump: m.parkour,
			};
		});
		broadcast({ type: "path", points, breaks, places });
	};
	const onPathClear = () =>
		broadcast({ type: "path", points: [], breaks: [], places: [] });

	const subscribe = (b: Bot) => {
		b.on("move", onMove);
		b.on("forcedMove", onMove);
		b.on("entitySpawn", onEntitySpawn);
		b.on("entityMoved", onEntityMoved);
		b.on("entityGone", onEntityGone);
		b.on("entityEquip", onEntityEquip);
		b.client.on("level_chunk_with_light", onMapChunk);
		b.client.on("forget_level_chunk", onUnloadChunk);
		b.client.on("block_update", onBlockChange);
		b.client.on("section_blocks_update", onSectionBlocksUpdate);
		b.client.on("explode", onExplodeBlocks);
		b.client.on("set_time", onTimeUpdate);
		b.on("path_update", onPath);
		b.on("goal_reached", onPathClear);
		b.on("path_stop", onPathClear);
		b.on("path_reset", onPathClear);
	};
	const unsubscribe = (b: Bot) => {
		b.removeListener("move", onMove);
		b.removeListener("forcedMove", onMove);
		b.removeListener("entitySpawn", onEntitySpawn);
		b.removeListener("entityMoved", onEntityMoved);
		b.removeListener("entityGone", onEntityGone);
		b.removeListener("entityEquip", onEntityEquip);
		b.client.removeListener("level_chunk_with_light", onMapChunk);
		b.client.removeListener("forget_level_chunk", onUnloadChunk);
		b.client.removeListener("block_update", onBlockChange);
		b.client.removeListener("section_blocks_update", onSectionBlocksUpdate);
		b.client.removeListener("explode", onExplodeBlocks);
		b.client.removeListener("set_time", onTimeUpdate);
		b.removeListener("path_update", onPath);
		b.removeListener("goal_reached", onPathClear);
		b.removeListener("path_stop", onPathClear);
		b.removeListener("path_reset", onPathClear);
	};

	// Send the full current world to one sink — on attach, and on every (re)bind.
	const replay = (sink: BotStreamSink): void => {
		if (!bot) return;
		sink(
			JSON.stringify({
				type: "init",
				version: bot.version,
				minY: bot.game.minY,
				height: bot.game.height,
			}),
		);
		// Assets are a pre-serialized ~15MB JSON string — send as-is.
		if (assets && _cachedAssetsJson) sink(_cachedAssetsJson);
		if (bot.entity) {
			sink(
				JSON.stringify({
					type: "position",
					x: bot.entity.position.x,
					y: bot.entity.position.y,
					z: bot.entity.position.z,
					yaw: bot.entity.yaw,
					pitch: bot.entity.pitch,
				}),
			);
		}
		if (bot.world) {
			const botPos = bot.entity?.position;
			const botCx = botPos ? Math.floor(botPos.x / 16) : 0;
			const botCz = botPos ? Math.floor(botPos.z / 16) : 0;
			// Dump fresh from the live world rather than the chunk cache. The cache is
			// the chunk as the server last *sent* it; as the bot mines, bot.world is
			// patched in place (block_update / section_blocks_update) but the cached
			// buffer drifts stale. A (re)connecting viewer fed the stale buffer renders
			// pre-mining rock — which, being buried, has no faces, so you see straight
			// through it to the caves behind (the "see-through" bug).
			for (const [key, column] of bot.world.columns) {
				const [x, z] = key.split(",").map(Number) as [number, number];
				if (
					Math.abs(x - botCx) <= viewDistance &&
					Math.abs(z - botCz) <= viewDistance
				) {
					sink(
						JSON.stringify({
							type: "chunk",
							x,
							z,
							buf: dumpChunkColumn(column, true).toString("base64"),
						}),
					);
				}
			}
		}
		for (const entity of Object.values(bot.entities)) {
			if (entity.id === bot.entity?.id) continue;
			const username =
				entity.type === "player"
					? (entity.username ??
						(entity.uuid ? bot.uuidToUsername[entity.uuid] : null))
					: null;
			const skinUrl =
				entity.type === "player" && entity.uuid
					? `/skins/${entity.uuid}.png`
					: undefined;
			sink(
				JSON.stringify({
					type: "entitySpawn",
					id: entity.id,
					entityName: entity.name ?? entity.type ?? "unknown",
					username: username ?? entity.username,
					skinUrl,
					x: entity.position.x,
					y: entity.position.y,
					z: entity.position.z,
					yaw: entity.yaw,
				}),
			);
		}
	};

	const bind = (next: Bot): void => {
		if (bot) unsubscribe(bot);
		bot = next;
		chunkCache = new Map(); // fresh world on (re)connect
		sentChunks.clear();
		lastBotChunk = null;
		assets = null;
		const setup = () => {
			if (next.registry) assets = getCachedAssets(next).assets;
		};
		if (next.registry && next.entity) setup();
		else next.once("spawn", setup);
		subscribe(next);
		// The bot's own arm swing isn't echoed back over the wire — it's an OUTGOING
		// action (bot.swingArm, fired every 350ms while digging). Wrap it so the viewer
		// can animate a real first-person swing when the bot actually swings.
		const nb = next as Bot & { swingArm: (...a: unknown[]) => void };
		const origSwing = nb.swingArm.bind(nb);
		nb.swingArm = (...args: unknown[]) => {
			broadcast({ type: "swing" });
			origSwing(...args);
		};
		// Pre-populate from chunks already loaded before bind.
		if (next.world) {
			for (const [key, column] of next.world.columns) {
				if (!chunkCache.has(key)) {
					const [cx, cz] = key.split(",").map(Number) as [number, number];
					chunkCache.set(chunkKey(cx, cz), dumpChunkColumn(column, true));
				}
			}
		}
		for (const sink of sinks) replay(sink);
		if (liveTimer) clearInterval(liveTimer);
		liveTimer = setInterval(broadcastLiveState, 500);
	};

	const attach = (sink: BotStreamSink): (() => void) => {
		sinks.add(sink);
		replay(sink);
		return () => {
			sinks.delete(sink);
		};
	};

	const close = () => {
		if (liveTimer) clearInterval(liveTimer);
		liveTimer = null;
		if (bot) unsubscribe(bot);
		bot = null;
		sinks.clear();
	};

	return { attach, bind, close };
};

// ── Server ──

export const createWebViewer = (
	bot: Bot,
	options?: WebViewerOptions,
): WebViewer => {
	const port = options?.port ?? 3000;
	const viewDistance = options?.viewDistance ?? 6;
	const distDir = resolve(import.meta.dirname, "../../dist");

	// Disk-backed skin cache
	const skinCacheDir = resolve(import.meta.dirname, "../../.cache/skins");
	mkdirSync(skinCacheDir, { recursive: true });

	// Usernames confirmed not to be real Mojang accounts — skip API calls
	const notRealAccounts = new Set<string>();

	/** UUID v3 = offline mode (0x30 version nibble), v4 = real Mojang account */
	const isOfflineUuid = (uuid: string): boolean => uuid.charAt(14) === "3";

	/** Skip Mojang API for our own bots (offline accounts that don't exist on Mojang) */
	const isBotUsername = (name: string): boolean =>
		name === bot.username || /^Steve\d*$|Bot/.test(name);

	const getSkinCache = (uuid: string): Buffer | null => {
		const p = join(skinCacheDir, `${uuid}.png`);
		return existsSync(p) ? readFileSync(p) : null;
	};

	const setSkinCache = (uuid: string, buf: Buffer): void => {
		writeFileSync(join(skinCacheDir, `${uuid}.png`), buf);
	};

	// ── Static file server ──

	// Steve skin texture from extracted client JAR assets
	const steveTexturePath = (() => {
		const p = join(DATA_DIR, "assets/textures/entity/player/wide/steve.png");
		return existsSync(p) ? p : null;
	})();

	const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Typecraft Viewer</title>
<script>
// Minimal Buffer polyfill for browser (read-only subset used by chunk code)
class Buffer extends Uint8Array {
  static from(src, enc) {
    if (enc === "base64") {
      const bin = atob(src);
      const arr = new Buffer(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }
    if (src instanceof ArrayBuffer || src instanceof Uint8Array) return new Buffer(src);
    return new Buffer(0);
  }
  static alloc(n) { return new Buffer(n); }
  readUInt8(o) { return this[o]; }
  readInt16BE(o) { const v = (this[o] << 8) | this[o+1]; return v > 0x7fff ? v - 0x10000 : v; }
  readUInt32BE(o) { return ((this[o] << 24) | (this[o+1] << 16) | (this[o+2] << 8) | this[o+3]) >>> 0; }
  writeUInt8(v, o) { this[o] = v & 0xff; return o + 1; }
  writeInt16BE(v, o) { this[o] = (v >> 8) & 0xff; this[o+1] = v & 0xff; return o + 2; }
  writeUInt32BE(v, o) { this[o]=(v>>>24)&0xff; this[o+1]=(v>>>16)&0xff; this[o+2]=(v>>>8)&0xff; this[o+3]=v&0xff; return o + 4; }
}
globalThis.Buffer = Buffer;
</script>
<style>
body { margin: 0; overflow: hidden; background: #000; }
canvas { display: block; width: 100vw; height: 100vh; }
#status { position: fixed; top: 12px; left: 12px; color: #fff; font: 14px monospace; z-index: 1; }
</style>
</head>
<body>
<div id="status">Connecting...</div>
<canvas id="viewer"></canvas>
<script type="module" src="/web/client.js"></script>
</body>
</html>`;

	const server = createServer(
		async (req: IncomingMessage, res: ServerResponse) => {
			if (req.url === "/" || req.url === "/index.html") {
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(INDEX_HTML);
				return;
			}

			// Serve player skins (proxy from Mojang to avoid CORS)
			if (req.url?.startsWith("/skins/") && req.url.endsWith(".png")) {
				const uuid = req.url.slice("/skins/".length, -".png".length);
				const skinHeaders = {
					"Content-Type": "image/png",
					"Cache-Control": "public, max-age=3600",
				};

				// Check disk cache first
				const cached = getSkinCache(uuid);
				if (cached) {
					res.writeHead(200, skinHeaders);
					res.end(cached);
					return;
				}

				// Resolve skin URL: bot.players → Mojang session API
				let skinUrl: string | undefined;
				const uname = bot.uuidToUsername[uuid];
				if (uname) skinUrl = bot.players[uname]?.skinData?.url;
				if (
					!skinUrl &&
					uname &&
					!isBotUsername(uname) &&
					!notRealAccounts.has(uname)
				) {
					// Only call Mojang for real players, never for our own bots
					let lookupUuid = uuid.replace(/-/g, "");
					if (isOfflineUuid(uuid)) {
						try {
							const nameRes = await fetch(
								`https://api.mojang.com/users/profiles/minecraft/${uname}`,
							);
							if (nameRes.ok) {
								const nameData = (await nameRes.json()) as { id: string };
								lookupUuid = nameData.id;
							} else {
								notRealAccounts.add(uname);
							}
						} catch {
							/* transient — retry next time */
						}
					}
					if (!notRealAccounts.has(uname)) {
						try {
							const profileRes = await fetch(
								`https://sessionserver.mojang.com/session/minecraft/profile/${lookupUuid}`,
							);
							if (profileRes.ok) {
								const profile = (await profileRes.json()) as {
									properties: { name: string; value: string }[];
								};
								const texProp = profile.properties.find(
									(p: { name: string }) => p.name === "textures",
								);
								if (texProp) {
									const decoded = JSON.parse(
										Buffer.from(texProp.value, "base64").toString("utf8"),
									);
									skinUrl = decoded?.textures?.SKIN?.url;
								}
							}
						} catch {
							/* fall through to steve */
						}
					}
				}

				// Fetch skin PNG and cache it
				if (skinUrl) {
					try {
						const skinRes = await fetch(skinUrl);
						if (skinRes.ok) {
							const buf = Buffer.from(await skinRes.arrayBuffer());
							setSkinCache(uuid, buf);
							res.writeHead(200, skinHeaders);
							res.end(buf);
							return;
						}
					} catch {
						/* fall through to steve */
					}
				}

				// Fallback: serve steve but don't cache it — next request will retry Mojang
				if (steveTexturePath) {
					res.writeHead(200, {
						...skinHeaders,
						"Cache-Control": "no-cache",
					});
					res.end(readFileSync(steveTexturePath));
					return;
				}
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			// Serve Steve skin texture
			if (req.url === "/textures/steve.png" && steveTexturePath) {
				const content = readFileSync(steveTexturePath);
				res.writeHead(200, { "Content-Type": "image/png" });
				res.end(content);
				return;
			}

			// Serve item textures from extracted assets
			if (req.url?.startsWith("/textures/item/") && req.url.endsWith(".png")) {
				const itemName = req.url.slice(
					"/textures/item/".length,
					-".png".length,
				);
				const itemPath = join(
					DATA_DIR,
					"assets/textures/item",
					`${itemName}.png`,
				);
				if (existsSync(itemPath)) {
					res.writeHead(200, {
						"Content-Type": "image/png",
						"Cache-Control": "public, max-age=86400",
					});
					res.end(readFileSync(itemPath));
					return;
				}
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const filePath = resolve(distDir, `.${req.url}`);

			if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const ext = extname(filePath);
			const contentType = MIME[ext] ?? "application/octet-stream";

			try {
				const content = readFileSync(filePath);
				res.writeHead(200, { "Content-Type": contentType });
				res.end(content);
			} catch {
				res.writeHead(500);
				res.end("Internal error");
			}
		},
	);

	// ── WebSocket server ──

	const wss = new WebSocketServer({ server });

	const streamer = createBotStreamer({ viewDistance });
	streamer.bind(bot);

	wss.on("connection", (ws: WebSocket) => {
		const detach = streamer.attach((json) => {
			if (ws.readyState === ws.OPEN) ws.send(json);
		});
		ws.on("close", detach);
	});

	server.listen(port, () => {
		console.log(`[web] Viewer at http://localhost:${port}`);
	});

	// ── Cleanup ──

	const close = () => {
		streamer.close();
		for (const ws of wss.clients) {
			try {
				ws.close();
			} catch {
				/* already closing */
			}
		}
		wss.close();
		server.close();
	};

	return { server, wss, close };
};

export const closeWebViewer = (viewer: WebViewer): void => {
	viewer.close();
};
