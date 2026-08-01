/**
 * Packet codec — schema-driven serialization replacing protodef.
 * Reads protocol-schema.json and builds read/write functions for every type.
 */

import { readAnonymousNbt, writeAnonymousNbt } from "../nbt/nbt.ts";
import type { NbtRoot } from "../nbt/types.ts";
import {
	readVarInt,
	readVarLong,
	sizeOfVarInt,
	sizeOfVarLong,
	writeVarInt,
	writeVarLong,
} from "./varint.ts";

// ── Core types ──

export type ReadResult = { value: unknown; size: number };

type TypeReader = (
	buffer: Buffer,
	offset: number,
	ctx: Record<string, unknown>,
) => ReadResult;
type TypeWriter = (
	value: unknown,
	buffer: Buffer,
	offset: number,
	ctx: Record<string, unknown>,
) => number;
type TypeSizer = (value: unknown, ctx: Record<string, unknown>) => number;

export type TypeDef = {
	readonly read: TypeReader;
	readonly write: TypeWriter;
	readonly sizeOf: TypeSizer;
};

export type TypeRegistry = {
	readonly types: Map<string, TypeDef>;
	readonly resolve: (schema: unknown) => TypeDef;
};

// ── Primitive types ──

const noop: TypeDef = {
	read: (_b, _o) => ({ value: undefined, size: 0 }),
	write: (_v, _b, o) => o,
	sizeOf: () => 0,
};

const fixed = (
	size: number,
	read: (b: Buffer, o: number) => unknown,
	write: (v: unknown, b: Buffer, o: number) => void,
): TypeDef => ({
	read: (b, o) => ({ value: read(b, o), size }),
	write: (v, b, o) => {
		write(v, b, o);
		return o + size;
	},
	sizeOf: () => size,
});

const PRIMITIVES: Record<string, TypeDef> = {
	void: noop,
	bool: fixed(
		1,
		(b, o) => !!b.readUInt8(o),
		(v, b, o) => b.writeUInt8(v ? 1 : 0, o),
	),
	i8: fixed(
		1,
		(b, o) => b.readInt8(o),
		(v, b, o) => b.writeInt8(v as number, o),
	),
	u8: fixed(
		1,
		(b, o) => b.readUInt8(o),
		(v, b, o) => b.writeUInt8(v as number, o),
	),
	i16: fixed(
		2,
		(b, o) => b.readInt16BE(o),
		(v, b, o) => b.writeInt16BE(v as number, o),
	),
	u16: fixed(
		2,
		(b, o) => b.readUInt16BE(o),
		(v, b, o) => b.writeUInt16BE(v as number, o),
	),
	i32: fixed(
		4,
		(b, o) => b.readInt32BE(o),
		(v, b, o) => b.writeInt32BE(v as number, o),
	),
	u32: fixed(
		4,
		(b, o) => b.readUInt32BE(o),
		(v, b, o) => b.writeUInt32BE(v as number, o),
	),
	i64: fixed(
		8,
		(b, o) => b.readBigInt64BE(o),
		(v, b, o) => b.writeBigInt64BE(v as bigint, o),
	),
	u64: fixed(
		8,
		(b, o) => b.readBigUInt64BE(o),
		(v, b, o) => b.writeBigUInt64BE(v as bigint, o),
	),
	f32: fixed(
		4,
		(b, o) => b.readFloatBE(o),
		(v, b, o) => b.writeFloatBE(v as number, o),
	),
	f64: fixed(
		8,
		(b, o) => b.readDoubleBE(o),
		(v, b, o) => b.writeDoubleBE(v as number, o),
	),
	varint: {
		read: (b, o) => readVarInt(b, o),
		write: (v, b, o) => writeVarInt(v as number, b, o),
		sizeOf: (v) => sizeOfVarInt(v as number),
	},
	varlong: {
		read: (b, o) => readVarLong(b, o),
		write: (v, b, o) => writeVarLong(v as bigint, b, o),
		sizeOf: (v) => sizeOfVarLong(v as bigint),
	},
};

// ── Compound type builders ──

