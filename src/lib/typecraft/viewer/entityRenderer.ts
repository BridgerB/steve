/**
 * Entity renderer — builds Bedrock-format entity meshes (bones + UV-mapped cubes).
 * Supports all entity types from entities.json, with Steve-model players as a special case.
 */

import {
	Bone,
	Color3,
	DynamicTexture,
	Matrix,
	Mesh,
	MeshBuilder,
	type Scene,
	Skeleton,
	Space,
	StandardMaterial,
	Texture,
	TransformNode,
	Vector3,
	VertexBuffer,
	VertexData,
} from "@babylonjs/core";

// ── Bedrock geometry types ──

type CubeDef = {
	readonly origin: readonly [number, number, number];
	readonly size: readonly [number, number, number];
	readonly uv: readonly [number, number];
	readonly inflate?: number;
};

type BoneDef = {
	readonly name: string;
	readonly parent?: string;
	readonly pivot?: readonly [number, number, number];
	readonly cubes?: readonly CubeDef[];
};

// ── Entity model definitions (populated by setEntityModels) ──

export type EntityModelDef = {
	readonly texturewidth: number;
	readonly textureheight: number;
	readonly bones: readonly BoneDef[];
};

let entityModels: Record<string, EntityModelDef> = {};

export const setEntityModels = (data: Record<string, EntityModelDef>): void => {
	entityModels = data;
};

const getEntityModel = (name: string): EntityModelDef | null =>
	entityModels[name] ?? null;

const PLAYER_BONES: readonly BoneDef[] = [
	{ name: "root", pivot: [0, 0, 0] },
	{ name: "waist", parent: "root", pivot: [0, 12, 0] },
	{
		name: "body",
		parent: "waist",
		pivot: [0, 24, 0],
		cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }],
	},
	{
		name: "head",
		parent: "body",
		pivot: [0, 24, 0],
		cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }],
	},
	{
		name: "hat",
		parent: "head",
		pivot: [0, 24, 0],
		cubes: [
			{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 },
		],
	},
	{
		name: "leftArm",
		parent: "body",
		pivot: [5, 22, 0],
		cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] }],
	},
	{
		name: "leftSleeve",
		parent: "leftArm",
		pivot: [5, 22, 0],
		cubes: [
			{ origin: [4, 12, -2], size: [4, 12, 4], uv: [48, 48], inflate: 0.25 },
		],
	},
	{
		name: "rightArm",
		parent: "body",
		pivot: [-5, 22, 0],
		cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }],
	},
	{
		name: "rightSleeve",
		parent: "rightArm",
		pivot: [-5, 22, 0],
		cubes: [
			{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 32], inflate: 0.25 },
		],
	},
	{
		name: "leftLeg",
		parent: "root",
		pivot: [1.9, 12, 0],
		cubes: [{ origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [16, 48] }],
	},
	{
		name: "leftPants",
		parent: "leftLeg",
		pivot: [1.9, 12, 0],
		cubes: [
			{ origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25 },
		],
	},
	{
		name: "rightLeg",
		parent: "root",
		pivot: [-1.9, 12, 0],
		cubes: [{ origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16] }],
	},
	{
		name: "rightPants",
		parent: "rightLeg",
		pivot: [-1.9, 12, 0],
		cubes: [
			{ origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25 },
		],
	},
	{
		name: "jacket",
		parent: "body",
		pivot: [0, 24, 0],
		cubes: [
			{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25 },
		],
	},
];

const TEX_W = 64;
const TEX_H = 64;

// ── Face definitions for box geometry (Bedrock format UV layout) ──

type FaceDef = {
	readonly corners: readonly (readonly [
		number,
		number,
		number,
		number,
		number,
	])[];
	readonly u0: readonly [number, number, number];
	readonly v0: readonly [number, number, number];
	readonly u1: readonly [number, number, number];
	readonly v1: readonly [number, number, number];
	readonly dir: readonly [number, number, number];
};

