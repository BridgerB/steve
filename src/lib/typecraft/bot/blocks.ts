/**
 * Block and world management — chunk loading/unloading, block state updates.
 */

import { stateIdToBlock } from "../block.ts";
import {
	createChunkColumn,
	GLOBAL_BITS_PER_BIOME,
	GLOBAL_BITS_PER_BLOCK,
	loadChunkColumn,
} from "../chunk/index.ts";
import { type Vec3, vec3 } from "../vec3/index.ts";
import {
	createWorld,
	onWorldEvent,
	PLAYER_EYE_HEIGHT,
	raycast,
	setColumn,
	unloadColumn,
	worldGetBlockStateId,
	worldSetBlockStateId,
} from "../world/index.ts";
import type { Bot, BotOptions, FindBlockOptions } from "./types.ts";

export const initBlocks = (bot: Bot, _options: BotOptions): void => {
	// ── World creation ──

	bot.on("login", () => {
		if (!bot.registry) return;
		bot.world = createWorld(bot.registry);

		// Forward world block update events
		onWorldEvent(bot.world!, "blockUpdate", (pos, oldStateId, newStateId) => {
			bot.emit("blockUpdate", pos, oldStateId, newStateId);
		});
	});

	// Recreate world on respawn if dimension changes
	bot.on("game", () => {
		if (!bot.registry || !bot.world) return;
		// Update world height if changed
	});

	// ── Chunk loading ──

	bot.client.on("level_chunk_with_light", (packet: Record<string, unknown>) => {
		if (!bot.registry || !bot.world) return;

		try {
			const x = packet.x as number;
			const z = packet.z as number;

			const column = createChunkColumn({
				minY: bot.game.minY,
				worldHeight: bot.game.height,
				maxBitsPerBlock: GLOBAL_BITS_PER_BLOCK,
				maxBitsPerBiome: GLOBAL_BITS_PER_BIOME,
			});

			loadChunkColumn(
				column,
				packet.chunkData as Buffer,
				bot.protocolVersion >= 770,
			);

			// Block entities
			const blockEntities = packet.blockEntities as
				| Array<Record<string, unknown>>
				| undefined;
			if (blockEntities) {
				for (const be of blockEntities) {
					const nbtData = be.nbtData ?? be;
					if (nbtData) {
						// Store block entity in column
					}
				}
			}

			setColumn(bot.world!, x, z, column);
			bot.emit("chunkColumnLoad", vec3(x * 16, 0, z * 16));

			// Emit blockSeen for exposed blocks in the newly loaded chunk
			// Only blocks with at least one transparent neighbor — no X-ray
			// watchBlocks can contain specific names or "*" for all blocks
			if (
				bot.registry &&
				bot.watchBlocks.size > 0 &&
				bot.listenerCount("blockSeen") > 0
			) {
				const watchAll = bot.watchBlocks.has("*");
				const minY = bot.game.minY;
				const sections = column.sections;
				for (let si = 0; si < sections.length; si++) {
					const section = sections[si];
					if (!section) continue;
					const sectionY = minY + si * 16;
					for (let bx = 0; bx < 16; bx++) {
						for (let by = 0; by < 16; by++) {
							for (let bz = 0; bz < 16; bz++) {
								const wx = x * 16 + bx;
								const wy = sectionY + by;
								const wz = z * 16 + bz;
								const sid = worldGetBlockStateId(bot.world!, vec3(wx, wy, wz));
								if (sid == null || sid === 0) continue;
								const def = bot.registry.blocksByStateId.get(sid);
								if (!def) continue;
								if (!watchAll && !bot.watchBlocks.has(def.name)) continue;
								// Exposed check — at least one transparent neighbor
								let exposed = false;
								for (const [ox, oy, oz] of [
									[1, 0, 0],
									[-1, 0, 0],
									[0, 1, 0],
									[0, -1, 0],
									[0, 0, 1],
									[0, 0, -1],
								] as const) {
									const nsid = worldGetBlockStateId(
										bot.world!,
										vec3(wx + ox, wy + oy, wz + oz),
									);
									if (nsid == null || nsid === 0) {
										exposed = true;
										break;
									}
									const ndef = bot.registry.blocksByStateId.get(nsid);
									if (ndef?.transparent) {
										exposed = true;
										break;
									}
								}
								if (exposed) {
									bot.emit("blockSeen", def.name, vec3(wx, wy, wz));
								}
							}
						}
					}
				}
			}
		} catch (err) {
			bot.emit("error", err as Error);
		}
	});

	// ── Chunk batch acknowledgement (1.20.2+) ──

	bot.client.on("chunk_batch_finished", (_packet: Record<string, unknown>) => {
		bot.client.write("chunk_batch_received", {
			chunksPerTick: 20.0,
		});
	});

	// ── Chunk unloading ──

	bot.client.on("forget_level_chunk", (packet: Record<string, unknown>) => {
		if (!bot.world) return;
		const x = packet.chunkX as number;
		const z = packet.chunkZ as number;
		unloadColumn(bot.world, x, z);
		bot.emit("chunkColumnUnload", vec3(x * 16, 0, z * 16));
	});

	// ── Single block change ──

	bot.client.on("block_update", (packet: Record<string, unknown>) => {
		if (!bot.world) return;

		const loc = packet.location as { x: number; y: number; z: number };
		if (!loc) return;

		const pos = vec3(loc.x, loc.y, loc.z);
		const stateId = packet.type as number;

		worldSetBlockStateId(bot.world, pos, stateId);

		// When a block changes (e.g., stone mined → air), check if any
		// neighbors just became exposed
		if (
			bot.registry &&
			bot.watchBlocks.size > 0 &&
			bot.listenerCount("blockSeen") > 0
		) {
			const watchAll = bot.watchBlocks.has("*");
			for (const [ox, oy, oz] of [
				[1, 0, 0],
				[-1, 0, 0],
				[0, 1, 0],
				[0, -1, 0],
				[0, 0, 1],
				[0, 0, -1],
			] as const) {
				const npos = vec3(loc.x + ox, loc.y + oy, loc.z + oz);
				const nsid = worldGetBlockStateId(bot.world, npos);
				if (nsid == null || nsid === 0) continue;
				const ndef = bot.registry.blocksByStateId.get(nsid);
				if (ndef && (watchAll || bot.watchBlocks.has(ndef.name))) {
					bot.emit("blockSeen", ndef.name, npos);
				}
			}
		}
	});

	// ── Multi block change ──

	bot.client.on("section_blocks_update", (packet: Record<string, unknown>) => {
		if (!bot.world) return;

		if (bot.supportFeature("usesMultiblockSingleLong")) {
			// 1.19.2+ — records are packed longs
			const chunkCoordinates = packet.chunkCoordinates as {
				x: number;
				y: number;
				z: number;
			};
			const records = packet.records as Array<bigint | number>;
			if (!chunkCoordinates || !records) return;

			const cx = chunkCoordinates.x * 16;
			const cy = chunkCoordinates.y * 16;
			const cz = chunkCoordinates.z * 16;

			for (const record of records) {
				const val = typeof record === "bigint" ? Number(record) : record;
				const stateId = val >>> 12;
				const localX = (val >> 8) & 0xf;
				const localZ = (val >> 4) & 0xf;
				const localY = val & 0xf;

				worldSetBlockStateId(
					bot.world,
					vec3(cx + localX, cy + localY, cz + localZ),
					stateId,
				);
			}
		} else {
			// Legacy — individual records
			const records = packet.records as Array<{
				horizontalPos: number;
				y: number;
				blockId: number;
			}>;
			if (!records) return;

			for (const record of records) {
				const pos = vec3(
					(record.horizontalPos >> 4) & 0xf,
					record.y,
					record.horizontalPos & 0xf,
				);
				worldSetBlockStateId(bot.world, pos, record.blockId);
			}
		}
	});

	// ── Explosion — set affected blocks to air ──

	bot.client.on("explode", (packet: Record<string, unknown>) => {
		if (!bot.world) return;

		const x = packet.x as number;
		const y = packet.y as number;
		const z = packet.z as number;
		const affectedBlockOffsets = packet.affectedBlockOffsets as
			| Array<{ x: number; y: number; z: number }>
			| undefined;

		if (affectedBlockOffsets) {
			for (const offset of affectedBlockOffsets) {
				worldSetBlockStateId(
					bot.world,
					vec3(x + offset.x, y + offset.y, z + offset.z),
					0, // air
				);
			}
		}
	});

	// ── Block entity updates ──

	bot.client.on("block_entity_data", (packet: Record<string, unknown>) => {
		if (!bot.world || !bot.registry) return;

		const loc = packet.location as { x: number; y: number; z: number };
		if (!loc) return;

		const nbtData = packet.nbtData as Record<string, unknown> | undefined;
		if (!nbtData) return;

		// Store block entity data — emit event so listeners can react
		const pos = vec3(loc.x, loc.y, loc.z);
		bot.emit("blockUpdate", bot.blockAt(pos), bot.blockAt(pos));
	});

	bot.client.on("block_entity_data", (packet: Record<string, unknown>) => {
		if (!bot.world || !bot.registry) return;

		const loc = packet.location as { x: number; y: number; z: number };
		if (!loc) return;

		const nbtData = packet.nbtData as Record<string, unknown> | undefined;
		if (!nbtData) return;

		const pos = vec3(loc.x, loc.y, loc.z);
		bot.emit("blockUpdate", bot.blockAt(pos), bot.blockAt(pos));
	});

	// ── Bot methods ──

	bot.blockAt = (point: Vec3, _extraInfos?: boolean) => {
		if (!bot.world || !bot.registry) return null;
		const stateId = worldGetBlockStateId(bot.world, point);
		if (stateId == null) return null;
		const block = stateIdToBlock(bot.registry, stateId);
		return {
			...block,
			position: vec3(
				Math.floor(point.x),
				Math.floor(point.y),
				Math.floor(point.z),
			),
			stateId,
		};
	};

	bot.findBlocks = (options: FindBlockOptions): Vec3[] => {
		if (!bot.world || !bot.registry) return [];

		const { matching, maxDistance = 64, count = 1, point, exposed } = options;
		const origin = point ?? bot.entity.position;
		const results: Vec3[] = [];
		const useExposed = exposed !== false;

		// Check if a block has at least one transparent neighbor (air, water, glass, etc.)
		const isExposed = (p: Vec3): boolean => {
			const offsets = [
				[1, 0, 0],
				[-1, 0, 0],
				[0, 1, 0],
				[0, -1, 0],
				[0, 0, 1],
				[0, 0, -1],
			] as const;
			for (const [ox, oy, oz] of offsets) {
				const sid = worldGetBlockStateId(
					bot.world!,
					vec3(p.x + ox, p.y + oy, p.z + oz),
				);
				if (sid == null || sid === 0) return true; // unloaded or air = exposed
				const def = bot.registry!.blocksByStateId.get(sid);
				if (def?.transparent) return true;
			}
			return false;
		};

		const matchFn =
			typeof matching === "function"
				? matching
				: typeof matching === "number"
					? (name: string, _sid: number) => {
							const def = bot.registry!.blocksByName.get(name);
							return def?.id === matching;
						}
					: (name: string, _sid: number) => {
							const def = bot.registry!.blocksByName.get(name);
							return def ? (matching as number[]).includes(def.id) : false;
						};

		// Scan expanding sphere around origin — closest blocks first
		const r = Math.ceil(maxDistance);
		let blocksChecked = 0;
		let chunksNull = 0;
		for (let dist = 0; dist <= r; dist++) {
			for (let dx = -dist; dx <= dist; dx++) {
				for (let dy = -dist; dy <= dist; dy++) {
					for (let dz = -dist; dz <= dist; dz++) {
						// Only check the shell at this distance
						if (
							Math.abs(dx) !== dist &&
							Math.abs(dy) !== dist &&
							Math.abs(dz) !== dist
						)
							continue;
						if (dx * dx + dy * dy + dz * dz > maxDistance * maxDistance)
							continue;

						const pos = vec3(
							Math.floor(origin.x) + dx,
							Math.floor(origin.y) + dy,
							Math.floor(origin.z) + dz,
						);

						const stateId = worldGetBlockStateId(bot.world!, pos);
						if (stateId == null) {
							chunksNull++;
							continue;
						}
						if (stateId === 0) continue;

						blocksChecked++;
						const block = stateIdToBlock(bot.registry!, stateId);
						if (matchFn(block.name, stateId)) {
							// Filter: exposed (has transparent neighbor) + line-of-sight from bot eye
							if (useExposed) {
								if (!isExposed(pos)) continue;
								if (!bot.canSeeBlock(pos)) continue;
							}
							results.push(pos);
							if (results.length >= count) {
								bot.emit("debug", "findBlocks", {
									results: results.length,
									blocksChecked,
									chunksNull,
									maxDistance,
									exposed: useExposed,
								});
								return results;
							}
						}
					}
				}
			}
		}

		bot.emit("debug", "findBlocks", {
			results: results.length,
			blocksChecked,
			chunksNull,
			maxDistance,
			exposed: useExposed,
			loadedChunks: bot.world!.columns.size,
		});
		return results;
	};

	bot.findBlock = (options: FindBlockOptions) => {
		const results = bot.findBlocks({ ...options, count: 1 });
		return results.length > 0 ? bot.blockAt(results[0]!) : null;
	};

	bot.canSeeBlock = (block: Vec3) => {
		if (!bot.world) return false;
		const eye = vec3(
			bot.entity.position.x,
			bot.entity.position.y + PLAYER_EYE_HEIGHT,
			bot.entity.position.z,
		);
		const dx = Math.floor(block.x) + 0.5 - eye.x;
		const dy = Math.floor(block.y) + 0.5 - eye.y;
		const dz = Math.floor(block.z) + 0.5 - eye.z;
		const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (dist === 0) return true;
		const dir = vec3(dx / dist, dy / dist, dz / dist);
		const hit = raycast(bot.world, eye, dir, dist + 1);
		if (!hit) return true; // no solid blocks in the way
		return (
			Math.floor(hit.position.x) === Math.floor(block.x) &&
			Math.floor(hit.position.y) === Math.floor(block.y) &&
			Math.floor(hit.position.z) === Math.floor(block.z)
		);
	};

	bot.waitForChunksToLoad = async () => {
		// Wait until the chunk at bot position is loaded
		if (!bot.world) return;
		const pos = bot.entity.position;
		const cx = Math.floor(pos.x / 16);
		const cz = Math.floor(pos.z / 16);

		return new Promise<void>((resolve) => {
			const check = () => {
				try {
					worldGetBlockStateId(bot.world!, vec3(cx * 16, 0, cz * 16));
					// If we can read the block, chunk is loaded
					resolve();
				} catch {
					// Not loaded yet, wait for next chunk load
					bot.once("chunkColumnLoad", check);
				}
			};
			check();
		});
	};
};
