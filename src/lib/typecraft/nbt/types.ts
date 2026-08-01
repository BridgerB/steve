// ─── Format ─────────────────────────────────────────────────────────────────

export type NbtFormat = "big" | "little" | "littleVarint";

// ─── Tag type identifiers ───────────────────────────────────────────────────

export type NbtTagType =
	| "byte"
	| "short"
	| "int"
	| "long"
	| "float"
	| "double"
	| "byteArray"
	| "string"
	| "list"
	| "compound"
	| "intArray"
	| "longArray";

// ─── Tag ID ↔ type mappings ────────────────────────────────────────────────

export const TAG_ID_TO_TYPE: Readonly<Record<number, NbtTagType | "end">> = {
	0: "end",
	1: "byte",
	2: "short",
	3: "int",
	4: "long",
	5: "float",
	6: "double",
	7: "byteArray",
	8: "string",
	9: "list",
	10: "compound",
	11: "intArray",
	12: "longArray",
};

export const TAG_TYPE_TO_ID: Readonly<Record<NbtTagType | "end", number>> = {
	end: 0,
	byte: 1,
	short: 2,
	int: 3,
	long: 4,
	float: 5,
	double: 6,
	byteArray: 7,
	string: 8,
	list: 9,
	compound: 10,
	intArray: 11,
	longArray: 12,
};

// ─── Individual tag types ───────────────────────────────────────────────────

export type NbtByte = { readonly type: "byte"; readonly value: number };
export type NbtShort = { readonly type: "short"; readonly value: number };
export type NbtInt = { readonly type: "int"; readonly value: number };
export type NbtLong = {
	readonly type: "long";
	readonly value: readonly [number, number];
};
export type NbtFloat = { readonly type: "float"; readonly value: number };
export type NbtDouble = { readonly type: "double"; readonly value: number };
export type NbtString = { readonly type: "string"; readonly value: string };
export type NbtByteArray = {
	readonly type: "byteArray";
	readonly value: readonly number[];
};
export type NbtIntArray = {
	readonly type: "intArray";
	readonly value: readonly number[];
};
export type NbtLongArray = {
	readonly type: "longArray";
	readonly value: readonly (readonly [number, number])[];
};
export type NbtList = {
	readonly type: "list";
	readonly value: {
		readonly type: NbtTagType | "end";
		readonly value: readonly NbtTagValue[];
	};
};
export type NbtCompound = {
	readonly type: "compound";
	readonly value: Readonly<Record<string, NbtTag>>;
};

// ─── Union types ────────────────────────────────────────────────────────────

export type NbtTag =
	| NbtByte
	| NbtShort
	| NbtInt
	| NbtLong
	| NbtFloat
	| NbtDouble
	| NbtString
	| NbtByteArray
	| NbtIntArray
	| NbtLongArray
	| NbtList
	| NbtCompound;

export type NbtTagValue = NbtTag["value"];

// ─── Root NBT (compound with a name) ───────────────────────────────────────

export type NbtRoot = NbtCompound & { readonly name: string };

// ─── Read result (value + bytes consumed) ───────────────────────────────────

export type ReadResult<T> = { readonly value: T; readonly size: number };

// ─── Parse result ───────────────────────────────────────────────────────────

export type NbtParseResult = {
	readonly parsed: NbtRoot;
	readonly format: NbtFormat;
	readonly bytesRead: number;
};
