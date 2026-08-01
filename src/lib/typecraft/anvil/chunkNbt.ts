import {
	type BitArray,
	bitArrayFromLongArray,
	bitArrayToLongArray,
	type ChunkColumn,
	createChunkColumn,
	loadChunkSectionFromAnvil,
	neededBits,
} from "../chunk/index.ts";
import {
	nbtByte,
	nbtByteArray,
	nbtCompound,
	nbtInt,
	nbtList,
	nbtLong,
	nbtLongArray,
	nbtString,
	simplifyNbt,
} from "../nbt/index.ts";
import type { NbtRoot, NbtTag, NbtTagValue } from "../nbt/types.ts";
import type { Registry } from "../registry/index.ts";

/**
 * Convert an anvil-format NBT chunk to a ChunkColumn.
 */
export const nbtToChunkColumn = (
	nbtRoot: NbtRoot,
	registry: Registry,
): ChunkColumn => {
	const data = simplifyNbt(nbtRoot) as Record<string, unknown>;
	const sections = data.sections as Record<string, unknown>[];

	const maxBlockStateId = Math.max(
		...registry.blocksArray.map((b) => b.maxStateId),
	);
	const col = createChunkColumn({
		minY: -64,
		worldHeight: 384,
		maxBitsPerBlock: neededBits(maxBlockStateId),
		maxBitsPerBiome: neededBits(registry.biomesArray.length),
	});

	// Load block entities from the raw (unsimplified) NBT to preserve types
	const rawBlockEntities = (nbtRoot.value as Record<string, NbtTag>)
		.block_entities;
	if (rawBlockEntities?.type === "list") {
		const listVal = rawBlockEntities.value;
		if (listVal.type === "compound") {
			for (const entry of listVal.value) {
				const compound = entry as Record<string, NbtTag>;
				const x = compound.x?.value as number | undefined;
				const y = compound.y?.value as number | undefined;
				const z = compound.z?.value as number | undefined;
				if (x !== undefined && y !== undefined && z !== undefined) {
					col.blockEntities[`${x & 0xf},${y},${z & 0xf}`] = compound;
				}
			}
		}
	}

	for (const section of sections) {
		const sectionY = section.Y as number;
		const blockStates = section.block_states as Record<string, unknown>;
		const biomes = section.biomes as Record<string, unknown>;

		if (!blockStates?.palette || !biomes?.palette) continue;

		const blockPalette = blockStates.palette as Record<string, unknown>[];
		const biomePalette = biomes.palette as string[];

		let bitsPerBlock = Math.ceil(Math.log2(blockPalette.length));
		if (bitsPerBlock >= 1 && bitsPerBlock <= 3) bitsPerBlock = 4;

		const bitsPerBiome = Math.ceil(Math.log2(biomePalette.length));

		const blockData = blockStates.data
			? bitArrayFromLongArray(
					blockStates.data as [number, number][],
					bitsPerBlock,
				)
			: emptyBitArray();

		const biomeData = biomes.data
			? bitArrayFromLongArray(biomes.data as [number, number][], bitsPerBiome)
			: emptyBitArray();

		const mappedBlockPalette = blockPalette.map((entry) => {
			const name = (entry.Name as string).replace("minecraft:", "");
			const props = (entry.Properties ?? {}) as Record<string, string>;
			return blockNameToStateId(registry, name, props);
		});

		const mappedBiomePalette = biomePalette.map((name) => {
			const cleanName = name.replace("minecraft:", "");
			const biome = registry.biomesByName.get(cleanName);
			if (!biome) throw new Error(`Unknown biome: ${name}`);
			return biome.id;
		});

		const blockLight = section.BlockLight
			? Buffer.from(section.BlockLight as number[])
			: undefined;
		const skyLight = section.SkyLight
			? Buffer.from(section.SkyLight as number[])
			: undefined;

		loadChunkSectionFromAnvil(
			col,
			sectionY,
			mappedBlockPalette,
			blockData,
			mappedBiomePalette,
			biomeData,
			blockLight,
			skyLight,
		);
	}

	return col;
};

/**
 * Convert a ChunkColumn to anvil-format NBT for writing.
 */
