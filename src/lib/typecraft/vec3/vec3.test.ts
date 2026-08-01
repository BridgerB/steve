import { describe, expect, it } from "vitest";
import {
	abs,
	add,
	component,
	cross,
	distance,
	distanceSquared,
	distanceXY,
	distanceXZ,
	distanceYZ,
	divide,
	dot,
	equals,
	euclideanMod,
	floor,
	formatVec3,
	isZero,
	length,
	manhattanDistance,
	max,
	min,
	multiply,
	normalize,
	offset,
	round,
	scalarEuclideanMod,
	scale,
	subtract,
	swapYZ,
	toArray,
	toXY,
	toXZ,
	toYZ,
	vec3,
	vec3FromArray,
	vec3FromString,
	volume,
	ZERO,
} from "../index.ts";

describe("construction", () => {
	it("creates from x, y, z", () => {
		const v = vec3(-1, 5, 10.1);
		expect(v.x).toBe(-1);
		expect(v.y).toBe(5);
		expect(v.z).toBe(10.1);
	});

	it("creates from array", () => {
		const v = vec3FromArray([4, 5, 6]);
		expect(v).toEqual(vec3(4, 5, 6));
	});

	it("parses from string", () => {
		const v = vec3FromString("(1, -3.5, 0)");
		expect(v).toEqual(vec3(1, -3.5, 0));
	});

	it("roundtrips through toString", () => {
		const original = vec3(1, -3.5, 0);
		expect(vec3FromString(formatVec3(original))).toEqual(original);
	});

	it("roundtrips large values through toString", () => {
		const original = vec3(-111, 222, 9876543210.12345);
		expect(vec3FromString(formatVec3(original))).toEqual(original);
	});

	it("throws on unparseable string", () => {
		expect(() => vec3FromString("lol hax")).toThrow(/cannot parse/);
	});

	it("ZERO is the zero vector", () => {
		expect(ZERO).toEqual(vec3(0, 0, 0));
	});
});

describe("arithmetic", () => {
	it("adds two vectors", () => {
		expect(add(vec3(1, 2, 3), vec3(-1, 0, 1))).toEqual(vec3(0, 2, 4));
	});

	it("does not mutate inputs on add", () => {
		const a = vec3(1, 2, 3);
		const b = vec3(-1, 0, 1);
		add(a, b);
		expect(a).toEqual(vec3(1, 2, 3));
		expect(b).toEqual(vec3(-1, 0, 1));
	});

	it("subtracts two vectors", () => {
		expect(subtract(vec3(1, 2, 3), vec3(-1, 0, 1))).toEqual(vec3(2, 2, 2));
	});

	it("does not mutate inputs on subtract", () => {
		const a = vec3(1, 2, 3);
		const b = vec3(-1, 0, 1);
		subtract(a, b);
		expect(a).toEqual(vec3(1, 2, 3));
		expect(b).toEqual(vec3(-1, 0, 1));
	});

	it("multiplies component-wise", () => {
		expect(multiply(vec3(1, 2, 3), vec3(-1, -2, -5))).toEqual(
			vec3(-1, -4, -15),
		);
	});

	it("divides component-wise", () => {
		expect(divide(vec3(10, 20, 30), vec3(2, 5, 3))).toEqual(vec3(5, 4, 10));
	});

	it("scales by scalar", () => {
		const v = vec3(1, 2, 3);
		const result = scale(v, 2);
		expect(v).toEqual(vec3(1, 2, 3));
		expect(result).toEqual(vec3(2, 4, 6));
	});

	it("offsets by dx dy dz", () => {
		const v = vec3(1, 2, 3);
		const result = offset(v, 10, -10, 20);
		expect(v).toEqual(vec3(1, 2, 3));
		expect(result).toEqual(vec3(11, -8, 23));
	});
});

describe("rounding", () => {
	it("rounds components", () => {
		expect(round(vec3(1.1, -1.5, 1.9))).toEqual(vec3(1, -1, 2));
	});

	it("floors components", () => {
		expect(floor(vec3(1.1, -1.5, 1.9))).toEqual(vec3(1, -2, 1));
	});

	it("computes absolute values", () => {
		expect(abs(vec3(1.1, -1.5, 1.9))).toEqual(vec3(1.1, 1.5, 1.9));
	});
});

describe("vector operations", () => {
	it("computes vector length", () => {
		expect(Math.round(length(vec3(-10, 0, 10)) * 100000)).toBe(
			Math.round(14.1421356237 * 100000),
		);
	});

	it("computes dot product", () => {
		expect(dot(vec3(-1, -1, -1), vec3(1, 1, 1))).toBe(-3);
	});

	it("computes cross product", () => {
		expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
	});

	it("normalizes to unit vector", () => {
		const result = normalize(vec3(10, -10, 1.1));
		expect(Math.round(result.x * 100000)).toBe(
			Math.round(0.7049774402 * 100000),
		);
		expect(Math.round(result.y * 100000)).toBe(
			Math.round(-0.7049774402 * 100000),
		);
		expect(Math.round(result.z * 100000)).toBe(
			Math.round(0.07754751842 * 100000),
		);
	});

	it("normalizes zero vector to zero", () => {
		expect(normalize(ZERO)).toEqual(ZERO);
	});
});

