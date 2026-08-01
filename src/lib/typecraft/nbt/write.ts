import type { NbtFormat, NbtList, NbtRoot, NbtTag } from "./types.ts";
import { TAG_TYPE_TO_ID } from "./types.ts";

// ─── Format writer interface ────────────────────────────────────────────────

type FormatWriter = {
	readonly writeInt16: (value: number, buf: Buffer, offset: number) => number;
	readonly writeInt32: (value: number, buf: Buffer, offset: number) => number;
	readonly writeInt64: (
		value: readonly [number, number],
		buf: Buffer,
		offset: number,
	) => number;
	readonly writeFloat32: (value: number, buf: Buffer, offset: number) => number;
	readonly writeFloat64: (value: number, buf: Buffer, offset: number) => number;
	readonly writeString: (value: string, buf: Buffer, offset: number) => number;
	readonly writeArrayCount: (
		value: number,
		buf: Buffer,
		offset: number,
	) => number;
};

// ─── Big-endian primitives ──────────────────────────────────────────────────

const writeInt16BE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeInt16BE(value, offset);
	return offset + 2;
};

const writeInt32BE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeInt32BE(value, offset);
	return offset + 4;
};

const writeInt64BE = (
	value: readonly [number, number],
	buf: Buffer,
	offset: number,
): number => {
	buf.writeInt32BE(value[0], offset);
	buf.writeInt32BE(value[1], offset + 4);
	return offset + 8;
};

const writeFloat32BE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeFloatBE(value, offset);
	return offset + 4;
};

const writeFloat64BE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeDoubleBE(value, offset);
	return offset + 8;
};

const writeStringBE = (value: string, buf: Buffer, offset: number): number => {
	const bytes = Buffer.from(value, "utf8");
	buf.writeUInt16BE(bytes.length, offset);
	bytes.copy(buf, offset + 2);
	return offset + 2 + bytes.length;
};

// ─── Little-endian primitives ───────────────────────────────────────────────

const writeInt16LE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeInt16LE(value, offset);
	return offset + 2;
};

const writeInt32LE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeInt32LE(value, offset);
	return offset + 4;
};

const writeInt64LE = (
	value: readonly [number, number],
	buf: Buffer,
	offset: number,
): number => {
	buf.writeInt32LE(value[1], offset);
	buf.writeInt32LE(value[0], offset + 4);
	return offset + 8;
};

const writeFloat32LE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeFloatLE(value, offset);
	return offset + 4;
};

const writeFloat64LE = (value: number, buf: Buffer, offset: number): number => {
	buf.writeDoubleLE(value, offset);
	return offset + 8;
};

const writeStringLE = (value: string, buf: Buffer, offset: number): number => {
	const bytes = Buffer.from(value, "utf8");
	buf.writeUInt16LE(bytes.length, offset);
	bytes.copy(buf, offset + 2);
	return offset + 2 + bytes.length;
};

// ─── Varint primitives ──────────────────────────────────────────────────────

const writeVarint = (value: number, buf: Buffer, offset: number): number => {
	let v = value >>> 0;
	while (v > 0x7f) {
		buf[offset++] = (v & 0x7f) | 0x80;
		v >>>= 7;
	}
	buf[offset++] = v;
	return offset;
};

const writeZigZag32 = (value: number, buf: Buffer, offset: number): number =>
	writeVarint((value << 1) ^ (value >> 31), buf, offset);

const writeZigZag64 = (
	value: readonly [number, number],
	buf: Buffer,
	offset: number,
): number => {
	const n = (BigInt(value[0]) << 32n) | (BigInt(value[1]) & 0xffffffffn);
	const zigzag = (n << 1n) ^ (n >> 63n);
	let v = zigzag < 0n ? zigzag + (1n << 64n) : zigzag;
	while (v > 0x7fn) {
		buf[offset++] = Number(v & 0x7fn) | 0x80;
		v >>= 7n;
	}
	buf[offset++] = Number(v);
	return offset;
};

const writeStringVarint = (
	value: string,
	buf: Buffer,
	offset: number,
): number => {
	const bytes = Buffer.from(value, "utf8");
	offset = writeVarint(bytes.length, buf, offset);
	bytes.copy(buf, offset);
	return offset + bytes.length;
};

// ─── Format writer instances ────────────────────────────────────────────────

const bigEndianWriter: FormatWriter = {
	writeInt16: writeInt16BE,
	writeInt32: writeInt32BE,
	writeInt64: writeInt64BE,
	writeFloat32: writeFloat32BE,
	writeFloat64: writeFloat64BE,
	writeString: writeStringBE,
	writeArrayCount: writeInt32BE,
};

const littleEndianWriter: FormatWriter = {
	writeInt16: writeInt16LE,
	writeInt32: writeInt32LE,
	writeInt64: writeInt64LE,
	writeFloat32: writeFloat32LE,
	writeFloat64: writeFloat64LE,
	writeString: writeStringLE,
	writeArrayCount: writeInt32LE,
};