const FACES: readonly FaceDef[] = [
	{
		dir: [0, 1, 0],
		u0: [0, 0, 1],
		v0: [0, 0, 0],
		u1: [1, 0, 1],
		v1: [0, 0, 1],
		corners: [
			[0, 1, 1, 0, 0],
			[1, 1, 1, 1, 0],
			[0, 1, 0, 0, 1],
			[1, 1, 0, 1, 1],
		],
	},
	{
		dir: [0, -1, 0],
		u0: [1, 0, 1],
		v0: [0, 0, 0],
		u1: [2, 0, 1],
		v1: [0, 0, 1],
		corners: [
			[1, 0, 1, 0, 0],
			[0, 0, 1, 1, 0],
			[1, 0, 0, 0, 1],
			[0, 0, 0, 1, 1],
		],
	},
	{
		dir: [1, 0, 0],
		u0: [0, 0, 0],
		v0: [0, 0, 1],
		u1: [0, 0, 1],
		v1: [0, 1, 1],
		corners: [
			[1, 1, 1, 0, 0],
			[1, 0, 1, 0, 1],
			[1, 1, 0, 1, 0],
			[1, 0, 0, 1, 1],
		],
	},
	{
		dir: [-1, 0, 0],
		u0: [1, 0, 1],
		v0: [0, 0, 1],
		u1: [1, 0, 2],
		v1: [0, 1, 1],
		corners: [
			[0, 1, 0, 0, 0],
			[0, 0, 0, 0, 1],
			[0, 1, 1, 1, 0],
			[0, 0, 1, 1, 1],
		],
	},
	{
		dir: [0, 0, -1],
		u0: [0, 0, 1],
		v0: [0, 0, 1],
		u1: [1, 0, 1],
		v1: [0, 1, 1],
		corners: [
			[1, 0, 0, 0, 1],
			[0, 0, 0, 1, 1],
			[1, 1, 0, 0, 0],
			[0, 1, 0, 1, 0],
		],
	},
	{
		dir: [0, 0, 1],
		u0: [1, 0, 2],
		v0: [0, 0, 1],
		u1: [2, 0, 2],
		v1: [0, 1, 1],
		corners: [
			[0, 0, 1, 0, 1],
			[1, 0, 1, 1, 1],
			[0, 1, 1, 0, 0],
			[1, 1, 1, 1, 0],
		],
	},
];

const dot3 = (
	a: readonly [number, number, number],
	b: readonly [number, number, number],
): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── Geometry building ──

type GeoData = {
	positions: number[];
	normals: number[];
	uvs: number[];
	indices: number[];
	skinIndices: number[];
	skinWeights: number[];
};

// Rotate vector by euler angles (XYZ order) — replaces THREE.Vector3.applyEuler
const applyEuler = (
	v: Vector3,
	rx: number,
	ry: number,
	rz: number,
): Vector3 => {
	const mat = Matrix.RotationYawPitchRoll(ry, rx, rz);
	return Vector3.TransformCoordinates(v, mat);
};

const addCube = (
	geo: GeoData,
	boneId: number,
	bonePos: Vector3,
	boneRot: Vector3,
	cube: CubeDef,
	texW: number,
	texH: number,
): void => {
	for (const face of FACES) {
		const ndx = geo.positions.length / 3;
		const inflate = cube.inflate ?? 0;

		for (const corner of face.corners) {
			const u =
				(cube.uv[0] + dot3(corner[3] ? face.u1 : face.u0, cube.size)) / texW;
			const v =
				(cube.uv[1] + dot3(corner[4] ? face.v1 : face.v0, cube.size)) / texH;

			const p = new Vector3(
				cube.origin[0] +
					corner[0] * cube.size[0] +
					(corner[0] ? inflate : -inflate),
				cube.origin[1] +
					corner[1] * cube.size[1] +
					(corner[1] ? inflate : -inflate),
				cube.origin[2] +
					corner[2] * cube.size[2] +
					(corner[2] ? inflate : -inflate),
			);

			// Transform to bone-local space
			const offset = p.subtract(bonePos);
			const rotated = applyEuler(offset, boneRot.x, boneRot.y, boneRot.z);
			const final = rotated.add(bonePos);

			geo.positions.push(final.x, final.y, final.z);
			geo.normals.push(face.dir[0], face.dir[1], face.dir[2]);
			geo.uvs.push(u, v);
			geo.skinIndices.push(boneId, 0, 0, 0);
			geo.skinWeights.push(1, 0, 0, 0);
		}

		geo.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
	}
};

