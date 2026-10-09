/**
 * Minecraft player physics simulation.
 * Replaces prismarine-physics with a functional API.
 */

import type { Entity } from "../entity/types.ts";
import { getEnchants } from "../item/item.ts";
import type { Registry } from "../registry/types.ts";
import {
	cloneAABB,
	computeOffsetX,
	computeOffsetY,
	computeOffsetZ,
	contractAABB,
	createAABB,
	extendAABB,
	intersectsAABB,
	offsetAABB,
} from "./aabb.ts";
import {
	addAttributeModifier,
	createAttributeValue,
	deleteAttributeModifier,
	getAttributeValue,
	hasAttributeModifier,
} from "./attribute.ts";
import type {
	AABB,
	MutableVec3,
	PhysicsBlock,
	PhysicsConfig,
	PhysicsEngine,
	PhysicsWorld,
	PlayerControls,
	PlayerState,
} from "./types.ts";

// ── Version-gated features ──

type PhysicsFeature =
	| "independentLiquidGravity"
	| "proportionalLiquidGravity"
	| "velocityBlocksOnCollision"
	| "velocityBlocksOnTop"
	| "climbUsingJump"
	| "climbableTrapdoor";

const FEATURES: readonly {
	name: PhysicsFeature;
	versions: readonly string[];
}[] = [
	{
		name: "independentLiquidGravity",
		versions: ["1.8", "1.9", "1.10", "1.11", "1.12"],
	},
	{
		name: "proportionalLiquidGravity",
		versions: [
			"1.13",
			"1.14",
			"1.15",
			"1.16",
			"1.17",
			"1.18",
			"1.19",
			"1.20",
			"1.21",
		],
	},
	{
		name: "velocityBlocksOnCollision",
		versions: ["1.8", "1.9", "1.10", "1.11", "1.12", "1.13", "1.14"],
	},
	{
		name: "velocityBlocksOnTop",
		versions: ["1.15", "1.16", "1.17", "1.18", "1.19", "1.20"],
	},
	{
		name: "climbUsingJump",
		versions: ["1.14", "1.15", "1.16", "1.17", "1.18", "1.19", "1.20"],
	},
	{
		name: "climbableTrapdoor",
		versions: [
			"1.9",
			"1.10",
			"1.11",
			"1.12",
			"1.13",
			"1.14",
			"1.15",
			"1.16",
			"1.17",
			"1.18",
			"1.19",
			"1.20",
		],
	},
];

const clamp = (min: number, x: number, max: number): number =>
	Math.max(min, Math.min(x, max));

const normalizeVec3 = (v: { x: number; y: number; z: number }): void => {
	const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
	if (len > 0) {
		v.x /= len;
		v.y /= len;
		v.z /= len;
	}
};

// ── Factory ──

