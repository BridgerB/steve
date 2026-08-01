/**
 * Asset pipeline: load block models, textures, and block states from src/data/assets/.
 * Builds a texture atlas and resolves all model references for use by the mesher.
 */

import type { Registry } from "../registry/index.ts";

// ── Types ──

export type TextureUV = {
	readonly u: number;
	readonly v: number;
	readonly su: number;
	readonly sv: number;
};

export type TextureAtlas = {
	readonly canvas: OffscreenCanvas;
	readonly uvMap: Readonly<Record<string, TextureUV>>;
	readonly tileSize: number;
	readonly atlasSize: number;
};

export type BlockModelFace = {
	texture: TextureUV;
	cullface?: string;
	tintindex?: number;
	rotation?: number;
};

export type BlockModelElement = {
	readonly from: readonly [number, number, number];
	readonly to: readonly [number, number, number];
	readonly rotation?: {
		readonly origin: readonly [number, number, number];
		readonly axis: "x" | "y" | "z";
		readonly angle: number;
	};
	readonly faces: Readonly<Record<string, BlockModelFace>>;
};

export type BlockModel = {
	readonly elements: readonly BlockModelElement[];
	readonly ao: boolean;
	readonly textures: Readonly<Record<string, unknown>>;
};

export type BlockModelVariant = {
	readonly model: BlockModel;
	readonly x?: number;
	readonly y?: number;
	readonly z?: number;
	readonly uvlock?: boolean;
};

export type MultipartCase = {
	readonly when?:
		| Readonly<Record<string, string>>
		| { readonly OR: readonly Record<string, string>[] };
	readonly apply: BlockModelVariant | readonly BlockModelVariant[];
};

export type BlockStateDefinition = {
	readonly variants?: Readonly<
		Record<string, BlockModelVariant | readonly BlockModelVariant[]>
	>;
	readonly multipart?: readonly MultipartCase[];
};

export type ResolvedBlockStates = Readonly<
	Record<string, BlockStateDefinition>
>;

export type BiomeTints = {
	readonly grass: ReadonlyMap<string, readonly [number, number, number]>;
	readonly foliage: ReadonlyMap<string, readonly [number, number, number]>;
	readonly water: ReadonlyMap<string, readonly [number, number, number]>;
	readonly redstone: ReadonlyMap<string, readonly [number, number, number]>;
	readonly constant: ReadonlyMap<string, readonly [number, number, number]>;
	readonly grassDefault: readonly [number, number, number];
	readonly foliageDefault: readonly [number, number, number];
	readonly waterDefault: readonly [number, number, number];
};

// ── Helpers ──

const nextPowerOfTwo = (n: number): number => {
	if (n === 0) return 1;
	let v = n - 1;
	v |= v >> 1;
	v |= v >> 2;
	v |= v >> 4;
	v |= v >> 8;
	v |= v >> 16;
	return v + 1;
};

const cleanupBlockName = (name: string): string => {
	if (name.startsWith("minecraft:block/"))
		return name.slice("minecraft:block/".length);
	if (name.startsWith("block/")) return name.slice("block/".length);
	return name;
};

const tintToGl = (color: number): readonly [number, number, number] => {
	const r = (color >> 16) & 0xff;
	const g = (color >> 8) & 0xff;
	const b = color & 0xff;
	return [r / 255, g / 255, b / 255] as const;
};

// ── Texture atlas ──

/** Compute UV map without a canvas — pure math, works on server. */
export const computeUvMap = (
	textureFiles: readonly string[],
): {
	uvMap: Record<string, TextureUV>;
	tileSize: number;
	atlasSize: number;
	texSize: number;
} => {
	const tileSize = 16;
	const texSize = nextPowerOfTwo(Math.ceil(Math.sqrt(textureFiles.length)));
	const atlasSize = texSize * tileSize;
	const uvMap: Record<string, TextureUV> = {};

	for (let i = 0; i < textureFiles.length; i++) {
		const x = (i % texSize) * tileSize;
		const y = Math.floor(i / texSize) * tileSize;
		const name = textureFiles[i]!.replace(".png", "");
		uvMap[name] = {
			u: x / atlasSize,
			v: y / atlasSize,
			su: tileSize / atlasSize,
			sv: tileSize / atlasSize,
		};
	}

	return { uvMap, tileSize, atlasSize, texSize };
};

export const createTextureAtlas = (
	textureFiles: readonly string[],
	loadImage: (name: string) => ImageBitmap | HTMLImageElement,
): TextureAtlas => {
	const { uvMap, tileSize, atlasSize, texSize } = computeUvMap(textureFiles);

	const canvas = new OffscreenCanvas(atlasSize, atlasSize);
	const ctx = canvas.getContext("2d")!;

	for (let i = 0; i < textureFiles.length; i++) {
		const x = (i % texSize) * tileSize;
		const y = Math.floor(i / texSize) * tileSize;
		const img = loadImage(textureFiles[i]!);
		ctx.drawImage(img, 0, 0, 16, 16, x, y, 16, 16);
	}

	return { canvas, uvMap, tileSize, atlasSize };
};

// ── Model resolution ──