const buildPstring = (
	registry: TypeRegistry,
	params: { countType: string },
): TypeDef => {
	const countType = registry.resolve(params.countType);
	return {
		read: (b, o, ctx) => {
			const len = countType.read(b, o, ctx);
			const strLen = len.value as number;
			const str = b.toString("utf8", o + len.size, o + len.size + strLen);
			return { value: str, size: len.size + strLen };
		},
		write: (v, b, o, ctx) => {
			const str = v as string;
			const strBuf = Buffer.from(str, "utf8");
			o = countType.write(strBuf.length, b, o, ctx);
			strBuf.copy(b, o);
			return o + strBuf.length;
		},
		sizeOf: (v, ctx) => {
			const str = v as string;
			const len = Buffer.byteLength(str, "utf8");
			return countType.sizeOf(len, ctx) + len;
		},
	};
};

const buildBuffer = (
	registry: TypeRegistry,
	params: { countType?: string; count?: number },
): TypeDef => {
	if (params.count !== undefined) {
		const count = params.count;
		return {
			read: (b, o) => ({ value: b.subarray(o, o + count), size: count }),
			write: (v, b, o) => {
				(v as Buffer).copy(b, o);
				return o + count;
			},
			sizeOf: () => count,
		};
	}
	const countType = registry.resolve(params.countType!);
	return {
		read: (b, o, ctx) => {
			const len = countType.read(b, o, ctx);
			const bufLen = len.value as number;
			return {
				value: b.subarray(o + len.size, o + len.size + bufLen),
				size: len.size + bufLen,
			};
		},
		write: (v, b, o, ctx) => {
			const buf = v as Buffer;
			o = countType.write(buf.length, b, o, ctx);
			buf.copy(b, o);
			return o + buf.length;
		},
		sizeOf: (v, ctx) => {
			const buf = v as Buffer;
			return countType.sizeOf(buf.length, ctx) + buf.length;
		},
	};
};

const buildContainer = (
	registry: TypeRegistry,
	fields: { name?: string; anon?: boolean; type: unknown }[],
): TypeDef => {
	const resolved = fields.map((f) => ({
		name: f.name,
		anon: f.anon ?? false,
		type: registry.resolve(f.type),
	}));
	return {
		read: (b, o, parentCtx) => {
			const result: Record<string, unknown> = { __parent: parentCtx };
			let totalSize = 0;
			for (const field of resolved) {
				const r = field.type.read(b, o + totalSize, result);
				totalSize += r.size;
				if (field.anon && typeof r.value === "object" && r.value !== null) {
					Object.assign(result, r.value);
				} else if (field.name) {
					result[field.name] = r.value;
				}
			}
			delete result.__parent;
			return { value: result, size: totalSize };
		},
		write: (v, b, o, _ctx) => {
			const obj = v as Record<string, unknown>;
			for (const field of resolved) {
				if (field.anon) {
					o = field.type.write(obj, b, o, obj);
				} else if (field.name) {
					o = field.type.write(obj[field.name], b, o, obj);
				}
			}
			return o;
		},
		sizeOf: (v, _ctx) => {
			const obj = v as Record<string, unknown>;
			let size = 0;
			for (const field of resolved) {
				if (field.anon) {
					size += field.type.sizeOf(obj, obj);
				} else if (field.name) {
					size += field.type.sizeOf(obj[field.name], obj);
				}
			}
			return size;
		},
	};
};

const buildArray = (
	registry: TypeRegistry,
	params: { countType?: string; count?: number | string; type: unknown },
): TypeDef => {
	const elemType = registry.resolve(params.type);
	const fixedCount =
		typeof params.count === "number" ? params.count : undefined;
	const countField = typeof params.count === "string" ? params.count : null;
	const countType = params.countType
		? registry.resolve(params.countType)
		: null;
	return {
		read: (b, o, ctx) => {
			let count: number;
			let totalSize = 0;
			if (fixedCount !== undefined) {
				count = fixedCount;
			} else if (countField && ctx) {
				count = (ctx as Record<string, unknown>)[countField] as number;
			} else if (countType) {
				const len = countType.read(b, o, ctx);
				count = len.value as number;
				totalSize += len.size;
			} else {
				count = 0;
			}
			const arr: unknown[] = [];
			for (let i = 0; i < count; i++) {
				const r = elemType.read(b, o + totalSize, ctx);
				arr.push(r.value);
				totalSize += r.size;
			}
			return { value: arr, size: totalSize };
		},
		write: (v, b, o, ctx) => {
			const arr = v as unknown[];
			if (countType) o = countType.write(arr.length, b, o, ctx);
			for (const elem of arr) o = elemType.write(elem, b, o, ctx);
			return o;
		},
		sizeOf: (v, ctx) => {
			const arr = v as unknown[];
			let size = countType ? countType.sizeOf(arr.length, ctx) : 0;
			for (const elem of arr) size += elemType.sizeOf(elem, ctx);
			return size;
		},
	};
};

