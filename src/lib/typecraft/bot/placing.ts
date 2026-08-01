/**
 * Block placement and activation.
 * Combines upstream place_block.js, generic_place.js, place_entity.js.
 */

import type { Entity } from "../entity/index.ts";
import { type Vec3, vec3 } from "../vec3/index.ts";
import type { Block, Bot, BotOptions, PlaceBlockOptions } from "./types.ts";
import { nextSequence, once } from "./utils.ts";

export const initPlacing = (bot: Bot, _options: BotOptions): void => {
	const _genericPlace = async (
		block: Vec3,
		faceVector: Vec3,
		options: PlaceBlockOptions = {},
	): Promise<void> => {
		const hand = options.offhand ? 1 : 0;

		// Calculate cursor position
		let dx = 0.5 + faceVector.x * 0.5;
		let dy = 0.5 + faceVector.y * 0.5;
		let dz = 0.5 + faceVector.z * 0.5;

		// Half-block adjustment for slabs/stairs
		if (dy === 0.5) {
			if (options.half === "top") dy += 0.25;
			else if (options.half === "bottom") dy -= 0.25;
		}

		// Custom delta override
		if (options.delta) {
			dx = options.delta.x;
			dy = options.delta.y;
			dz = options.delta.z;
		}

		// Look at the placement point and lock for duration
		const lookTarget = vec3(block.x + dx, block.y + dy, block.z + dz);
		if (options.forceLook !== "ignore") {
			bot.lockLook(lookTarget);
			await bot.lookAt(lookTarget, options.forceLook === true);
		}

		// Swing arm
		if (options.swingArm) {
			bot.swingArm(options.swingArm, options.showHand);
		} else {
			bot.swingArm();
		}

		const face = vecToFace(faceVector);

		if (bot.supportFeature("blockPlaceHasInsideBlock")) {
			bot.client.write("use_item_on", {
				location: { x: block.x, y: block.y, z: block.z },
				direction: face,
				hand,
				cursorX: dx,
				cursorY: dy,
				cursorZ: dz,
				insideBlock: false,
				worldBorderHit: false,
				sequence: nextSequence(),
			});
		} else if (bot.supportFeature("blockPlaceHasHandAndFloatCursor")) {
			bot.client.write("use_item_on", {
				location: { x: block.x, y: block.y, z: block.z },
				direction: face,
				hand,
				cursorX: dx,
				cursorY: dy,
				cursorZ: dz,
			});
		} else if (bot.supportFeature("blockPlaceHasHandAndIntCursor")) {
			bot.client.write("use_item_on", {
				location: { x: block.x, y: block.y, z: block.z },
				direction: face,
				hand,
				cursorX: Math.floor(dx * 16),
				cursorY: Math.floor(dy * 16),
				cursorZ: Math.floor(dz * 16),
			});
		} else {
			bot.client.write("use_item_on", {
				location: { x: block.x, y: block.y, z: block.z },
				direction: face,
				heldItem: { blockId: -1 },
				cursorX: Math.floor(dx * 16),
				cursorY: Math.floor(dy * 16),
				cursorZ: Math.floor(dz * 16),
			});
		}
	};

	bot.activateBlock = async (
		block: Vec3,
		direction?: Vec3,
		cursorPos?: Vec3,
	): Promise<void> => {
		// Validate distance — server ignores interactions beyond ~4.5 blocks
		const dx = bot.entity.position.x - (block.x + 0.5);
		const dy = bot.entity.position.y - (block.y + 0.5);
		const dz = bot.entity.position.z - (block.z + 0.5);
		const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (dist > 6) {
			throw new Error(
				`Too far to interact with block (dist=${dist.toFixed(1)}, max=6)`,
			);
		}

		const faceVector = direction ?? vec3(0, 1, 0);
		await _genericPlace(block, faceVector, {
			delta: cursorPos,
			forceLook: "ignore",
		});
	};

	bot.placeBlockWithOptions = async (
		referenceBlock: unknown,
		faceVector: Vec3,
		options?: PlaceBlockOptions,
	): Promise<void> => {
		const block = referenceBlock as { position: Vec3 };
		if (!block.position) return;

		const dest = vec3(
			block.position.x + faceVector.x,
			block.position.y + faceVector.y,
			block.position.z + faceVector.z,
		);

		bot.emit("debug", "place", {
			event: "start",
			ref: { x: block.position.x, y: block.position.y, z: block.position.z },
			dest: { x: dest.x, y: dest.y, z: dest.z },
			face: { x: faceVector.x, y: faceVector.y, z: faceVector.z },
			held: bot.heldItem?.name ?? null,
		});

		await _genericPlace(block.position, faceVector, {
			forceLook: true,
			...options,
		});

		// Wait for block update confirmation — accept ANY block change at dest
		try {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					bot.removeListener("blockUpdate", onUpdate);
					bot.emit("debug", "place", {
						event: "timeout",
						dest: { x: dest.x, y: dest.y, z: dest.z },
					});
					reject(new Error("Place block timeout"));
				}, 5000);

				const onUpdate = (
					pos: unknown,
					oldStateId: unknown,
					newStateId: unknown,
				) => {
					const p = pos as Vec3;
					if (!p || typeof p.x !== "number") return;
					if (p.x === dest.x && p.y === dest.y && p.z === dest.z) {
						if (oldStateId !== newStateId) {
							clearTimeout(timeout);
							bot.removeListener("blockUpdate", onUpdate);
							bot.emit("debug", "place", {
								event: "confirmed",
								dest: { x: dest.x, y: dest.y, z: dest.z },
								newStateId,
							});
							bot.emit("blockPlaced", pos, pos);
							resolve();
						}
					}
				};

				bot.on("blockUpdate", onUpdate);
			});
		} finally {
			bot.unlockLook();
		}
	};

	bot.placeBlock = async (
		referenceBlock: Block,
		faceVector: Vec3,
	): Promise<void> => {
		await bot.placeBlockWithOptions(referenceBlock, faceVector);
	};

	bot.placeEntity = async (
		referenceBlock: unknown,
		faceVector: Vec3,
	): Promise<Entity> => {
		const block = referenceBlock as { position: Vec3 };
		if (!block.position) throw new Error("Invalid block for entity placement");

		await bot.activateBlock(block.position, faceVector);

		// Wait for entity spawn
		const [entity] = await once<[Entity]>(bot, "entitySpawn", 5000);
		return entity;
	};
};

const vecToFace = (dir: Vec3): number => {
	if (dir.y === -1) return 0; // bottom
	if (dir.y === 1) return 1; // top
	if (dir.z === -1) return 2; // north
	if (dir.z === 1) return 3; // south
	if (dir.x === -1) return 4; // west
	if (dir.x === 1) return 5; // east
	return 1; // default top
};
