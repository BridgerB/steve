export type Vec3 = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
};

// ─── Construction ────────────────────────────────────────────────────────────

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const vec3FromArray = (arr: readonly [number, number, number]): Vec3 =>
	vec3(arr[0], arr[1], arr[2]);

const parsePattern = /\((-?[.\d]+), (-?[.\d]+), (-?[.\d]+)\)/;

export const vec3FromString = (str: string): Vec3 => {
	const match = str.match(parsePattern);
	if (!match) throw new Error(`vec3: cannot parse: ${str}`);
	return vec3(
		Number.parseFloat(match[1]!),
		Number.parseFloat(match[2]!),
		Number.parseFloat(match[3]!),
	);
};

export const ZERO: Vec3 = vec3(0, 0, 0);

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export const add = (a: Vec3, b: Vec3): Vec3 =>
	vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const subtract = (a: Vec3, b: Vec3): Vec3 =>
	vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const multiply = (a: Vec3, b: Vec3): Vec3 =>
	vec3(a.x * b.x, a.y * b.y, a.z * b.z);

export const divide = (a: Vec3, b: Vec3): Vec3 =>
	vec3(a.x / b.x, a.y / b.y, a.z / b.z);

export const scale = (v: Vec3, scalar: number): Vec3 =>
	vec3(v.x * scalar, v.y * scalar, v.z * scalar);

export const offset = (v: Vec3, dx: number, dy: number, dz: number): Vec3 =>
	vec3(v.x + dx, v.y + dy, v.z + dz);

// ─── Rounding ────────────────────────────────────────────────────────────────

export const floor = (v: Vec3): Vec3 =>
	vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z));

export const round = (v: Vec3): Vec3 =>
	vec3(Math.round(v.x), Math.round(v.y), Math.round(v.z));

export const abs = (v: Vec3): Vec3 =>
	vec3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));

// ─── Component-wise comparison ───────────────────────────────────────────────

export const min = (a: Vec3, b: Vec3): Vec3 =>
	vec3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));

export const max = (a: Vec3, b: Vec3): Vec3 =>
	vec3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));

// ─── Modulus ─────────────────────────────────────────────────────────────────

export const scalarEuclideanMod = (
	numerator: number,
	denominator: number,
): number => {
	const result = numerator % denominator;
	return result < 0 ? result + denominator : result;
};

export const euclideanMod = (a: Vec3, b: Vec3): Vec3 =>
	vec3(
		scalarEuclideanMod(a.x, b.x),
		scalarEuclideanMod(a.y, b.y),
		scalarEuclideanMod(a.z, b.z),
	);

// ─── Vector operations ──────────────────────────────────────────────────────

export const dot = (a: Vec3, b: Vec3): number =>
	a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
	vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const length = (v: Vec3): number =>
	Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

export const normalize = (v: Vec3): Vec3 => {
	const len = length(v);
	return len === 0 ? vec3(0, 0, 0) : scale(v, 1 / len);
};

// ─── Distances ───────────────────────────────────────────────────────────────

export const distance = (a: Vec3, b: Vec3): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dz = b.z - a.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const distanceSquared = (a: Vec3, b: Vec3): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dz = b.z - a.z;
	return dx * dx + dy * dy + dz * dz;
};

export const distanceXY = (a: Vec3, b: Vec3): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.sqrt(dx * dx + dy * dy);
};

export const distanceXZ = (a: Vec3, b: Vec3): number => {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	return Math.sqrt(dx * dx + dz * dz);
};

export const distanceYZ = (a: Vec3, b: Vec3): number => {
	const dy = b.y - a.y;
	const dz = b.z - a.z;
	return Math.sqrt(dy * dy + dz * dz);
};

export const manhattanDistance = (a: Vec3, b: Vec3): number =>
	Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(b.z - a.z);

// ─── Scalar queries ──────────────────────────────────────────────────────────

export const volume = (v: Vec3): number => v.x * v.y * v.z;

export const isZero = (v: Vec3): boolean => v.x === 0 && v.y === 0 && v.z === 0;

export const equals = (a: Vec3, b: Vec3, tolerance = 0): boolean =>
	Math.abs(a.x - b.x) <= tolerance &&
	Math.abs(a.y - b.y) <= tolerance &&
	Math.abs(a.z - b.z) <= tolerance;

export const component = (v: Vec3, index: number): number =>
	[v.x, v.y, v.z][index]!;

// ─── Conversions ─────────────────────────────────────────────────────────────

export const formatVec3 = (v: Vec3): string => `(${v.x}, ${v.y}, ${v.z})`;

export const toArray = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

export const toXZ = (v: Vec3): [number, number] => [v.x, v.z];

export const toXY = (v: Vec3): [number, number] => [v.x, v.y];

export const toYZ = (v: Vec3): [number, number] => [v.y, v.z];

export const swapYZ = (v: Vec3): Vec3 => vec3(v.x, v.z, v.y);