// Store raw skin data alongside VertexData since it can't hold skin attributes
type EntityGeoData = {
	readonly vertexData: VertexData;
	readonly skinIndices: number[];
	readonly skinWeights: number[];
};

const buildEntityGeoData = (
	bones: readonly BoneDef[],
	texW: number,
	texH: number,
): EntityGeoData => {
	const geo: GeoData = {
		positions: [],
		normals: [],
		uvs: [],
		indices: [],
		skinIndices: [],
		skinWeights: [],
	};
	const boneMap = new Map<
		string,
		{ idx: number; pos: Vector3; rot: Vector3 }
	>();

	let idx = 0;
	for (const bone of bones) {
		const pos = bone.pivot
			? new Vector3(bone.pivot[0], bone.pivot[1], bone.pivot[2])
			: Vector3.Zero();
		const rot = Vector3.Zero();
		boneMap.set(bone.name, { idx, pos, rot });

		if (bone.cubes) {
			for (const cube of bone.cubes) {
				addCube(geo, idx, pos, rot, cube, texW, texH);
			}
		}
		idx++;
	}

	const vd = new VertexData();
	vd.positions = geo.positions;
	vd.normals = geo.normals;
	vd.uvs = geo.uvs;
	vd.indices = geo.indices;

	return {
		vertexData: vd,
		skinIndices: geo.skinIndices,
		skinWeights: geo.skinWeights,
	};
};

const buildPlayerGeoData = (): EntityGeoData =>
	buildEntityGeoData(PLAYER_BONES, TEX_W, TEX_H);

const applyGeoToMesh = (mesh: Mesh, geoData: EntityGeoData): void => {
	geoData.vertexData.applyToMesh(mesh);
	mesh.setVerticesData(
		VertexBuffer.MatricesIndicesKind,
		Float32Array.from(geoData.skinIndices),
		false,
	);
	mesh.setVerticesData(
		VertexBuffer.MatricesWeightsKind,
		new Float32Array(geoData.skinWeights),
		false,
	);
};

const buildEntitySkeleton = (
	bones: readonly BoneDef[],
	scene: Scene,
): Skeleton => {
	const skeleton = new Skeleton("skel", "skel", scene);
	const boneMap = new Map<string, Bone>();
	const pivotMap = new Map<string, Vector3>();

	for (const def of bones) {
		const pivot = def.pivot
			? new Vector3(def.pivot[0], def.pivot[1], def.pivot[2])
			: Vector3.Zero();
		pivotMap.set(def.name, pivot);
	}

	for (const def of bones) {
		const pivot = pivotMap.get(def.name)!;
		const parentBone = def.parent ? (boneMap.get(def.parent) ?? null) : null;

		// Position relative to parent
		const localPos =
			parentBone && def.parent
				? pivot.subtract(pivotMap.get(def.parent)!)
				: pivot.clone();

		const bone = new Bone(
			def.name,
			skeleton,
			parentBone,
			Matrix.Translation(localPos.x, localPos.y, localPos.z),
		);
		boneMap.set(def.name, bone);
	}

	return skeleton;
};

const buildPlayerSkeleton = (scene: Scene): Skeleton =>
	buildEntitySkeleton(PLAYER_BONES, scene);

// ── Animation ──

const BONE_LEFT_ARM = 5;
const BONE_RIGHT_ARM = 7;
const BONE_LEFT_LEG = 9;
const BONE_RIGHT_LEG = 11;

