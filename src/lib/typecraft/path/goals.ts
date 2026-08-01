/**
 * Goal factory functions for A* pathfinding.
 * Each goal provides a heuristic and end-condition for the search.
 */

import type { Entity } from "../entity/types.ts";
import type { Vec3 } from "../vec3/index.ts";
import { vec3 } from "../vec3/index.ts";
import type { World } from "../world/index.ts";
import { raycast } from "../world/index.ts";
import type { Goal } from "./types.ts";

/** Octile distance on XZ + manhattan on Y. Admissible heuristic for A*. */
const octileHeuristic = (dx: number, dy: number, dz: number): number => {
	const adx = Math.abs(dx);
	const adz = Math.abs(dz);
	return Math.abs(adx - adz) + Math.min(adx, adz) * Math.SQRT2 + Math.abs(dy);
};

/** Goal: stand at exact block position. */
export const createGoalBlock = (x: number, y: number, z: number): Goal => {
	const gx = Math.floor(x);
	const gy = Math.floor(y);
	const gz = Math.floor(z);
	return {
		heuristic: (node) => octileHeuristic(gx - node.x, gy - node.y, gz - node.z),
		isEnd: (node) => node.x === gx && node.y === gy && node.z === gz,
	};
};

/** Goal: within range of a static position. */
export const createGoalNear = (
	x: number,
	y: number,
	z: number,
	range: number,
): Goal => {
	const gx = Math.floor(x);
	const gy = Math.floor(y);
	const gz = Math.floor(z);
	const rangeSq = range * range;
	return {
		heuristic: (node) => octileHeuristic(gx - node.x, gy - node.y, gz - node.z),
		isEnd: (node) => {
			const dx = gx - node.x;
			const dy = gy - node.y;
			const dz = gz - node.z;
			return dx * dx + dy * dy + dz * dz <= rangeSq;
		},
	};
};

/** Goal: follow a moving entity within range. Dynamic — hasChanged() triggers recomputation. */
export const createGoalFollow = (entity: Entity, range: number): Goal => {
	const rangeSq = range * range;
	let lastX = Math.floor(entity.position.x);
	let lastY = Math.floor(entity.position.y);
	let lastZ = Math.floor(entity.position.z);

	return {
		heuristic: (node) =>
			octileHeuristic(lastX - node.x, lastY - node.y, lastZ - node.z),

		isEnd: (node) => {
			const dx = lastX - node.x;
			const dy = lastY - node.y;
			const dz = lastZ - node.z;
			return dx * dx + dy * dy + dz * dz <= rangeSq;
		},

		hasChanged: () => {
			const px = Math.floor(entity.position.x);
			const py = Math.floor(entity.position.y);
			const pz = Math.floor(entity.position.z);
			const dx = lastX - px;
			const dy = lastY - py;
			const dz = lastZ - pz;
			if (dx * dx + dy * dy + dz * dz > rangeSq) {
				lastX = px;
				lastY = py;
				lastZ = pz;
				return true;
			}
			return false;
		},

		isValid: () => entity.isValid,
	};
};

/** Goal: reach specific X,Z coordinates (any Y level). */
export const createGoalXZ = (x: number, z: number): Goal => {
	const gx = Math.floor(x);
	const gz = Math.floor(z);
	return {
		heuristic: (node) => octileHeuristic(gx - node.x, 0, gz - node.z),
		isEnd: (node) => node.x === gx && node.z === gz,
	};
};

/** Goal: within range of X,Z coordinates (any Y level). */
export const createGoalNearXZ = (x: number, z: number, range: number): Goal => {
	const gx = Math.floor(x);
	const gz = Math.floor(z);
	const rangeSq = range * range;
	return {
		heuristic: (node) => octileHeuristic(gx - node.x, 0, gz - node.z),
		isEnd: (node) => {
			const dx = gx - node.x;
			const dz = gz - node.z;
			return dx * dx + dz * dz <= rangeSq;
		},
	};
};

/** Goal: reach specific Y level (any X,Z). */
export const createGoalY = (y: number): Goal => {
	const gy = Math.floor(y);
	return {
		heuristic: (node) => Math.abs(gy - node.y),
		isEnd: (node) => node.y === gy,
	};
};

