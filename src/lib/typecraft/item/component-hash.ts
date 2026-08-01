/**
 * Component hashing for 1.21+ HashedSlot format.
 * Re-serializes component data using the protocol codec, then computes
 * Java-compatible Arrays.hashCode over the serialized bytes.
 */

import {
	createTypeRegistry,
	type TypeDef,
	type TypeRegistry,
} from "../protocol/codec.ts";
import { SHARED_TYPES } from "../protocol/shared-types.ts";
import type { ItemComponent } from "./types.ts";

// ── Java-compatible hash ──

/** Java's Arrays.hashCode(byte[]) — treats bytes as signed. */
export const javaArraysHashCode = (buf: Buffer): number => {
	let result = 1;
	for (let i = 0; i < buf.length; i++) {
		result = (31 * result + ((buf[i]! << 24) >> 24)) | 0;
	}
	return result;
};

// ── Lazy codec initialization ──

let registry: TypeRegistry | null = null;
let componentSerializers: Map<string, TypeDef> | null = null;

const init = (): void => {
	if (registry) return;
	registry = createTypeRegistry(
		SHARED_TYPES as unknown as Record<string, unknown>,
	);

	componentSerializers = new Map();

	// Extract the switch fields from SlotComponent schema:
	// SlotComponent = ["container", [
	//   { name: "type", type: "SlotComponentType" },
	//   { name: "data", type: ["switch", { compareTo: "type", fields: { ... } }] }
	// ]]
	const schema = SHARED_TYPES.SlotComponent as unknown as [
		string,
		{ name: string; type: unknown }[],
	];
	const containerFields = schema[1];
	const dataField = containerFields.find((f) => f.name === "data")!;
	const switchDef = dataField.type as [
		string,
		{ fields: Record<string, unknown> },
	];
	const fields = switchDef[1].fields;

	for (const [typeName, typeSchema] of Object.entries(fields)) {
		componentSerializers.set(typeName, registry.resolve(typeSchema));
	}
};

// ── Public API ──

/** Serialize a component's data to bytes using the protocol codec. */
export const serializeComponentData = (type: string, data: unknown): Buffer => {
	init();
	const serializer = componentSerializers!.get(type);
	if (!serializer) {
		// Unknown component type — return empty buffer (hash = 1)
		return Buffer.alloc(0);
	}
	const ctx = { type };
	const size = serializer.sizeOf(data, ctx);
	const buf = Buffer.alloc(size);
	serializer.write(data, buf, 0, ctx);
	return buf;
};

/** Compute the Java-compatible hash for a single component. */
export const hashComponentData = (type: string, data: unknown): number => {
	const bytes = serializeComponentData(type, data);
	return javaArraysHashCode(bytes);
};

/** Convert raw deserialized components to ItemComponents with hashes. */
export const hashComponents = (
	raw: readonly { type: string; data: unknown }[],
): ItemComponent[] =>
	raw.map((c) => ({
		type: c.type,
		data: c.data,
		hash: hashComponentData(c.type, c.data),
	}));
