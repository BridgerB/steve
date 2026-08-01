/**
 * Extract Minecraft packet field definitions from the remapped MC jar.
 *
 * Reads JVM bytecode of each packet class's FriendlyByteBuf constructor
 * to find readXxx() → putfield pairs, giving us exact field names and types.
 *
 * Usage: node datagen/extract-protocol.ts <mc-jar-path> <output-path>
 */

import type { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";

// ── JVM Class File Parser (minimal, only what we need) ──

interface ConstantPool {
	tag: number;
	// Different fields depending on tag
	nameIndex?: number;
	descriptorIndex?: number;
	classIndex?: number;
	nameAndTypeIndex?: number;
	stringIndex?: number;
	utf8?: string;
	intValue?: number;
	longValue?: bigint;
	floatValue?: number;
	doubleValue?: number;
}

interface ClassFile {
	constantPool: ConstantPool[];
	thisClass: string;
	superClass: string;
	interfaces: string[];
	fields: { name: string; descriptor: string }[];
	methods: { name: string; descriptor: string; code: Buffer | null }[];
}

const readU1 = (buf: Buffer, offset: number) => buf.readUInt8(offset);
const readU2 = (buf: Buffer, offset: number) => buf.readUInt16BE(offset);
const readU4 = (buf: Buffer, offset: number) => buf.readUInt32BE(offset);
const readI4 = (buf: Buffer, offset: number) => buf.readInt32BE(offset);

const parseClassFile = (data: Buffer): ClassFile => {
	let pos = 0;
	const magic = readU4(data, pos);
	pos += 4;
	if (magic !== 0xcafebabe) throw new Error("Not a class file");
	pos += 4; // minor + major version

	// Constant pool
	const cpCount = readU2(data, pos);
	pos += 2;
	const cp: ConstantPool[] = [{ tag: 0 }]; // index 0 unused

	for (let i = 1; i < cpCount; i++) {
		const tag = readU1(data, pos);
		pos += 1;
		const entry: ConstantPool = { tag };

		switch (tag) {
			case 1: {
				// Utf8
				const len = readU2(data, pos);
				pos += 2;
				entry.utf8 = data.toString("utf8", pos, pos + len);
				pos += len;
				break;
			}
			case 3: // Integer
				entry.intValue = readI4(data, pos);
				pos += 4;
				break;
			case 4: // Float
				entry.floatValue = data.readFloatBE(pos);
				pos += 4;
				break;
			case 5: // Long
				entry.longValue = data.readBigInt64BE(pos);
				pos += 8;
				cp.push(entry);
				i++; // longs take 2 slots
				break;
			case 6: // Double
				entry.doubleValue = data.readDoubleBE(pos);
				pos += 8;
				cp.push(entry);
				i++; // doubles take 2 slots
				break;
			case 7: // Class
				entry.nameIndex = readU2(data, pos);
				pos += 2;
				break;
			case 8: // String
				entry.stringIndex = readU2(data, pos);
				pos += 2;
				break;
			case 9:
			case 10:
			case 11: // Fieldref, Methodref, InterfaceMethodref
				entry.classIndex = readU2(data, pos);
				pos += 2;
				entry.nameAndTypeIndex = readU2(data, pos);
				pos += 2;
				break;
			case 12: // NameAndType
				entry.nameIndex = readU2(data, pos);
				pos += 2;
				entry.descriptorIndex = readU2(data, pos);
				pos += 2;
				break;
			case 15: // MethodHandle
				pos += 3;
				break;
			case 16: // MethodType
				pos += 2;
				break;
			case 17: // Dynamic
			case 18: // InvokeDynamic
				pos += 4;
				break;
			case 19: // Module
			case 20: // Package
				pos += 2;
				break;
			default:
				throw new Error(`Unknown constant pool tag ${tag} at index ${i}`);
		}
		cp.push(entry);
	}

	const resolveUtf8 = (idx: number) => cp[idx]?.utf8 ?? "";
	const resolveClass = (idx: number) => resolveUtf8(cp[idx]?.nameIndex ?? 0);
	const resolveNameAndType = (idx: number) => ({
		name: resolveUtf8(cp[idx]?.nameIndex ?? 0),
		descriptor: resolveUtf8(cp[idx]?.descriptorIndex ?? 0),
	});
	const resolveRef = (idx: number) => ({
		class: resolveClass(cp[idx]?.classIndex ?? 0),
		...resolveNameAndType(cp[idx]?.nameAndTypeIndex ?? 0),
	});

	// Access flags
	pos += 2;

	// This class, super class
	const thisClassIdx = readU2(data, pos);
	pos += 2;
	const superClassIdx = readU2(data, pos);
	pos += 2;

	// Interfaces
	const ifaceCount = readU2(data, pos);
	pos += 2;
	const interfaces: string[] = [];
	for (let i = 0; i < ifaceCount; i++) {
		interfaces.push(resolveClass(readU2(data, pos)));
		pos += 2;
	}

	// Fields
	const fieldCount = readU2(data, pos);
	pos += 2;
	const fields: { name: string; descriptor: string }[] = [];
	for (let i = 0; i < fieldCount; i++) {
		pos += 2; // access flags
		const nameIdx = readU2(data, pos);
		pos += 2;
		const descIdx = readU2(data, pos);
		pos += 2;
		fields.push({
			name: resolveUtf8(nameIdx),
			descriptor: resolveUtf8(descIdx),
		});
		// Skip attributes
		const attrCount = readU2(data, pos);
		pos += 2;
		for (let j = 0; j < attrCount; j++) {
			pos += 2; // name index
			const attrLen = readU4(data, pos);
			pos += 4;
			pos += attrLen;
		}
	}

	// Methods
	const methodCount = readU2(data, pos);
	pos += 2;
	const methods: { name: string; descriptor: string; code: Buffer | null }[] =
		[];
	for (let i = 0; i < methodCount; i++) {
		pos += 2; // access flags
		const nameIdx = readU2(data, pos);
		pos += 2;
		const descIdx = readU2(data, pos);
		pos += 2;
		let code: Buffer | null = null;
		const attrCount = readU2(data, pos);
		pos += 2;
		for (let j = 0; j < attrCount; j++) {
			const attrNameIdx = readU2(data, pos);
			pos += 2;
			const attrLen = readU4(data, pos);
			pos += 4;
			if (resolveUtf8(attrNameIdx) === "Code") {
				// max_stack(2) + max_locals(2) + code_length(4) + code + exception_table + attributes
				const codeLen = readU4(data, pos + 4);
				code = data.subarray(pos + 8, pos + 8 + codeLen);
			}
			pos += attrLen;
		}
		methods.push({
			name: resolveUtf8(nameIdx),
			descriptor: resolveUtf8(descIdx),
			code,
		});
	}

	return {
		constantPool: cp,
		thisClass: resolveClass(thisClassIdx),
		superClass: resolveClass(superClassIdx),
		interfaces,
		fields,
		methods,
	};

	// Attach resolvers for bytecode analysis
};

// ── Bytecode instruction scanner ──

interface FieldDef {
	name: string;
	type: string;
}

const BUFFER_READ_TYPES: Record<string, string> = {
	readBoolean: "bool",
	readByte: "i8",
	readUnsignedByte: "u8",
	readShort: "i16",
	readUnsignedShort: "u16",
	readInt: "i32",
	readLong: "i64",
	readFloat: "f32",
	readDouble: "f64",
	readVarInt: "varint",
	readVarLong: "varlong",
	readUtf: "string",
	readUUID: "UUID",
	readBlockPos: "position",
	readNbt: "anonymousNbt",
	readAnySizeNbt: "anonymousNbt",
	readComponent: "anonymousNbt",
	readComponentTrusted: "anonymousNbt",
	readByteArray: "buffer",
	readBytes: "buffer",
	readItem: "Slot",
	readEnum: "varint",
	readResourceLocation: "string",
	readResourceKey: "string",
	readGlobalPos: "GlobalPos",
	readSectionPos: "position",
	readChunkPos: "position",
	readVec3: "vec3f",
	readIdentifier: "string",
	readNullable: "option",
	readId: "varint",
	readIntIdList: "varintArray",
	readContainerId: "varint",
	readOptionalBlockPos: "position",
	readBitSet: "buffer",
	readFixedBitSet: "buffer",
	readGameProfileProperties: "buffer",
	readCollection: "array",
	readList: "array",
	readMap: "array",
	readWithCount: "array",
	readOptional: "option",
};

// Netty ByteBuf methods (some packets use raw ByteBuf instead of FriendlyByteBuf)
const NETTY_READ_TYPES: Record<string, string> = {
	readLong: "i64",
	readInt: "i32",
	readShort: "i16",
	readByte: "i8",
	readFloat: "f32",
	readDouble: "f64",
	readBoolean: "bool",
	readUnsignedByte: "u8",
	readUnsignedShort: "u16",
};

const BUFFER_WRITE_TYPES: Record<string, string> = {
	writeBoolean: "bool",
	writeByte: "i8",
	writeShort: "i16",
	writeInt: "i32",
	writeLong: "i64",
	writeFloat: "f32",
	writeDouble: "f64",
	writeVarInt: "varint",
	writeVarLong: "varlong",
	writeUtf: "string",
	writeUUID: "UUID",
	writeBlockPos: "position",
	writeNbt: "anonymousNbt",
	writeComponent: "anonymousNbt",
	writeByteArray: "buffer",
	writeBytes: "buffer",
	writeItem: "Slot",
	writeEnum: "varint",
	writeResourceLocation: "string",
	writeResourceKey: "string",
	writeGlobalPos: "GlobalPos",
	writeSectionPos: "position",
	writeChunkPos: "position",
	writeVec3: "vec3f",
	writeIntIdList: "varintArray",
	writeContainerId: "varint",
	writeOptionalBlockPos: "position",
	writeBitSet: "buffer",
	writeFixedBitSet: "buffer",
	writeGameProfileProperties: "buffer",
	writeCollection: "array",
	writeOptional: "option",
	writeIdentifier: "string",
	writeId: "varint",
};

const FRIENDLY_BUF = "net/minecraft/network/FriendlyByteBuf";
const REGISTRY_BUF = "net/minecraft/network/RegistryFriendlyByteBuf";

/**
 * Scan bytecode for read/write method calls on FriendlyByteBuf,
 * paired with putfield/getfield to get field names.
 */
const extractFieldsFromBytecode = (
	cf: ClassFile,
	methodName: string,
	methodDescPrefix: string,
	mode: "read" | "write",
): FieldDef[] => {
	const method = cf.methods.find(
		(m) => m.name === methodName && m.descriptor.startsWith(methodDescPrefix),
	);
	if (!method?.code) return [];

	const typeMap = mode === "read" ? BUFFER_READ_TYPES : BUFFER_WRITE_TYPES;
	const code = method.code;
	const fields: FieldDef[] = [];
	const resolveRef = (idx: number) => {
		const entry = cf.constantPool[idx];
		if (!entry) return null;
		const classEntry = cf.constantPool[entry.classIndex ?? 0];
		const className = cf.constantPool[classEntry?.nameIndex ?? 0]?.utf8 ?? "";
		const natEntry = cf.constantPool[entry.nameAndTypeIndex ?? 0];
		const name = cf.constantPool[natEntry?.nameIndex ?? 0]?.utf8 ?? "";
		const descriptor =
			cf.constantPool[natEntry?.descriptorIndex ?? 0]?.utf8 ?? "";
		return { class: className, name, descriptor };
	};

	let lastReadType: string | null = null;
	let lastFieldName: string | null = null;
	let pos = 0;

	while (pos < code.length) {
		const op = code[pos] as number;

		if (op === 0xb6 || op === 0xb9) {
			// invokevirtual (0xB6) or invokeinterface (0xB9)
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref) {
				const isBuf =
					ref.class === FRIENDLY_BUF ||
					ref.class === REGISTRY_BUF ||
					ref.class.endsWith("FriendlyByteBuf") ||
					ref.class.endsWith("RegistryFriendlyByteBuf") ||
					ref.class.startsWith("io/netty/buffer/ByteBuf");
				const resolvedType =
					typeMap[ref.name] ?? (isBuf ? NETTY_READ_TYPES[ref.name] : undefined);
				if (isBuf && resolvedType) {
					if (mode === "read") {
						lastReadType = resolvedType;
					} else if (mode === "write" && lastFieldName) {
						fields.push({ name: lastFieldName, type: resolvedType });
						lastFieldName = null;
					}
				}
			}
			pos += op === 0xb9 ? 5 : 3;
		} else if (op === 0xb5 && mode === "read") {
			// putfield — pair with last read
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref && lastReadType) {
				fields.push({ name: ref.name, type: lastReadType });
				lastReadType = null;
			}
			pos += 3;
		} else if (op === 0xb4 && mode === "write") {
			// getfield — store field name for next write call
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref) lastFieldName = ref.name;
			pos += 3;
		} else {
			pos += instructionLength(op, code, pos);
		}
	}

	return fields;
};

