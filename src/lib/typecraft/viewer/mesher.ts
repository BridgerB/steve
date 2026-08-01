/**
 * Section geometry generation — converts a 16×16×16 chunk section into
 * vertex buffers for Three.js rendering. Port of prismarine-viewer's models.js.
 */

import type {
	BiomeTints,
	BlockModelElement,
	BlockModelVariant,
	BlockStateDefinition,
	ResolvedBlockStates,
	TextureUV,
} from "./assets.ts";

// ── MesherBlock — the minimal block interface the mesher needs ──

export type MesherBlock = {
	readonly name: string;
	readonly stateId: number;
	readonly transparent: boolean;
	readonly isCube: boolean;
	readonly biome: string;
	readonly properties: Readonly<Record<string, string>>;
};

export type GetBlock = (x: number, y: number, z: number) => MesherBlock | null;

// ── Section geometry output ──

export type SectionGeometry = {
	readonly sx: number;
	readonly sy: number;
	readonly sz: number;
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;
};

// ── Face definitions ──

type FaceDef = {
	readonly dir: readonly [number, number, number];
	readonly mask1: readonly [number, number, number];
	readonly mask2: readonly [number, number, number];
	readonly corners: readonly (readonly [
		number,
		number,
		number,
		number,
		number,
	])[];
};

// Minecraft-style per-face shade (baked into vertex colors, not via lights)
const faceShade: Readonly<Record<string, number>> = {
	up: 1.0,
	down: 0.5,
	north: 0.8,
	south: 0.8,
	east: 0.6,
	west: 0.6,
};

const elemFaces: Readonly<Record<string, FaceDef>> = {
	up: {
		dir: [0, 1, 0],
		mask1: [1, 1, 0],
		mask2: [0, 1, 1],
		corners: [
			[0, 1, 1, 0, 1],
			[1, 1, 1, 1, 1],
			[0, 1, 0, 0, 0],
			[1, 1, 0, 1, 0],
		],
	},
	down: {
		dir: [0, -1, 0],
		mask1: [1, 1, 0],
		mask2: [0, 1, 1],
		corners: [
			[1, 0, 1, 0, 1],
			[0, 0, 1, 1, 1],
			[1, 0, 0, 0, 0],
			[0, 0, 0, 1, 0],
		],
	},
	east: {
		dir: [1, 0, 0],
		mask1: [1, 1, 0],
		mask2: [1, 0, 1],
		corners: [
			[1, 1, 1, 0, 0],
			[1, 0, 1, 0, 1],
			[1, 1, 0, 1, 0],
			[1, 0, 0, 1, 1],
		],
	},
	west: {
		dir: [-1, 0, 0],
		mask1: [1, 1, 0],
		mask2: [1, 0, 1],
		corners: [
			[0, 1, 0, 0, 0],
			[0, 0, 0, 0, 1],
			[0, 1, 1, 1, 0],
			[0, 0, 1, 1, 1],
		],
	},
	north: {
		dir: [0, 0, -1],
		mask1: [1, 0, 1],
		mask2: [0, 1, 1],
		corners: [
			[1, 0, 0, 0, 1],
			[0, 0, 0, 1, 1],
			[1, 1, 0, 0, 0],
			[0, 1, 0, 1, 0],
		],
	},
	south: {
		dir: [0, 0, 1],
		mask1: [1, 0, 1],
		mask2: [0, 1, 1],
		corners: [
			[0, 0, 1, 0, 1],
			[1, 0, 1, 1, 1],
			[0, 1, 1, 0, 0],
			[1, 1, 1, 1, 0],
		],
	},
};

// ── Math helpers ──

type Vec3Tuple = [number, number, number];
type Mat3 = [Vec3Tuple, Vec3Tuple, Vec3Tuple];

