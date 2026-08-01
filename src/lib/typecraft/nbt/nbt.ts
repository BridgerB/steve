import { gunzipSync, inflateSync } from "node:zlib";
import { readAnonymousTag, readRootTag } from "./read.ts";
import type {
	NbtByte,
	NbtByteArray,
	NbtCompound,
	NbtDouble,
	NbtFloat,
	NbtFormat,
	NbtInt,
	NbtIntArray,
	NbtList,
	NbtLong,
	NbtLongArray,
	NbtParseResult,
	NbtRoot,
	NbtShort,
	NbtString,
	NbtTag,
	NbtTagType,
	NbtTagValue,
} from "./types.ts";
import { writeAnonymousTag, writeRootTag } from "./write.ts";

// ─── Decompression helpers ──────────────────────────────────────────────────

const hasGzipHeader = (data: Buffer): boolean =>
	data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;

const hasBedrockLevelHeader = (data: Buffer): boolean =>
	data.length >= 4 && data[1] === 0 && data[2] === 0 && data[3] === 0;

const decompress = (data: Buffer): Buffer => {
	if (hasGzipHeader(data)) return gunzipSync(data);
	try {
		return inflateSync(data);
	} catch {
		return data;
	}
};

// ─── Parse (auto-detect format + decompress) ───────────────────────────────

export const parseNbt = (data: Buffer | Uint8Array): NbtParseResult => {
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
	const decompressed = decompress(buf);

	if (hasBedrockLevelHeader(decompressed)) {
		const result = readRootTag(decompressed, 8, "little");
		return {
			parsed: result.value,
			format: "little",
			bytesRead: result.size,
		};
	}

	const formats: NbtFormat[] = ["big", "little", "littleVarint"];
	for (const format of formats) {
		try {
			const result = readRootTag(decompressed, 0, format);
			return { parsed: result.value, format, bytesRead: result.size };
		} catch {
			// try next format
		}
	}

	throw new Error("Failed to parse NBT: could not detect format");
};

// ─── Parse (explicit format, no decompression) ─────────────────────────────

export const parseUncompressedNbt = (
	data: Buffer | Uint8Array,
	format: NbtFormat = "big",
): NbtRoot => {
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
	return readRootTag(buf, 0, format).value;
};

// ─── Parse anonymous (network NBT — no name string) ─────────────────────────

export const readAnonymousNbt = (
	data: Buffer,
	offset: number,
	format: NbtFormat = "big",
): { value: NbtRoot | null; size: number } =>
	readAnonymousTag(data, offset, format);

export const writeAnonymousNbt = (
	root: NbtRoot | null,
	format: NbtFormat = "big",
): Buffer => writeAnonymousTag(root, format);

// ─── Write ──────────────────────────────────────────────────────────────────

export const writeUncompressedNbt = (
	root: NbtRoot,
	format: NbtFormat = "big",
): Buffer => writeRootTag(root, format);

// ─── Simplify (strip type wrappers → plain JS values) ──────────────────────

export const simplifyNbt = (tag: NbtTag): unknown => {
	switch (tag.type) {
		case "compound":
			return Object.fromEntries(
				Object.entries(tag.value).map(([key, child]) => [
					key,
					simplifyNbt(child),
				]),
			);
		case "list":
			return tag.value.value.map((item) =>
				simplifyNbt({ type: tag.value.type, value: item } as NbtTag),
			);
		default:
			return tag.value;
	}
};

// ─── Equality (deep structural comparison) ──────────────────────────────────

export const equalNbt = (a: NbtTag, b: NbtTag): boolean => {
	if (a.type !== b.type) return false;

	switch (a.type) {
		case "compound": {
			const bValue = (b as NbtCompound).value;
			const aEntries = Object.entries(a.value);
			if (aEntries.length !== Object.keys(bValue).length) return false;
			return aEntries.every(
				([key, val]) => key in bValue && equalNbt(val, bValue[key]!),
			);
		}
		case "list": {
			const bList = (b as NbtList).value;
			if (a.value.type !== bList.type) return false;
			if (a.value.value.length !== bList.value.length) return false;
			return a.value.value.every((item, i) =>
				equalNbt(
					{ type: a.value.type, value: item } as NbtTag,
					{ type: bList.type, value: bList.value[i] } as NbtTag,
				),
			);
		}
		case "long":
			return (
				a.value[0] === (b as NbtLong).value[0] &&
				a.value[1] === (b as NbtLong).value[1]
			);
		case "byteArray":
		case "intArray": {
			const bArr = (b as NbtByteArray | NbtIntArray).value;
			return (
				a.value.length === bArr.length && a.value.every((v, i) => v === bArr[i])
			);
		}
		case "longArray": {
			const bLongs = (b as NbtLongArray).value;
			if (a.value.length !== bLongs.length) return false;
			return a.value.every(
				(v, i) => v[0] === bLongs[i]![0] && v[1] === bLongs[i]![1],
			);
		}
		default:
			return a.value === (b as typeof a).value;
	}
};

// ─── Builder functions ──────────────────────────────────────────────────────

export const nbtByte = (value: number): NbtByte => ({ type: "byte", value });

export const nbtShort = (value: number): NbtShort => ({
	type: "short",
	value,
});

export const nbtInt = (value: number): NbtInt => ({ type: "int", value });

export const nbtLong = (value: readonly [number, number]): NbtLong => ({
	type: "long",
	value,
});

export const nbtFloat = (value: number): NbtFloat => ({
	type: "float",
	value,
});

export const nbtDouble = (value: number): NbtDouble => ({
	type: "double",
	value,
});

export const nbtString = (value: string): NbtString => ({
	type: "string",
	value,
});

export const nbtByteArray = (value: readonly number[] = []): NbtByteArray => ({
	type: "byteArray",
	value,
});

export const nbtIntArray = (value: readonly number[] = []): NbtIntArray => ({
	type: "intArray",
	value,
});

export const nbtLongArray = (
	value: readonly (readonly [number, number])[] = [],
): NbtLongArray => ({
	type: "longArray",
	value,
});

export const nbtCompound = (
	value: Record<string, NbtTag> = {},
	name = "",
): NbtRoot => ({ type: "compound", name, value });

export const nbtList = (
	inner?: {
		readonly type: NbtTagType | "end";
		readonly value: readonly NbtTagValue[];
	} | null,
): NbtList => ({
	type: "list",
	value: inner ?? { type: "end", value: [] },
});

export const nbtBool = (value = false): NbtShort => ({
	type: "short",
	value: value ? 1 : 0,
});