// ── STREAM_CODEC.composite() analysis ──

/** Known StreamCodec field references → ProtoDef types */
const KNOWN_CODECS: Record<string, string> = {
	// ByteBufCodecs static fields
	"net/minecraft/network/codec/ByteBufCodecs.BOOL": "bool",
	"net/minecraft/network/codec/ByteBufCodecs.BYTE": "i8",
	"net/minecraft/network/codec/ByteBufCodecs.SHORT": "i16",
	"net/minecraft/network/codec/ByteBufCodecs.UNSIGNED_SHORT": "u16",
	"net/minecraft/network/codec/ByteBufCodecs.INT": "i32",
	"net/minecraft/network/codec/ByteBufCodecs.VAR_INT": "varint",
	"net/minecraft/network/codec/ByteBufCodecs.LONG": "i64",
	"net/minecraft/network/codec/ByteBufCodecs.VAR_LONG": "varlong",
	"net/minecraft/network/codec/ByteBufCodecs.FLOAT": "f32",
	"net/minecraft/network/codec/ByteBufCodecs.DOUBLE": "f64",
	"net/minecraft/network/codec/ByteBufCodecs.STRING_UTF8": "string",
	"net/minecraft/network/codec/ByteBufCodecs.TAG": "anonymousNbt",
	"net/minecraft/network/codec/ByteBufCodecs.COMPOUND_TAG": "anonymousNbt",
	"net/minecraft/network/codec/ByteBufCodecs.TRUSTED_COMPOUND_TAG":
		"anonymousNbt",
	"net/minecraft/network/codec/ByteBufCodecs.OPTIONAL_COMPOUND_TAG":
		"anonymousNbt",
	"net/minecraft/network/codec/ByteBufCodecs.BYTE_ARRAY": "buffer",
	"net/minecraft/network/codec/ByteBufCodecs.GAME_PROFILE": "string",
	"net/minecraft/network/codec/ByteBufCodecs.VECTOR3F": "vec3f",
	"net/minecraft/network/codec/ByteBufCodecs.QUATERNIONF": "vec4f",
	// Common STREAM_CODEC fields on MC types
	"net/minecraft/core/BlockPos.STREAM_CODEC": "position",
	"net/minecraft/world/item/ItemStack.STREAM_CODEC": "Slot",
	"net/minecraft/world/item/ItemStack.OPTIONAL_STREAM_CODEC": "Slot",
	"net/minecraft/network/chat/ComponentSerialization.STREAM_CODEC":
		"anonymousNbt",
	"net/minecraft/network/chat/ComponentSerialization.TRUSTED_STREAM_CODEC":
		"anonymousNbt",
	"net/minecraft/network/chat/ComponentSerialization.TRUSTED_CONTEXT_FREE_STREAM_CODEC":
		"anonymousNbt",
	"net/minecraft/network/chat/ComponentSerialization.OPTIONAL_STREAM_CODEC":
		"anonymousNbt",
	"net/minecraft/resources/ResourceLocation.STREAM_CODEC": "string",
	"net/minecraft/core/UUIDUtil.STREAM_CODEC": "UUID",
	"net/minecraft/server/ServerLinks.UNTRUSTED_LINKS_STREAM_CODEC": "array",
	"net/minecraft/network/chat/MessageSignature$Packed.STREAM_CODEC": "buffer",
	"net/minecraft/network/chat/RemoteChatSession$Data.STREAM_CODEC": "container",
};

