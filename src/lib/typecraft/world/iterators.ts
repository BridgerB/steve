import { add, floor, scale, subtract, type Vec3, vec3 } from "../vec3/index.ts";

// ── Block face ──

export const BlockFace = {
	UNKNOWN: -999,
	BOTTOM: 0,
	TOP: 1,
	NORTH: 2,
	SOUTH: 3,
	WEST: 4,
	EAST: 5,
} as const;

export type BlockFace = (typeof BlockFace)[keyof typeof BlockFace];

// ── Manhattan iterator ──

/** 2D spiral around a center point using Manhattan distance. Useful for loading chunks around a player. */
export type ManhattanIterator = {
	next(): Vec3 | null;
};

export const createManhattanIterator = (
	startX: number,
	startZ: number,
	maxDistance: number,
): ManhattanIterator => {
	const max = Math.floor(maxDistance);
	let x = 2;
	let y = -1;
	let layer = 1;
	let leg = -1;

	return {
		next() {
			if (leg === -1) {
				leg = 0;
				return vec3(startX, 0, startZ);
			}
			if (leg === 0) {
				if (max === 1) return null;
				x--;
				y++;
				if (x === 0) leg = 1;
			} else if (leg === 1) {
				x--;
				y--;
				if (y === 0) leg = 2;
			} else if (leg === 2) {
				x++;
				y--;
				if (x === 0) leg = 3;
			} else if (leg === 3) {
				x++;
				y++;
				if (y === 0) {
					x++;
					leg = 0;
					layer++;
					if (layer === max) return null;
				}
			}
			return vec3(startX + x, 0, startZ + y);
		},
	};
};

// ── Octahedron iterator ──

/** 3D octahedron expansion from a starting point. Useful for block search. */
export type OctahedronIterator = {
	next(): Vec3 | null;
};

export const createOctahedronIterator = (
	start: Vec3,
	maxDistance: number,
): OctahedronIterator => {
	const s = floor(start);
	let apothem = 1;
	let x = -1;
	let y = -1;
	let z = -1;
	let L = apothem;
	let R = L + 1;

	return {
		next() {
			if (apothem > maxDistance) return null;
			R -= 1;
			if (R < 0) {
				L -= 1;
				if (L < 0) {
					z += 2;
					if (z > 1) {
						y += 2;
						if (y > 1) {
							x += 2;
							if (x > 1) {
								apothem += 1;
								x = -1;
							}
							y = -1;
						}
						z = -1;
					}
					L = apothem;
				}
				R = L;
			}
			const X = x * R;
			const Y = y * (apothem - L);
			const Z = z * (apothem - (Math.abs(X) + Math.abs(Y)));
			return vec3(s.x + X, s.y + Y, s.z + Z);
		},
	};
};

// ── Raycast iterator ──

/** Block along a ray, using DDA traversal. Returns block coordinates and entry face. */
export type RaycastBlock = {
	x: number;
	y: number;
	z: number;
	face: BlockFace;
};

export type RaycastHit = {
	readonly pos: Vec3;
	readonly face: BlockFace;
};

export type RaycastIterator = {
	next(): RaycastBlock | null;
	intersect(shapes: readonly number[][], offset: Vec3): RaycastHit | null;
};