/** Create a physics engine for a specific Minecraft version. */
export const createPhysics = (registry: Registry): PhysicsEngine => {
	const supportFeature = (feature: PhysicsFeature): boolean =>
		FEATURES.some(
			({ name, versions }) =>
				name === feature && versions.includes(registry.version.majorVersion),
		);

	// ── Pre-compute block IDs ──

	const blockId = (name: string): number =>
		registry.blocksByName.get(name)?.id ?? -1;

	const slimeBlockId =
		blockId("slime_block") !== -1 ? blockId("slime_block") : blockId("slime");
	const soulsandId = blockId("soul_sand");
	const honeyblockId = blockId("honey_block");
	const webId = blockId("cobweb") !== -1 ? blockId("cobweb") : blockId("web");
	const waterId = blockId("water");
	const flowingWaterId = blockId("flowing_water");
	const lavaId = blockId("lava");
	const flowingLavaId = blockId("flowing_lava");
	const ladderId = blockId("ladder");
	const vineId = blockId("vine");
	const bubblecolumnId = blockId("bubble_column");
	const powderSnowId = blockId("powder_snow");

	const waterIds = new Set([waterId, flowingWaterId].filter((id) => id !== -1));
	const lavaIds = new Set([lavaId, flowingLavaId].filter((id) => id !== -1));

	const idsFromNames = (names: readonly string[]) =>
		new Set(names.map(blockId).filter((id) => id !== -1));

	const waterLike = idsFromNames([
		"seagrass",
		"tall_seagrass",
		"kelp",
		"kelp_plant",
		"bubble_column",
	]);

	const trapdoorIds = idsFromNames([
		"iron_trapdoor",
		"acacia_trapdoor",
		"birch_trapdoor",
		"jungle_trapdoor",
		"oak_trapdoor",
		"dark_oak_trapdoor",
		"spruce_trapdoor",
		"crimson_trapdoor",
		"warped_trapdoor",
		"mangrove_trapdoor",
		"cherry_trapdoor",
	]);

	// ── Block slipperiness ──

	const blockSlipperiness = new Map<number, number>();
	blockSlipperiness.set(slimeBlockId, 0.8);
	blockSlipperiness.set(blockId("ice"), 0.98);
	blockSlipperiness.set(blockId("packed_ice"), 0.98);
	const frostedIceId = blockId("frosted_ice");
	if (frostedIceId !== -1) blockSlipperiness.set(frostedIceId, 0.98);
	const blueIceId = blockId("blue_ice");
	if (blueIceId !== -1) blockSlipperiness.set(blueIceId, 0.989);

	// ── Physics config ──

	const movementSpeedAttr = registry.attributesByName.get("movementSpeed");
	const movementSpeedResource =
		movementSpeedAttr?.resource ?? "generic.movement_speed";

	const gravity = 0.08;
	const independentGravity = supportFeature("independentLiquidGravity");
	const waterGravity = independentGravity ? 0.02 : gravity / 16;
	const lavaGravity = independentGravity ? 0.02 : gravity / 4;

	const config: PhysicsConfig = {
		gravity,
		airdrag: Math.fround(1 - 0.02),
		yawSpeed: 3.0,
		pitchSpeed: 3.0,
		playerSpeed: 0.1,
		sprintSpeed: 0.3,
		sneakSpeed: 0.3,
		stepHeight: 0.6,
		negligeableVelocity: 0.003,
		soulsandSpeed: 0.4,
		honeyblockSpeed: 0.4,
		honeyblockJumpSpeed: 0.4,
		ladderMaxSpeed: 0.15,
		ladderClimbSpeed: 0.2,
		playerHalfWidth: 0.3,
		playerHeight: 1.8,
		waterInertia: 0.8,
		lavaInertia: 0.5,
		liquidAcceleration: 0.02,
		airborneInertia: 0.91,
		airborneAcceleration: 0.02,
		defaultSlipperiness: 0.6,
		outOfLiquidImpulse: 0.3,
		autojumpCooldown: 10,
		bubbleColumnSurfaceDrag: {
			down: 0.03,
			maxDown: -0.9,
			up: 0.1,
			maxUp: 1.8,
		},
		bubbleColumnDrag: {
			down: 0.03,
			maxDown: -0.3,
			up: 0.06,
			maxUp: 0.7,
		},
		slowFalling: 0.125,
		waterGravity,
		lavaGravity,
		movementSpeedAttribute: movementSpeedResource,
		sprintingUUID: "662a6b8d-da3e-4c1c-8813-96ea6097278d",
	};

	// ── Feature flags ──

	const hasVelocityBlocksOnCollision = supportFeature(
		"velocityBlocksOnCollision",
	);
	const hasVelocityBlocksOnTop = supportFeature("velocityBlocksOnTop");
	const hasClimbUsingJump = supportFeature("climbUsingJump");
	const hasClimbableTrapdoor = supportFeature("climbableTrapdoor");

	// ── Internal helpers ──

	const getPlayerBB = (pos: MutableVec3): AABB => {
		const w = config.playerHalfWidth;
		return createAABB(
			pos.x - w,
			pos.y,
			pos.z - w,
			pos.x + w,
			pos.y + config.playerHeight,
			pos.z + w,
		);
	};

	const setPositionToBB = (bb: AABB, pos: MutableVec3): void => {
		pos.x = bb.minX + config.playerHalfWidth;
		pos.y = bb.minY;
		pos.z = bb.minZ + config.playerHalfWidth;
	};

	const getSurroundingBBs = (world: PhysicsWorld, queryBB: AABB): AABB[] => {
		const result: AABB[] = [];
		for (
			let y = Math.floor(queryBB.minY) - 1;
			y <= Math.floor(queryBB.maxY);
			y++
		) {
			for (
				let z = Math.floor(queryBB.minZ);
				z <= Math.floor(queryBB.maxZ);
				z++
			) {
				for (
					let x = Math.floor(queryBB.minX);
					x <= Math.floor(queryBB.maxX);
					x++
				) {
					const block = world.getBlock({ x, y, z });
					if (block) {
						for (const shape of block.shapes) {
							const bb = createAABB(
								shape[0]!,
								shape[1]!,
								shape[2]!,
								shape[3]!,
								shape[4]!,
								shape[5]!,
							);
							offsetAABB(bb, x, y, z);
							result.push(bb);
						}
					}
				}
			}
		}
		return result;
	};

	const moveEntity = (
		entity: PlayerState,
		world: PhysicsWorld,
		dx: number,
		dy: number,
		dz: number,
	): void => {
		const vel = entity.vel;
		const pos = entity.pos;

		if (entity.isInWeb) {
			dx *= 0.25;
			dy *= 0.05;
			dz *= 0.25;
			vel.x = 0;
			vel.y = 0;
			vel.z = 0;
			entity.isInWeb = false;
		}

		let oldVelX = dx;
		const oldVelY = dy;
		let oldVelZ = dz;

		if (entity.control.sneak && entity.onGround) {
			const step = 0.05;

			for (
				;
				dx !== 0 &&
				getSurroundingBBs(world, offsetAABB(getPlayerBB(pos), dx, 0, 0))
					.length === 0;
				oldVelX = dx
			) {
				if (dx < step && dx >= -step) dx = 0;
				else if (dx > 0) dx -= step;
				else dx += step;
			}

			for (
				;
				dz !== 0 &&
				getSurroundingBBs(world, offsetAABB(getPlayerBB(pos), 0, 0, dz))
					.length === 0;
				oldVelZ = dz
			) {
				if (dz < step && dz >= -step) dz = 0;
				else if (dz > 0) dz -= step;
				else dz += step;
			}

			while (
				dx !== 0 &&
				dz !== 0 &&
				getSurroundingBBs(world, offsetAABB(getPlayerBB(pos), dx, 0, dz))
					.length === 0
			) {
				if (dx < step && dx >= -step) dx = 0;
				else if (dx > 0) dx -= step;
				else dx += step;

				if (dz < step && dz >= -step) dz = 0;
				else if (dz > 0) dz -= step;
				else dz += step;

				oldVelX = dx;
				oldVelZ = dz;
			}
		}

		let playerBB = getPlayerBB(pos);
		const queryBB = extendAABB(cloneAABB(playerBB), dx, dy, dz);
		const surroundingBBs = getSurroundingBBs(world, queryBB);
		const oldBB = cloneAABB(playerBB);

		for (const blockBB of surroundingBBs) {
			dy = computeOffsetY(blockBB, playerBB, dy);
		}
		offsetAABB(playerBB, 0, dy, 0);

		for (const blockBB of surroundingBBs) {
			dx = computeOffsetX(blockBB, playerBB, dx);
		}
		offsetAABB(playerBB, dx, 0, 0);

		for (const blockBB of surroundingBBs) {
			dz = computeOffsetZ(blockBB, playerBB, dz);
		}
		offsetAABB(playerBB, 0, 0, dz);

		// Step on block if height < stepHeight
		if (
			config.stepHeight > 0 &&
			(entity.onGround || (dy !== oldVelY && oldVelY < 0)) &&
			(dx !== oldVelX || dz !== oldVelZ)
		) {
			const oldVelXCol = dx;
			const oldVelYCol = dy;
			const oldVelZCol = dz;
			const oldBBCol = cloneAABB(playerBB);

			dy = config.stepHeight;
			const stepQueryBB = extendAABB(cloneAABB(oldBB), oldVelX, dy, oldVelZ);
			const stepBBs = getSurroundingBBs(world, stepQueryBB);

			const BB1 = cloneAABB(oldBB);
			const BB2 = cloneAABB(oldBB);
			const BB_XZ = extendAABB(cloneAABB(BB1), dx, 0, dz);

			let dy1 = dy;
			let dy2 = dy;
			for (const blockBB of stepBBs) {
				dy1 = computeOffsetY(blockBB, BB_XZ, dy1);
				dy2 = computeOffsetY(blockBB, BB2, dy2);
			}
			offsetAABB(BB1, 0, dy1, 0);
			offsetAABB(BB2, 0, dy2, 0);

			let dx1 = oldVelX;
			let dx2 = oldVelX;
			for (const blockBB of stepBBs) {
				dx1 = computeOffsetX(blockBB, BB1, dx1);
				dx2 = computeOffsetX(blockBB, BB2, dx2);
			}
			offsetAABB(BB1, dx1, 0, 0);
			offsetAABB(BB2, dx2, 0, 0);

			let dz1 = oldVelZ;
			let dz2 = oldVelZ;
			for (const blockBB of stepBBs) {
				dz1 = computeOffsetZ(blockBB, BB1, dz1);
				dz2 = computeOffsetZ(blockBB, BB2, dz2);
			}
			offsetAABB(BB1, 0, 0, dz1);
			offsetAABB(BB2, 0, 0, dz2);

			const norm1 = dx1 * dx1 + dz1 * dz1;
			const norm2 = dx2 * dx2 + dz2 * dz2;

			if (norm1 > norm2) {
				dx = dx1;
				dy = -dy1;
				dz = dz1;
				playerBB = BB1;
			} else {
				dx = dx2;
				dy = -dy2;
				dz = dz2;
				playerBB = BB2;
			}

			for (const blockBB of stepBBs) {
				dy = computeOffsetY(blockBB, playerBB, dy);
			}
			offsetAABB(playerBB, 0, dy, 0);

			if (
				oldVelXCol * oldVelXCol + oldVelZCol * oldVelZCol >=
				dx * dx + dz * dz
			) {
				dx = oldVelXCol;
				dy = oldVelYCol;
				dz = oldVelZCol;
				playerBB = oldBBCol;
			}
		}

		// Update flags
		setPositionToBB(playerBB, pos);
		entity.isCollidedHorizontally = dx !== oldVelX || dz !== oldVelZ;
		entity.isCollidedVertically = dy !== oldVelY;
		entity.onGround = entity.isCollidedVertically && oldVelY < 0;

		const blockAtFeet = world.getBlock({
			x: pos.x,
			y: pos.y - 0.2,
			z: pos.z,
		});

		if (dx !== oldVelX) vel.x = 0;
		if (dz !== oldVelZ) vel.z = 0;
		if (dy !== oldVelY) {
			if (
				blockAtFeet &&
				blockAtFeet.id === slimeBlockId &&
				!entity.control.sneak
			) {
				vel.y = -vel.y;
			} else {
				vel.y = 0;
			}
		}

		// Block collisions (web, soulsand, honeyblock, bubble columns)
		const contractedBB = contractAABB(cloneAABB(playerBB), 0.001, 0.001, 0.001);
		for (
			let cy = Math.floor(contractedBB.minY);
			cy <= Math.floor(contractedBB.maxY);
			cy++
		) {
			for (
				let cz = Math.floor(contractedBB.minZ);
				cz <= Math.floor(contractedBB.maxZ);
				cz++
			) {
				for (
					let cx = Math.floor(contractedBB.minX);
					cx <= Math.floor(contractedBB.maxX);
					cx++
				) {
					const block = world.getBlock({ x: cx, y: cy, z: cz });
					if (block) {
						if (hasVelocityBlocksOnCollision) {
							if (block.id === soulsandId) {
								vel.x *= config.soulsandSpeed;
								vel.z *= config.soulsandSpeed;
							} else if (block.id === honeyblockId) {
								vel.x *= config.honeyblockSpeed;
								vel.z *= config.honeyblockSpeed;
							}
						}
						if (block.id === webId) {
							entity.isInWeb = true;
						} else if (block.id === bubblecolumnId) {
							const down = block.properties.drag === "true";
							const aboveBlock = world.getBlock({
								x: cx,
								y: cy + 1,
								z: cz,
							});
							const bubbleDrag =
								aboveBlock && aboveBlock.name === "air"
									? config.bubbleColumnSurfaceDrag
									: config.bubbleColumnDrag;
							if (down) {
								vel.y = Math.max(bubbleDrag.maxDown, vel.y - bubbleDrag.down);
							} else {
								vel.y = Math.min(bubbleDrag.maxUp, vel.y + bubbleDrag.up);
							}
						}
					}
				}
			}
		}
		if (hasVelocityBlocksOnTop) {
			const flooredPos = {
				x: Math.floor(entity.pos.x),
				y: Math.floor(entity.pos.y) - 1,
				z: Math.floor(entity.pos.z),
			};
			const blockBelow = world.getBlock(flooredPos);
			if (blockBelow) {
				if (blockBelow.id === soulsandId) {
					// Soul speed enchantment counteracts soul sand slowdown
					if (entity.soulSpeed > 0) {
						vel.x *= 1.0 + entity.soulSpeed * 0.105;
						vel.z *= 1.0 + entity.soulSpeed * 0.105;
					} else {
						vel.x *= config.soulsandSpeed;
						vel.z *= config.soulsandSpeed;
					}
				} else if (blockBelow.id === honeyblockId) {
					vel.x *= config.honeyblockSpeed;
					vel.z *= config.honeyblockSpeed;
				}
			}
		}

		// Powder snow: slow movement and apply freezing
		if (powderSnowId !== -1) {
			const feetBlock = world.getBlock({
				x: Math.floor(entity.pos.x),
				y: Math.floor(entity.pos.y),
				z: Math.floor(entity.pos.z),
			});
			if (feetBlock && feetBlock.id === powderSnowId) {
				vel.x *= 0.9;
				vel.z *= 0.9;
			}
		}
	};

	// ── Looking vector ──

	const getLookingVector = (entity: PlayerState) => {
		const yaw = entity.yaw;
		const pitch = entity.pitch;
		const sinYaw = Math.sin(yaw);
		const cosYaw = Math.cos(yaw);
		const sinPitch = Math.sin(pitch);
		const cosPitch = Math.cos(pitch);
		const lookX = -sinYaw * cosPitch;
		const lookY = sinPitch;
		const lookZ = -cosYaw * cosPitch;
		return {
			yaw,
			pitch,
			sinYaw,
			cosYaw,
			sinPitch,
			cosPitch,
			lookX,
			lookY,
			lookZ,
			lookDir: { x: lookX, y: lookY, z: lookZ },
		};
	};

	const applyHeading = (
		entity: PlayerState,
		strafe: number,
		forward: number,
		multiplier: number,
	): void => {
		let speed = Math.sqrt(strafe * strafe + forward * forward);
		if (speed < 0.01) return;

		speed = multiplier / Math.max(speed, 1);
		strafe *= speed;
		forward *= speed;

		const yaw = Math.PI - entity.yaw;
		const sin = Math.sin(yaw);
		const cos = Math.cos(yaw);

		entity.vel.x -= strafe * cos + forward * sin;
		entity.vel.z += forward * cos - strafe * sin;
	};

	const isOnLadder = (world: PhysicsWorld, pos: MutableVec3): boolean => {
		const block = world.getBlock(pos);
		if (!block) return false;
		if (block.id === ladderId || block.id === vineId) return true;
		if (!hasClimbableTrapdoor || !trapdoorIds.has(block.id)) return false;

		const blockBelow = world.getBlock({
			x: pos.x,
			y: pos.y - 1,
			z: pos.z,
		});
		return (
			blockBelow?.id === ladderId &&
			block.properties.open === "true" &&
			block.properties.facing === blockBelow.properties.facing
		);
	};

	const doesNotCollide = (world: PhysicsWorld, pos: MutableVec3): boolean => {
		const pBB = getPlayerBB(pos);
		return (
			!getSurroundingBBs(world, pBB).some((x) => intersectsAABB(pBB, x)) &&
			getWaterInBB(world, pBB).length === 0
		);
	};

	// ── Water helpers ──

	const getRenderedDepth = (block: PhysicsBlock | null): number => {
		if (!block) return -1;
		if (waterLike.has(block.id)) return 0;
		if (block.properties.waterlogged === "true") return 0;
		if (!waterIds.has(block.id)) return -1;
		const level = Number.parseInt(block.properties.level ?? "0", 10);
		return level >= 8 ? 0 : level;
	};

	const getLiquidHeightPcent = (block: PhysicsBlock): number =>
		(getRenderedDepth(block) + 1) / 9;

	const getFlow = (
		world: PhysicsWorld,
		block: PhysicsBlock,
		bx: number,
		by: number,
		bz: number,
	): MutableVec3 => {
		const curlevel = getRenderedDepth(block);
		const flow: MutableVec3 = { x: 0, y: 0, z: 0 };
		for (const [dx, dz] of [
			[0, 1],
			[-1, 0],
			[0, -1],
			[1, 0],
		] as const) {
			const adjBlock = world.getBlock({
				x: bx + dx,
				y: by,
				z: bz + dz,
			});
			const adjLevel = getRenderedDepth(adjBlock);
			if (adjLevel < 0) {
				if (adjBlock && adjBlock.boundingBox !== "empty") {
					const belowAdj = world.getBlock({
						x: bx + dx,
						y: by - 1,
						z: bz + dz,
					});
					const belowLevel = getRenderedDepth(belowAdj);
					if (belowLevel >= 0) {
						const f = belowLevel - (curlevel - 8);
						flow.x += dx * f;
						flow.z += dz * f;
					}
				}
			} else {
				const f = adjLevel - curlevel;
				flow.x += dx * f;
				flow.z += dz * f;
			}
		}

		const level = Number.parseInt(block.properties.level ?? "0", 10);
		if (level >= 8) {
			for (const [dx, dz] of [
				[0, 1],
				[-1, 0],
				[0, -1],
				[1, 0],
			] as const) {
				const adjBlock = world.getBlock({
					x: bx + dx,
					y: by,
					z: bz + dz,
				});
				const adjUpBlock = world.getBlock({
					x: bx + dx,
					y: by + 1,
					z: bz + dz,
				});
				if (
					(adjBlock && adjBlock.boundingBox !== "empty") ||
					(adjUpBlock && adjUpBlock.boundingBox !== "empty")
				) {
					normalizeVec3(flow);
					flow.y -= 6;
					break;
				}
			}
		}

		normalizeVec3(flow);
		return flow;
	};

	const getWaterInBB = (world: PhysicsWorld, bb: AABB): PhysicsBlock[] => {
		const waterBlocks: PhysicsBlock[] = [];
		for (let cy = Math.floor(bb.minY); cy <= Math.floor(bb.maxY); cy++) {
			for (let cz = Math.floor(bb.minZ); cz <= Math.floor(bb.maxZ); cz++) {
				for (let cx = Math.floor(bb.minX); cx <= Math.floor(bb.maxX); cx++) {
					const block = world.getBlock({ x: cx, y: cy, z: cz });
					if (
						block &&
						(waterIds.has(block.id) ||
							waterLike.has(block.id) ||
							block.properties.waterlogged === "true")
					) {
						const waterLevel = cy + 1 - getLiquidHeightPcent(block);
						if (Math.ceil(bb.maxY) >= waterLevel) waterBlocks.push(block);
					}
				}
			}
		}
		return waterBlocks;
	};

	const isInWaterApplyCurrent = (
		world: PhysicsWorld,
		bb: AABB,
		vel: MutableVec3,
	): boolean => {
		const acceleration: MutableVec3 = { x: 0, y: 0, z: 0 };
		const waterBlocks = getWaterInBB(world, bb);
		const isInWater = waterBlocks.length > 0;
		for (const block of waterBlocks) {
			const flow = getFlow(
				world,
				block,
				Math.floor(bb.minX),
				Math.floor(bb.minY),
				Math.floor(bb.minZ),
			);
			acceleration.x += flow.x;
			acceleration.y += flow.y;
			acceleration.z += flow.z;
		}

		normalizeVec3(acceleration);
		vel.x += acceleration.x * 0.014;
		vel.y += acceleration.y * 0.014;
		vel.z += acceleration.z * 0.014;
		return isInWater;
	};

	const isMaterialInBB = (
		world: PhysicsWorld,
		queryBB: AABB,
		types: Set<number>,
	): boolean => {
		for (
			let cy = Math.floor(queryBB.minY);
			cy <= Math.floor(queryBB.maxY);
			cy++
		) {
			for (
				let cz = Math.floor(queryBB.minZ);
				cz <= Math.floor(queryBB.maxZ);
				cz++
			) {
				for (
					let cx = Math.floor(queryBB.minX);
					cx <= Math.floor(queryBB.maxX);
					cx++
				) {
					const block = world.getBlock({ x: cx, y: cy, z: cz });
					if (block && types.has(block.id)) return true;
				}
			}
		}
		return false;
	};

	// ── Movement with heading ──

	const moveEntityWithHeading = (
		entity: PlayerState,
		world: PhysicsWorld,
		strafe: number,
		forward: number,
	): void => {
		const vel = entity.vel;
		const pos = entity.pos;

		const gravityMultiplier =
			vel.y <= 0 && entity.slowFalling > 0 ? config.slowFalling : 1;

		if (entity.isInWater || entity.isInLava) {
			const lastY = pos.y;
			let acceleration = config.liquidAcceleration;
			const inertia = entity.isInWater
				? config.waterInertia
				: config.lavaInertia;
			let horizontalInertia = inertia;

			if (entity.isInWater) {
				let strider = Math.min(entity.depthStrider, 3);
				if (!entity.onGround) {
					strider *= 0.5;
				}
				if (strider > 0) {
					horizontalInertia += ((0.546 - horizontalInertia) * strider) / 3;
					acceleration += ((0.7 - acceleration) * strider) / 3;
				}

				if (entity.dolphinsGrace > 0) horizontalInertia = 0.96;
			}

			applyHeading(entity, strafe, forward, acceleration);
			moveEntity(entity, world, vel.x, vel.y, vel.z);
			vel.y *= inertia;
			vel.y -=
				(entity.isInWater ? config.waterGravity : config.lavaGravity) *
				gravityMultiplier;
			vel.x *= horizontalInertia;
			vel.z *= horizontalInertia;

			if (
				entity.isCollidedHorizontally &&
				doesNotCollide(world, {
					x: vel.x,
					y: vel.y + 0.6 - pos.y + lastY,
					z: vel.z,
				})
			) {
				vel.y = config.outOfLiquidImpulse;
			}
		} else if (entity.elytraFlying) {
			const { pitch, sinPitch, cosPitch, lookDir } = getLookingVector(entity);
			const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
			const cosPitchSquared = cosPitch * cosPitch;
			vel.y +=
				config.gravity * gravityMultiplier * (-1.0 + cosPitchSquared * 0.75);

			if (vel.y < 0.0 && cosPitch > 0.0) {
				const movingDownSpeedModifier = vel.y * -0.1 * cosPitchSquared;
				vel.x += (lookDir.x * movingDownSpeedModifier) / cosPitch;
				vel.y += movingDownSpeedModifier;
				vel.z += (lookDir.z * movingDownSpeedModifier) / cosPitch;
			}

			if (pitch < 0.0 && cosPitch > 0.0) {
				const lookDownSpeedModifier = horizontalSpeed * -sinPitch * 0.04;
				vel.x += (-lookDir.x * lookDownSpeedModifier) / cosPitch;
				vel.y += lookDownSpeedModifier * 3.2;
				vel.z += (-lookDir.z * lookDownSpeedModifier) / cosPitch;
			}

			if (cosPitch > 0.0) {
				vel.x += ((lookDir.x / cosPitch) * horizontalSpeed - vel.x) * 0.1;
				vel.z += ((lookDir.z / cosPitch) * horizontalSpeed - vel.z) * 0.1;
			}

			vel.x *= 0.99;
			vel.y *= 0.98;
			vel.z *= 0.99;
			moveEntity(entity, world, vel.x, vel.y, vel.z);

			if (entity.onGround) {
				entity.elytraFlying = false;
			}
		} else {
			// Normal movement
			let acceleration = 0.0;
			let inertia = 0.0;
			const blockUnder = world.getBlock({
				x: pos.x,
				y: pos.y - 1,
				z: pos.z,
			});
			if (entity.onGround && blockUnder) {
				let playerSpeedAttribute =
					entity.attributes?.[config.movementSpeedAttribute] ??
					createAttributeValue(config.playerSpeed);

				playerSpeedAttribute = deleteAttributeModifier(
					playerSpeedAttribute,
					config.sprintingUUID,
				);
				if (entity.control.sprint) {
					if (
						!hasAttributeModifier(playerSpeedAttribute, config.sprintingUUID)
					) {
						playerSpeedAttribute = addAttributeModifier(playerSpeedAttribute, {
							uuid: config.sprintingUUID,
							amount: config.sprintSpeed,
							operation: 2,
						});
					}
				}

				const attributeSpeed = getAttributeValue(playerSpeedAttribute);
				inertia =
					(blockSlipperiness.get(blockUnder.id) ?? config.defaultSlipperiness) *
					0.91;
				acceleration =
					attributeSpeed * (0.1627714 / (inertia * inertia * inertia));
				if (acceleration < 0) acceleration = 0;
			} else {
				acceleration = config.airborneAcceleration;
				inertia = config.airborneInertia;

				if (entity.control.sprint) {
					const airSprintFactor = config.airborneAcceleration * 0.3;
					acceleration += airSprintFactor;
				}
			}

			applyHeading(entity, strafe, forward, acceleration);

			if (isOnLadder(world, pos)) {
				vel.x = clamp(-config.ladderMaxSpeed, vel.x, config.ladderMaxSpeed);
				vel.z = clamp(-config.ladderMaxSpeed, vel.z, config.ladderMaxSpeed);
				vel.y = Math.max(
					vel.y,
					entity.control.sneak ? 0 : -config.ladderMaxSpeed,
				);
			}

			moveEntity(entity, world, vel.x, vel.y, vel.z);

			if (
				isOnLadder(world, pos) &&
				(entity.isCollidedHorizontally ||
					(hasClimbUsingJump && entity.control.jump))
			) {
				vel.y = config.ladderClimbSpeed;
			}

			// Apply friction and gravity
			if (entity.levitation > 0) {
				vel.y += (0.05 * entity.levitation - vel.y) * 0.2;
			} else {
				vel.y -= config.gravity * gravityMultiplier;
			}
			vel.y *= config.airdrag;
			vel.x *= inertia;
			vel.z *= inertia;
		}
	};

	// ── Main simulation ──

	const simulatePlayer = (
		state: PlayerState,
		world: PhysicsWorld,
	): PlayerState => {
		const vel = state.vel;
		const pos = state.pos;

		const waterBB = contractAABB(getPlayerBB(pos), 0.001, 0.401, 0.001);
		const lavaBB = contractAABB(getPlayerBB(pos), 0.1, 0.4, 0.1);

		state.isInWater = isInWaterApplyCurrent(world, waterBB, vel);
		state.isInLava = isMaterialInBB(world, lavaBB, lavaIds);

		if (Math.abs(vel.x) < config.negligeableVelocity) vel.x = 0;
		if (Math.abs(vel.y) < config.negligeableVelocity) vel.y = 0;
		if (Math.abs(vel.z) < config.negligeableVelocity) vel.z = 0;

		// Handle jump input
		if (state.control.jump || state.jumpQueued) {
			if (state.jumpTicks > 0) state.jumpTicks--;
			if ((state.isInWater || state.isInLava) && !state.onGround) {
				// Floating in liquid — gentle swim-up only.
				vel.y += 0.04;
			} else if (state.onGround && state.jumpTicks === 0) {
				// Standing on the floor (including the floor of shallow water): do a
				// real ground-jump, NOT the weak 0.04 swim-up. Otherwise a bot in a
				// 1-deep water pocket can only bob ~0.8 and never clears the 1-block
				// ledge to step out — it gets stuck bobbing forever.
				const blockBelow = world.getBlock({
					x: Math.floor(pos.x),
					y: Math.floor(pos.y) - 1,
					z: Math.floor(pos.z),
				});
				vel.y =
					Math.fround(0.42) *
					(blockBelow && blockBelow.id === honeyblockId
						? config.honeyblockJumpSpeed
						: 1);
				if (state.jumpBoost > 0) {
					vel.y += 0.1 * state.jumpBoost;
				}
				if (state.control.sprint) {
					const yaw = Math.PI - state.yaw;
					vel.x -= Math.sin(yaw) * 0.2;
					vel.z += Math.cos(yaw) * 0.2;
				}
				state.jumpTicks = config.autojumpCooldown;
			}
		} else {
			state.jumpTicks = 0;
		}
		state.jumpQueued = false;

		let strafe =
			(Number(state.control.right) - Number(state.control.left)) * 0.98;
		let forward =
			(Number(state.control.forward) - Number(state.control.back)) * 0.98;

		if (state.control.sneak) {
			const sneakMult =
				state.swiftSneak > 0
					? Math.min(0.3 + state.swiftSneak * 0.15, 1.0)
					: config.sneakSpeed;
			strafe *= sneakMult;
			forward *= sneakMult;
		}

		state.elytraFlying =
			state.elytraFlying &&
			state.elytraEquipped &&
			!state.onGround &&
			!state.levitation;

		// Riptide: trident launch in water/rain
		if (state.riptideTicks > 0) {
			const { lookDir } = getLookingVector(state);
			const riptideSpeed = state.riptideTicks;
			vel.x += lookDir.x * riptideSpeed;
			vel.y += lookDir.y * riptideSpeed;
			vel.z += lookDir.z * riptideSpeed;
			state.riptideTicks = 0;
		}

		if (state.fireworkRocketDuration > 0) {
			if (!state.elytraFlying) {
				state.fireworkRocketDuration = 0;
			} else {
				const { lookDir } = getLookingVector(state);
				vel.x += lookDir.x * 0.1 + (lookDir.x * 1.5 - vel.x) * 0.5;
				vel.y += lookDir.y * 0.1 + (lookDir.y * 1.5 - vel.y) * 0.5;
				vel.z += lookDir.z * 0.1 + (lookDir.z * 1.5 - vel.z) * 0.5;
				--state.fireworkRocketDuration;
			}
		}

		moveEntityWithHeading(state, world, strafe, forward);

		return state;
	};

	const adjustPositionHeight = (
		pos: MutableVec3,
		world: PhysicsWorld,
	): void => {
		const playerBB = getPlayerBB(pos);
		const queryBB = extendAABB(cloneAABB(playerBB), 0, -1, 0);
		const surroundingBBs = getSurroundingBBs(world, queryBB);

		let dy = -1;
		for (const blockBB of surroundingBBs) {
			dy = computeOffsetY(blockBB, playerBB, dy);
		}
		pos.y += dy;
	};

	return { config, simulatePlayer, adjustPositionHeight };
};