const buildMapper = (
	registry: TypeRegistry,
	params: { type: unknown; mappings: Record<string, string> },
): TypeDef => {
	const innerType = registry.resolve(params.type);
	const forward = new Map<string | number, string>();
	const reverse = new Map<string, string | number>();
	for (const [k, v] of Object.entries(params.mappings)) {
		const numKey = k.startsWith("0x") ? Number.parseInt(k, 16) : Number(k);
		forward.set(numKey, v);
		reverse.set(v, numKey);
	}
	return {
		read: (b, o, ctx) => {
			const r = innerType.read(b, o, ctx);
			return { value: forward.get(r.value as number) ?? r.value, size: r.size };
		},
		write: (v, b, o, ctx) => {
			const mapped = reverse.get(v as string) ?? v;
			return innerType.write(mapped, b, o, ctx);
		},
		sizeOf: (v, ctx) => {
			const mapped = reverse.get(v as string) ?? v;
			return innerType.sizeOf(mapped, ctx);
		},
	};
};

const resolveCompareTo = (
	path: string,
	ctx: Record<string, unknown>,
): unknown => {
	// Walk up parent chain for ../ prefixes
	let target = ctx;
	let cleaned = path;
	while (cleaned.startsWith("../")) {
		cleaned = cleaned.slice(3);
		const parent = target.__parent as Record<string, unknown> | undefined;
		if (parent) target = parent;
	}
	// Traverse slash-separated paths: "flags/has_redirect_node" → ctx.flags.has_redirect_node
	const parts = cleaned.split("/");
	let current: unknown = target;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
};

const buildSwitch = (
	registry: TypeRegistry,
	params: {
		compareTo: string;
		fields: Record<string, unknown>;
		default?: unknown;
	},
): TypeDef => {
	const fieldsResolved = new Map<string, TypeDef>();
	for (const [k, v] of Object.entries(params.fields)) {
		fieldsResolved.set(k, registry.resolve(v));
	}
	const defaultType =
		params.default !== undefined ? registry.resolve(params.default) : noop;
	const getType = (ctx: Record<string, unknown>): TypeDef => {
		const val = resolveCompareTo(params.compareTo, ctx);
		return fieldsResolved.get(String(val)) ?? defaultType;
	};
	return {
		read: (b, o, ctx) => getType(ctx).read(b, o, ctx),
		write: (v, b, o, ctx) => getType(ctx).write(v, b, o, ctx),
		sizeOf: (v, ctx) => getType(ctx).sizeOf(v, ctx),
	};
};

const buildOption = (registry: TypeRegistry, innerSchema: unknown): TypeDef => {
	const innerType = registry.resolve(innerSchema);
	return {
		read: (b, o, ctx) => {
			const present = !!b.readUInt8(o);
			if (!present) return { value: undefined, size: 1 };
			const r = innerType.read(b, o + 1, ctx);
			return { value: r.value, size: 1 + r.size };
		},
		write: (v, b, o, ctx) => {
			if (v == null || v === false) {
				b.writeUInt8(0, o);
				return o + 1;
			}
			b.writeUInt8(1, o);
			return innerType.write(v, b, o + 1, ctx);
		},
		sizeOf: (v, ctx) =>
			v == null || v === false ? 1 : 1 + innerType.sizeOf(v, ctx),
	};
};

