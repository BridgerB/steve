/**
 * Extended features — bed, title, book, sound, explosion, particle,
 * resource pack, kick, fishing, ray trace.
 */

import { stateIdToBlock } from "../block.ts";
import type { Entity } from "../entity/index.ts";
import { type Vec3, vec3 } from "../vec3/index.ts";
import {
	directionFromYawPitch,
	PLAYER_EYE_HEIGHT,
	raycast,
} from "../world/index.ts";
import type {
	Bot,
	BotOptions,
	CommandBlockOptions,
	Particle,
	Task,
} from "./types.ts";
import { createTask, nextSequence } from "./utils.ts";

export const initExtended = (bot: Bot, _options: BotOptions): void => {
	// ── Sleeping ──

	bot.sleep = async (bedBlock: Vec3): Promise<void> => {
		bot.client.write("use_item_on", {
			location: { x: bedBlock.x, y: bedBlock.y, z: bedBlock.z },
			direction: 0,
			hand: 0,
			cursorX: 0.5,
			cursorY: 0.5,
			cursorZ: 0.5,
			insideBlock: false,
			sequence: nextSequence(),
		});

		// Wait for sleep confirmation
		return new Promise<void>((resolve) => {
			const onMetadata = () => {
				if (bot.isSleeping) {
					bot.removeListener("entityUpdate", onMetadata);
					bot.emit("sleep");
					resolve();
				}
			};
			bot.on("entityUpdate", onMetadata);
			setTimeout(() => {
				bot.removeListener("entityUpdate", onMetadata);
				resolve();
			}, 3000);
		});
	};

	bot.wake = async (): Promise<void> => {
		bot.client.write("player_command", {
			entityId: bot.entity.id,
			actionId: bot.supportFeature("entityActionUsesStringMapper")
				? "leave_bed"
				: 2,
			jumpBoost: 0,
		});
		bot.isSleeping = false;
		bot.emit("wake");
	};

	// ── Title ──

	bot.client.on("set_title_text", (packet: Record<string, unknown>) => {
		const text = (packet.text as string) ?? "";
		bot.emit("title", text, "title");
	});

	bot.client.on("set_subtitle_text", (packet: Record<string, unknown>) => {
		const text = (packet.text as string) ?? "";
		bot.emit("title", text, "subtitle");
	});

	// Legacy title packet
	bot.client.on("title", (packet: Record<string, unknown>) => {
		const action = packet.action as number;
		if (action === 0) {
			bot.emit("title", (packet.text as string) ?? "", "title");
		} else if (action === 1) {
			bot.emit("title", (packet.text as string) ?? "", "subtitle");
		}
	});

	// ── Sound ──

	bot.client.on("sound", (packet: Record<string, unknown>) => {
		const soundId = packet.soundId as number;
		const soundCategory = (packet.soundCategory as number) ?? 0;
		const x = ((packet.x as number) ?? 0) / 8;
		const y = ((packet.y as number) ?? 0) / 8;
		const z = ((packet.z as number) ?? 0) / 8;
		const volume = (packet.volume as number) ?? 1;
		const pitch = (packet.pitch as number) ?? 1;

		bot.emit(
			"hardcodedSoundEffectHeard",
			soundId,
			soundCategory,
			vec3(x, y, z),
			volume,
			pitch,
		);
	});

	bot.client.on("named_sound_effect", (packet: Record<string, unknown>) => {
		const soundName = (packet.soundName as string) ?? "";
		const x = ((packet.x as number) ?? 0) / 8;
		const y = ((packet.y as number) ?? 0) / 8;
		const z = ((packet.z as number) ?? 0) / 8;
		const volume = (packet.volume as number) ?? 1;
		const pitch = (packet.pitch as number) ?? 1;

		bot.emit("soundEffectHeard", soundName, vec3(x, y, z), volume, pitch);
	});

	// ── Particle ──

	bot.client.on("level_particles", (packet: Record<string, unknown>) => {
		const particle: Particle = {
			id: (packet.particleId as number) ?? 0,
			position: vec3(
				packet.x as number,
				packet.y as number,
				packet.z as number,
			),
			offset: vec3(
				(packet.offsetX as number) ?? 0,
				(packet.offsetY as number) ?? 0,
				(packet.offsetZ as number) ?? 0,
			),
			count: (packet.particles as number) ?? 1,
			movementSpeed: (packet.particleData as number) ?? 0,
			longDistanceRender: (packet.longDistance as boolean) ?? false,
		};
		bot.emit("particle", particle);
	});

	// ── Resource pack ──

	bot.client.on("resource_pack_send", (packet: Record<string, unknown>) => {
		const url = packet.url as string;
		const hash = packet.hash as string | undefined;
		const uuid = packet.uuid as string | undefined;
		bot.emit("resourcePack", url, hash, uuid);
	});

	bot.acceptResourcePack = () => {
		bot.client.write("resource_pack", {
			result: 3, // accepted
		});
		bot.client.write("resource_pack", {
			result: 0, // loaded
		});
	};

	bot.denyResourcePack = () => {
		bot.client.write("resource_pack", {
			result: 1, // declined
		});
	};

	// ── Fishing ──

	let fishingTask: Task<void> | null = null;
	let lastBobber: { id: number; position: Vec3 } | null = null;

	// Determine bobber entity ID
	bot.on("login", () => {
		// Set up bobber tracking once registry is available
	});

	// Track bobber spawn
	bot.client.on("add_entity", (packet: Record<string, unknown>) => {
		if (!fishingTask || lastBobber) return;
		const registry = bot.registry;
		if (!registry) return;

		let bobberId = 90;
		const bobberDef = registry.entitiesByName.get("fishing_bobber");
		if (bobberDef) bobberId = bobberDef.id;

		if ((packet.type as number) === bobberId) {
			const entityId = packet.entityId as number;
			const entity = bot.entities[entityId];
			if (entity) {
				lastBobber = entity;
			}
		}
	});

	// Detect bite via particles
	bot.client.on("level_particles", (packet: Record<string, unknown>) => {
		if (!lastBobber || !fishingTask) return;

		const pos = lastBobber.position;
		const particleObj = packet.particle as { type?: string } | undefined;
		const amount =
			(packet.particles as number) ?? (packet.amount as number) ?? 0;

		// Check for fishing/bubble particles, amount=6, within 1.23 blocks XZ
		const isFishingParticle =
			particleObj?.type === "fishing" || particleObj?.type === "bubble";
		const isCorrectAmount = amount === 6;

		if (isFishingParticle && isCorrectAmount) {
			const px = packet.x as number;
			const pz = packet.z as number;
			const dx = px - pos.x;
			const dz = pz - pos.z;
			const distXZ = Math.sqrt(dx * dx + dz * dz);

			if (distXZ <= 1.23) {
				bot.activateItem(); // reel in
				lastBobber = null;
				if (fishingTask) {
					fishingTask.finish(undefined as never);
					fishingTask = null;
				}
			}
		}
	});

	// Track bobber destruction
	bot.client.on("remove_entities", (packet: Record<string, unknown>) => {
		if (!lastBobber) return;
		const entityIds = packet.entityIds as number[] | undefined;
		if (entityIds?.includes(lastBobber.id)) {
			lastBobber = null;
			if (fishingTask) {
				fishingTask.cancel(new Error("Fishing cancelled"));
				fishingTask = null;
			}
		}
	});

	bot.fish = async (): Promise<void> => {
		// Cancel any existing fishing task
		if (fishingTask) {
			fishingTask.cancel(new Error("Fishing cancelled due to re-cast"));
			fishingTask = null;
		}

		lastBobber = null;
		fishingTask = createTask<void>();

		bot.activateItem(); // cast

		await fishingTask.promise;
	};

	// ── Block at cursor ──

	bot.blockAtCursor = (maxDistance = 5) => {
		if (!bot.world || !bot.registry) return null;
		const eye = vec3(
			bot.entity.position.x,
			bot.entity.position.y + PLAYER_EYE_HEIGHT,
			bot.entity.position.z,
		);
		const dir = directionFromYawPitch(bot.entity.yaw, bot.entity.pitch);
		const hit = raycast(bot.world, eye, dir, maxDistance);
		if (!hit) return null;
		const blockInfo = stateIdToBlock(bot.registry, hit.stateId);
		return {
			position: hit.position,
			face: hit.face,
			intersect: hit.intersect,
			name: hit.name,
			stateId: hit.stateId,
			properties: blockInfo.properties,
		};
	};

	// ── Command block ──

	bot.setCommandBlock = (
		pos: Vec3,
		command: string,
		options: CommandBlockOptions,
	) => {
		bot.client.write("set_command_block", {
			location: { x: pos.x, y: pos.y, z: pos.z },
			command,
			mode: options.mode,
			flags:
				(options.trackOutput ? 0x01 : 0) |
				(options.conditional ? 0x02 : 0) |
				(options.alwaysActive ? 0x04 : 0),
		});
	};

	// ── Sign writing ──

	bot.updateSign = (block: Vec3, text: string, back?: boolean) => {
		const lines = text.split("\n");
		while (lines.length < 4) lines.push("");

		bot.client.write("sign_update", {
			location: { x: block.x, y: block.y, z: block.z },
			isFrontText: !back,
			text1: JSON.stringify(lines[0]),
			text2: JSON.stringify(lines[1]),
			text3: JSON.stringify(lines[2]),
			text4: JSON.stringify(lines[3]),
		});
	};

	// ── Book writing ──

	bot.writeBook = async (slot: number, pages: string[]): Promise<void> => {
		// Move book to quickbar if needed
		const quickBarStart = 36;
		let bookSlot = slot;
		if (slot < quickBarStart || slot >= quickBarStart + 9) {
			await bot.moveSlotItem(slot, quickBarStart);
			bookSlot = quickBarStart;
		}
		bot.setQuickBarSlot(bookSlot - quickBarStart);

		bot.client.write("edit_book", {
			hand: 0,
			pages,
			title: undefined,
		});
	};

	bot.signBook = async (
		slot: number,
		pages: string[],
		title: string,
		author: string,
	): Promise<void> => {
		// Move book to quickbar if needed
		const quickBarStart = 36;
		let bookSlot = slot;
		if (slot < quickBarStart || slot >= quickBarStart + 9) {
			await bot.moveSlotItem(slot, quickBarStart);
			bookSlot = quickBarStart;
		}
		bot.setQuickBarSlot(bookSlot - quickBarStart);

		bot.client.write("edit_book", {
			hand: 0,
			pages,
			title,
			author,
		});
	};

	// ── Entity at cursor ──

	// ── Explosion damage ──

	bot.getExplosionDamages = (
		targetEntity: Entity,
		explosionPos: Vec3,
		power: number,
		rawDamages?: boolean,
	): number => {
		const radius = 2 * power;
		const pos = targetEntity.position;
		const w = targetEntity.width / 2;
		const h = targetEntity.height;

		// Distance check
		const dx = pos.x - explosionPos.x;
		const dy = pos.y + h / 2 - explosionPos.y;
		const dz = pos.z - explosionPos.z;
		const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

		if (distance >= radius) return 0;

		// Calculate exposure by sampling rays from explosion to entity AABB
		const stepX = 1 / (targetEntity.width * 2 + 1);
		const stepY = 1 / (targetEntity.height * 2 + 1);
		const stepZ = stepX;

		let blocked = 0;
		let total = 0;

		for (let fx = 0; fx <= 1; fx += stepX) {
			for (let fy = 0; fy <= 1; fy += stepY) {
				for (let fz = 0; fz <= 1; fz += stepZ) {
					const testX = pos.x - w + fx * targetEntity.width;
					const testY = pos.y + fy * h;
					const testZ = pos.z - w + fz * targetEntity.width;

					// Check if ray from explosion to this point is blocked
					if (bot.world) {
						const rayDir = vec3(
							testX - explosionPos.x,
							testY - explosionPos.y,
							testZ - explosionPos.z,
						);
						const rayLen = Math.sqrt(
							rayDir.x * rayDir.x + rayDir.y * rayDir.y + rayDir.z * rayDir.z,
						);
						if (rayLen > 0) {
							const normDir = vec3(
								rayDir.x / rayLen,
								rayDir.y / rayLen,
								rayDir.z / rayLen,
							);
							const hit = raycast(bot.world, explosionPos, normDir, rayLen);
							if (hit) {
								blocked++;
							}
						}
					}
					total++;
				}
			}
		}

		const exposure = total > 0 ? 1 - blocked / total : 1;
		const impact = (1 - distance / radius) * exposure;

		let damages = Math.floor((impact * impact + impact) * 7 * power + 1);

		if (!rawDamages) {
			// Apply armor reduction (simplified — use entity armor attribute if available)
			const armorAttr = targetEntity.attributes["minecraft:generic.armor"];
			const armorToughness =
				targetEntity.attributes["minecraft:generic.armor_toughness"];
			const armor = armorAttr?.value ?? 0;
			const toughness = armorToughness?.value ?? 0;

			if (armor > 0) {
				const reducedArmor = Math.max(
					armor / 5,
					armor - damages / (2 + toughness / 4),
				);
				damages = Math.floor(damages * (1 - Math.min(20, reducedArmor) / 25));
			}
		}

		return Math.max(0, damages);
	};

	// ── Entity at cursor ──

	bot.entityAtCursor = (maxDistance = 3.5): Entity | null => {
		const eye = vec3(
			bot.entity.position.x,
			bot.entity.position.y + PLAYER_EYE_HEIGHT,
			bot.entity.position.z,
		);
		const dir = directionFromYawPitch(bot.entity.yaw, bot.entity.pitch);

		let closestEntity: Entity | null = null;
		let closestDist = maxDistance;

		for (const entityId of Object.keys(bot.entities)) {
			const entity = bot.entities[Number(entityId)];
			if (!entity || entity.id === bot.entity.id) continue;
			if (!entity.isValid) continue;

			const pos = entity.position;
			const w = entity.width / 2;
			const h = entity.height;

			// AABB bounds
			const minX = pos.x - w;
			const maxX = pos.x + w;
			const minY = pos.y;
			const maxY = pos.y + h;
			const minZ = pos.z - w;
			const maxZ = pos.z + w;

			// Ray-AABB intersection (slab method)
			let tmin = -Infinity;
			let tmax = Infinity;

			// X slab
			if (dir.x !== 0) {
				const t1 = (minX - eye.x) / dir.x;
				const t2 = (maxX - eye.x) / dir.x;
				tmin = Math.max(tmin, Math.min(t1, t2));
				tmax = Math.min(tmax, Math.max(t1, t2));
			} else if (eye.x < minX || eye.x > maxX) {
				continue;
			}

			// Y slab
			if (dir.y !== 0) {
				const t1 = (minY - eye.y) / dir.y;
				const t2 = (maxY - eye.y) / dir.y;
				tmin = Math.max(tmin, Math.min(t1, t2));
				tmax = Math.min(tmax, Math.max(t1, t2));
			} else if (eye.y < minY || eye.y > maxY) {
				continue;
			}

			// Z slab
			if (dir.z !== 0) {
				const t1 = (minZ - eye.z) / dir.z;
				const t2 = (maxZ - eye.z) / dir.z;
				tmin = Math.max(tmin, Math.min(t1, t2));
				tmax = Math.min(tmax, Math.max(t1, t2));
			} else if (eye.z < minZ || eye.z > maxZ) {
				continue;
			}

			if (tmax < 0 || tmin > tmax) continue;

			const hitDist = tmin >= 0 ? tmin : tmax;
			if (hitDist < closestDist) {
				closestDist = hitDist;
				closestEntity = entity;
			}
		}

		return closestEntity;
	};
};