const matmul3 = (matrix: Mat3 | null, vector: Vec3Tuple): Vec3Tuple => {
	if (!matrix) return vector;
	return [
		matrix[0][0] * vector[0] +
			matrix[0][1] * vector[1] +
			matrix[0][2] * vector[2],
		matrix[1][0] * vector[0] +
			matrix[1][1] * vector[1] +
			matrix[1][2] * vector[2],
		matrix[2][0] * vector[0] +
			matrix[2][1] * vector[1] +
			matrix[2][2] * vector[2],
	];
};

const matmulmat3 = (a: Mat3, b: Mat3): Mat3 => {
	const r: Mat3 = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	];
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < 3; j++) {
			r[i]![j] =
				a[i]![0] * b[0][j]! + a[i]![1] * b[1][j]! + a[i]![2] * b[2][j]!;
		}
	}
	return r;
};

const buildRotationMatrix = (axis: string, degree: number): Mat3 => {
	const radians = (degree / 180) * Math.PI;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	const axis0 = axis === "x" ? 0 : axis === "y" ? 1 : 2;
	const axis1 = (axis0 + 1) % 3;
	const axis2 = (axis0 + 2) % 3;

	const matrix: Mat3 = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	];
	matrix[axis0]![axis0] = 1;
	matrix[axis1]![axis1] = cos;
	matrix[axis1]![axis2] = -sin;
	matrix[axis2]![axis1] = sin;
	matrix[axis2]![axis2] = cos;

	return matrix;
};

const vecadd3 = (a: Vec3Tuple, b: Vec3Tuple | null): Vec3Tuple => {
	if (!b) return a;
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
};

const vecsub3 = (a: Vec3Tuple, b: Vec3Tuple | null): Vec3Tuple => {
	if (!b) return a;
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
};

// ── Geometry buffer accumulator ──

type GeometryAccum = {
	positions: number[];
	normals: number[];
	colors: number[];
	uvs: number[];
	t_positions: number[];
	t_normals: number[];
	t_colors: number[];
	t_uvs: number[];
	indices: number[];
};

// ── Liquid rendering ──

const getLiquidRenderHeight = (
	getBlock: GetBlock,
	x: number,
	y: number,
	z: number,
	type: string,
): number => {
	const block = getBlock(x, y, z);
	if (!block || block.name !== type) return 1 / 9;
	const level = block.properties.level;
	if (!level || level === "0") {
		const above = getBlock(x, y + 1, z);
		if (above && above.name === type) return 1;
		return 8 / 9;
	}
	const meta = Number.parseInt(level, 10);
	return ((meta >= 8 ? 8 : 7 - meta) + 1) / 9;
};

const renderLiquid = (
	getBlock: GetBlock,
	cx: number,
	cy: number,
	cz: number,
	texture: TextureUV,
	type: string,
	biome: string,
	isWater: boolean,
	tints: BiomeTints,
	attr: GeometryAccum,
): void => {
	const heights: number[] = [];
	for (let z = -1; z <= 1; z++) {
		for (let x = -1; x <= 1; x++) {
			heights.push(getLiquidRenderHeight(getBlock, cx + x, cy, cz + z, type));
		}
	}
	const cornerHeights = [
		Math.max(heights[0]!, heights[1]!, heights[3]!, heights[4]!),
		Math.max(heights[1]!, heights[2]!, heights[4]!, heights[5]!),
		Math.max(heights[3]!, heights[4]!, heights[6]!, heights[7]!),
		Math.max(heights[4]!, heights[5]!, heights[7]!, heights[8]!),
	];

	for (const face in elemFaces) {
		const { dir, corners } = elemFaces[face]!;
		const isUp = dir[1] === 1;

		const neighbor = getBlock(cx + dir[0], cy + dir[1], cz + dir[2]);
		if (neighbor) {
			if (neighbor.name === type) continue;
			if (neighbor.isCube && !isUp) continue;
		}

		let tint: readonly [number, number, number] = [1, 1, 1];
		if (isWater) {
			let m = 1;
			if (Math.abs(dir[0]) > 0) m = 0.6;
			else if (Math.abs(dir[2]) > 0) m = 0.8;
			const waterTint = tints.water.get(biome) ?? tints.waterDefault;
			tint = [waterTint[0] * m, waterTint[1] * m, waterTint[2] * m];
		}

		const { u, v, su, sv } = texture;

		for (const pos of corners) {
			const height = cornerHeights[pos[2] * 2 + pos[0]]!;
			attr.t_positions.push(
				(pos[0] ? 1 : 0) + (cx & 15) - 8,
				(pos[1] ? height : 0) + (cy & 15) - 8,
				(pos[2] ? 1 : 0) + (cz & 15) - 8,
			);
			attr.t_normals.push(dir[0], dir[1], dir[2]);
			attr.t_uvs.push(pos[3] * su + u, pos[4] * sv * (pos[1] ? 1 : height) + v);
			attr.t_colors.push(tint[0], tint[1], tint[2]);
		}
	}
};

