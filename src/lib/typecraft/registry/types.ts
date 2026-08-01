/** Item definition from the Minecraft data registry. */
export type ItemDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly stackSize: number;
	readonly enchantCategories?: readonly string[];
	readonly repairWith?: readonly string[];
	readonly maxDurability?: number;
};

/** Enchantment cost formula coefficient (level = a * enchantLevel + b). */
export type EnchantmentCost = {
	readonly a: number;
	readonly b: number;
};

/** Enchantment definition from the Minecraft data registry. */
export type EnchantmentDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly maxLevel: number;
	readonly minCost: EnchantmentCost;
	readonly maxCost: EnchantmentCost;
	readonly treasureOnly: boolean;
	readonly curse: boolean;
	readonly exclude: readonly string[];
	readonly category: string;
	readonly weight: number;
	readonly tradeable: boolean;
	readonly discoverable: boolean;
};

/** Food definition from the Minecraft data registry. */
export type FoodDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly stackSize: number;
	readonly foodPoints: number;
	readonly saturation: number;
	readonly effectiveQuality: number;
	readonly saturationRatio: number;
};

/** Entity definition from the Minecraft data registry. */
export type EntityDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly width: number;
	readonly height: number;
	readonly type: string;
	readonly category: string;
};

/** Block definition from the Minecraft data registry. */
export type BlockDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly hardness: number | null;
	readonly resistance: number | null;
	readonly stackSize: number;
	readonly diggable: boolean;
	readonly boundingBox: "block" | "empty";
	readonly material?: string;
	readonly transparent: boolean;
	readonly emitLight: number;
	readonly filterLight: number;
	readonly defaultState: number;
	readonly minStateId: number;
	readonly maxStateId: number;
	readonly states: readonly BlockStateProperty[];
	readonly drops: readonly unknown[];
	readonly harvestTools?: Readonly<Record<number, boolean>>;
};

/** A block state property (e.g. facing, powered, waterlogged). */
export type BlockStateProperty = {
	readonly name: string;
	readonly type: "enum" | "bool" | "int" | "direction";
	readonly num_values: number;
	readonly values?: readonly string[];
};

/** Effect (potion) definition from the Minecraft data registry. */
export type EffectDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly type: "good" | "bad";
};

/** Attribute definition from the Minecraft data registry. */
export type AttributeDefinition = {
	readonly resource: string;
	readonly name: string;
	readonly min: number;
	readonly max: number;
	readonly default: number;
};

/** Raw recipe item. Keyed by result item ID. */
export type RawRecipeItem =
	| null
	| number
	| {
			readonly id: number;
			readonly metadata?: number | null;
			readonly choices?: readonly number[];
		};

/** Raw recipe entry. */
export type RawRecipe = {
	readonly inShape?: readonly (readonly RawRecipeItem[])[];
	readonly outShape?: readonly (readonly RawRecipeItem[])[];
	readonly ingredients?: readonly RawRecipeItem[];
	readonly result: {
		readonly id: number;
		readonly count: number;
		readonly metadata?: number | null;
	};
};

/** Block collision shape data from the Minecraft data registry. */
export type BlockCollisionShapes = {
	readonly blocks: Readonly<Record<string, number | readonly number[]>>;
	readonly shapes: Readonly<Record<string, readonly (readonly number[])[]>>;
};

/** Biome definition from the Minecraft data registry. */
export type BiomeDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly category: string;
	readonly temperature: number;
	readonly dimension: string;
	readonly color: number;
	readonly precipitation?: "none" | "rain" | "snow";
	readonly has_precipitation?: boolean;
	readonly rainfall?: number;
};

/** Version info with comparison operators. */
export type VersionInfo = {
	readonly type: "pc" | "bedrock";
	readonly majorVersion: string;
	readonly minecraftVersion: string;
	readonly version: number;
	readonly dataVersion?: number;
};

/** The loaded Minecraft data registry for a specific version. */
export type Registry = {
	readonly version: VersionInfo;
	readonly blocksById: ReadonlyMap<number, BlockDefinition>;
	readonly blocksByName: ReadonlyMap<string, BlockDefinition>;
	readonly blocksByStateId: ReadonlyMap<number, BlockDefinition>;
	readonly blocksArray: readonly BlockDefinition[];
	readonly biomesById: ReadonlyMap<number, BiomeDefinition>;
	readonly biomesByName: ReadonlyMap<string, BiomeDefinition>;
	readonly biomesArray: readonly BiomeDefinition[];
	readonly itemsById: ReadonlyMap<number, ItemDefinition>;
	readonly itemsByName: ReadonlyMap<string, ItemDefinition>;
	readonly itemsArray: readonly ItemDefinition[];
	readonly enchantmentsById: ReadonlyMap<number, EnchantmentDefinition>;
	readonly enchantmentsByName: ReadonlyMap<string, EnchantmentDefinition>;
	readonly enchantmentsArray: readonly EnchantmentDefinition[];
	readonly foodsById: ReadonlyMap<number, FoodDefinition>;
	readonly foodsByName: ReadonlyMap<string, FoodDefinition>;
	readonly foodsArray: readonly FoodDefinition[];
	readonly entitiesById: ReadonlyMap<number, EntityDefinition>;
	readonly entitiesByName: ReadonlyMap<string, EntityDefinition>;
	readonly entitiesArray: readonly EntityDefinition[];
	readonly effectsById: ReadonlyMap<number, EffectDefinition>;
	readonly effectsByName: ReadonlyMap<string, EffectDefinition>;
	readonly effectsArray: readonly EffectDefinition[];
	readonly attributesByName: ReadonlyMap<string, AttributeDefinition>;
	readonly attributesArray: readonly AttributeDefinition[];
	readonly blockCollisionShapes: BlockCollisionShapes;
	readonly recipes: Readonly<Record<number, readonly RawRecipe[]>>;
	readonly materials: Readonly<
		Record<string, Readonly<Record<number, number>>>
	>;
	readonly language: Readonly<Record<string, string>>;
	readonly isNewerOrEqualTo: (version: string) => boolean;
	readonly isOlderThan: (version: string) => boolean;
	readonly supportFeature: (feature: string) => unknown;
};
