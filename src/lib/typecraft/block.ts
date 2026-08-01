import {
	type ChunkColumn,
	getBlockStateId,
	setBlockStateId,
} from "./chunk/index.ts";
import type { Registry } from "./registry/index.ts";

/** Block name and properties, as used by the Minecraft world format. */
export type BlockInfo = {
	readonly name: string;
	readonly properties: Readonly<Record<string, string>>;
};

/**
 * Convert a block state ID to a block name and properties.
 */
export const stateIdToBlock = (
	registry: Registry,
	stateId: number,
): BlockInfo => {
	const block = registry.blocksByStateId.get(stateId);
	if (!block) throw new Error(`Unknown state ID: ${stateId}`);

	if (block.states.length === 0 || stateId === block.defaultState) {
		return { name: block.name, properties: {} };
	}

	const properties: Record<string, string> = {};
	let remaining = stateId - block.minStateId;
	let multiplier = 1;
	for (let i = block.states.length - 1; i >= 0; i--) {
		multiplier *= block.states[i]!.num_values;
	}

	for (const prop of block.states) {
		multiplier = Math.floor(multiplier / prop.num_values);
		const idx = Math.floor(remaining / multiplier);
		remaining %= multiplier;
		if (prop.values) {
			properties[prop.name] = prop.values[idx] ?? String(idx);
		}
	}

	return { name: block.name, properties };
};

/**
 * Convert a block name and properties to a block state ID.
 */
export const blockToStateId = (
	registry: Registry,
	name: string,
	properties?: Readonly<Record<string, string>>,
): number => {
	const block = registry.blocksByName.get(name);
	if (!block) throw new Error(`Unknown block: ${name}`);

	if (
		!properties ||
		Object.keys(properties).length === 0 ||
		block.states.length === 0
	) {
		return block.defaultState;
	}

	let offset = 0;
	let multiplier = 1;
	for (let i = block.states.length - 1; i >= 0; i--) {
		const prop = block.states[i]!;
		const propValue = properties[prop.name];
		if (propValue !== undefined && prop.values) {
			const idx = prop.values.indexOf(propValue);
			if (idx >= 0) {
				offset += idx * multiplier;
			}
		}
		multiplier *= prop.num_values;
	}

	return block.minStateId + offset;
};

/**
 * Get the block at a position as a name and properties.
 */
export const getBlock = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
	registry: Registry,
): BlockInfo => stateIdToBlock(registry, getBlockStateId(col, x, y, z));

/**
 * Set a block at a position by name and optional properties.
 * If no properties are given, uses the block's default state.
 */
export const setBlock = (
	col: ChunkColumn,
	x: number,
	y: number,
	z: number,
	registry: Registry,
	name: string,
	properties?: Readonly<Record<string, string>>,
): void => {
	setBlockStateId(col, x, y, z, blockToStateId(registry, name, properties));
};