// ── Element rendering ──

const renderElement = (
	getBlock: GetBlock,
	cx: number,
	cy: number,
	cz: number,
	element: BlockModelElement,
	doAO: boolean,
	attr: GeometryAccum,
	globalMatrix: Mat3 | null,
	globalShift: Vec3Tuple | null,
	block: MesherBlock,
	biome: string,
	tints: BiomeTints,
): void => {
	const cullIfIdentical = block.name.includes("glass");

	for (const face in element.faces) {
		const eFace = element.faces[face]!;
		const { corners, mask1, mask2 } = elemFaces[face]!;
		const dir = matmul3(
			globalMatrix,
			elemFaces[face]!.dir as unknown as Vec3Tuple,
		);

		if (eFace.cullface) {
			const neighbor = getBlock(cx + dir[0], cy + dir[1], cz + dir[2]);
			// null = unloaded/unknown neighbor — render the face (assume visible)
			if (neighbor) {
				if (cullIfIdentical && neighbor.name === block.name) continue;
				if (!neighbor.transparent && neighbor.isCube) continue;
			}
		}

		const minx = element.from[0];
		const miny = element.from[1];
		const minz = element.from[2];
		const maxx = element.to[0];
		const maxy = element.to[1];
		const maxz = element.to[2];

		const texture = eFace.texture as TextureUV;
		if (!texture || !Number.isFinite(texture.u)) continue;
		const { u, v, su, sv } = texture;

		const ndx = Math.floor(attr.positions.length / 3);

		let tint: readonly [number, number, number] = [1, 1, 1];
		if (eFace.tintindex !== undefined) {
			if (eFace.tintindex === 0) {
				if (block.name === "redstone_wire") {
					const power = block.properties.power ?? "0";
					tint = tints.redstone.get(power) ?? [1, 0, 0];
				} else if (
					block.name === "birch_leaves" ||
					block.name === "spruce_leaves" ||
					block.name === "lily_pad"
				) {
					tint = tints.constant.get(block.name) ?? [1, 1, 1];
				} else if (block.name.includes("leaves") || block.name === "vine") {
					tint = tints.foliage.get(biome) ?? tints.foliageDefault;
				} else {
					tint = tints.grass.get(biome) ?? tints.grassDefault;
				}
			}
		}

		// UV rotation
		const r = eFace.rotation ?? 0;
		const uvcs = Math.cos((r * Math.PI) / 180);
		const uvsn = -Math.sin((r * Math.PI) / 180);

		let localMatrix: Mat3 | null = null;
		let localShift: Vec3Tuple | null = null;

		if (element.rotation) {
			localMatrix = buildRotationMatrix(
				element.rotation.axis,
				element.rotation.angle,
			);
			localShift = vecsub3(
				element.rotation.origin as unknown as Vec3Tuple,
				matmul3(localMatrix, element.rotation.origin as unknown as Vec3Tuple),
			);
		}

		const aos: number[] = [];
		for (const pos of corners) {
			let vertex: Vec3Tuple = [
				pos[0] ? maxx : minx,
				pos[1] ? maxy : miny,
				pos[2] ? maxz : minz,
			];

			vertex = vecadd3(matmul3(localMatrix, vertex), localShift);
			vertex = vecadd3(matmul3(globalMatrix, vertex), globalShift);
			vertex = [vertex[0] / 16, vertex[1] / 16, vertex[2] / 16];

			attr.positions.push(
				vertex[0] + (cx & 15) - 8,
				vertex[1] + (cy & 15) - 8,
				vertex[2] + (cz & 15) - 8,
			);

			attr.normals.push(dir[0], dir[1], dir[2]);

			const baseu = (pos[3] - 0.5) * uvcs - (pos[4] - 0.5) * uvsn + 0.5;
			const basev = (pos[3] - 0.5) * uvsn + (pos[4] - 0.5) * uvcs + 0.5;
			attr.uvs.push(baseu * su + u, basev * sv + v);

			const shade = faceShade[face] ?? 1;
			let light = shade;
			if (doAO) {
				const dx = pos[0] * 2 - 1;
				const dy = pos[1] * 2 - 1;
				const dz = pos[2] * 2 - 1;
				const cornerDir = matmul3(globalMatrix, [dx, dy, dz]);
				const side1Dir = matmul3(globalMatrix, [
					dx * mask1[0],
					dy * mask1[1],
					dz * mask1[2],
				]);
				const side2Dir = matmul3(globalMatrix, [
					dx * mask2[0],
					dy * mask2[1],
					dz * mask2[2],
				]);
				const side1 = getBlock(
					cx + side1Dir[0],
					cy + side1Dir[1],
					cz + side1Dir[2],
				);
				const side2 = getBlock(
					cx + side2Dir[0],
					cy + side2Dir[1],
					cz + side2Dir[2],
				);
				const corner = getBlock(
					cx + cornerDir[0],
					cy + cornerDir[1],
					cz + cornerDir[2],
				);

				const s1 = side1?.isCube ? 1 : 0;
				const s2 = side2?.isCube ? 1 : 0;
				const c = corner?.isCube ? 1 : 0;

				const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
				light = shade * (0.5 + ao / 6);
				aos.push(ao);
			}

			attr.colors.push(tint[0] * light, tint[1] * light, tint[2] * light);
		}

		// Flip quad winding based on AO to avoid diagonal artifacts
		if (doAO && aos[0]! + aos[3]! >= aos[1]! + aos[2]!) {
			attr.indices.push(ndx, ndx + 3, ndx + 2, ndx, ndx + 1, ndx + 3);
		} else {
			attr.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
		}
	}
};