const buildBitfield = (
	_registry: TypeRegistry,
	fields: { name: string; size: number; signed: boolean }[],
): TypeDef => {
	const totalBits = fields.reduce((s, f) => s + f.size, 0);
	const byteSize = Math.ceil(totalBits / 8);
	return {
		read: (b, o) => {
			// Read as big-endian bigint
			let raw = 0n;
			for (let i = 0; i < byteSize; i++) {
				raw = (raw << 8n) | BigInt(b[o + i]!);
			}
			const result: Record<string, number> = {};
			let bitOffset = BigInt(totalBits);
			for (const field of fields) {
				bitOffset -= BigInt(field.size);
				const mask = (1n << BigInt(field.size)) - 1n;
				let val = (raw >> bitOffset) & mask;
				if (field.signed && val >= 1n << BigInt(field.size - 1)) {
					val -= 1n << BigInt(field.size);
				}
				result[field.name] = Number(val);
			}
			return { value: result, size: byteSize };
		},
		write: (v, b, o) => {
			const obj = v as Record<string, number>;
			let raw = 0n;
			let bitOffset = BigInt(totalBits);
			for (const field of fields) {
				bitOffset -= BigInt(field.size);
				const mask = (1n << BigInt(field.size)) - 1n;
				let val = BigInt(obj[field.name]!) & mask;
				if (val < 0n) val = (1n << BigInt(field.size)) + val;
				raw |= (val & mask) << bitOffset;
			}
			for (let i = byteSize - 1; i >= 0; i--) {
				b[o + i] = Number(raw & 0xffn);
				raw >>= 8n;
			}
			return o + byteSize;
		},
		sizeOf: () => byteSize,
	};
};

const buildBitflags = (
	registry: TypeRegistry,
	params: { type: unknown; flags: string[]; shift?: number },
): TypeDef => {
	const innerType = registry.resolve(params.type);
	const flags = params.flags;
	const shift = params.shift ?? 0;
	return {
		read: (b, o, ctx) => {
			const r = innerType.read(b, o, ctx);
			const bits = r.value as number;
			const result: Record<string, boolean> = {};
			for (let i = 0; i < flags.length; i++) {
				if (flags[i]) result[flags[i]!] = !!(bits & (1 << (i + shift)));
			}
			return { value: result, size: r.size };
		},
		write: (v, b, o, ctx) => {
			const obj = v as Record<string, boolean>;
			let bits = 0;
			for (let i = 0; i < flags.length; i++) {
				if (flags[i] && obj[flags[i]!]) bits |= 1 << (i + shift);
			}
			return innerType.write(bits, b, o, ctx);
		},
		sizeOf: (_v, ctx) => innerType.sizeOf(0, ctx),
	};
};

// ── Minecraft-specific types ──

const UUID_TYPE: TypeDef = {
	read: (b, o) => {
		const hex = b.subarray(o, o + 16).toString("hex");
		const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
		return { value: uuid, size: 16 };
	},
	write: (v, b, o) => {
		const hex = (v as string).replace(/-/g, "");
		Buffer.from(hex, "hex").copy(b, o);
		return o + 16;
	},
	sizeOf: () => 16,
};

const REST_BUFFER_TYPE: TypeDef = {
	read: (b, o) => ({ value: b.subarray(o), size: b.length - o }),
	write: (v, b, o) => {
		(v as Buffer).copy(b, o);
		return o + (v as Buffer).length;
	},
	sizeOf: (v) => (v as Buffer).length,
};

const ANONYMOUS_NBT_TYPE: TypeDef = {
	read: (b, o) => {
		const result = readAnonymousNbt(b, o, "big");
		return { value: result.value, size: result.size };
	},
	write: (v, b, o) => {
		const nbtBuf = writeAnonymousNbt((v as NbtRoot) ?? null, "big");
		nbtBuf.copy(b, o);
		return o + nbtBuf.length;
	},
	sizeOf: (v) => writeAnonymousNbt((v as NbtRoot) ?? null, "big").length,
};

/**
 * Low-precision Vec3 — variable-length packed velocity encoding (1.21.9+).
 * 1 byte if zero, 6 bytes normally, 6+ bytes with varint scale continuation.
 * Packs 3x 15-bit quantized values + scale into a compact bit-packed format.
 */
const LP_VEC3_DATA_BITS_MASK = 32767;
const LP_VEC3_MAX_QUANTIZED = 32766.0;
const LP_VEC3_ABS_MIN = 3.051944088384301e-5;
const LP_VEC3_ABS_MAX = 1.7179869183e10;

const lpVec3Unpack = (packed: number, shift: number): number => {
	const val = Math.floor(packed / 2 ** shift) & LP_VEC3_DATA_BITS_MASK;
	const clamped = val > 32766 ? 32766 : val;
	return (clamped * 2.0) / 32766.0 - 1.0;
};

const lpVec3Pack = (value: number): number =>
	Math.round((value * 0.5 + 0.5) * LP_VEC3_MAX_QUANTIZED);