// ── Player state construction ──

/** Create a PlayerState from an Entity for simulation. */
export const createPlayerState = (
	registry: Registry,
	entity: Entity,
	controls: PlayerControls,
	opts?: {
		jumpTicks?: number;
		jumpQueued?: boolean;
		fireworkRocketDuration?: number;
		attributes?: Record<
			string,
			{
				value: number;
				modifiers: readonly {
					uuid: string;
					amount: number;
					operation: 0 | 1 | 2;
				}[];
			}
		> | null;
	},
): PlayerState => {
	const getEffectLevel = (name: string): number => {
		const effectDef = registry.effectsByName.get(name);
		if (!effectDef) return 0;
		const effect = entity.effects.get(effectDef.id);
		if (!effect) return 0;
		return effect.amplifier + 1;
	};

	let depthStrider = 0;
	let soulSpeed = 0;
	let swiftSneak = 0;
	const boots = entity.equipment[2];
	if (boots) {
		const enchants = getEnchants(registry, boots);
		const dsEnch = enchants.find((e) => e.name === "depth_strider");
		if (dsEnch) depthStrider = dsEnch.level;
		const ssEnch = enchants.find((e) => e.name === "soul_speed");
		if (ssEnch) soulSpeed = ssEnch.level;
	}
	const leggings = entity.equipment[3];
	if (leggings) {
		const enchants = getEnchants(registry, leggings);
		const snEnch = enchants.find((e) => e.name === "swift_sneak");
		if (snEnch) swiftSneak = snEnch.level;
	}

	const elytraEquipped = entity.equipment[4]?.name === "elytra";

	return {
		pos: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
		vel: { x: entity.velocity.x, y: entity.velocity.y, z: entity.velocity.z },
		onGround: entity.onGround,
		isInWater: false,
		isInLava: false,
		isInWeb: false,
		isCollidedHorizontally: false,
		isCollidedVertically: false,
		elytraFlying: entity.elytraFlying,
		fireworkRocketDuration: opts?.fireworkRocketDuration ?? 0,
		riptideTicks: 0,
		jumpTicks: opts?.jumpTicks ?? 0,
		jumpQueued: opts?.jumpQueued ?? false,
		yaw: entity.yaw,
		pitch: entity.pitch,
		control: controls,
		attributes: opts?.attributes ?? null,
		jumpBoost: getEffectLevel("JumpBoost"),
		speed: getEffectLevel("Speed"),
		slowness: getEffectLevel("Slowness"),
		dolphinsGrace: getEffectLevel("DolphinsGrace"),
		slowFalling: getEffectLevel("SlowFalling"),
		levitation: getEffectLevel("Levitation"),
		depthStrider,
		soulSpeed,
		swiftSneak,
		elytraEquipped,
	};
};

/** Apply simulation results back to an entity. */
export const applyPlayerState = (state: PlayerState, entity: Entity): void => {
	entity.position = { x: state.pos.x, y: state.pos.y, z: state.pos.z };
	entity.velocity = { x: state.vel.x, y: state.vel.y, z: state.vel.z };
	entity.onGround = state.onGround;
	entity.elytraFlying = state.elytraFlying;
	// Without this, bot.entity.isInWater is stuck at its default (false) forever:
	// the sim computes it every tick for buoyancy but never published it back, so
	// every consumer (water-escape, drowning guard, digging-in-water) was blind.
	entity.isInWater = state.isInWater;
};
