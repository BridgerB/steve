/**
 * VarInt / VarLong encoding — Minecraft's LEB128 variant.
 * VarInt: 1-5 bytes (32-bit), VarLong: 1-10 bytes (64-bit).
 */

export const readVarInt = (
	buffer: Buffer,
	offset: number,
): { value: number; size: number } => {
	let value = 0;
	let size = 0;
	let byte: number;
	do {
		byte = buffer[offset + size]!;
		value |= (byte & 0x7f) << (size * 7);
		size++;
		if (size > 5) throw new Error("VarInt too big");
	} while (byte & 0x80);
	// Sign extend
	if (value > 0x7fffffff) value -= 0x100000000;
	return { value, size };
};

export const writeVarInt = (
	value: number,
	buffer: Buffer,
	offset: number,
): number => {
	let v = value >>> 0; // unsigned
	if (value < 0) v = (value & 0x7fffffff) | 0x80000000;
	while (v & ~0x7f) {
		buffer[offset++] = (v & 0x7f) | 0x80;
		v >>>= 7;
	}
	buffer[offset++] = v;
	return offset;
};

export const sizeOfVarInt = (value: number): number => {
	let v = value >>> 0;
	if (value < 0) v = (value & 0x7fffffff) | 0x80000000;
	let size = 0;
	do {
		v >>>= 7;
		size++;
	} while (v);
	return size;
};

export const readVarLong = (
	buffer: Buffer,
	offset: number,
): { value: bigint; size: number } => {
	let value = 0n;
	let size = 0;
	let byte: number;
	do {
		byte = buffer[offset + size]!;
		value |= BigInt(byte & 0x7f) << BigInt(size * 7);
		size++;
		if (size > 10) throw new Error("VarLong too big");
	} while (byte & 0x80);
	// Sign extend 64-bit
	if (value >= 1n << 63n) value -= 1n << 64n;
	return { value, size };
};

export const writeVarLong = (
	value: bigint,
	buffer: Buffer,
	offset: number,
): number => {
	let v = value & 0xffffffffffffffffn;
	if (v < 0n) v = (1n << 64n) + v;
	while (v & ~0x7fn) {
		buffer[offset++] = Number(v & 0x7fn) | 0x80;
		v >>= 7n;
	}
	buffer[offset++] = Number(v);
	return offset;
};

export const sizeOfVarLong = (value: bigint): number => {
	let v = value & 0xffffffffffffffffn;
	if (v < 0n) v = (1n << 64n) + v;
	let size = 0;
	do {
		v >>= 7n;
		size++;
	} while (v);
	return size;
};