const lpVec3Sanitize = (v: number): number =>
	Number.isNaN(v)
		? 0
		: Math.max(-LP_VEC3_ABS_MAX, Math.min(v, LP_VEC3_ABS_MAX));

const LP_VEC3_TYPE: TypeDef = {
	read: (b, o) => {
		const a = b[o]!;
		if (a === 0) return { value: { x: 0, y: 0, z: 0 }, size: 1 };

		const byte1 = b[o + 1]!;
		const dword = b.readUInt32LE(o + 2);
		const packed = dword * 65536 + (byte1 << 8) + a;

		let scale = a & 3;
		let size = 6;

		if ((a & 4) === 4) {
			const r = readVarInt(b, o + 6);
			scale = (r.value as number) * 4 + scale;
			size += r.size;
		}

		return {
			value: {
				x: lpVec3Unpack(packed, 3) * scale,
				y: lpVec3Unpack(packed, 18) * scale,
				z: lpVec3Unpack(packed, 33) * scale,
			},
			size,
		};
	},
	write: (v, b, o) => {
		const vec = v as { x: number; y: number; z: number };
		const x = lpVec3Sanitize(vec.x);
		const y = lpVec3Sanitize(vec.y);
		const z = lpVec3Sanitize(vec.z);
		const max = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));

		if (max < LP_VEC3_ABS_MIN) {
			b[o] = 0;
			return o + 1;
		}

		const scale = Math.ceil(max);
		const needsCont = (scale & 3) !== scale;
		const scaleByte = needsCont ? (scale & 3) | 4 : scale & 3;

		const pX = lpVec3Pack(x / scale);
		const pY = lpVec3Pack(y / scale);
		const pZ = lpVec3Pack(z / scale);

		const low32 = (scaleByte | (pX << 3) | (pY << 18)) >>> 0;
		const high16 = ((pY >> 14) & 0x01) | (pZ << 1);

		b.writeUInt32LE(low32, o);
		b.writeUInt16LE(high16, o + 4);

		if (needsCont) {
			return writeVarInt(Math.floor(scale / 4), b, o + 6);
		}
		return o + 6;
	},
	sizeOf: (v) => {
		const vec = v as { x: number; y: number; z: number };
		const max = Math.max(Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z));
		if (max < LP_VEC3_ABS_MIN) return 1;
		const scale = Math.ceil(max);
		if ((scale & 3) !== scale) return 6 + sizeOfVarInt(Math.floor(scale / 4));
		return 6;
	},
};

const ANON_OPTIONAL_NBT_TYPE: TypeDef = {
	read: (b, o) => {
		if (o >= b.length || b[o] === 0x00) return { value: undefined, size: 1 };
		return ANONYMOUS_NBT_TYPE.read(b, o, {});
	},
	write: (v, b, o) => ANONYMOUS_NBT_TYPE.write(v, b, o, {}),
	sizeOf: (v) => ANONYMOUS_NBT_TYPE.sizeOf(v, {}),
};

const buildEntityMetadataLoop = (
	registry: TypeRegistry,
	params: {
		endVal: number;
		type: unknown;
	},
): TypeDef => {
	const innerType = registry.resolve(params.type);
	const endVal = params.endVal;
	return {
		read: (b, o, ctx) => {
			const arr: unknown[] = [];
			let totalSize = 0;
			while (o + totalSize < b.length) {
				if (b[o + totalSize] === endVal) {
					totalSize += 1;
					break;
				}
				const r = innerType.read(b, o + totalSize, ctx);
				if (r.size === 0) break; // unknown type — stop to avoid infinite loop
				arr.push(r.value);
				totalSize += r.size;
			}
			return { value: arr, size: totalSize };
		},
		write: (v, b, o, ctx) => {
			const arr = v as unknown[];
			for (const elem of arr) o = innerType.write(elem, b, o, ctx);
			b[o] = endVal;
			return o + 1;
		},
		sizeOf: (v, ctx) => {
			const arr = v as unknown[];
			let size = 1; // end byte
			for (const elem of arr) size += innerType.sizeOf(elem, ctx);
			return size;
		},
	};
};

