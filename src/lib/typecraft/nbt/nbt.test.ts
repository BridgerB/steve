import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { NbtRoot, NbtTag } from "./index.ts";
import {
	equalNbt,
	nbtBool,
	nbtByte,
	nbtByteArray,
	nbtCompound,
	nbtDouble,
	nbtFloat,
	nbtInt,
	nbtIntArray,
	nbtList,
	nbtLong,
	nbtLongArray,
	nbtShort,
	nbtString,
	parseNbt,
	parseUncompressedNbt,
	simplifyNbt,
	writeUncompressedNbt,
} from "./index.ts";

const SAMPLE_DIR = resolve("upstream/prismarine-nbt/sample");
const readSample = (name: string): Buffer =>
	readFileSync(resolve(SAMPLE_DIR, name));

// Generate the expected byteArray: (n*n*255+n*7)%100 for n=0..999
const expectedByteArray = Array.from(
	{ length: 1000 },
	(_, n) => (n * n * 255 + n * 7) % 100,
);

describe("builder functions", () => {
	it("creates byte tag", () => {
		expect(nbtByte(42)).toEqual({ type: "byte", value: 42 });
	});

	it("creates short tag", () => {
		expect(nbtShort(1000)).toEqual({ type: "short", value: 1000 });
	});

	it("creates int tag", () => {
		expect(nbtInt(100000)).toEqual({ type: "int", value: 100000 });
	});

	it("creates long tag", () => {
		expect(nbtLong([0, 42])).toEqual({ type: "long", value: [0, 42] });
	});

	it("creates float tag", () => {
		expect(nbtFloat(3.14)).toEqual({ type: "float", value: 3.14 });
	});

	it("creates double tag", () => {
		expect(nbtDouble(1.23456)).toEqual({ type: "double", value: 1.23456 });
	});

	it("creates string tag", () => {
		expect(nbtString("hello")).toEqual({ type: "string", value: "hello" });
	});

	it("creates byteArray tag", () => {
		expect(nbtByteArray([1, 2, 3])).toEqual({
			type: "byteArray",
			value: [1, 2, 3],
		});
	});

	it("creates intArray tag", () => {
		expect(nbtIntArray([10, 20])).toEqual({
			type: "intArray",
			value: [10, 20],
		});
	});

	it("creates longArray tag", () => {
		expect(
			nbtLongArray([
				[0, 1],
				[0, 2],
			]),
		).toEqual({
			type: "longArray",
			value: [
				[0, 1],
				[0, 2],
			],
		});
	});

	it("creates compound tag", () => {
		const tag = nbtCompound({ x: nbtInt(5) }, "root");
		expect(tag.type).toBe("compound");
		expect(tag.name).toBe("root");
		expect(tag.value.x).toEqual({ type: "int", value: 5 });
	});

	it("creates empty list tag", () => {
		expect(nbtList()).toEqual({
			type: "list",
			value: { type: "end", value: [] },
		});
	});

	it("creates list tag with items", () => {
		const tag = nbtList({ type: "int", value: [1, 2, 3] });
		expect(tag.type).toBe("list");
		expect(tag.value.type).toBe("int");
		expect(tag.value.value).toEqual([1, 2, 3]);
	});

	it("creates bool tag (stored as short)", () => {
		expect(nbtBool(true)).toEqual({ type: "short", value: 1 });
		expect(nbtBool(false)).toEqual({ type: "short", value: 0 });
		expect(nbtBool()).toEqual({ type: "short", value: 0 });
	});
});