// ── Block state matching ──

const parseProperties = (
	properties: string | Record<string, string>,
): Record<string, string> => {
	if (typeof properties === "object") return properties;
	const json: Record<string, string> = {};
	for (const prop of properties.split(",")) {
		const [key, value] = prop.split("=");
		if (key && value) json[key] = value;
	}
	return json;
};

const matchProperties = (
	blockProps: Readonly<Record<string, string>>,
	properties: unknown,
): boolean => {
	if (!properties) return true;

	if (typeof properties === "string") {
		return matchProperties(blockProps, parseProperties(properties));
	}

	const props = properties as Record<string, unknown>;

	if (props.OR && Array.isArray(props.OR)) {
		return (props.OR as Record<string, string>[]).some((or) =>
			matchProperties(blockProps, or),
		);
	}

	for (const prop in blockProps) {
		const pv = props[prop];
		if (
			typeof pv === "string" &&
			!pv.split("|").some((v) => v === `${blockProps[prop]}`)
		) {
			return false;
		}
	}

	return true;
};

export const getModelVariants = (
	block: MesherBlock,
	blockStates: ResolvedBlockStates,
): readonly BlockModelVariant[] => {
	if (block.name.includes("air")) return [];

	const state = blockStates[block.name] as BlockStateDefinition | undefined;
	if (!state) return [];

	if (state.variants) {
		for (const [properties, variant] of Object.entries(state.variants)) {
			if (!matchProperties(block.properties, properties)) continue;
			if (Array.isArray(variant)) return [variant[0]! as BlockModelVariant];
			return [variant as BlockModelVariant];
		}
	}

	if (state.multipart) {
		const variants: BlockModelVariant[] = [];
		for (const part of state.multipart) {
			if (!matchProperties(block.properties, part.when)) continue;
			if (Array.isArray(part.apply)) {
				variants.push(...part.apply);
			} else {
				variants.push(part.apply as BlockModelVariant);
			}
		}
		return variants;
	}

	return [];
};