export const chunkColumnToNbt = (
	col: ChunkColumn,
	chunkX: number,
	chunkZ: number,
	registry: Registry,
	dataVersion: number,
): NbtRoot => {
	const sectionTags: NbtTagValue[] = [];
	const minSectionY = col.minY >> 4;
	const maxSectionY = minSectionY + col.numSections;

	for (let y = minSectionY; y < maxSectionY; y++) {
		const idx = y - minSectionY;
		const section = col.sections[idx]!;
		const biomeSection = col.biomes[idx]!;
		const blockLightSection = col.blockLightSections[idx + 1];
		const skyLightSection = col.skyLightSections[idx + 1];

		const blockPalette = extractBlockPalette(section.data, registry);
		const biomePalette = extractBiomePalette(biomeSection.data, registry);

		const bitsPerBlock = Math.ceil(Math.log2(blockPalette.nbtEntries.length));
		const bitsPerBiome = Math.ceil(Math.log2(biomePalette.names.length));

		const blockStatesEntries: Record<string, NbtTag> = {
			palette: nbtList({
				type: "compound",
				value: blockPalette.nbtEntries,
			}),
		};
		if (bitsPerBlock && section.data.type !== "single") {
			const bitArr =
				section.data.type === "indirect"
					? section.data.data
					: section.data.data;
			blockStatesEntries.data = nbtLongArray(bitArrayToLongArray(bitArr));
		}

		const biomesEntries: Record<string, NbtTag> = {
			palette: nbtList({
				type: "string",
				value: biomePalette.names,
			}),
		};
		if (bitsPerBiome && biomeSection.data.type !== "single") {
			const bitArr =
				biomeSection.data.type === "indirect"
					? biomeSection.data.data
					: biomeSection.data.data;
			biomesEntries.data = nbtLongArray(bitArrayToLongArray(bitArr));
		}

		const sectionEntries: Record<string, NbtTag> = {
			Y: nbtByte(y),
			block_states: nbtCompound(blockStatesEntries),
			biomes: nbtCompound(biomesEntries),
		};

		if (blockLightSection) {
			sectionEntries.BlockLight = nbtByteArray(
				Array.from(new Int8Array(blockLightSection.data.buffer)),
			);
		}
		if (skyLightSection) {
			sectionEntries.SkyLight = nbtByteArray(
				Array.from(new Int8Array(skyLightSection.data.buffer)),
			);
		}

		sectionTags.push(sectionEntries as NbtTagValue);
	}

	return nbtCompound(
		{
			DataVersion: nbtInt(dataVersion),
			Status: nbtString("full"),
			xPos: nbtInt(chunkX),
			yPos: nbtInt(col.minY >> 4),
			zPos: nbtInt(chunkZ),
			sections: nbtList({ type: "compound", value: sectionTags }),
			block_entities: serializeBlockEntities(col.blockEntities),
			LastUpdate: nbtLong([0, 0]),
			InhabitedTime: nbtLong([0, 0]),
			structures: nbtCompound({}),
			Heightmaps: nbtCompound({}),
			isLightOn: nbtInt(0),
			block_ticks: nbtList(null),
			PostProcessing: nbtList(null),
			fluid_ticks: nbtList(null),
		},
		"",
	);
};

// ── Helpers ──

const emptyBitArray = (): BitArray => ({
	data: new Uint32Array(0),
	bitsPerValue: 0,
	capacity: 0,
	valuesPerLong: 1,
	valueMask: 0,
});

const blockNameToStateId = (
	registry: Registry,
	name: string,
	properties: Record<string, string>,
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

	// State ID = minStateId + sum of (property_value_index * product_of_later_num_values)
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

const stateIdToBlockNbt = (
	registry: Registry,
	stateId: number,
): NbtTagValue => {
	const block = registry.blocksByStateId.get(stateId);
	if (!block) throw new Error(`Unknown state ID: ${stateId}`);

	const entries: Record<string, NbtTag> = {
		Name: nbtString(`minecraft:${block.name}`),
	};

	if (block.states.length > 0 && stateId !== block.defaultState) {
		const props: Record<string, NbtTag> = {};
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
				props[prop.name] = nbtString(prop.values[idx] ?? String(idx));
			}
		}

		if (Object.keys(props).length > 0) {
			entries.Properties = nbtCompound(props);
		}
	}

	return entries as NbtTagValue;
};

type BlockPaletteInfo = {
	nbtEntries: NbtTagValue[];
	stateIds: number[];
};

const extractBlockPalette = (
	container: ChunkColumn["sections"][number]["data"],
	registry: Registry,
): BlockPaletteInfo => {
	if (container.type === "single") {
		return {
			nbtEntries: [stateIdToBlockNbt(registry, container.value)],
			stateIds: [container.value],
		};
	}
	if (container.type === "indirect") {
		return {
			nbtEntries: container.palette.map((id) =>
				stateIdToBlockNbt(registry, id),
			),
			stateIds: [...container.palette],
		};
	}
	// Direct: collect unique state IDs
	const seen = new Map<number, NbtTagValue>();
	const stateIds: number[] = [];
	for (let i = 0; i < container.data.capacity; i++) {
		const id = container.data.data[i]!;
		if (!seen.has(id)) {
			seen.set(id, stateIdToBlockNbt(registry, id));
			stateIds.push(id);
		}
	}
	return {
		nbtEntries: stateIds.map((id) => seen.get(id)!),
		stateIds,
	};
};

const extractBiomePalette = (
	container: ChunkColumn["biomes"][number]["data"],
	registry: Registry,
): { names: string[]; ids: number[] } => {
	if (container.type === "single") {
		const biome = registry.biomesById.get(container.value);
		const name = biome ? `minecraft:${biome.name}` : "minecraft:plains";
		return { names: [name], ids: [container.value] };
	}
	if (container.type === "indirect") {
		return {
			names: container.palette.map((id) => {
				const biome = registry.biomesById.get(id);
				return biome ? `minecraft:${biome.name}` : "minecraft:plains";
			}),
			ids: [...container.palette],
		};
	}
	// Direct
	const seen = new Map<number, string>();
	const ids: number[] = [];
	for (let i = 0; i < container.data.capacity; i++) {
		const id = container.data.data[i]!;
		if (!seen.has(id)) {
			const biome = registry.biomesById.get(id);
			seen.set(id, biome ? `minecraft:${biome.name}` : "minecraft:plains");
			ids.push(id);
		}
	}
	return {
		names: ids.map((id) => seen.get(id)!),
		ids,
	};
};

const serializeBlockEntities = (entities: Record<string, unknown>): NbtTag => {
	const keys = Object.keys(entities);
	if (keys.length === 0) return nbtList(null);

	const compounds: NbtTagValue[] = [];
	for (const value of Object.values(entities)) {
		// Stored as raw NbtTag compound value (Record<string, NbtTag>)
		compounds.push(value as NbtTagValue);
	}

	return nbtList({ type: "compound", value: compounds });
};
