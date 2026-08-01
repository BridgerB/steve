import type {
	NbtCompound,
	NbtFormat,
	NbtList,
	NbtRoot,
	NbtTag,
	NbtTagType,
	NbtTagValue,
	ReadResult,
} from "./types.ts";
import { TAG_ID_TO_TYPE } from "./types.ts";

// ─── Format reader interface ────────────────────────────────────────────────

type FormatReader = {
	readonly readInt16: (buf: Buffer, offset: number) => ReadResult<number>;
	readonly readInt32: (buf: Buffer, offset: number) => ReadResult<number>;
	readonly readInt64: (
		buf: Buffer,
		offset: number,
	) => ReadResult<readonly [number, number]>;
	readonly readFloat32: (buf: Buffer, offset: number) => ReadResult<number>;
	readonly readFloat64: (buf: Buffer, offset: number) => ReadResult<number>;
	readonly readString: (buf: Buffer, offset: number) => ReadResult<string>;
	readonly readArrayCount: (buf: Buffer, offset: number) => ReadResult<number>;
};

// ─── Big-endian primitives ──────────────────────────────────────────────────

const readInt16BE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readInt16BE(offset),
	size: 2,
});

const readInt32BE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readInt32BE(offset),
	size: 4,
});

const readInt64BE = (
	buf: Buffer,
	offset: number,
): ReadResult<readonly [number, number]> => ({
	value: [buf.readInt32BE(offset), buf.readInt32BE(offset + 4)],
	size: 8,
});

const readFloat32BE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readFloatBE(offset),
	size: 4,
});

const readFloat64BE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readDoubleBE(offset),
	size: 8,
});

const readStringBE = (buf: Buffer, offset: number): ReadResult<string> => {
	const length = buf.readUInt16BE(offset);
	return {
		value: buf.toString("utf8", offset + 2, offset + 2 + length),
		size: 2 + length,
	};
};

// ─── Little-endian primitives ───────────────────────────────────────────────

const readInt16LE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readInt16LE(offset),
	size: 2,
});

const readInt32LE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readInt32LE(offset),
	size: 4,
});

const readInt64LE = (
	buf: Buffer,
	offset: number,
): ReadResult<readonly [number, number]> => ({
	value: [buf.readInt32LE(offset + 4), buf.readInt32LE(offset)],
	size: 8,
});

const readFloat32LE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readFloatLE(offset),
	size: 4,
});

const readFloat64LE = (buf: Buffer, offset: number): ReadResult<number> => ({
	value: buf.readDoubleLE(offset),
	size: 8,
});

const readStringLE = (buf: Buffer, offset: number): ReadResult<string> => {
	const length = buf.readUInt16LE(offset);
	return {
		value: buf.toString("utf8", offset + 2, offset + 2 + length),
		size: 2 + length,
	};
};

// ─── Varint primitives ──────────────────────────────────────────────────────

const readVarint = (buf: Buffer, offset: number): ReadResult<number> => {
	let value = 0;
	let size = 0;
	let byte: number;
	do {
		byte = buf[offset + size]!;
		value |= (byte & 0x7f) << (7 * size);
		size++;
	} while (byte & 0x80);
	return { value: value >>> 0, size };
};

const readZigZag32 = (buf: Buffer, offset: number): ReadResult<number> => {
	const { value: raw, size } = readVarint(buf, offset);
	return { value: (raw >>> 1) ^ -(raw & 1), size };
};

const readZigZag64 = (
	buf: Buffer,
	offset: number,
): ReadResult<readonly [number, number]> => {
	let value = 0n;
	let size = 0;
	let shift = 0n;
	let byte: number;
	do {
		byte = buf[offset + size]!;
		value |= BigInt(byte & 0x7f) << shift;
		shift += 7n;
		size++;
	} while (byte & 0x80);
	const decoded = (value >> 1n) ^ -(value & 1n);
	const high = Number((decoded >> 32n) & 0xffffffffn);
	const low = Number(decoded & 0xffffffffn);
	return { value: [high, low], size };
};

const readStringVarint = (buf: Buffer, offset: number): ReadResult<string> => {
	const { value: length, size: prefixSize } = readVarint(buf, offset);
	return {
		value: buf.toString(
			"utf8",
			offset + prefixSize,
			offset + prefixSize + length,
		),
		size: prefixSize + length,
	};
};

// ─── Format reader instances ────────────────────────────────────────────────

const bigEndianReader: FormatReader = {
	readInt16: readInt16BE,
	readInt32: readInt32BE,
	readInt64: readInt64BE,
	readFloat32: readFloat32BE,
	readFloat64: readFloat64BE,
	readString: readStringBE,
	readArrayCount: readInt32BE,
};

const littleEndianReader: FormatReader = {
	readInt16: readInt16LE,
	readInt32: readInt32LE,
	readInt64: readInt64LE,
	readFloat32: readFloat32LE,
	readFloat64: readFloat64LE,
	readString: readStringLE,
	readArrayCount: readInt32LE,
};

const littleVarintReader: FormatReader = {
	readInt16: readInt16LE,
	readInt32: readZigZag32,
	readInt64: readZigZag64,
	readFloat32: readFloat32LE,
	readFloat64: readFloat64LE,
	readString: readStringVarint,
	readArrayCount: readZigZag32,
};

const getReader = (format: NbtFormat): FormatReader => {
	if (format === "big") return bigEndianReader;
	if (format === "little") return littleEndianReader;
	return littleVarintReader;
};