const buildTopBitSetArray = (
	registry: TypeRegistry,
	params: { type: unknown },
): TypeDef => {
	const innerType = registry.resolve(params.type);
	return {
		read: (b, o, ctx) => {
			const arr: unknown[] = [];
			let totalSize = 0;
			while (o + totalSize < b.length) {
				const hasMore = !!(b[o + totalSize]! & 0x80);
				b[o + totalSize]! &= 0x7f; // Clear top bit for reading
				const r = innerType.read(b, o + totalSize, ctx);
				arr.push(r.value);
				totalSize += r.size;
				if (!hasMore) break;
			}
			return { value: arr, size: totalSize };
		},
		write: (v, b, o, ctx) => {
			const arr = v as unknown[];
			for (let i = 0; i < arr.length; i++) {
				const startO = o;
				o = innerType.write(arr[i], b, o, ctx);
				if (i < arr.length - 1) b[startO]! |= 0x80; // Set top bit for continuation
			}
			return o;
		},
		sizeOf: (v, ctx) => {
			const arr = v as unknown[];
			let size = 0;
			for (const elem of arr) size += innerType.sizeOf(elem, ctx);
			return size;
		},
	};
};

// ── Registry entry types (1.20.5+) ──

/**
 * registryEntryHolder — varint discriminator:
 *   0 → inline data (read `otherwise.type`, stored as `{ [otherwise.name]: value }`)
 *   >0 → registry ID = varint - 1 (stored as `{ [baseName]: id }`)
 */
const buildRegistryEntryHolder = (
	registry: TypeRegistry,
	params: { baseName: string; otherwise: { name: string; type: unknown } },
): TypeDef => {
	const otherwiseType = registry.resolve(params.otherwise.type);
	return {
		read: (b, o, ctx) => {
			const r = readVarInt(b, o);
			const id = r.value as number;
			if (id === 0) {
				const inner = otherwiseType.read(b, o + r.size, ctx);
				return {
					value: { [params.otherwise.name]: inner.value },
					size: r.size + inner.size,
				};
			}
			return { value: { [params.baseName]: id - 1 }, size: r.size };
		},
		write: (v, b, o, ctx) => {
			const obj = v as Record<string, unknown>;
			if (params.baseName in obj) {
				o = writeVarInt((obj[params.baseName] as number) + 1, b, o);
				return o;
			}
			o = writeVarInt(0, b, o);
			return otherwiseType.write(obj[params.otherwise.name], b, o, ctx);
		},
		sizeOf: (v, ctx) => {
			const obj = v as Record<string, unknown>;
			if (params.baseName in obj) {
				return sizeOfVarInt((obj[params.baseName] as number) + 1);
			}
			return (
				sizeOfVarInt(0) + otherwiseType.sizeOf(obj[params.otherwise.name], ctx)
			);
		},
	};
};

/**
 * registryEntryHolderSet — varint discriminator:
 *   0 → tag name (read `base.type`, stored as `{ [base.name]: value }`)
 *   >0 → explicit set of (varint - 1) IDs (read array, stored as `{ [otherwise.name]: [...] }`)
 */
const buildRegistryEntryHolderSet = (
	registry: TypeRegistry,
	params: {
		base: { name: string; type: unknown };
		otherwise: { name: string; type: unknown };
	},
): TypeDef => {
	const baseType = registry.resolve(params.base.type);
	const otherwiseType = registry.resolve(params.otherwise.type);
	return {
		read: (b, o, ctx) => {
			const r = readVarInt(b, o);
			const discriminator = r.value as number;
			if (discriminator === 0) {
				const inner = baseType.read(b, o + r.size, ctx);
				return {
					value: { [params.base.name]: inner.value },
					size: r.size + inner.size,
				};
			}
			const count = discriminator - 1;
			const ids: unknown[] = [];
			let totalSize = r.size;
			for (let i = 0; i < count; i++) {
				const elem = otherwiseType.read(b, o + totalSize, ctx);
				ids.push(elem.value);
				totalSize += elem.size;
			}
			return {
				value: { [params.otherwise.name]: ids },
				size: totalSize,
			};
		},
		write: (v, b, o, ctx) => {
			const obj = v as Record<string, unknown>;
			if (params.base.name in obj) {
				o = writeVarInt(0, b, o);
				return baseType.write(obj[params.base.name], b, o, ctx);
			}
			const ids = obj[params.otherwise.name] as unknown[];
			o = writeVarInt(ids.length + 1, b, o);
			for (const id of ids) o = otherwiseType.write(id, b, o, ctx);
			return o;
		},
		sizeOf: (v, ctx) => {
			const obj = v as Record<string, unknown>;
			if (params.base.name in obj) {
				return sizeOfVarInt(0) + baseType.sizeOf(obj[params.base.name], ctx);
			}
			const ids = obj[params.otherwise.name] as unknown[];
			let size = sizeOfVarInt(ids.length + 1);
			for (const id of ids) size += otherwiseType.sizeOf(id, ctx);
			return size;
		},
	};
};