export const createRaycastIterator = (
	pos: Vec3,
	dir: Vec3,
	maxDistance: number,
): RaycastIterator => {
	const block: RaycastBlock = {
		x: Math.floor(pos.x),
		y: Math.floor(pos.y),
		z: Math.floor(pos.z),
		face: BlockFace.UNKNOWN,
	};

	const invDirX = dir.x === 0 ? Number.MAX_VALUE : 1 / dir.x;
	const invDirY = dir.y === 0 ? Number.MAX_VALUE : 1 / dir.y;
	const invDirZ = dir.z === 0 ? Number.MAX_VALUE : 1 / dir.z;

	const stepX = Math.sign(dir.x);
	const stepY = Math.sign(dir.y);
	const stepZ = Math.sign(dir.z);

	const tDeltaX = dir.x === 0 ? Number.MAX_VALUE : Math.abs(1 / dir.x);
	const tDeltaY = dir.y === 0 ? Number.MAX_VALUE : Math.abs(1 / dir.y);
	const tDeltaZ = dir.z === 0 ? Number.MAX_VALUE : Math.abs(1 / dir.z);

	let tMaxX =
		dir.x === 0
			? Number.MAX_VALUE
			: Math.abs((block.x + (dir.x > 0 ? 1 : 0) - pos.x) / dir.x);
	let tMaxY =
		dir.y === 0
			? Number.MAX_VALUE
			: Math.abs((block.y + (dir.y > 0 ? 1 : 0) - pos.y) / dir.y);
	let tMaxZ =
		dir.z === 0
			? Number.MAX_VALUE
			: Math.abs((block.z + (dir.z > 0 ? 1 : 0) - pos.z) / dir.z);

	return {
		intersect(shapes, offset) {
			let t = Number.MAX_VALUE;
			let f: BlockFace = BlockFace.UNKNOWN;
			const p = subtract(pos, offset);

			for (const shape of shapes) {
				let tmin = (shape[invDirX > 0 ? 0 : 3]! - p.x) * invDirX;
				let tmax = (shape[invDirX > 0 ? 3 : 0]! - p.x) * invDirX;
				const tymin = (shape[invDirY > 0 ? 1 : 4]! - p.y) * invDirY;
				const tymax = (shape[invDirY > 0 ? 4 : 1]! - p.y) * invDirY;

				let face: BlockFace = stepX > 0 ? BlockFace.WEST : BlockFace.EAST;

				if (tmin > tymax || tymin > tmax) continue;
				if (tymin > tmin) {
					tmin = tymin;
					face = stepY > 0 ? BlockFace.BOTTOM : BlockFace.TOP;
				}
				if (tymax < tmax) tmax = tymax;

				const tzmin = (shape[invDirZ > 0 ? 2 : 5]! - p.z) * invDirZ;
				const tzmax = (shape[invDirZ > 0 ? 5 : 2]! - p.z) * invDirZ;

				if (tmin > tzmax || tzmin > tmax) continue;
				if (tzmin > tmin) {
					tmin = tzmin;
					face = stepZ > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
				}

				if (tmin < t) {
					t = tmin;
					f = face;
				}
			}

			if (t === Number.MAX_VALUE) return null;
			return { pos: add(pos, scale(dir, t)), face: f };
		},

		next() {
			if (Math.min(tMaxX, tMaxY, tMaxZ) > maxDistance) return null;

			if (tMaxX < tMaxY) {
				if (tMaxX < tMaxZ) {
					block.x += stepX;
					tMaxX += tDeltaX;
					block.face = stepX > 0 ? BlockFace.WEST : BlockFace.EAST;
				} else {
					block.z += stepZ;
					tMaxZ += tDeltaZ;
					block.face = stepZ > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
				}
			} else {
				if (tMaxY < tMaxZ) {
					block.y += stepY;
					tMaxY += tDeltaY;
					block.face = stepY > 0 ? BlockFace.BOTTOM : BlockFace.TOP;
				} else {
					block.z += stepZ;
					tMaxZ += tDeltaZ;
					block.face = stepZ > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
				}
			}

			return block;
		},
	};
};

// ── Spiral iterator 2D ──

/** 2D outward spiral in growing squares. */
export type SpiralIterator2d = {
	next(): Vec3 | null;
};

export const createSpiralIterator2d = (
	start: Vec3,
	maxDistance: number,
): SpiralIterator2d => {
	const numPoints = Math.floor((Math.floor(maxDistance) - 0.5) * 2) ** 2;
	let di = 1;
	let dj = 0;
	let segmentLength = 1;
	let i = 0;
	let j = 0;
	let segmentPassed = 0;
	let k = 0;

	return {
		next() {
			if (k >= numPoints) return null;
			const output = vec3(start.x + i, 0, start.z + j);

			i += di;
			j += dj;
			segmentPassed += 1;

			if (segmentPassed === segmentLength) {
				segmentPassed = 0;
				const tmp = di;
				di = -dj;
				dj = tmp;
				if (dj === 0) segmentLength += 1;
			}

			k += 1;
			return output;
		},
	};
};