type RawBlockModels = Readonly<
	Record<
		string,
		{
			parent?: string;
			textures?: Record<string, string>;
			elements?: readonly RawElement[];
			ambientocclusion?: boolean;
		}
	>
>;

type RawElement = {
	from: [number, number, number];
	to: [number, number, number];
	rotation?: { origin: [number, number, number]; axis: string; angle: number };
	faces: Record<
		string,
		{
			texture: string;
			cullface?: string;
			tintindex?: number;
			rotation?: number;
			uv?: number[];
		}
	>;
};

type MutableModel = {
	textures: Record<string, string>;
	elements: RawElement[];
	ao: boolean;
};

const getModel = (
	name: string,
	blocksModels: RawBlockModels,
): MutableModel | null => {
	const cleanName = cleanupBlockName(name);
	const data = blocksModels[cleanName];
	if (!data) return null;

	let model: MutableModel = { textures: {}, elements: [], ao: true };

	if (data.parent) {
		const parentModel = getModel(data.parent, blocksModels);
		if (parentModel) model = parentModel;
	}

	if (data.textures) {
		Object.assign(model.textures, JSON.parse(JSON.stringify(data.textures)));
	}
	if (data.elements) {
		model.elements = JSON.parse(JSON.stringify(data.elements));
	}
	if (data.ambientocclusion !== undefined) {
		model.ao = data.ambientocclusion;
	}

	return model;
};

const prepareModel = (
	model: MutableModel,
	uvMap: Readonly<Record<string, TextureUV>>,
): void => {
	// Resolve texture name references (e.g. #all → stone)
	for (const tex in model.textures) {
		let root = model.textures[tex]!;
		while (root.charAt(0) === "#") {
			root = model.textures[root.slice(1)]!;
			if (!root) break;
		}
		if (root) model.textures[tex] = root;
	}

	// Replace texture names with atlas UV coords
	for (const tex in model.textures) {
		const name = cleanupBlockName(model.textures[tex]!);
		const uv = uvMap[name];
		if (uv) {
			(model.textures as Record<string, unknown>)[tex] = uv;
		}
	}

	// Resolve element face textures
	for (const elem of model.elements) {
		for (const sideName of Object.keys(elem.faces)) {
			const face = elem.faces[sideName]!;
			let resolvedTexture: TextureUV | undefined;

			if (face.texture.charAt(0) === "#") {
				const ref = model.textures[face.texture.slice(1)];
				// Only accept resolved TextureUV objects (not leftover strings)
				if (ref && typeof ref === "object") {
					resolvedTexture = ref as unknown as TextureUV;
				}
			} else {
				const name = cleanupBlockName(face.texture);
				resolvedTexture = uvMap[name];
			}

			if (!resolvedTexture || !Number.isFinite(resolvedTexture.u)) continue;

			// Compute sub-UV from element bounds
			let uv = face.uv;
			if (!uv) {
				const _from = elem.from;
				const _to = elem.to;
				uv = (
					{
						north: [_to[0], 16 - _to[1], _from[0], 16 - _from[1]],
						east: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
						south: [_from[0], 16 - _to[1], _to[0], 16 - _from[1]],
						west: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
						up: [_from[0], _from[2], _to[0], _to[2]],
						down: [_to[0], _from[2], _from[0], _to[2]],
					} as Record<string, number[]>
				)[sideName]!;
			}

			const baseTexture = { ...resolvedTexture };
			const su = ((uv[2]! - uv[0]!) * baseTexture.su) / 16;
			const sv = ((uv[3]! - uv[1]!) * baseTexture.sv) / 16;
			const finalTexture: TextureUV = {
				u: baseTexture.u + (uv[0]! * baseTexture.su) / 16,
				v: baseTexture.v + (uv[1]! * baseTexture.sv) / 16,
				su,
				sv,
			};

			(face as Record<string, unknown>).texture = finalTexture;
		}
	}
};

const resolveModel = (
	name: string,
	blocksModels: RawBlockModels,
	uvMap: Readonly<Record<string, TextureUV>>,
): BlockModel | null => {
	const model = getModel(name, blocksModels);
	if (!model) return null;
	prepareModel(model, uvMap);
	return model as unknown as BlockModel;
};

// ── Block states preparation ──