type AnimState = {
	skeleton: Skeleton;
	mesh: Mesh;
	isPlayer: boolean;
	lastX: number;
	lastZ: number;
	distanceMoved: number;
};

// ── Public API ──

export type EntityRenderer = {
	readonly scene: Scene;
	readonly entities: Map<number, TransformNode>;
	readonly animStates: Map<number, AnimState>;
	readonly geoData: EntityGeoData;
	readonly material: StandardMaterial;
};

export const createEntityRenderer = (
	scene: Scene,
	textureUrl: string,
): EntityRenderer => {
	const geoData = buildPlayerGeoData();
	const material = new StandardMaterial("entityMat", scene);
	material.disableLighting = true;
	material.backFaceCulling = false;
	material.emissiveColor = Color3.White();
	material.specularColor = Color3.Black();
	material.useAlphaFromDiffuseTexture = true;
	material.transparencyMode = 1; // ALPHA_TEST
	material.alphaCutOff = 0.1;

	const tex = new Texture(
		textureUrl,
		scene,
		false,
		false,
		Texture.NEAREST_SAMPLINGMODE,
	);
	tex.hasAlpha = true;
	material.diffuseTexture = tex;

	return {
		scene,
		entities: new Map(),
		animStates: new Map(),
		geoData,
		material,
	};
};

const loadSkinTexture = (
	url: string,
	material: StandardMaterial,
	scene: Scene,
): void => {
	const tex = new Texture(
		url,
		scene,
		false,
		false,
		Texture.NEAREST_SAMPLINGMODE,
	);
	tex.hasAlpha = true;
	material.diffuseTexture = tex;
};

export const addEntity = (
	er: EntityRenderer,
	id: number,
	entityName: string,
	username: string | null,
	x: number,
	y: number,
	z: number,
	yaw: number,
	skinUrl?: string,
): void => {
	if (er.entities.has(id)) removeEntity(er, id);

	const node = new TransformNode(`entity-${id}`, er.scene);

	let geoData: EntityGeoData;
	let scale: number;

	if (entityName === "player") {
		geoData = er.geoData;
		scale = 1.8 / 32;
	} else {
		const model = getEntityModel(entityName);
		if (model) {
			geoData = buildEntityGeoData(
				model.bones,
				model.texturewidth,
				model.textureheight,
			);
			scale = 1 / 16;
		} else {
			// Fallback: colored box for unknown entities
			const box = MeshBuilder.CreateBox(
				`box-${id}`,
				{ size: 0.5, sideOrientation: Mesh.BACKSIDE },
				er.scene,
			);
			const boxMat = new StandardMaterial(`boxMat-${id}`, er.scene);
			boxMat.diffuseColor = new Color3(1, 0.4, 0);
			boxMat.specularColor = Color3.Black();
			box.material = boxMat;
			box.position.y = 0.25;
			box.parent = node;
			node.position.set(x, y, z);
			node.rotation.y = yaw;
			er.entities.set(id, node);
			return;
		}
	}

	const material = skinUrl
		? (() => {
				const mat = new StandardMaterial(`skin-${id}`, er.scene);
				mat.disableLighting = true;
				mat.backFaceCulling = false;
				mat.emissiveColor = Color3.White();
				mat.specularColor = Color3.Black();
				mat.useAlphaFromDiffuseTexture = true;
				mat.transparencyMode = 1;
				mat.alphaCutOff = 0.1;
				return mat;
			})()
		: entityName === "player"
			? er.material
			: (() => {
					const mat = new StandardMaterial(`entityMat-${id}`, er.scene);
					mat.disableLighting = true;
					mat.backFaceCulling = false;
					mat.emissiveColor = Color3.White();
					mat.specularColor = Color3.Black();
					mat.useAlphaFromDiffuseTexture = true;
					mat.transparencyMode = 1;
					mat.alphaCutOff = 0.1;
					return mat;
				})();
	if (skinUrl) loadSkinTexture(skinUrl, material, er.scene);

	const skeleton =
		entityName === "player"
			? buildPlayerSkeleton(er.scene)
			: buildEntitySkeleton(
					getEntityModel(entityName)?.bones ?? PLAYER_BONES,
					er.scene,
				);

	const mesh = new Mesh(`skinned-${id}`, er.scene);
	applyGeoToMesh(mesh, geoData);
	mesh.material = material;
	mesh.skeleton = skeleton;
	mesh.scaling.set(scale, scale, scale);
	mesh.parent = node;

	if (username) {
		const label = createLabelPlane(username, er.scene);
		label.position.y = 2.1;
		label.parent = node;
	}

	node.position.set(x, y, z);
	node.rotation.y = yaw;

	er.entities.set(id, node);
	er.animStates.set(id, {
		skeleton,
		mesh,
		isPlayer: entityName === "player",
		lastX: x,
		lastZ: z,
		distanceMoved: 0,
	});
};

