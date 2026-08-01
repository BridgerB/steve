/**
 * High-level raycast — steps through blocks along a ray, tests collision
 * shapes via AABB slab intersection, returns the first solid block hit.
 */

import { createPhysicsWorld } from "../physics/adapter.ts";
import { type Vec3, vec3 } from "../vec3/index.ts";
import {
	type BlockFace,
	createRaycastIterator,
	type RaycastHit,
} from "./iterators.ts";
import type { World } from "./world.ts";

export type RaycastResult = {
	readonly position: Vec3;
	readonly face: BlockFace;
	readonly intersect: Vec3;
	readonly name: string;
	readonly stateId: number;
};

/** Cast a ray through the world, returning the first solid block hit. */
export const raycast = (
	world: World,
	from: Vec3,
	direction: Vec3,
	maxDistance: number,
	matchFn?: (name: string) => boolean,
): RaycastResult | null => {
	const physicsWorld = createPhysicsWorld(world);
	const iter = createRaycastIterator(from, direction, maxDistance);

	let block = iter.next();
	while (block) {
		const pos = vec3(block.x, block.y, block.z);
		const pBlock = physicsWorld.getBlock(pos);

		if (pBlock && pBlock.boundingBox === "block") {
			if (!matchFn || matchFn(pBlock.name)) {
				const shapes = pBlock.shapes as number[][];
				if (shapes.length > 0) {
					const hit: RaycastHit | null = iter.intersect(shapes, pos);
					if (hit) {
						return {
							position: pos,
							face: hit.face,
							intersect: hit.pos,
							name: pBlock.name,
							stateId: pBlock.stateId,
						};
					}
				}
			}
		}

		block = iter.next();
	}

	return null;
};

/** Get the direction vector from yaw and pitch (radians). */
export const directionFromYawPitch = (yaw: number, pitch: number): Vec3 =>
	vec3(
		-Math.sin(yaw) * Math.cos(pitch),
		-Math.sin(pitch),
		Math.cos(yaw) * Math.cos(pitch),
	);

/** Standard eye height for a standing player. */
export const PLAYER_EYE_HEIGHT = 1.62;

/** Standard eye height for a sneaking player. */
export const PLAYER_SNEAK_EYE_HEIGHT = 1.27;