// ── Main entry point ──

export const getSectionGeometry = (
	sx: number,
	sy: number,
	sz: number,
	getBlock: GetBlock,
	blockStates: ResolvedBlockStates,
	tints: BiomeTints,
): SectionGeometry => {
	const attr: GeometryAccum = {
		positions: [],
		normals: [],
		colors: [],
		uvs: [],
		t_positions: [],
		t_normals: [],
		t_colors: [],
		t_uvs: [],
		indices: [],
	};

	for (let y = sy; y < sy + 16; y++) {
		for (let z = sz; z < sz + 16; z++) {
			for (let x = sx; x < sx + 16; x++) {
				const block = getBlock(x, y, z);
				if (!block) continue;
				if (block.name.includes("air")) continue;

				const biome = block.biome;
				const variants = getModelVariants(block, blockStates);

				for (const variant of variants) {
					if (!variant?.model) continue;

					if (block.name === "water") {
						const particle = (variant.model.textures as Record<string, unknown>)
							.particle as TextureUV | undefined;
						if (particle)
							renderLiquid(
								getBlock,
								x,
								y,
								z,
								particle,
								"water",
								biome,
								true,
								tints,
								attr,
							);
					} else if (block.name === "lava") {
						const particle = (variant.model.textures as Record<string, unknown>)
							.particle as TextureUV | undefined;
						if (particle)
							renderLiquid(
								getBlock,
								x,
								y,
								z,
								particle,
								"lava",
								biome,
								false,
								tints,
								attr,
							);
					} else {
						let globalMatrix: Mat3 | null = null;
						let globalShift: Vec3Tuple | null = null;

						for (const axis of ["x", "y", "z"] as const) {
							const angle = variant[axis];
							if (angle !== undefined) {
								const rot = buildRotationMatrix(axis, -angle);
								globalMatrix = globalMatrix
									? matmulmat3(globalMatrix, rot)
									: rot;
							}
						}

						if (globalMatrix) {
							const center: Vec3Tuple = [8, 8, 8];
							globalShift = vecsub3(center, matmul3(globalMatrix, center));
						}

						for (const element of variant.model.elements) {
							renderElement(
								getBlock,
								x,
								y,
								z,
								element,
								variant.model.ao,
								attr,
								globalMatrix,
								globalShift,
								block,
								biome,
								tints,
							);
						}
					}
				}
			}
		}
	}

	// Append transparent geometry (liquids) after opaque with double-sided indices
	let ndx = attr.positions.length / 3;
	for (let i = 0; i < attr.t_positions.length / 12; i++) {
		attr.indices.push(
			ndx,
			ndx + 1,
			ndx + 2,
			ndx + 2,
			ndx + 1,
			ndx + 3,
			// back face
			ndx,
			ndx + 2,
			ndx + 1,
			ndx + 2,
			ndx + 3,
			ndx + 1,
		);
		ndx += 4;
	}

	attr.positions.push(...attr.t_positions);
	attr.normals.push(...attr.t_normals);
	attr.colors.push(...attr.t_colors);
	attr.uvs.push(...attr.t_uvs);

	return {
		sx: sx + 8,
		sy: sy + 8,
		sz: sz + 8,
		positions: new Float32Array(attr.positions),
		normals: new Float32Array(attr.normals),
		colors: new Float32Array(attr.colors),
		uvs: new Float32Array(attr.uvs),
		indices: new Uint32Array(attr.indices),
	};
};
