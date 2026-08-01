/**
 * Entity tracking — spawning, movement, metadata, equipment, player list.
 * Largest init function. Handles all entity lifecycle packets.
 */

import {
	addEffect,
	addPassenger,
	createEntity,
	type Entity,
	initEntity,
	invalidateEntity,
	removeEffect,
	removePassenger,
	setEquipment,
	setVehicle,
} from "../entity/index.ts";
import { fromNotch } from "../item/index.ts";
import {
	fromNotchianPitch,
	fromNotchianPitchByte,
	fromNotchianYaw,
	fromNotchianYawByte,
	fromNotchVelocity,
} from "./conversions.ts";
import type { Bot, BotOptions, Player, SkinData } from "./types.ts";

/** Writable version of Vec3 for entity position/velocity mutation. */
type MutableVec3 = { x: number; y: number; z: number };

export const initEntities = (bot: Bot, _options: BotOptions): void => {
	// ── Helpers ──

	const fetchEntity = (id: number): Entity => {
		const existing = bot.entities[id];
		if (existing) return existing;
		const entity = createEntity(id);
		bot.entities[id] = entity;
		return entity;
	};

	const FIXED_SCALE = 128 * 32; // 4096 — server fixed-point scale for 1.9+

	const updateEntityPos = (
		entity: Entity,
		packet: Record<string, unknown>,
		isFixed: boolean,
	) => {
		const pos = entity.position as MutableVec3;
		if (isFixed) {
			// Pre-1.9: position as fixed-point /32
			entity._fixedX = (packet.x as number) * (FIXED_SCALE / 32);
			entity._fixedY = (packet.y as number) * (FIXED_SCALE / 32);
			entity._fixedZ = (packet.z as number) * (FIXED_SCALE / 32);
		} else {
			// 1.9+: position as doubles
			entity._fixedX = Math.round((packet.x as number) * FIXED_SCALE);
			entity._fixedY = Math.round((packet.y as number) * FIXED_SCALE);
			entity._fixedZ = Math.round((packet.z as number) * FIXED_SCALE);
		}
		pos.x = entity._fixedX / FIXED_SCALE;
		pos.y = entity._fixedY / FIXED_SCALE;
		pos.z = entity._fixedZ / FIXED_SCALE;
	};

	const setEntityData = (entity: Entity, typeId: number) => {
		if (!bot.registry) return;
		initEntity(entity, bot.registry, typeId);
		bot.emit("debug", "entity", {
			event: "init",
			id: entity.id,
			typeId,
			name: entity.name,
			entityType: entity.entityType,
		});
	};

	const addNewPlayer = (
		entityId: number,
		uuid: string,
		packet: Record<string, unknown>,
	) => {
		const entity = fetchEntity(entityId);
		entity.type = "player";
		entity.uuid = uuid;
		entity.username = bot.uuidToUsername[uuid] ?? null;
		entity.height = 1.8;
		entity.width = 0.6;

		const isFixed = bot.supportFeature("fixedPointPosition");
		updateEntityPos(entity, packet, isFixed);

		if (packet.yaw != null) {
			entity.yaw = fromNotchianYawByte(packet.yaw as number);
		}
		if (packet.pitch != null) {
			entity.pitch = fromNotchianPitchByte(packet.pitch as number);
		}

		// Link to player object
		const username = entity.username;
		if (username && bot.players[username]) {
			bot.players[username]!.entity = entity;
		}

		return entity;
	};

	// ── Login — initialize bot's own entity ──

	bot.client.on("login", (packet: Record<string, unknown>) => {
		const entityId = packet.entityId as number;

		// Clear old state
		bot.entities = {};
		bot.players = {};
		bot.uuidToUsername = {};

		const entity = fetchEntity(entityId);
		entity.type = "player";
		entity.username = bot.username;
		entity.uuid = bot.client.uuid;
		entity.height = 1.8;
		entity.width = 0.6;
		bot.entity = entity;
		bot.player.entity = entity;
	});

	// ── Named entity spawn (players, pre-1.19) ──

	bot.client.on("named_entity_spawn", (packet: Record<string, unknown>) => {
		const uuid = packet.playerUUID as string;
		if (!bot.uuidToUsername[uuid]) return;
		const entity = addNewPlayer(packet.entityId as number, uuid, packet);
		bot.emit("entitySpawn", entity);
	});

	// ── Spawn entity (1.19+ unified, or objects pre-1.19) ──

	bot.client.on("add_entity", (packet: Record<string, unknown>) => {
		const typeId = packet.type as number;
		if (!bot.registry) return;

		// Check if it's a player (1.19+)
		const entityDef = bot.registry.entitiesById.get(typeId);
		if (entityDef?.type === "player" || entityDef?.name === "player") {
			const uuid = (packet.objectUUID ?? packet.entityUUID) as string;
			const entity = addNewPlayer(packet.entityId as number, uuid, packet);
			bot.emit("entitySpawn", entity);
			return;
		}

		const entity = fetchEntity(packet.entityId as number);
		setEntityData(entity, typeId);

		const isFixed = bot.supportFeature("fixedPointPosition");
		updateEntityPos(entity, packet, isFixed);

		if (packet.yaw != null) {
			entity.yaw = fromNotchianYawByte(packet.yaw as number);
		}
		if (packet.pitch != null) {
			entity.pitch = fromNotchianPitchByte(packet.pitch as number);
		}

		if (packet.velocityX != null) {
			const vel = entity.velocity as MutableVec3;
			vel.x = (packet.velocityX as number) / 8000;
			vel.y = (packet.velocityY as number) / 8000;
			vel.z = (packet.velocityZ as number) / 8000;
		}

		bot.emit("entitySpawn", entity);
	});

	// ── Spawn entity living (mobs, pre-1.19) ──

	bot.client.on("spawn_entity_living", (packet: Record<string, unknown>) => {
		const entity = fetchEntity(packet.entityId as number);
		setEntityData(entity, packet.type as number);

		const isFixed = bot.supportFeature("fixedPointPosition");
		updateEntityPos(entity, packet, isFixed);

		if (packet.yaw != null) {
			entity.yaw = fromNotchianYawByte(packet.yaw as number);
		}
		if (packet.pitch != null) {
			entity.pitch = fromNotchianPitchByte(packet.pitch as number);
		}

		// Velocity
		const vel = entity.velocity as MutableVec3;
		if (bot.supportFeature("entityVelocityIsLpVec3")) {
			const pvel = packet.velocity as { x: number; y: number; z: number };
			vel.x = pvel.x / 8000;
			vel.y = pvel.y / 8000;
			vel.z = pvel.z / 8000;
		} else if (packet.velocityX != null) {
			vel.x = (packet.velocityX as number) / 8000;
			vel.y = (packet.velocityY as number) / 8000;
			vel.z = (packet.velocityZ as number) / 8000;
		}

		bot.emit("entitySpawn", entity);
	});

	// ── XP orbs (pre-1.21.5) ──

	bot.client.on(
		"spawn_entity_experience_orb",
		(packet: Record<string, unknown>) => {
			const entity = fetchEntity(packet.entityId as number);
			entity.type = "orb";
			entity.name = "experience_orb";
			entity.height = 0.5;
			entity.width = 0.5;
			entity.count = (packet.count as number) ?? null;

			const isFixed = bot.supportFeature("fixedPointPosition");
			updateEntityPos(entity, packet, isFixed);

			bot.emit("entitySpawn", entity);
		},
	);

	// ── Entity destroy ──

	bot.client.on("remove_entities", (packet: Record<string, unknown>) => {
		const ids = (packet.entityIds as number[]) ?? [packet.entityId as number];
		for (const id of ids) {
			const entity = bot.entities[id];
			if (!entity) continue;

			invalidateEntity(entity);

			// Clean up player references
			if (entity.username) {
				const player = bot.players[entity.username];
				if (player) player.entity = null;
			}

			// Dismount if this was our vehicle
			if (bot.entity.vehicle === entity) {
				setVehicle(bot.entity, null);
				bot.emit("dismount", entity);
			}

			delete bot.entities[id];
			bot.emit("entityGone", entity);
		}
	});

	// 1.17+ uses destroy_entity for single entity
	bot.client.on("destroy_entity", (packet: Record<string, unknown>) => {
		bot.client.emit("entity_destroy", {
			entityIds: [packet.entityId as number],
		});
	});

	// ── Movement ──

	// ── Sync entity position (1.21.5+, absolute doubles) ──

	bot.client.on("entity_position_sync", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const pos = entity.position as MutableVec3;
		pos.x = packet.x as number;
		pos.y = packet.y as number;
		pos.z = packet.z as number;
		entity._fixedX = Math.round(pos.x * FIXED_SCALE);
		entity._fixedY = Math.round(pos.y * FIXED_SCALE);
		entity._fixedZ = Math.round(pos.z * FIXED_SCALE);

		if (packet.yaw != null) {
			entity.yaw = fromNotchianYaw(packet.yaw as number);
		}
		if (packet.pitch != null) {
			entity.pitch = fromNotchianPitch(packet.pitch as number);
		}
		entity.onGround = (packet.onGround as boolean) ?? entity.onGround;

		bot.emit("entityMoved", entity);
	});

	bot.client.on("move_entity_pos", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		// 1.9+: deltas are i16 in 4096-scale, add directly
		entity._fixedX += packet.dX as number;
		entity._fixedY += packet.dY as number;
		entity._fixedZ += packet.dZ as number;
		const pos = entity.position as MutableVec3;
		pos.x = entity._fixedX / FIXED_SCALE;
		pos.y = entity._fixedY / FIXED_SCALE;
		pos.z = entity._fixedZ / FIXED_SCALE;
		entity.onGround = (packet.onGround as boolean) ?? entity.onGround;

		bot.emit("entityMoved", entity);
	});

	bot.client.on("move_entity_rot", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;
		entity.yaw = fromNotchianYawByte(packet.yaw as number);
		entity.pitch = fromNotchianPitchByte(packet.pitch as number);
		entity.onGround = (packet.onGround as boolean) ?? entity.onGround;
		bot.emit("entityMoved", entity);
	});

	bot.client.on("move_entity_pos_rot", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		// 1.9+: deltas are i16 in 4096-scale, add directly
		entity._fixedX += packet.dX as number;
		entity._fixedY += packet.dY as number;
		entity._fixedZ += packet.dZ as number;
		const pos = entity.position as MutableVec3;
		pos.x = entity._fixedX / FIXED_SCALE;
		pos.y = entity._fixedY / FIXED_SCALE;
		pos.z = entity._fixedZ / FIXED_SCALE;
		entity.yaw = fromNotchianYawByte(packet.yaw as number);
		entity.pitch = fromNotchianPitchByte(packet.pitch as number);
		entity.onGround = (packet.onGround as boolean) ?? entity.onGround;

		bot.emit("entityMoved", entity);
	});

	bot.client.on("teleport_entity", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const isFixed = bot.supportFeature("fixedPointPosition");
		updateEntityPos(entity, packet, isFixed);
		entity.yaw = fromNotchianYawByte(packet.yaw as number);
		entity.pitch = fromNotchianPitchByte(packet.pitch as number);
		entity.onGround = (packet.onGround as boolean) ?? entity.onGround;

		bot.emit("entityMoved", entity);
	});

	bot.client.on("rotate_head", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;
		// headYaw stored separately but we keep yaw for the primary heading
		bot.emit("entityMoved", entity);
	});

	// ── Velocity ──

	bot.client.on("set_entity_motion", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		if (bot.supportFeature("entityVelocityIsLpVec3")) {
			const pvel = packet.velocity as { x: number; y: number; z: number };
			entity.velocity = fromNotchVelocity(pvel);
		} else {
			const vel = entity.velocity as MutableVec3;
			vel.x = (packet.velocityX as number) / 8000;
			vel.y = (packet.velocityY as number) / 8000;
			vel.z = (packet.velocityZ as number) / 8000;
		}
	});

	// ── Equipment ──

	bot.client.on("set_equipment", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity || !bot.registry) return;

		const equipments = (packet.equipments as Array<{
			slot: number;
			item: unknown;
		}>) ?? [{ slot: packet.slot as number, item: packet.item }];

		for (const equip of equipments) {
			const item = fromNotch(bot.registry, equip.item as never);
			setEquipment(entity, equip.slot, item);
		}

		bot.emit("entityEquip", entity);
	});

	// ── Entity status ──

	bot.client.on("entity_event", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const status = packet.entityStatus as number;
		switch (status) {
			case 2:
				bot.emit("entityHurt", entity, null);
				break;
			case 3:
				bot.emit("entityDead", entity);
				break;
			case 6:
				bot.emit("entityTaming", entity);
				break;
			case 7:
				bot.emit("entityTamed", entity);
				break;
			case 8:
				bot.emit("entityShakingOffWater", entity);
				break;
			case 10:
				bot.emit("entityEatingGrass", entity);
				break;
			case 55: {
				// Hand swap
				const main = entity.equipment[0];
				entity.equipment[0] = entity.equipment[1]!;
				entity.equipment[1] = main!;
				bot.emit("entityHandSwap", entity);
				break;
			}
		}
	});

	// ── Animation ──

	bot.client.on("animate", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const anim = packet.animation as number;
		switch (anim) {
			case 0:
				bot.emit("entitySwingArm", entity);
				break;
			case 1:
				bot.emit("entityHurt", entity, null);
				break;
			case 2:
				bot.emit("entityWake", entity);
				break;
			case 3:
				bot.emit("entityEat", entity);
				break;
			case 4:
				bot.emit("entityCriticalEffect", entity);
				break;
			case 5:
				bot.emit("entityMagicCriticalEffect", entity);
				break;
		}
	});

	// ── Entity metadata ──

	bot.client.on("set_entity_data", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const metadata = packet.metadata as Array<{
			key: number;
			value: unknown;
			type: number;
		}>;
		if (!metadata) return;

		entity.metadata = metadata;
		bot.emit("entityUpdate", entity);
	});

	// ── Effects ──

	bot.client.on("update_mob_effect", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const effect = {
			id: packet.effectId as number,
			amplifier: packet.amplifier as number,
			duration: packet.duration as number,
		};
		addEffect(entity, effect);
		bot.emit("entityEffect", entity, effect);
	});

	bot.client.on("remove_mob_effect", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const effectId = packet.effectId as number;
		removeEffect(entity, effectId);
		bot.emit("entityEffectEnd", entity, { id: effectId });
	});

	// ── Collect ──

	bot.client.on("take_item_entity", (packet: Record<string, unknown>) => {
		const collector = bot.entities[packet.collectorEntityId as number];
		const collected = bot.entities[packet.collectedEntityId as number];
		if (collector && collected) {
			bot.emit("playerCollect", collector, collected);
		}
	});

	// ── Attach / passengers ──

	bot.client.on("set_entity_link", (packet: Record<string, unknown>) => {
		const entity = bot.entities[packet.entityId as number];
		if (!entity) return;

		const vehicleId = packet.vehicleId as number;

		if (vehicleId === -1) {
			// Detach
			const vehicle = entity.vehicle;
			setVehicle(entity, null);
			if (vehicle) {
				removePassenger(vehicle, entity.id);
			}
			if (entity === bot.entity && vehicle) {
				bot.emit("dismount", vehicle);
			}
		} else {
			const vehicle = bot.entities[vehicleId];
			if (!vehicle) return;
			setVehicle(entity, vehicle);
			addPassenger(vehicle, entity);
			if (entity === bot.entity) {
				bot.emit("mount");
			}
		}
	});

	bot.client.on("set_passengers", (packet: Record<string, unknown>) => {
		const vehicleId = packet.entityId as number;
		const vehicle = bot.entities[vehicleId];
		if (!vehicle) return;

		const passengerIds = (packet.passengers as number[]) ?? [];

		// Clear old passengers
		for (const p of vehicle.passengers) {
			setVehicle(p, null);
		}
		vehicle.passengers = [];

		// Set new passengers
		for (const pid of passengerIds) {
			const passenger = bot.entities[pid];
			if (!passenger) continue;
			setVehicle(passenger, vehicle);
			addPassenger(vehicle, passenger);
		}

		// Check bot mount/dismount
		const botIsMounted = passengerIds.includes(bot.entity.id);
		if (botIsMounted && bot.entity.vehicle !== vehicle) {
			bot.emit("mount");
		} else if (!botIsMounted && bot.entity.vehicle === vehicle) {
			setVehicle(bot.entity, null);
			bot.emit("dismount", vehicle);
		}
	});

	// ── Player info ──

	bot.client.on("player_info_update", (packet: Record<string, unknown>) => {
		if (bot.supportFeature("playerInfoActionIsBitfield")) {
			handlePlayerInfoBitfield(packet);
		} else {
			handlePlayerInfoLegacy(packet);
		}
	});

	const handlePlayerInfoBitfield = (packet: Record<string, unknown>) => {
		const action = packet.action as number;
		const data = packet.data as Array<Record<string, unknown>>;

		for (const entry of data) {
			const uuid = entry.uuid as string;
			const isNew = !bot.uuidToUsername[uuid];

			// Add player
			if (action & 0x01) {
				const username = (entry.player as Record<string, unknown>)
					?.name as string;
				if (!username) continue;

				bot.uuidToUsername[uuid] = username;

				if (!bot.players[username]) {
					const player: Player = {
						uuid,
						username,
						displayName: null,
						gamemode: 0,
						ping: 0,
						entity: null,
						skinData: null,
					};

					// Extract skin data
					const properties = (entry.player as Record<string, unknown>)
						?.properties as Array<Record<string, unknown>> | undefined;
					if (properties) {
						const textures = properties.find((p) => p.name === "textures");
						if (textures?.value) {
							try {
								const decoded = JSON.parse(
									Buffer.from(textures.value as string, "base64").toString(),
								);
								const skin = decoded?.textures?.SKIN as Record<string, unknown>;
								if (skin?.url) {
									player.skinData = {
										url: skin.url as string,
										model:
											(skin.metadata as Record<string, string>)?.model ?? null,
									} satisfies SkinData;
								}
							} catch {
								// Ignore parse errors
							}
						}
					}

					bot.players[username] = player;

					// Link entity if already spawned
					for (const ent of Object.values(bot.entities)) {
						if (ent.uuid === uuid) {
							player.entity = ent;
							ent.username = username;
							break;
						}
					}

					bot.emit("playerJoined", player);
				}
			}

			// Update gamemode
			if (action & 0x04) {
				const username = bot.uuidToUsername[uuid];
				if (username && bot.players[username]) {
					bot.players[username]!.gamemode = entry.gamemode as number;
					if (!isNew) bot.emit("playerUpdated", bot.players[username]!);
				}
			}

			// Update latency
			if (action & 0x10) {
				const username = bot.uuidToUsername[uuid];
				if (username && bot.players[username]) {
					bot.players[username]!.ping = entry.latency as number;
					if (!isNew) bot.emit("playerUpdated", bot.players[username]!);
				}
			}

			// Update display name
			if (action & 0x20) {
				const username = bot.uuidToUsername[uuid];
				if (username && bot.players[username]) {
					bot.players[username]!.displayName =
						(entry.displayName as never) ?? null;
					if (!isNew) bot.emit("playerUpdated", bot.players[username]!);
				}
			}
		}
	};

	const handlePlayerInfoLegacy = (packet: Record<string, unknown>) => {
		const action = packet.action as number;
		const data = packet.data as Array<Record<string, unknown>>;

		for (const entry of data) {
			const uuid = entry.UUID as string;

			if (action === 0) {
				// Add player
				const username = entry.name as string;
				if (!username) continue;

				bot.uuidToUsername[uuid] = username;

				const player: Player = {
					uuid,
					username,
					displayName: (entry.displayName as never) ?? null,
					gamemode: (entry.gamemode as number) ?? 0,
					ping: (entry.ping as number) ?? 0,
					entity: null,
					skinData: null,
				};

				bot.players[username] = player;
				bot.emit("playerJoined", player);
			} else if (action === 4) {
				// Remove player
				const username = bot.uuidToUsername[uuid];
				if (username && bot.players[username]) {
					const player = bot.players[username]!;
					if (player.entity) player.entity = null;
					delete bot.players[username];
					delete bot.uuidToUsername[uuid];
					bot.emit("playerLeft", player);
				}
			} else {
				// Update
				const username = bot.uuidToUsername[uuid];
				if (!username || !bot.players[username]) continue;
				const player = bot.players[username]!;

				if (action === 1) player.gamemode = entry.gamemode as number;
				if (action === 2) player.ping = entry.ping as number;
				if (action === 3)
					player.displayName = (entry.displayName as never) ?? null;

				bot.emit("playerUpdated", player);
			}
		}
	};

	// 1.19.3+ player_remove
	bot.client.on("player_info_remove", (packet: Record<string, unknown>) => {
		const uuids = packet.players as string[];
		if (!uuids) return;

		for (const uuid of uuids) {
			const username = bot.uuidToUsername[uuid];
			if (!username || !bot.players[username]) continue;
			const player = bot.players[username]!;
			if (player.entity) player.entity = null;
			delete bot.players[username];
			delete bot.uuidToUsername[uuid];
			bot.emit("playerLeft", player);
		}
	});

	// ── Attributes ──

	bot.client.on(
		"entity_update_attributes",
		(packet: Record<string, unknown>) => {
			const entityId = packet.entityId as number;
			const entity = bot.entities[entityId];
			if (!entity) return;

			const properties = packet.properties as Array<{
				key: string;
				value: number;
				modifiers: Array<{
					uuid: string;
					amount: number;
					operation: number;
				}>;
			}>;

			if (!properties) return;

			for (const prop of properties) {
				entity.attributes[prop.key] = {
					value: prop.value,
					modifiers: (prop.modifiers ?? []).map((m) => ({
						uuid: m.uuid,
						amount: m.amount,
						operation: m.operation,
					})),
				};
			}

			bot.emit("entityAttributes", entity);
		},
	);

	bot.client.on("update_attributes", (packet: Record<string, unknown>) => {
		const entityId = packet.entityId as number;
		const entity = bot.entities[entityId];
		if (!entity) return;

		const properties = packet.properties as Array<{
			key: string;
			value: number;
			modifiers: Array<{
				uuid: string;
				amount: number;
				operation: number;
			}>;
		}>;

		if (!properties) return;

		for (const prop of properties) {
			entity.attributes[prop.key] = {
				value: prop.value,
				modifiers: (prop.modifiers ?? []).map((m) => ({
					uuid: m.uuid,
					amount: m.amount,
					operation: m.operation,
				})),
			};
		}

		bot.emit("entityAttributes", entity);
	});

	// ── Bot methods ──

	bot.nearestEntity = (filter?: (entity: Entity) => boolean): Entity | null => {
		let nearest: Entity | null = null;
		let bestDist = Number.POSITIVE_INFINITY;

		for (const entity of Object.values(bot.entities)) {
			if (entity === bot.entity) continue;
			if (filter && !filter(entity)) continue;
			const dx = entity.position.x - bot.entity.position.x;
			const dy = entity.position.y - bot.entity.position.y;
			const dz = entity.position.z - bot.entity.position.z;
			const dist = dx * dx + dy * dy + dz * dz;
			if (dist < bestDist) {
				bestDist = dist;
				nearest = entity;
			}
		}

		return nearest;
	};

	bot.swingArm = (hand?: "left" | "right", _showHand?: boolean) => {
		bot.client.write("swing", {
			hand: hand === "left" ? 1 : 0,
		});
	};

	bot.attack = (target: Entity) => {
		if (bot.supportFeature("armAnimationBeforeUse")) {
			bot.swingArm();
		}

		bot.client.write("interact", {
			target: target.id,
			mouse: 1,
			sneaking: bot.controlState.sneak,
		});

		if (!bot.supportFeature("armAnimationBeforeUse")) {
			bot.swingArm();
		}
	};

	bot.useOn = (target: Entity) => {
		bot.client.write("interact", {
			target: target.id,
			mouse: 0,
			sneaking: bot.controlState.sneak,
		});
	};

	bot.mount = (target: Entity) => {
		bot.useOn(target);
	};

	bot.dismount = () => {
		if (!bot.entity.vehicle) return;

		if (bot.supportFeature("newPlayerInputPacket")) {
			bot.client.write("player_input", {
				sideways: 0,
				forward: 0,
				jump: true,
				unmount: true,
			});
		} else {
			bot.client.write("steer_vehicle", {
				sideways: 0,
				forward: 0,
				jump: 0x02,
			});
		}
	};

	bot.moveVehicle = (left: number, forward: number) => {
		if (bot.supportFeature("newPlayerInputPacket")) {
			bot.client.write("player_input", {
				sideways: left,
				forward,
				jump: false,
				unmount: false,
			});
		} else {
			bot.client.write("steer_vehicle", {
				sideways: left,
				forward,
				jump: 0,
			});
		}
	};

	bot.findPlayers = (
		filter: string | RegExp | ((player: Player) => boolean),
	): Entity[] => {
		const results: Entity[] = [];

		for (const username of Object.keys(bot.players)) {
			const player = bot.players[username];
			if (!player?.entity) continue;

			let matches = false;
			if (typeof filter === "string") {
				matches = player.username === filter;
			} else if (filter instanceof RegExp) {
				matches = filter.test(player.username);
			} else {
				matches = filter(player);
			}

			if (matches) results.push(player.entity);
		}

		return results;
	};

	bot.findPlayer = (
		filter: string | RegExp | ((player: Player) => boolean),
	): Entity | null => {
		const results = bot.findPlayers(filter);
		return results[0] ?? null;
	};

	// Emit bot's entitySpawn when first spawn happens
	bot.once("spawn", () => {
		bot.emit("entitySpawn", bot.entity);
	});
};