describe("parse big-endian", () => {
	it("parses bigtest.nbt", () => {
		const data = readSample("bigtest.nbt");
		const root = parseUncompressedNbt(data, "big");

		expect(root.name).toBe("Level");
		expect(root.type).toBe("compound");

		const v = root.value;
		expect(v.longTest).toEqual({ type: "long", value: [2147483647, -1] });
		expect(v.shortTest).toEqual({ type: "short", value: 32767 });
		expect(v.stringTest).toEqual({
			type: "string",
			value: "HELLO WORLD THIS IS A TEST STRING ÅÄÖ!",
		});
		expect((v.floatTest as { value: number }).value).toBeCloseTo(
			0.498231470584869,
			5,
		);
		expect(v.intTest).toEqual({ type: "int", value: 2147483647 });
		expect(v.byteTest).toEqual({ type: "byte", value: 127 });
		expect((v.doubleTest as { value: number }).value).toBeCloseTo(
			0.493128713218231,
			5,
		);
	});

	it("parses nested compounds", () => {
		const data = readSample("bigtest.nbt");
		const root = parseUncompressedNbt(data, "big");
		const nested = root.value["nested compound test"] as NbtTag;

		expect(nested.type).toBe("compound");
		const nestedValue = nested.value as Record<string, NbtTag>;
		expect((nestedValue.ham.value as Record<string, NbtTag>).name).toEqual({
			type: "string",
			value: "Hampus",
		});
		expect((nestedValue.egg.value as Record<string, NbtTag>).name).toEqual({
			type: "string",
			value: "Eggbert",
		});
	});

	it("parses lists", () => {
		const data = readSample("bigtest.nbt");
		const root = parseUncompressedNbt(data, "big");

		const longList = root.value["listTest (long)"] as NbtTag;
		expect(longList.type).toBe("list");
		const longListValue = (
			longList as { value: { type: string; value: unknown[] } }
		).value;
		expect(longListValue.type).toBe("long");
		expect(longListValue.value).toEqual([
			[0, 11],
			[0, 12],
			[0, 13],
			[0, 14],
			[0, 15],
		]);

		const compoundList = root.value["listTest (compound)"] as NbtTag;
		expect(compoundList.type).toBe("list");
	});

	it("parses byteArray", () => {
		const data = readSample("bigtest.nbt");
		const root = parseUncompressedNbt(data, "big");

		const key =
			"byteArrayTest (the first 1000 values of (n*n*255+n*7)%100, starting with n=0 (0, 62, 34, 16, 8, ...))";
		const byteArray = root.value[key] as NbtTag;
		expect(byteArray.type).toBe("byteArray");
		expect((byteArray.value as number[]).length).toBe(1000);
		expect(byteArray.value as number[]).toEqual(expectedByteArray);
	});

	it("parses empty compound", () => {
		const data = readSample("emptyComp.nbt");
		const root = parseUncompressedNbt(data, "big");
		expect(root.type).toBe("compound");
		expect(Object.keys(root.value)).toHaveLength(0);
	});
});

describe("parse with auto-detection", () => {
	it("detects gzip compressed big-endian", () => {
		const data = readSample("bigtest.nbt.gz");
		const result = parseNbt(data);
		expect(result.format).toBe("big");
		expect(result.parsed.name).toBe("Level");
		expect(result.parsed.value.shortTest).toEqual({
			type: "short",
			value: 32767,
		});
	});

	it("detects uncompressed big-endian", () => {
		const data = readSample("bigtest.nbt");
		const result = parseNbt(data);
		expect(result.format).toBe("big");
		expect(result.parsed.name).toBe("Level");
	});
});

describe("parse little-endian", () => {
	it("parses level.dat (Bedrock)", () => {
		const data = readSample("level.dat");
		const result = parseNbt(data);
		expect(result.format).toBe("little");
		expect(result.parsed.type).toBe("compound");
	});

	it("parses biome_definitions.le.nbt (littleVarint)", () => {
		const data = readSample("biome_definitions.le.nbt");
		const root = parseUncompressedNbt(data, "littleVarint");
		expect(root.type).toBe("compound");
	});
});

describe("parse littleVarint", () => {
	it("parses block_states.lev.nbt", () => {
		const data = readSample("block_states.lev.nbt");
		const result = parseNbt(data);
		expect(result.parsed.type).toBe("compound");
	});
});