// ── Registry builder ──

const COMPOUND_BUILDERS: Record<
	string,
	(registry: TypeRegistry, params: unknown) => TypeDef
> = {
	pstring: (r, p) => buildPstring(r, p as { countType: string }),
	buffer: (r, p) => buildBuffer(r, p as { countType?: string; count?: number }),
	container: (r, p) =>
		buildContainer(r, p as { name?: string; anon?: boolean; type: unknown }[]),
	array: (r, p) =>
		buildArray(r, p as { countType?: string; count?: number; type: unknown }),
	mapper: (r, p) =>
		buildMapper(r, p as { type: unknown; mappings: Record<string, string> }),
	switch: (r, p) =>
		buildSwitch(
			r,
			p as {
				compareTo: string;
				fields: Record<string, unknown>;
				default?: unknown;
			},
		),
	option: (r, p) => buildOption(r, p as unknown),
	bitfield: (r, p) =>
		buildBitfield(r, p as { name: string; size: number; signed: boolean }[]),
	bitflags: (r, p) =>
		buildBitflags(r, p as { type: unknown; flags: string[]; shift?: number }),
	entityMetadataLoop: (r, p) =>
		buildEntityMetadataLoop(r, p as { endVal: number; type: unknown }),
	topBitSetTerminatedArray: (r, p) =>
		buildTopBitSetArray(r, p as { type: unknown }),
	registryEntryHolder: (r, p) =>
		buildRegistryEntryHolder(
			r,
			p as {
				baseName: string;
				otherwise: { name: string; type: unknown };
			},
		),
	registryEntryHolderSet: (r, p) =>
		buildRegistryEntryHolderSet(
			r,
			p as {
				base: { name: string; type: unknown };
				otherwise: { name: string; type: unknown };
			},
		),
};

/** Create a type registry from a protocol.json types section. */
export const createTypeRegistry = (
	protocolTypes: Record<string, unknown>,
): TypeRegistry => {
	const types = new Map<string, TypeDef>();
	const resolveCache = new Map<string, TypeDef>();

	// Register primitives
	for (const [name, def] of Object.entries(PRIMITIVES)) types.set(name, def);

	// Register minecraft custom types
	types.set("UUID", UUID_TYPE);
	types.set("restBuffer", REST_BUFFER_TYPE);
	types.set("anonymousNbt", ANONYMOUS_NBT_TYPE);
	types.set("anonOptionalNbt", ANON_OPTIONAL_NBT_TYPE);
	types.set("lpVec3", LP_VEC3_TYPE);

	const registry: TypeRegistry = { types, resolve };

	// Register protocol-defined types (lazy resolution)
	for (const [name, schema] of Object.entries(protocolTypes)) {
		if (schema === "native") {
			// Already registered or a primitive
			continue;
		}
		// Lazy: don't resolve yet, just store the schema
		Object.defineProperty(types, `get_${name}`, {
			get: () => resolveSchema(schema),
		});
		// Use a getter-like pattern via resolve
		if (!types.has(name)) {
			types.set(name, {
				read: (b, o, ctx) => resolveNamed(name).read(b, o, ctx),
				write: (v, b, o, ctx) => resolveNamed(name).write(v, b, o, ctx),
				sizeOf: (v, ctx) => resolveNamed(name).sizeOf(v, ctx),
			});
		}
	}

	function resolveNamed(name: string): TypeDef {
		const cacheKey = `named:${name}`;
		const cached = resolveCache.get(cacheKey);
		if (cached) return cached;
		const schema = protocolTypes[name];
		if (!schema) throw new Error(`Unknown type: ${name}`);
		const resolved = resolveSchema(schema);
		resolveCache.set(cacheKey, resolved);
		return resolved;
	}

	function resolveSchema(schema: unknown): TypeDef {
		if (typeof schema === "string") {
			// Named type reference
			if (types.has(schema) && resolveCache.has(`named:${schema}`)) {
				return resolveCache.get(`named:${schema}`)!;
			}
			if (PRIMITIVES[schema]) return PRIMITIVES[schema];
			if (types.has(schema)) return types.get(schema)!;
			// Try resolving from protocol types
			if (protocolTypes[schema]) return resolveNamed(schema);
			throw new Error(`Unknown type: ${schema}`);
		}
		if (Array.isArray(schema)) {
			const [typeName, params] = schema as [string, unknown];
			const builder = COMPOUND_BUILDERS[typeName];
			if (builder) return builder(registry, params);
			// Could be a named type with params — shouldn't happen in protocol.json
			throw new Error(`Unknown compound type: ${typeName}`);
		}
		throw new Error(`Invalid type schema: ${JSON.stringify(schema)}`);
	}

	function resolve(schema: unknown): TypeDef {
		if (typeof schema === "string") {
			// Check cache first for named types
			const cached = resolveCache.get(`named:${schema}`);
			if (cached) return cached;
			return resolveSchema(schema);
		}
		return resolveSchema(schema);
	}

	return registry;
};