/** Known ByteBufCodecs static methods → ProtoDef types */
const CODEC_METHODS: Record<string, string> = {
	"net/minecraft/network/codec/ByteBufCodecs.idMapper": "varint",
	"net/minecraft/network/codec/ByteBufCodecs.registry": "varint",
	"net/minecraft/network/codec/ByteBufCodecs.holderRegistry": "varint",
	"net/minecraft/network/codec/ByteBufCodecs.fromCodec": "anonymousNbt",
	"net/minecraft/network/codec/ByteBufCodecs.fromCodecTrusted": "anonymousNbt",
	"net/minecraft/network/codec/ByteBufCodecs.map": "array",
	"net/minecraft/network/codec/ByteBufCodecs.stringUtf8": "string",
	"net/minecraft/network/codec/ByteBufCodecs.collection": "array",
	"net/minecraft/network/codec/ByteBufCodecs.list": "array",
};

/**
 * Extract fields from <clinit> by tracing StreamCodec.composite() pattern.
 * Pattern: pairs of (codec_push, getter_invokedynamic) before composite() call.
 */
const extractFieldsFromClinitCodec = (cf: ClassFile): FieldDef[] => {
	const clinit = cf.methods.find((m) => m.name === "<clinit>");
	if (!clinit?.code) return [];

	const code = clinit.code;
	const fields: FieldDef[] = [];

	const resolveRef = (idx: number) => {
		const entry = cf.constantPool[idx];
		if (!entry) return null;
		const classEntry = cf.constantPool[entry.classIndex ?? 0];
		const className = cf.constantPool[classEntry?.nameIndex ?? 0]?.utf8 ?? "";
		const natEntry = cf.constantPool[entry.nameAndTypeIndex ?? 0];
		const name = cf.constantPool[natEntry?.nameIndex ?? 0]?.utf8 ?? "";
		const descriptor =
			cf.constantPool[natEntry?.descriptorIndex ?? 0]?.utf8 ?? "";
		return { class: className, name, descriptor };
	};

	// Resolve InvokeDynamic bootstrap method to get the target method name
	// This is complex — for now, use the Java field names from the class
	const javaFields = cf.fields
		.filter(
			(f) => !f.name.startsWith("STREAM_CODEC") && f.descriptor.startsWith("L"),
		)
		.map((f) => f.name);

	// Track codec types pushed onto the stack + local codec fields
	const codecStack: string[] = [];
	const localCodecs = new Map<string, string>(); // field name → type
	let lastCodecType: string | null = null;
	let pos = 0;

	while (pos < code.length) {
		const op = code[pos] as number;

		if (op === 0xb2) {
			// getstatic — check if it's a known codec or a local codec field
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref) {
				const key = `${ref.class}.${ref.name}`;
				if (KNOWN_CODECS[key]) {
					codecStack.push(KNOWN_CODECS[key] as string);
					lastCodecType = KNOWN_CODECS[key] as string;
				} else if (localCodecs.has(ref.name)) {
					codecStack.push(localCodecs.get(ref.name) as string);
					lastCodecType = localCodecs.get(ref.name) as string;
				} else if (
					ref.name === "STREAM_CODEC" ||
					ref.name === "OPTIONAL_STREAM_CODEC"
				) {
					codecStack.push("container");
					lastCodecType = "container";
				}
			}
			pos += 3;
		} else if (op === 0xb3) {
			// putstatic — store codec type for local field and pop from stack
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref && lastCodecType && ref.name !== "STREAM_CODEC") {
				localCodecs.set(ref.name, lastCodecType);
				// Everything on codecStack was consumed to build this field's codec
				codecStack.length = 0;
			}
			pos += 3;
		} else if (op === 0xb8) {
			// invokestatic — check for ByteBufCodecs factory methods or StreamCodec.composite
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref) {
				const key = `${ref.class}.${ref.name}`;
				if (CODEC_METHODS[key]) {
					lastCodecType = CODEC_METHODS[key] as string;
					codecStack.push(lastCodecType);
				} else if (
					ref.class === "net/minecraft/network/codec/StreamCodec" &&
					ref.name === "composite"
				) {
					for (let i = 0; i < codecStack.length; i++) {
						const name = javaFields[i] ?? `field${i}`;
						fields.push({ name, type: codecStack[i] as string });
					}
					codecStack.length = 0;
				}
			}
			pos += 3;
		} else if (op === 0xba) {
			pos += 5;
		} else {
			pos += instructionLength(op, code, pos);
		}
	}

	return fields;
};