describe("roundtrip", () => {
	it("roundtrips big-endian", () => {
		const data = readSample("bigtest.nbt");
		const original = parseUncompressedNbt(data, "big");
		const written = writeUncompressedNbt(original, "big");
		const reparsed = parseUncompressedNbt(written, "big");
		expect(equalNbt(original, reparsed)).toBe(true);
	});

	it("roundtrips little-endian", () => {
		const data = readSample("level.dat");
		const result = parseNbt(data);
		const written = writeUncompressedNbt(result.parsed, result.format);
		const reparsed = parseUncompressedNbt(written, result.format);
		expect(equalNbt(result.parsed, reparsed)).toBe(true);
	});

	it("roundtrips littleVarint", () => {
		const data = readSample("block_states.lev.nbt");
		const original = parseUncompressedNbt(data, "littleVarint");
		const written = writeUncompressedNbt(original, "littleVarint");
		const reparsed = parseUncompressedNbt(written, "littleVarint");
		expect(equalNbt(original, reparsed)).toBe(true);
	});

	it("roundtrips empty compound", () => {
		const data = readSample("emptyComp.nbt");
		const original = parseUncompressedNbt(data, "big");
		const written = writeUncompressedNbt(original, "big");
		const reparsed = parseUncompressedNbt(written, "big");
		expect(equalNbt(original, reparsed)).toBe(true);
	});

	it("roundtrips builder-constructed NBT", () => {
		const root = nbtCompound({
			name: nbtString("test"),
			value: nbtInt(42),
			items: nbtList({ type: "byte", value: [1, 2, 3] }),
			nested: nbtCompound({ x: nbtDouble(1.5) }) as NbtTag,
		});
		const written = writeUncompressedNbt(root, "big");
		const reparsed = parseUncompressedNbt(written, "big");
		expect(equalNbt(root, reparsed)).toBe(true);
	});
});

describe("cross-format encode", () => {
	it("big → little → big", () => {
		const data = readSample("bigtest.nbt");
		const original = parseUncompressedNbt(data, "big");
		const asLittle = writeUncompressedNbt(original, "little");
		const fromLittle = parseUncompressedNbt(asLittle, "little");
		expect(equalNbt(original, fromLittle)).toBe(true);
	});
});

describe("simplifyNbt", () => {
	it("simplifies primitives", () => {
		expect(simplifyNbt(nbtInt(42))).toBe(42);
		expect(simplifyNbt(nbtString("hello"))).toBe("hello");
		expect(simplifyNbt(nbtByte(1))).toBe(1);
	});

	it("simplifies compound", () => {
		const tag: NbtTag = {
			type: "compound",
			value: {
				x: nbtInt(5),
				name: nbtString("test"),
			},
		};
		expect(simplifyNbt(tag)).toEqual({ x: 5, name: "test" });
	});

	it("simplifies list", () => {
		const tag = nbtList({ type: "int", value: [10, 20, 30] });
		expect(simplifyNbt(tag)).toEqual([10, 20, 30]);
	});

	it("simplifies nested structures", () => {
		const tag: NbtTag = {
			type: "compound",
			value: {
				items: nbtList({ type: "int", value: [1, 2] }),
				nested: {
					type: "compound",
					value: { x: nbtFloat(1.5) },
				} as NbtTag,
			},
		};
		const simplified = simplifyNbt(tag) as Record<string, unknown>;
		expect(simplified.items).toEqual([1, 2]);
		expect((simplified.nested as Record<string, unknown>).x).toBeCloseTo(1.5);
	});

	it("simplifies real parsed data", () => {
		const data = readSample("bigtest.nbt");
		const root = parseUncompressedNbt(data, "big");
		const simplified = simplifyNbt(root) as Record<string, unknown>;
		expect(simplified.shortTest).toBe(32767);
		expect(simplified.stringTest).toBe(
			"HELLO WORLD THIS IS A TEST STRING ÅÄÖ!",
		);
		expect(simplified.byteTest).toBe(127);
	});
});

