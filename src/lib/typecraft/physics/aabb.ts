import type { AABB } from "./types.ts";

export const createAABB = (
	x0: number,
	y0: number,
	z0: number,
	x1: number,
	y1: number,
	z1: number,
): AABB => ({ minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 });

export const cloneAABB = (bb: AABB): AABB =>
	createAABB(bb.minX, bb.minY, bb.minZ, bb.maxX, bb.maxY, bb.maxZ);

/** Expand the bounding box in the direction of the given offset (for sweep tests). */
export const extendAABB = (
	bb: AABB,
	dx: number,
	dy: number,
	dz: number,
): AABB => {
	if (dx < 0) bb.minX += dx;
	else bb.maxX += dx;
	if (dy < 0) bb.minY += dy;
	else bb.maxY += dy;
	if (dz < 0) bb.minZ += dz;
	else bb.maxZ += dz;
	return bb;
};

/** Shrink inward symmetrically. */
export const contractAABB = (
	bb: AABB,
	x: number,
	y: number,
	z: number,
): AABB => {
	bb.minX += x;
	bb.minY += y;
	bb.minZ += z;
	bb.maxX -= x;
	bb.maxY -= y;
	bb.maxZ -= z;
	return bb;
};

/** Translate by offset. */
export const offsetAABB = (bb: AABB, x: number, y: number, z: number): AABB => {
	bb.minX += x;
	bb.minY += y;
	bb.minZ += z;
	bb.maxX += x;
	bb.maxY += y;
	bb.maxZ += z;
	return bb;
};

export const computeOffsetX = (
	bb: AABB,
	other: AABB,
	offsetX: number,
): number => {
	if (
		other.maxY > bb.minY &&
		other.minY < bb.maxY &&
		other.maxZ > bb.minZ &&
		other.minZ < bb.maxZ
	) {
		if (offsetX > 0.0 && other.maxX <= bb.minX)
			return Math.min(bb.minX - other.maxX, offsetX);
		if (offsetX < 0.0 && other.minX >= bb.maxX)
			return Math.max(bb.maxX - other.minX, offsetX);
	}
	return offsetX;
};

export const computeOffsetY = (
	bb: AABB,
	other: AABB,
	offsetY: number,
): number => {
	if (
		other.maxX > bb.minX &&
		other.minX < bb.maxX &&
		other.maxZ > bb.minZ &&
		other.minZ < bb.maxZ
	) {
		if (offsetY > 0.0 && other.maxY <= bb.minY)
			return Math.min(bb.minY - other.maxY, offsetY);
		if (offsetY < 0.0 && other.minY >= bb.maxY)
			return Math.max(bb.maxY - other.minY, offsetY);
	}
	return offsetY;
};

export const computeOffsetZ = (
	bb: AABB,
	other: AABB,
	offsetZ: number,
): number => {
	if (
		other.maxX > bb.minX &&
		other.minX < bb.maxX &&
		other.maxY > bb.minY &&
		other.minY < bb.maxY
	) {
		if (offsetZ > 0.0 && other.maxZ <= bb.minZ)
			return Math.min(bb.minZ - other.maxZ, offsetZ);
		if (offsetZ < 0.0 && other.minZ >= bb.maxZ)
			return Math.max(bb.maxZ - other.minZ, offsetZ);
	}
	return offsetZ;
};

export const intersectsAABB = (a: AABB, b: AABB): boolean =>
	a.minX < b.maxX &&
	a.maxX > b.minX &&
	a.minY < b.maxY &&
	a.maxY > b.minY &&
	a.minZ < b.maxZ &&
	a.maxZ > b.minZ;