/** Goal: stand adjacent to a block (manhattan distance 1). */
export const createGoalGetToBlock = (x: number, y: number, z: number): Goal => {
	const gx = Math.floor(x);
	const gy = Math.floor(y);
	const gz = Math.floor(z);
	return {
		heuristic: (node) => {
			const dx = Math.abs(node.x - gx);
			const dy = Math.abs(node.y - gy);
			const dz = Math.abs(node.z - gz);
			return octileHeuristic(dx, dy, dz) - 1;
		},
		isEnd: (node) => {
			const dx = Math.abs(node.x - gx);
			const dy = Math.abs(node.y - gy);
			const dz = Math.abs(node.z - gz);
			return dx + dy + dz === 1;
		},
	};
};

/** Goal: any of the sub-goals is satisfied (OR). */
export const createGoalCompositeAny = (goals: readonly Goal[]): Goal => ({
	heuristic: (node) => Math.min(...goals.map((g) => g.heuristic(node))),
	isEnd: (node) => goals.some((g) => g.isEnd(node)),
	hasChanged: () => goals.some((g) => g.hasChanged?.() ?? false),
	isValid: () => goals.some((g) => g.isValid?.() ?? true),
});

/** Goal: all sub-goals are satisfied simultaneously (AND). */
export const createGoalCompositeAll = (goals: readonly Goal[]): Goal => ({
	heuristic: (node) => Math.max(...goals.map((g) => g.heuristic(node))),
	isEnd: (node) => goals.every((g) => g.isEnd(node)),
	hasChanged: () => goals.some((g) => g.hasChanged?.() ?? false),
	isValid: () => goals.every((g) => g.isValid?.() ?? true),
});

/** Goal: invert a goal — path AWAY from the target. */
export const createGoalInvert = (goal: Goal): Goal => ({
	heuristic: (node) => -goal.heuristic(node),
	isEnd: (node) => !goal.isEnd(node),
	hasChanged: goal.hasChanged ? () => goal.hasChanged!() : undefined,
	isValid: goal.isValid ? () => goal.isValid!() : undefined,
});

/** Options for LOS-based goals. */
export type LookAtBlockOptions = {
	readonly reach?: number;
	readonly entityHeight?: number;
};

/** Goal: position where a block is visible and within reach (for breaking/interacting). */
export const createGoalLookAtBlock = (
	pos: Vec3,
	world: World,
	options?: LookAtBlockOptions,
): Goal => {
	const gx = Math.floor(pos.x);
	const gy = Math.floor(pos.y);
	const gz = Math.floor(pos.z);
	const reach = options?.reach ?? 4.5;
	const entityHeight = options?.entityHeight ?? 1.6;
	const reachSq = reach * reach;

	return {
		heuristic: (node) => {
			const dx = Math.abs(node.x - gx);
			const dy = Math.abs(node.y - gy);
			const dz = Math.abs(node.z - gz);
			return octileHeuristic(dx, dy, dz) - 1;
		},
		isEnd: (node) => {
			// Check distance from eye to block center
			const eyeX = node.x + 0.5;
			const eyeY = node.y + entityHeight;
			const eyeZ = node.z + 0.5;
			const blockCenterX = gx + 0.5;
			const blockCenterY = gy + 0.5;
			const blockCenterZ = gz + 0.5;

			const dx = blockCenterX - eyeX;
			const dy = blockCenterY - eyeY;
			const dz = blockCenterZ - eyeZ;
			const distSq = dx * dx + dy * dy + dz * dz;

			if (distSq > reachSq) return false;

			// Check which faces could be visible based on position delta
			const pdx = eyeX - blockCenterX;
			const pdy = eyeY - blockCenterY;
			const pdz = eyeZ - blockCenterZ;

			const facesToCheck: Vec3[] = [];
			if (Math.abs(pdx) > 0.5)
				facesToCheck.push(vec3(Math.sign(pdx) * 0.5, 0, 0));
			if (Math.abs(pdy) > 0.5)
				facesToCheck.push(vec3(0, Math.sign(pdy) * 0.5, 0));
			if (Math.abs(pdz) > 0.5)
				facesToCheck.push(vec3(0, 0, Math.sign(pdz) * 0.5));

			if (facesToCheck.length === 0) return true; // Inside the block conceptually

			// Raycast to each visible face center
			const eyePos = vec3(eyeX, eyeY, eyeZ);
			for (const faceOffset of facesToCheck) {
				const faceCenter = vec3(
					blockCenterX + faceOffset.x,
					blockCenterY + faceOffset.y,
					blockCenterZ + faceOffset.z,
				);
				const rayDx = faceCenter.x - eyeX;
				const rayDy = faceCenter.y - eyeY;
				const rayDz = faceCenter.z - eyeZ;
				const rayLen = Math.sqrt(rayDx * rayDx + rayDy * rayDy + rayDz * rayDz);
				if (rayLen === 0) continue;

				const dir = vec3(rayDx / rayLen, rayDy / rayLen, rayDz / rayLen);
				const hit = raycast(world, eyePos, dir, reach);

				if (
					hit &&
					hit.position.x === gx &&
					hit.position.y === gy &&
					hit.position.z === gz
				) {
					return true;
				}
			}

			return false;
		},
	};
};