/** Extract just the codec types from clinit (no field name pairing) */
const extractClinitCodecTypes = (cf: ClassFile): string[] => {
	const clinit = cf.methods.find((m) => m.name === "<clinit>");
	if (!clinit?.code) return [];

	const code = clinit.code;
	const types: string[] = [];

	const resolveRef = (idx: number) => {
		const entry = cf.constantPool[idx];
		if (!entry) return null;
		const classEntry = cf.constantPool[entry.classIndex ?? 0];
		const className = cf.constantPool[classEntry?.nameIndex ?? 0]?.utf8 ?? "";
		const natEntry = cf.constantPool[entry.nameAndTypeIndex ?? 0];
		const name = cf.constantPool[natEntry?.nameIndex ?? 0]?.utf8 ?? "";
		return { class: className, name };
	};

	let pos = 0;
	while (pos < code.length) {
		const op = code[pos] as number;
		if (op === 0xb2) {
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref) {
				const key = `${ref.class}.${ref.name}`;
				if (KNOWN_CODECS[key]) types.push(KNOWN_CODECS[key] as string);
			}
			pos += 3;
		} else if (op === 0xb8) {
			const idx = code.readUInt16BE(pos + 1);
			const ref = resolveRef(idx);
			if (ref) {
				const key = `${ref.class}.${ref.name}`;
				if (CODEC_METHODS[key]) types.push(CODEC_METHODS[key] as string);
			}
			pos += 3;
		} else {
			pos += instructionLength(op, code, pos);
		}
	}

	return types;
};