export const prepareBlockStates = (
	blocksStates: Record<string, unknown>,
	blocksModels: RawBlockModels,
	uvMap: Readonly<Record<string, TextureUV>>,
): ResolvedBlockStates => {
	const result: Record<string, BlockStateDefinition> = {};

	for (const [blockName, stateDef] of Object.entries(blocksStates)) {
		if (!stateDef || typeof stateDef !== "object") continue;

		const def = stateDef as Record<string, unknown>;

		if (def.variants && typeof def.variants === "object") {
			const variants: Record<string, BlockModelVariant | BlockModelVariant[]> =
				{};

			for (const [props, variant] of Object.entries(
				def.variants as Record<string, unknown>,
			)) {
				if (Array.isArray(variant)) {
					const resolved: BlockModelVariant[] = [];
					for (const v of variant) {
						const rv = resolveVariant(
							v as Record<string, unknown>,
							blocksModels,
							uvMap,
						);
						if (rv) resolved.push(rv);
					}
					if (resolved.length > 0) variants[props] = resolved;
				} else {
					const rv = resolveVariant(
						variant as Record<string, unknown>,
						blocksModels,
						uvMap,
					);
					if (rv) variants[props] = rv;
				}
			}

			result[blockName] = { variants };
		}

		if (def.multipart && Array.isArray(def.multipart)) {
			const parts: MultipartCase[] = [];

			for (const part of def.multipart) {
				const p = part as { when?: unknown; apply: unknown };
				let apply: BlockModelVariant | BlockModelVariant[];

				if (Array.isArray(p.apply)) {
					const resolved: BlockModelVariant[] = [];
					for (const v of p.apply) {
						const rv = resolveVariant(
							v as Record<string, unknown>,
							blocksModels,
							uvMap,
						);
						if (rv) resolved.push(rv);
					}
					apply = resolved;
				} else {
					const rv = resolveVariant(
						p.apply as Record<string, unknown>,
						blocksModels,
						uvMap,
					);
					if (!rv) continue;
					apply = rv;
				}

				parts.push({
					when: p.when as MultipartCase["when"],
					apply,
				});
			}

			result[blockName] = { ...result[blockName], multipart: parts };
		}
	}

	return result;
};

const resolveVariant = (
	v: Record<string, unknown>,
	blocksModels: RawBlockModels,
	uvMap: Readonly<Record<string, TextureUV>>,
): BlockModelVariant | null => {
	const modelName = v.model as string;
	if (!modelName) return null;
	const model = resolveModel(modelName, blocksModels, uvMap);
	if (!model) return null;

	return {
		model,
		...(v.x !== undefined ? { x: v.x as number } : {}),
		...(v.y !== undefined ? { y: v.y as number } : {}),
		...(v.z !== undefined ? { z: v.z as number } : {}),
		...(v.uvlock !== undefined ? { uvlock: v.uvlock as boolean } : {}),
	};
};

// ── Biome tints ──

export const prepareBiomeTints = (registry: Registry): BiomeTints => {
	const tints = (registry as unknown as { raw: { tints: RawTints } }).raw
		?.tints;
	if (!tints) {
		// Fallback: build from minecraft-data directly
		return prepareBiomeTintsFromMcData(registry.version.minecraftVersion);
	}
	return buildTints(tints);
};

type RawTints = {
	grass: { default?: number; data: { keys: string[]; color: number }[] };
	foliage: { default?: number; data: { keys: string[]; color: number }[] };
	water: { default?: number; data: { keys: string[]; color: number }[] };
	redstone: { data: { keys: (string | number)[]; color: number }[] };
	constant: { data: { keys: string[]; color: number }[] };
};

const prepareBiomeTintsFromMcData = (_version: string): BiomeTints => {
	// Fallback — return defaults when registry has no tints
	return {
		grass: new Map(),
		foliage: new Map(),
		water: new Map(),
		redstone: new Map(),
		constant: new Map(),
		grassDefault: [0.48, 0.74, 0.31],
		foliageDefault: [0.48, 0.74, 0.31],
		waterDefault: [0.25, 0.29, 0.98],
	};
};

const buildTints = (tints: RawTints): BiomeTints => {
	const buildMap = (
		data: { keys: (string | number)[]; color: number }[],
	): Map<string, readonly [number, number, number]> => {
		const map = new Map<string, readonly [number, number, number]>();
		for (const entry of data) {
			if (entry.color === 0) continue; // 0 = use default colormap color
			const color = tintToGl(entry.color);
			for (const key of entry.keys) {
				map.set(`${key}`, color);
			}
		}
		return map;
	};

	return {
		grass: buildMap(tints.grass.data),
		foliage: buildMap(tints.foliage.data),
		water: buildMap(tints.water.data),
		redstone: buildMap(tints.redstone.data),
		constant: buildMap(tints.constant.data),
		grassDefault:
			tints.grass.default !== undefined
				? tintToGl(tints.grass.default)
				: [0.48, 0.74, 0.31],
		foliageDefault:
			tints.foliage.default !== undefined
				? tintToGl(tints.foliage.default)
				: [0.48, 0.74, 0.31],
		waterDefault:
			tints.water.default !== undefined
				? tintToGl(tints.water.default)
				: [0.25, 0.29, 0.98],
	};
};

// ── High-level loader ──

export type McAssets = {
	blocksStates: Record<string, unknown>;
	blocksModels: RawBlockModels;
	directory: string;
};

/** Load all viewer assets for a given minecraft version. */
export const loadAssets = (
	mcAssets: McAssets,
	textureFileNames: readonly string[],
	loadImage: (name: string) => ImageBitmap | HTMLImageElement,
): { atlas: TextureAtlas; blockStates: ResolvedBlockStates } => {
	const atlas = createTextureAtlas(textureFileNames, loadImage);
	const blockStates = prepareBlockStates(
		mcAssets.blocksStates,
		mcAssets.blocksModels,
		atlas.uvMap,
	);
	return { atlas, blockStates };
};