describe("equalNbt", () => {
	it("returns true for equal primitives", () => {
		expect(equalNbt(nbtInt(42), nbtInt(42))).toBe(true);
		expect(equalNbt(nbtString("a"), nbtString("a"))).toBe(true);
		expect(equalNbt(nbtLong([0, 1]), nbtLong([0, 1]))).toBe(true);
	});

	it("returns false for different values", () => {
		expect(equalNbt(nbtInt(42), nbtInt(43))).toBe(false);
		expect(equalNbt(nbtString("a"), nbtString("b"))).toBe(false);
		expect(equalNbt(nbtLong([0, 1]), nbtLong([0, 2]))).toBe(false);
	});

	it("returns false for different types", () => {
		expect(equalNbt(nbtInt(42), nbtShort(42))).toBe(false);
		expect(equalNbt(nbtFloat(1.0), nbtDouble(1.0))).toBe(false);
	});

	it("compares compounds", () => {
		const a: NbtTag = { type: "compound", value: { x: nbtInt(1) } };
		const b: NbtTag = { type: "compound", value: { x: nbtInt(1) } };
		const c: NbtTag = { type: "compound", value: { x: nbtInt(2) } };
		const d: NbtTag = { type: "compound", value: { y: nbtInt(1) } };

		expect(equalNbt(a, b)).toBe(true);
		expect(equalNbt(a, c)).toBe(false);
		expect(equalNbt(a, d)).toBe(false);
	});

	it("compares lists", () => {
		const a = nbtList({ type: "int", value: [1, 2, 3] });
		const b = nbtList({ type: "int", value: [1, 2, 3] });
		const c = nbtList({ type: "int", value: [1, 2, 4] });
		const d = nbtList({ type: "byte", value: [1, 2, 3] });

		expect(equalNbt(a, b)).toBe(true);
		expect(equalNbt(a, c)).toBe(false);
		expect(equalNbt(a, d)).toBe(false);
	});

	it("compares arrays", () => {
		expect(equalNbt(nbtByteArray([1, 2]), nbtByteArray([1, 2]))).toBe(true);
		expect(equalNbt(nbtByteArray([1, 2]), nbtByteArray([1, 3]))).toBe(false);
		expect(equalNbt(nbtIntArray([10]), nbtIntArray([10]))).toBe(true);
		expect(
			equalNbt(
				nbtLongArray([
					[0, 1],
					[0, 2],
				]),
				nbtLongArray([
					[0, 1],
					[0, 2],
				]),
			),
		).toBe(true);
		expect(equalNbt(nbtLongArray([[0, 1]]), nbtLongArray([[0, 2]]))).toBe(
			false,
		);
	});

	it("compares parsed NBT data", () => {
		const data = readSample("bigtest.nbt");
		const a = parseUncompressedNbt(data, "big");
		const b = parseUncompressedNbt(data, "big");
		expect(equalNbt(a, b)).toBe(true);
	});
});

describe("edge cases", () => {
	it("handles empty list (type=end)", () => {
		const root = nbtCompound({ items: nbtList() });
		const written = writeUncompressedNbt(root, "big");
		const reparsed = parseUncompressedNbt(written, "big");
		const items = reparsed.value.items as NbtTag;
		expect(items.type).toBe("list");
		expect(
			(items as { value: { type: string; value: unknown[] } }).value.type,
		).toBe("end");
		expect(
			(items as { value: { type: string; value: unknown[] } }).value.value,
		).toHaveLength(0);
	});

	it("handles UTF-8 strings", () => {
		const root = nbtCompound({
			jp: nbtString("こんにちは!"),
			nordic: nbtString("ÅÄÖ"),
		});
		const written = writeUncompressedNbt(root, "big");
		const reparsed = parseUncompressedNbt(written, "big");
		expect((reparsed.value.jp as NbtTag).value).toBe("こんにちは!");
		expect((reparsed.value.nordic as NbtTag).value).toBe("ÅÄÖ");
	});

	it("handles deeply nested compounds", () => {
		const deep: NbtRoot = nbtCompound({
			a: {
				type: "compound",
				value: {
					b: {
						type: "compound",
						value: {
							c: {
								type: "compound",
								value: { d: nbtInt(42) },
							} as NbtTag,
						},
					} as NbtTag,
				},
			} as NbtTag,
		});
		const written = writeUncompressedNbt(deep, "big");
		const reparsed = parseUncompressedNbt(written, "big");
		expect(equalNbt(deep, reparsed)).toBe(true);
	});

	it("handles max/min numeric values", () => {
		const root = nbtCompound({
			maxByte: nbtByte(127),
			minByte: nbtByte(-128),
			maxShort: nbtShort(32767),
			minShort: nbtShort(-32768),
			maxInt: nbtInt(2147483647),
			minInt: nbtInt(-2147483648),
		});
		const written = writeUncompressedNbt(root, "big");
		const reparsed = parseUncompressedNbt(written, "big");
		expect(equalNbt(root, reparsed)).toBe(true);
	});
});