export const updateEntity = (
	er: EntityRenderer,
	id: number,
	x: number,
	y: number,
	z: number,
	yaw: number,
): void => {
	const node = er.entities.get(id);
	if (!node) return;
	node.position.set(x, y, z);
	node.rotation.y = yaw;

	const anim = er.animStates.get(id);
	if (!anim) return;

	const dx = x - anim.lastX;
	const dz = z - anim.lastZ;
	const dist = Math.sqrt(dx * dx + dz * dz);
	anim.lastX = x;
	anim.lastZ = z;

	if (!anim.isPlayer) return;

	if (dist > 0.001 && dist < 1) {
		anim.distanceMoved += dist;
		const speed = Math.min(dist * 20, 1);
		const tcos0 = Math.cos(anim.distanceMoved * 38.17) * speed * 57.3;
		const rad = tcos0 * (Math.PI / 180);

		anim.skeleton.bones[BONE_LEFT_ARM]!.setRotation(
			new Vector3(rad, 0, 0),
			Space.LOCAL,
		);
		anim.skeleton.bones[BONE_RIGHT_ARM]!.setRotation(
			new Vector3(-rad, 0, 0),
			Space.LOCAL,
		);
		anim.skeleton.bones[BONE_LEFT_LEG]!.setRotation(
			new Vector3(-rad * 1.4, 0, 0),
			Space.LOCAL,
		);
		anim.skeleton.bones[BONE_RIGHT_LEG]!.setRotation(
			new Vector3(rad * 1.4, 0, 0),
			Space.LOCAL,
		);
	} else {
		anim.skeleton.bones[BONE_LEFT_ARM]!.setRotation(
			Vector3.Zero(),
			Space.LOCAL,
		);
		anim.skeleton.bones[BONE_RIGHT_ARM]!.setRotation(
			Vector3.Zero(),
			Space.LOCAL,
		);
		anim.skeleton.bones[BONE_LEFT_LEG]!.setRotation(
			Vector3.Zero(),
			Space.LOCAL,
		);
		anim.skeleton.bones[BONE_RIGHT_LEG]!.setRotation(
			Vector3.Zero(),
			Space.LOCAL,
		);
	}
};

// ── Equipment rendering ──

const itemTextureCache = new Map<string, Texture>();
const loadingTextures = new Set<string>();

const getItemTexture = (itemName: string, scene: Scene): Texture | null => {
	const cached = itemTextureCache.get(itemName);
	if (cached) return cached;
	if (loadingTextures.has(itemName)) return null;

	loadingTextures.add(itemName);
	const url = `/textures/item/${itemName}.png`;
	const tex = new Texture(
		url,
		scene,
		false,
		true,
		Texture.NEAREST_SAMPLINGMODE,
		() => {
			itemTextureCache.set(itemName, tex);
		},
		() => {
			loadingTextures.delete(itemName);
		},
	);
	return null;
};