const littleVarintWriter: FormatWriter = {
	writeInt16: writeInt16LE,
	writeInt32: writeZigZag32,
	writeInt64: writeZigZag64,
	writeFloat32: writeFloat32LE,
	writeFloat64: writeFloat64LE,
	writeString: writeStringVarint,
	writeArrayCount: writeZigZag32,
};

const getWriter = (format: NbtFormat): FormatWriter => {
	if (format === "big") return bigEndianWriter;
	if (format === "little") return littleEndianWriter;
	return littleVarintWriter;
};

// ─── Tag payload writers ────────────────────────────────────────────────────

const writeByteArray = (
	value: readonly number[],
	buf: Buffer,
	offset: number,
	writer: FormatWriter,
): number => {
	offset = writer.writeArrayCount(value.length, buf, offset);
	for (const byte of value) {
		buf.writeInt8(byte, offset);
		offset += 1;
	}
	return offset;
};

const writeIntArray = (
	value: readonly number[],
	buf: Buffer,
	offset: number,
	writer: FormatWriter,
): number => {
	offset = writer.writeArrayCount(value.length, buf, offset);
	for (const int of value) {
		offset = writer.writeInt32(int, buf, offset);
	}
	return offset;
};

const writeLongArray = (
	value: readonly (readonly [number, number])[],
	buf: Buffer,
	offset: number,
	writer: FormatWriter,
): number => {
	offset = writer.writeArrayCount(value.length, buf, offset);
	for (const long of value) {
		offset = writer.writeInt64(long, buf, offset);
	}
	return offset;
};

const writeList = (
	value: NbtList["value"],
	buf: Buffer,
	offset: number,
	writer: FormatWriter,
): number => {
	buf.writeInt8(TAG_TYPE_TO_ID[value.type], offset);
	offset += 1;
	offset = writer.writeArrayCount(value.value.length, buf, offset);
	for (const item of value.value) {
		offset = writePayload(
			{ type: value.type, value: item } as NbtTag,
			buf,
			offset,
			writer,
		);
	}
	return offset;
};

const writeCompound = (
	value: Readonly<Record<string, NbtTag>>,
	buf: Buffer,
	offset: number,
	writer: FormatWriter,
): number => {
	for (const [name, tag] of Object.entries(value)) {
		buf.writeInt8(TAG_TYPE_TO_ID[tag.type], offset);
		offset += 1;
		offset = writer.writeString(name, buf, offset);
		offset = writePayload(tag, buf, offset, writer);
	}
	buf.writeInt8(0, offset);
	return offset + 1;
};

const writePayload = (
	tag: NbtTag,
	buf: Buffer,
	offset: number,
	writer: FormatWriter,
): number => {
	switch (tag.type) {
		case "byte":
			buf.writeInt8(tag.value, offset);
			return offset + 1;
		case "short":
			return writer.writeInt16(tag.value, buf, offset);
		case "int":
			return writer.writeInt32(tag.value, buf, offset);
		case "long":
			return writer.writeInt64(tag.value, buf, offset);
		case "float":
			return writer.writeFloat32(tag.value, buf, offset);
		case "double":
			return writer.writeFloat64(tag.value, buf, offset);
		case "byteArray":
			return writeByteArray(tag.value, buf, offset, writer);
		case "string":
			return writer.writeString(tag.value, buf, offset);
		case "list":
			return writeList(tag.value, buf, offset, writer);
		case "compound":
			return writeCompound(tag.value, buf, offset, writer);
		case "intArray":
			return writeIntArray(tag.value, buf, offset, writer);
		case "longArray":
			return writeLongArray(tag.value, buf, offset, writer);
	}
};

// ─── Anonymous tag writer (network NBT — no name string) ────────────────────

export const writeAnonymousTag = (
	root: NbtRoot | null,
	format: NbtFormat,
): Buffer => {
	if (root == null) return Buffer.from([0x00]);
	const writer = getWriter(format);
	const buf = Buffer.alloc(1024 * 1024);
	const tagId = TAG_TYPE_TO_ID[root.type] ?? 10;
	buf.writeInt8(tagId, 0);
	const offset = writePayload(root as NbtTag, buf, 1, writer);
	return Buffer.from(buf.subarray(0, offset));
};

// ─── Root tag writer ────────────────────────────────────────────────────────

export const writeRootTag = (root: NbtRoot, format: NbtFormat): Buffer => {
	const writer = getWriter(format);
	const buf = Buffer.alloc(1024 * 1024);
	let offset = 0;
	buf.writeInt8(10, offset);
	offset += 1;
	offset = writer.writeString(root.name, buf, offset);
	offset = writeCompound(root.value, buf, offset, writer);
	return Buffer.from(buf.subarray(0, offset));
};