/** Goal: within sub-block XZ range of an exact position (for item pickup).
 * A* gets the bot to the right block, isEnd checks actual bot position. */
export const createGoalExactXZ = (
	targetX: number,
	targetZ: number,
	range = 1.0,
): Goal => {
	const gx = Math.floor(targetX);
	const gz = Math.floor(targetZ);
	const rangeSq = range * range;
	return {
		heuristic: (node) => octileHeuristic(gx - node.x, 0, gz - node.z),
		isEnd: (node) => {
			// A* uses block grid, so check if this block is close enough
			// that the bot could be within range (node center = node.x+0.5, node.z+0.5)
			const dx = targetX - (node.x + 0.5);
			const dz = targetZ - (node.z + 0.5);
			return dx * dx + dz * dz <= rangeSq + 1.0; // allow slight overshoot for A* to find the right block
		},
		// Sub-block precision is handled by the caller after pathfinding via lookAt + forward
	};
};

/** Goal: position where a block can be broken (alias for GoalLookAtBlock). */
export const createGoalBreakBlock = (
	x: number,
	y: number,
	z: number,
	world: World,
	options?: LookAtBlockOptions,
): Goal => createGoalLookAtBlock(vec3(x, y, z), world, options);

/** Options for GoalPlaceBlock. */
export type PlaceBlockGoalOptions = {
	readonly reach?: number;
	readonly entityHeight?: number;
	readonly LOS?: boolean;
	readonly faces?: readonly Vec3[];
};

/** All 6 block face directions. */
const ALL_FACES: readonly Vec3[] = [
	vec3(0, -1, 0),
	vec3(0, 1, 0),
	vec3(0, 0, -1),
	vec3(0, 0, 1),
	vec3(-1, 0, 0),
	vec3(1, 0, 0),
];

/** Goal: position where a block can be placed at the target. */
export const createGoalPlaceBlock = (
	pos: Vec3,
	world: World,
	options?: PlaceBlockGoalOptions,
): Goal => {
	const gx = Math.floor(pos.x);
	const gy = Math.floor(pos.y);
	const gz = Math.floor(pos.z);
	const reach = options?.reach ?? 4.5;
	const entityHeight = options?.entityHeight ?? 1.6;
	const checkLOS = options?.LOS ?? true;
	const faces = options?.faces ?? ALL_FACES;
	const reachSq = reach * reach;

	return {
		heuristic: (node) => {
			const dx = Math.abs(node.x - gx);
			const dy = Math.abs(node.y - gy);
			const dz = Math.abs(node.z - gz);
			return octileHeuristic(dx, dy, dz) - 1;
		},
		isEnd: (node) => {
			// Can't stand in the target block
			if (node.x === gx && node.y === gy && node.z === gz) return false;

			const eyeX = node.x + 0.5;
			const eyeY = node.y + entityHeight;
			const eyeZ = node.z + 0.5;

			// Check each face for placement viability
			for (const face of faces) {
				// The reference block is at pos + face
				const refX = gx + face.x;
				const refY = gy + face.y;
				const refZ = gz + face.z;

				// Reference block center
				const refCenterX = refX + 0.5;
				const refCenterY = refY + 0.5;
				const refCenterZ = refZ + 0.5;

				// Check distance
				const dx = refCenterX - eyeX;
				const dy = refCenterY - eyeY;
				const dz = refCenterZ - eyeZ;
				if (dx * dx + dy * dy + dz * dz > reachSq) continue;

				// Check LOS if required
				if (checkLOS) {
					const rayLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
					if (rayLen === 0) continue;
					const dir = vec3(dx / rayLen, dy / rayLen, dz / rayLen);
					const hit = raycast(world, vec3(eyeX, eyeY, eyeZ), dir, reach);
					if (
						hit &&
						hit.position.x === refX &&
						hit.position.y === refY &&
						hit.position.z === refZ
					) {
						return true;
					}
				} else {
					return true;
				}
			}

			return false;
		},
	};
};