// ─── Tag payload readers ────────────────────────────────────────────────────

const readByteArray = (
	buf: Buffer,
	offset: number,
	reader: FormatReader,
): ReadResult<readonly number[]> => {
	const { value: count, size: countSize } = reader.readArrayCount(buf, offset);
	const value: number[] = [];
	for (let i = 0; i < count; i++)
		value.push(buf.readInt8(offset + countSize + i));
	return { value, size: countSize + count };
};

const readIntArray = (
	buf: Buffer,
	offset: number,
	reader: FormatReader,
): ReadResult<readonly number[]> => {
	const { value: count, size: countSize } = reader.readArrayCount(buf, offset);
	const value: number[] = [];
	let pos = offset + countSize;
	for (let i = 0; i < count; i++) {
		const result = reader.readInt32(buf, pos);
		value.push(result.value);
		pos += result.size;
	}
	return { value, size: pos - offset };
};

const readLongArray = (
	buf: Buffer,
	offset: number,
	reader: FormatReader,
): ReadResult<readonly (readonly [number, number])[]> => {
	const { value: count, size: countSize } = reader.readArrayCount(buf, offset);
	const value: (readonly [number, number])[] = [];
	let pos = offset + countSize;
	for (let i = 0; i < count; i++) {
		const result = reader.readInt64(buf, pos);
		value.push(result.value);
		pos += result.size;
	}
	return { value, size: pos - offset };
};

const readList = (
	buf: Buffer,
	offset: number,
	reader: FormatReader,
): ReadResult<NbtList["value"]> => {
	const tagId = buf.readInt8(offset);
	const tagType = TAG_ID_TO_TYPE[tagId] as NbtTagType | "end";
	const { value: count, size: countSize } = reader.readArrayCount(
		buf,
		offset + 1,
	);
	let pos = offset + 1 + countSize;
	const items: NbtTagValue[] = [];
	for (let i = 0; i < count; i++) {
		const result = readPayload(buf, pos, tagType as NbtTagType, reader);
		items.push(result.value);
		pos += result.size;
	}
	return { value: { type: tagType, value: items }, size: pos - offset };
};

const readCompound = (
	buf: Buffer,
	offset: number,
	reader: FormatReader,
): ReadResult<NbtCompound["value"]> => {
	const entries: Record<string, NbtTag> = {};
	let pos = offset;
	while (pos < buf.length) {
		const tagId = buf.readUInt8(pos);
		pos += 1;
		if (tagId === 0) break;
		const tagType = TAG_ID_TO_TYPE[tagId] as NbtTagType;
		if (!tagType) throw new Error(`Unknown tag ID: ${tagId}`);
		const nameResult = reader.readString(buf, pos);
		pos += nameResult.size;
		const payloadResult = readPayload(buf, pos, tagType, reader);
		entries[nameResult.value] = {
			type: tagType,
			value: payloadResult.value,
		} as NbtTag;
		pos += payloadResult.size;
	}
	return { value: entries, size: pos - offset };
};

const readPayload = (
	buf: Buffer,
	offset: number,
	tagType: NbtTagType,
	reader: FormatReader,
): ReadResult<NbtTagValue> => {
	switch (tagType) {
		case "byte":
			return { value: buf.readInt8(offset), size: 1 };
		case "short":
			return reader.readInt16(buf, offset);
		case "int":
			return reader.readInt32(buf, offset);
		case "long":
			return reader.readInt64(buf, offset);
		case "float":
			return reader.readFloat32(buf, offset);
		case "double":
			return reader.readFloat64(buf, offset);
		case "byteArray":
			return readByteArray(buf, offset, reader);
		case "string":
			return reader.readString(buf, offset);
		case "list":
			return readList(buf, offset, reader);
		case "compound":
			return readCompound(buf, offset, reader);
		case "intArray":
			return readIntArray(buf, offset, reader);
		case "longArray":
			return readLongArray(buf, offset, reader);
	}
};

// ─── Anonymous tag reader (network NBT — no name string) ────────────────────

export const readAnonymousTag = (
	buf: Buffer,
	offset: number,
	format: NbtFormat,
): ReadResult<NbtRoot | null> => {
	const tagId = buf.readUInt8(offset);
	if (tagId === 0) return { value: null, size: 1 };
	const tagType = TAG_ID_TO_TYPE[tagId] as NbtTagType;
	if (!tagType) throw new Error(`Unknown NBT tag ID: ${tagId}`);
	const reader = getReader(format);
	const result = readPayload(buf, offset + 1, tagType, reader);
	return {
		value: { type: tagType, name: "", value: result.value } as NbtRoot,
		size: 1 + result.size,
	};
};

// ─── Root tag reader ────────────────────────────────────────────────────────

export const readRootTag = (
	buf: Buffer,
	offset: number,
	format: NbtFormat,
): ReadResult<NbtRoot> => {
	const reader = getReader(format);
	const tagId = buf.readUInt8(offset);
	if (tagId !== 10) throw new Error(`Expected compound tag (10), got ${tagId}`);
	let pos = offset + 1;
	const nameResult = reader.readString(buf, pos);
	pos += nameResult.size;
	const compoundResult = readCompound(buf, pos, reader);
	pos += compoundResult.size;
	return {
		value: {
			type: "compound",
			name: nameResult.value,
			value: compoundResult.value,
		},
		size: pos - offset,
	};
};