/** Get JVM instruction length */
const instructionLength = (op: number, code: Buffer, pos: number): number => {
	// Single-byte instructions
	if (
		(op >= 0x00 && op <= 0x0f) || // nop, aconst_null, iconst_*
		(op >= 0x1a && op <= 0x35) || // iload_0..aload_3, iaload..saload
		(op >= 0x3b && op <= 0x56) || // istore_0..astore_3, iastore..sastore
		(op >= 0x57 && op <= 0x83) || // pop..ixor
		(op >= 0x85 && op <= 0x93) || // i2l..d2i, etc
		(op >= 0x94 && op <= 0x98) || // lcmp..dcmpg
		(op >= 0xac && op <= 0xb1) || // ireturn..return
		op === 0xbe ||
		op === 0xbf || // arraylength, athrow
		op === 0xc2 ||
		op === 0xc3 // monitorenter, monitorexit
	)
		return 1;

	// 2-byte instructions
	if (
		op === 0x10 || // bipush
		op === 0x12 || // ldc
		(op >= 0x15 && op <= 0x19) || // iload..aload
		(op >= 0x36 && op <= 0x3a) || // istore..astore
		op === 0xa9 || // ret
		op === 0xbc // newarray
	)
		return 2;

	// 3-byte instructions
	if (
		op === 0x11 || // sipush
		op === 0x13 ||
		op === 0x14 || // ldc_w, ldc2_w
		(op >= 0x99 && op <= 0xa8) || // if*, goto, jsr
		op === 0xb2 ||
		op === 0xb3 || // getstatic, putstatic
		op === 0xb4 ||
		op === 0xb5 || // getfield, putfield
		op === 0xb6 ||
		op === 0xb7 || // invokevirtual, invokespecial
		op === 0xbb || // new
		op === 0xbd || // anewarray
		op === 0xc0 ||
		op === 0xc1 || // checkcast, instanceof
		op === 0xc6 ||
		op === 0xc7 || // ifnull, ifnonnull
		op === 0x84 // iinc
	)
		return 3;

	// 4-byte instructions
	if (op === 0xc8 || op === 0xc9) return 5; // goto_w, jsr_w

	// 5-byte instructions
	if (op === 0xb8) return 3; // invokestatic
	if (op === 0xb9) return 5; // invokeinterface
	if (op === 0xba) return 5; // invokedynamic
	if (op === 0xc5) return 4; // multianewarray

	// tableswitch and lookupswitch (variable length, aligned)
	if (op === 0xaa) {
		const pad = (4 - ((pos + 1) % 4)) % 4;
		const low = code.readInt32BE(pos + 1 + pad + 4);
		const high = code.readInt32BE(pos + 1 + pad + 8);
		return 1 + pad + 12 + (high - low + 1) * 4;
	}
	if (op === 0xab) {
		const pad = (4 - ((pos + 1) % 4)) % 4;
		const npairs = code.readInt32BE(pos + 1 + pad + 4);
		return 1 + pad + 8 + npairs * 8;
	}

	// wide
	if (op === 0xc4) {
		const wideOp = code[pos + 1]!;
		return wideOp === 0x84 ? 6 : 4;
	}

	return 1; // fallback
};