describe("distances", () => {
	it("computes euclidean distance", () => {
		const a = vec3(1, 1, 1);
		const b = vec3(2, 2, 2);
		const expected = 1.7320508075688772;
		expect(distance(a, b)).toBe(distance(b, a));
		expect(Math.round(distance(a, b) * 100000)).toBe(
			Math.round(expected * 100000),
		);
	});

	it("computes squared distance", () => {
		const a = vec3(1, 1, 1);
		const b = vec3(2, 2, 2);
		expect(distanceSquared(a, b)).toBe(distanceSquared(b, a));
		expect(distanceSquared(a, b)).toBe(3);
	});

	it("computes XY distance", () => {
		const a = vec3(1, 1, 1);
		const b = vec3(2, 2, 2);
		const expected = Math.SQRT2;
		expect(distanceXY(a, b)).toBe(distanceXY(b, a));
		expect(Math.round(distanceXY(a, b) * 100000)).toBe(
			Math.round(expected * 100000),
		);
	});

	it("computes XZ distance", () => {
		const a = vec3(1, 1, 1);
		const b = vec3(2, 2, 2);
		const expected = Math.SQRT2;
		expect(distanceXZ(a, b)).toBe(distanceXZ(b, a));
		expect(Math.round(distanceXZ(a, b) * 100000)).toBe(
			Math.round(expected * 100000),
		);
	});

	it("computes YZ distance", () => {
		const a = vec3(1, 1, 1);
		const b = vec3(2, 2, 2);
		const expected = Math.SQRT2;
		expect(distanceYZ(a, b)).toBe(distanceYZ(b, a));
		expect(Math.round(distanceYZ(a, b) * 100000)).toBe(
			Math.round(expected * 100000),
		);
	});

	it("computes manhattan distance", () => {
		const a = vec3(-1, 0, 1);
		const b = vec3(10, -10, 1.1);
		expect(manhattanDistance(a, b)).toBe(manhattanDistance(b, a));
		expect(manhattanDistance(a, b)).toBe(21.1);
	});
});

describe("comparisons", () => {
	it("checks exact equality", () => {
		const v = vec3(1, 2, 3);
		const scaled = scale(v, 0.23424);
		const scaled2 = scale(v, 0.23424);
		expect(equals(scaled, scaled2)).toBe(true);
	});

	it("checks equality with tolerance", () => {
		const a = vec3(0.1, 0, 0);
		const b = vec3(0.2, 0, 0);
		const sum = add(a, b);
		expect(equals(sum, vec3(0.3, 0, 0), Number.EPSILON)).toBe(true);
	});

	it("checks zero vector", () => {
		expect(isZero(ZERO)).toBe(true);
		expect(isZero(vec3(0, 1, 2))).toBe(false);
	});

	it("computes component-wise min", () => {
		expect(min(vec3(-1, 0, 1), vec3(10, -10, 1.1))).toEqual(vec3(-1, -10, 1));
	});

	it("computes component-wise max", () => {
		expect(max(vec3(-1, 0, 1), vec3(10, -10, 1.1))).toEqual(vec3(10, 0, 1.1));
	});

	it("computes volume", () => {
		expect(volume(vec3(3, 4, 5))).toBe(60);
	});
});

describe("modulus", () => {
	it("computes euclidean mod component-wise", () => {
		const result = euclideanMod(vec3(12, 32, -1), vec3(14, 32, 16));
		expect(result).toEqual(vec3(12, 0, 15));
	});

	it("computes scalar euclidean mod", () => {
		expect(scalarEuclideanMod(-1, 16)).toBe(15);
		expect(scalarEuclideanMod(12, 14)).toBe(12);
	});
});

describe("conversions", () => {
	it("converts to string", () => {
		expect(formatVec3(vec3(1, -1, 3.14))).toBe("(1, -1, 3.14)");
	});

	it("converts to array", () => {
		const v = vec3(1, -1, 3.14);
		expect(toArray(v)).toEqual([1, -1, 3.14]);
	});

	it("projects to XZ", () => {
		expect(toXZ(vec3(0, 1, 2))).toEqual([0, 2]);
	});

	it("projects to XY", () => {
		expect(toXY(vec3(0, 1, 2))).toEqual([0, 1]);
	});

	it("projects to YZ", () => {
		expect(toYZ(vec3(0, 1, 2))).toEqual([1, 2]);
	});

	it("swaps Y and Z", () => {
		expect(swapYZ(vec3(0, 1, 2))).toEqual(vec3(0, 2, 1));
	});

	it("accesses component by index", () => {
		const v = vec3(0, 1, 2);
		expect(component(v, 0)).toBe(0);
		expect(component(v, 1)).toBe(1);
		expect(component(v, 2)).toBe(2);
	});
});