// ── Packet-level codec ──

export type PacketCodec = {
	readonly read: (buffer: Buffer) => {
		name: string;
		params: Record<string, unknown>;
	};
	readonly write: (name: string, params: Record<string, unknown>) => Buffer;
	readonly packetNames: ReadonlyMap<number, string>;
	readonly packetIds: ReadonlyMap<string, number>;
};

/** Create a packet codec from a protocol.json state+direction section. */
export const createPacketCodec = (
	protocolData: Record<string, unknown>,
): PacketCodec => {
	const typesSection = protocolData.types as Record<string, unknown>;
	const registry = createTypeRegistry(typesSection);

	// Extract packet mappings from the "packet" type definition
	// The packet type is: container[{name:"name", type:mapper}, {name:"params", type:switch}]
	const packetSchema = typesSection.packet as unknown[] | undefined;
	if (!packetSchema)
		return {
			read: () => ({ name: "unknown", params: {} }),
			write: () => {},
		} as unknown as PacketCodec;
	const containerFields = packetSchema[1] as { name: string; type: unknown }[];

	// Find the mapper (name field) to get packet ID ↔ name mappings
	const nameField = containerFields.find((f) => f.name === "name")!;
	const mapperDef = nameField.type as [
		string,
		{ type: string; mappings: Record<string, string> },
	];
	const mappings = mapperDef[1].mappings;

	const packetNames = new Map<number, string>();
	const packetIds = new Map<string, number>();
	for (const [idStr, name] of Object.entries(mappings)) {
		const id = idStr.startsWith("0x")
			? Number.parseInt(idStr, 16)
			: Number(idStr);
		packetNames.set(id, name);
		packetIds.set(name, id);
	}

	// Resolve packet types
	const packetTypes = new Map<string, TypeDef>();
	const paramsField = containerFields.find((f) => f.name === "params")!;
	const switchDef = paramsField.type as [
		string,
		{ compareTo: string; fields: Record<string, unknown> },
	];
	const packetFields = switchDef[1].fields;

	for (const [name, typeRef] of Object.entries(packetFields)) {
		packetTypes.set(name, registry.resolve(typeRef));
	}

	return {
		packetNames,
		packetIds,
		read: (buffer: Buffer) => {
			const { value: id, size: idSize } = readVarInt(buffer, 0);
			const name = packetNames.get(id);
			if (!name) throw new Error(`Unknown packet ID: 0x${id.toString(16)}`);
			const typeDef = packetTypes.get(name);
			if (!typeDef) throw new Error(`No type definition for packet: ${name}`);
			const { value: params } = typeDef.read(buffer, idSize, {});
			return { name, params: params as Record<string, unknown> };
		},
		write: (name: string, params: Record<string, unknown>) => {
			const id = packetIds.get(name);
			if (id === undefined) throw new Error(`Unknown packet name: ${name}`);
			const typeDef = packetTypes.get(name);
			if (!typeDef) throw new Error(`No type definition for packet: ${name}`);
			// Calculate size
			const idSize = sizeOfVarInt(id);
			const dataSize = typeDef.sizeOf(params, {});
			const buffer = Buffer.allocUnsafe(idSize + dataSize);
			writeVarInt(id, buffer, 0);
			typeDef.write(params, buffer, idSize, {});
			return buffer;
		},
	};
};