export const updateEntityEquipment = (
	er: EntityRenderer,
	entityId: number,
	slot: number,
	itemName: string | null,
): void => {
	const anim = er.animStates.get(entityId);
	if (!anim) return;
	if (slot !== 0) return;

	const rightArm = anim.skeleton.bones[BONE_RIGHT_ARM];
	if (!rightArm) return;

	// Remove existing held item
	const existing = anim.mesh
		.getChildMeshes(true)
		.find((c) => (c.metadata as { heldItem?: boolean } | null)?.heldItem);
	if (existing) {
		existing.material?.dispose();
		existing.dispose();
	}

	if (!itemName) return;

	const tex = getItemTexture(itemName, er.scene);

	const plane = MeshBuilder.CreatePlane(
		`held-${entityId}`,
		{ size: 1 },
		er.scene,
	);
	plane.metadata = { heldItem: true };

	if (tex) {
		const mat = new StandardMaterial(`heldMat-${entityId}`, er.scene);
		mat.backFaceCulling = false;
		mat.diffuseTexture = tex;
		mat.transparencyMode = 1;
		mat.alphaCutOff = 0.1;
		mat.emissiveTexture = tex;
		mat.disableLighting = true;
		plane.material = mat;
	} else {
		const mat = new StandardMaterial(`heldPlaceholder-${entityId}`, er.scene);
		mat.backFaceCulling = false;
		mat.diffuseColor = new Color3(0.67, 0.67, 0.67);
		mat.disableLighting = true;
		plane.material = mat;
	}

	plane.scaling.set(8, 8, 8);
	plane.position.set(0, -10, -1);
	plane.rotation.x = -Math.PI / 4;
	plane.attachToBone(rightArm, anim.mesh);
};

export const removeEntity = (er: EntityRenderer, id: number): void => {
	const node = er.entities.get(id);
	if (!node) return;

	for (const child of node.getChildMeshes(false)) {
		if (child instanceof Mesh) {
			// Dispose skeleton if present
			if (child.skeleton) {
				child.skeleton.dispose();
			}
			// Dispose per-entity material (not the shared Steve one)
			if (child.material && child.material !== er.material) {
				const mat = child.material as StandardMaterial;
				mat.diffuseTexture?.dispose();
				mat.dispose();
			}
			child.dispose();
		}
	}

	// Dispose label planes (direct children that are meshes on the node)
	for (const child of node.getChildren()) {
		if (child instanceof Mesh) {
			child.material?.dispose();
			child.dispose();
		}
	}

	node.dispose();
	er.entities.delete(id);
	er.animStates.delete(id);
};

export const clearEntities = (er: EntityRenderer): void => {
	for (const id of er.entities.keys()) {
		removeEntity(er, id);
	}
};

// ── Label plane (billboard) ──

const createLabelPlane = (text: string, scene: Scene): Mesh => {
	const texWidth = 256;
	const texHeight = 64;

	const dynamicTex = new DynamicTexture(
		"labelTex",
		{ width: texWidth, height: texHeight },
		scene,
		false,
		Texture.LINEAR_LINEAR,
	);

	const ctx = dynamicTex.getContext() as unknown as CanvasRenderingContext2D;
	ctx.font = "bold 32px monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	const metrics = ctx.measureText(text);
	const pad = 10;
	const w = metrics.width + pad * 2;
	const h = 40;
	const cx = 128;
	const cy = 32;
	ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
	ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 6);
	ctx.fill();

	ctx.fillStyle = "#ffffff";
	ctx.fillText(text, cx, cy);
	dynamicTex.update();

	const mat = new StandardMaterial("labelMat", scene);
	mat.diffuseTexture = dynamicTex;
	mat.emissiveTexture = dynamicTex;
	mat.disableLighting = true;
	mat.backFaceCulling = false;
	mat.transparencyMode = 2; // ALPHA_BLEND
	mat.useAlphaFromDiffuseTexture = true;
	mat.disableDepthWrite = true;

	const plane = MeshBuilder.CreatePlane(
		"label",
		{ width: 3, height: 0.75 },
		scene,
	);
	plane.material = mat;
	plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

	return plane;
};