// ── Main: extract from jar ──

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

const extractFromJar = async (jarPath: string) => {
	const { execSync } = await import("node:child_process");

	// List packet classes (pipe to file to avoid buffer overflow)
	const tmpDir = execSync("mktemp -d", { encoding: "utf8" }).trim();
	execSync(
		`jar tf "${jarPath}" | grep "network/protocol.*Packet.*\\.class$" | grep -vE '\\$[0-9]+|\\$Builder|\\$Action|\\$Entry|\\$NodeStub|\\$Parameters|\\$ChunkBiomeData|\\$NodeInspector|\\$NodeResolver|\\$LiteralNodeStub|\\$NodeBuilder|\\$Handler|\\$Operation|Type\\.class$|TagOutput|\\$Data$' > "${tmpDir}/classes.txt"`,
	);
	const packetClasses = readFileSync(`${tmpDir}/classes.txt`, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean);

	console.log(`Found ${packetClasses.length} packet classes`);

	// Extract classes in batches
	for (let i = 0; i < packetClasses.length; i += 50) {
		const batch = packetClasses.slice(i, i + 50);
		const escaped = batch.map((c) => `'${c}'`).join(" ");
		execSync(`cd "${tmpDir}" && jar xf "${jarPath}" ${escaped}`);
	}

	const protocol: Record<string, Record<string, Record<string, unknown>>> = {};

	for (const classPath of packetClasses) {
		const data = readFileSync(`${tmpDir}/${classPath}`);
		const cf = parseClassFile(data);

		// Determine state and direction from class path
		const parts = classPath.split("/");
		const className = parts[parts.length - 1]!.replace(".class", "");
		const packageName = parts[parts.length - 2] ?? "";

		const stateMap: Record<string, string> = {
			game: "play",
			login: "login",
			status: "status",
			configuration: "configuration",
			handshake: "handshaking",
			common: "common",
			cookie: "cookie",
			ping: "ping",
		};
		const state = stateMap[packageName] ?? packageName;

		// Handle inner classes: ClientboundMoveEntityPacket$Pos → Clientbound + MoveEntity + Pos
		const [outerName, innerName] = className.split("$");
		const baseName = outerName!;

		const isClientbound = baseName.startsWith("Clientbound");
		const isServerbound = baseName.startsWith("Serverbound");
		if (!isClientbound && !isServerbound) continue;

		const direction = isClientbound ? "toClient" : "toServer";

		// Convert class name to packet name
		let rawName = baseName
			.replace(/^Clientbound/, "")
			.replace(/^Serverbound/, "")
			.replace(/Packet$/, "");
		if (innerName) rawName += innerName;

		const packetName =
			"packet_" +
			rawName
				.replace(/([A-Z])/g, "_$1")
				.toLowerCase()
				.replace(/^_/, "");

		// Try to extract fields from the FriendlyByteBuf constructor (read mode)
		let fields = extractFieldsFromBytecode(
			cf,
			"<init>",
			"(Lnet/minecraft/network/",
			"read",
		);

		// Also try Netty ByteBuf constructor
		if (fields.length === 0) {
			fields = extractFieldsFromBytecode(
				cf,
				"<init>",
				"(Lio/netty/buffer/ByteBuf",
				"read",
			);
		}

		// Fallback: try write method (FriendlyByteBuf or ByteBuf)
		if (fields.length === 0) {
			fields = extractFieldsFromBytecode(
				cf,
				"write",
				"(Lnet/minecraft/network/",
				"write",
			);
		}
		if (fields.length === 0) {
			fields = extractFieldsFromBytecode(
				cf,
				"write",
				"(Lio/netty/buffer/ByteBuf",
				"write",
			);
		}

		// Fallback: try STREAM_CODEC.composite() in <clinit>
		if (fields.length === 0) {
			fields = extractFieldsFromClinitCodec(cf);
		}

		// Fallback: for record classes with a single component, infer from clinit codec
		if (
			fields.length === 0 &&
			cf.superClass === "java/lang/Record" &&
			cf.fields.length > 0
		) {
			// Record fields that aren't STREAM_CODEC are packet data
			const dataFields = cf.fields.filter(
				(f) =>
					!f.name.includes("STREAM_CODEC") && !f.descriptor.startsWith("["),
			);
			// Try to match clinit's getstatic codecs to field types
			const clinitCodecs = extractClinitCodecTypes(cf);
			if (clinitCodecs.length === dataFields.length) {
				for (let i = 0; i < dataFields.length; i++) {
					fields.push({ name: dataFields[i]!.name, type: clinitCodecs[i]! });
				}
			}
		}

		// Build ProtoDef container
		const container = [
			"container",
			fields.map((f) => ({ name: f.name, type: f.type })),
		];

		if (!protocol[state]) protocol[state] = {};
		if (!protocol[state]![direction])
			protocol[state]![direction] = { types: {} };
		(protocol[state]![direction] as { types: Record<string, unknown> }).types[
			packetName
		] = container;
	}

	// Cleanup
	execSync(`rm -rf "${tmpDir}"`);

	return protocol;
};

// ── CLI ──

const jarPath = process.argv[2];
const outputPath = process.argv[3] ?? "protocol-extracted.json";

if (!jarPath) {
	console.error(
		"Usage: node datagen/extract-protocol.ts <mc-jar-path> [output-path]",
	);
	process.exit(1);
}

console.log(`Extracting from: ${jarPath}`);
const protocol = await extractFromJar(jarPath);

// Hard-coded overrides for packets that can't be auto-extracted
const OVERRIDES: Record<string, Record<string, Record<string, unknown>>> = {
	common: {
		toClient: {
			packet_custom_payload: [
				"container",
				[
					{ name: "identifier", type: "string" },
					{ name: "data", type: "restBuffer" },
				],
			],
			packet_disconnect: [
				"container",
				[{ name: "reason", type: "anonymousNbt" }],
			],
		},
		toServer: {
			packet_custom_payload: [
				"container",
				[
					{ name: "identifier", type: "string" },
					{ name: "data", type: "restBuffer" },
				],
			],
			packet_client_information: [
				"container",
				[
					{ name: "language", type: "string" },
					{ name: "viewDistance", type: "i8" },
					{ name: "chatVisibility", type: "varint" },
					{ name: "chatColors", type: "bool" },
					{ name: "modelCustomisation", type: "u8" },
					{ name: "mainHand", type: "varint" },
					{ name: "textFilteringEnabled", type: "bool" },
					{ name: "allowsListing", type: "bool" },
					{ name: "particleStatus", type: "varint" },
				],
			],
		},
	},
	play: {
		toClient: {
			packet_delete_chat: [
				"container",
				[{ name: "messageSignature", type: "buffer" }],
			],
			packet_award_stats: ["container", [{ name: "stats", type: "array" }]],
		},
		toServer: {
			packet_chat_session_update: [
				"container",
				[
					{ name: "sessionId", type: "UUID" },
					{ name: "profilePublicKey", type: "container" },
				],
			],
			packet_debug_subscription_request: [
				"container",
				[{ name: "subscriptions", type: "array" }],
			],
		},
	},
};

// Merge overrides
for (const [state, dirs] of Object.entries(OVERRIDES)) {
	for (const [dir, packets] of Object.entries(dirs)) {
		if (!protocol[state]) protocol[state] = {};
		if (!protocol[state]![dir]) protocol[state]![dir] = { types: {} };
		const types = (protocol[state]![dir] as { types: Record<string, unknown> })
			.types;
		for (const [name, def] of Object.entries(packets)) {
			if (!types[name] || (types[name] as unknown[])[1]?.length === 0) {
				types[name] = def;
			}
		}
	}
}

const totalPackets = Object.values(protocol)
	.flatMap((dirs) => Object.values(dirs))
	.reduce(
		(sum, dir) =>
			sum +
			Object.keys((dir as { types: Record<string, unknown> }).types).length,
		0,
	);

console.log(`Extracted ${totalPackets} packets`);
writeFileSync(outputPath, JSON.stringify(protocol, null, 2));
console.log(`Written to: ${outputPath}`);
