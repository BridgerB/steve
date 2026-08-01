import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AttributeDefinition,
	BiomeDefinition,
	BlockCollisionShapes,
	BlockDefinition,
	EffectDefinition,
	EnchantmentDefinition,
	EntityDefinition,
	FoodDefinition,
	ItemDefinition,
	RawRecipe,
	RawRecipeItem,
	Registry,
	VersionInfo,
} from "./types.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");

const loadJson = <T>(filename: string): T =>
	JSON.parse(readFileSync(join(DATA_DIR, filename), "utf8")) as T;

// ── Recipe loading ──

type RawVanillaRecipe = {
	type: string;
	key?: Record<string, string>;
	pattern?: string[];
	ingredients?: (string | string[])[];
	ingredient?: string | string[];
	result: { id: string; count?: number };
};

/** Load item tags (e.g., #minecraft:oak_logs → [oak_log, oak_wood, ...]) */
const loadItemTags = (): ReadonlyMap<string, readonly string[]> => {
	const tagsDir = join(DATA_DIR, "tags/item");
	if (!existsSync(tagsDir)) return new Map();

	// Pass 1: Load all tag files (may contain #tag references)
	const raw = new Map<string, string[]>();
	for (const file of readdirSync(tagsDir)) {
		if (!file.endsWith(".json")) continue;
		const name = file.replace(".json", "");
		const data = JSON.parse(readFileSync(join(tagsDir, file), "utf8")) as {
			values: string[];
		};
		raw.set(
			name,
			data.values.map((v) => v.replace("minecraft:", "")),
		);
	}

	// Pass 2: Recursively resolve nested #tag references
	const resolve = (name: string, seen = new Set<string>()): string[] => {
		if (seen.has(name)) return [];
		seen.add(name);
		const values = raw.get(name);
		if (!values) return [];
		const resolved: string[] = [];
		for (const v of values) {
			if (v.startsWith("#")) {
				resolved.push(...resolve(v.slice(1), seen));
			} else {
				resolved.push(v);
			}
		}
		return resolved;
	};

	const tags = new Map<string, readonly string[]>();
	for (const name of raw.keys()) {
		tags.set(name, resolve(name));
	}
	return tags;
};

/**
 * Resolve an ingredient reference to a recipe item. Tags (e.g.
 * #minecraft:planks) keep ALL their member IDs as `choices` so the crafter can
 * satisfy the ingredient with any one of them (oak, birch, …), not just the
 * first. Concrete items resolve to a plain numeric ID.
 */
const resolveIngredient = (
	ref: string,
	itemsByName: ReadonlyMap<string, ItemDefinition>,
	tags: ReadonlyMap<string, readonly string[]>,
): RawRecipeItem => {
	if (ref.startsWith("#minecraft:")) {
		const tagName = ref.slice("#minecraft:".length);
		const tagItems = tags.get(tagName);
		if (!tagItems || tagItems.length === 0) return null;
		const ids = tagItems
			.map((n) => itemsByName.get(n)?.id)
			.filter((id): id is number => id != null);
		if (ids.length === 0) return null;
		return ids.length === 1 ? ids[0]! : { id: ids[0]!, choices: ids };
	}
	const name = ref.replace("minecraft:", "");
	return itemsByName.get(name)?.id ?? null;
};

/** Load crafting recipes from recipes-raw/ and convert to RawRecipe format. */
const loadRecipes = (
	itemsByName: ReadonlyMap<string, ItemDefinition>,
): Readonly<Record<number, readonly RawRecipe[]>> => {
	const recipesDir = join(DATA_DIR, "recipes-raw");
	if (!existsSync(recipesDir)) return {};

	const tags = loadItemTags();
	const byResultId: Record<number, RawRecipe[]> = {};

	for (const file of readdirSync(recipesDir)) {
		if (!file.endsWith(".json")) continue;
		try {
			const raw = JSON.parse(
				readFileSync(join(recipesDir, file), "utf8"),
			) as RawVanillaRecipe;

			const resultName = raw.result.id.replace("minecraft:", "");
			const resultItem = itemsByName.get(resultName);
			if (!resultItem) continue;

			const result = { id: resultItem.id, count: raw.result.count ?? 1 };

			if (raw.type === "minecraft:crafting_shaped" && raw.pattern && raw.key) {
				// Shaped recipe: pattern + key → inShape grid
				const inShape: RawRecipeItem[][] = [];
				for (const row of raw.pattern) {
					const shapeRow: RawRecipeItem[] = [];
					for (const ch of row) {
						if (ch === " ") {
							shapeRow.push(null);
						} else {
							const ref = raw.key[ch];
							if (!ref) {
								shapeRow.push(null);
								continue;
							}
							shapeRow.push(resolveIngredient(ref, itemsByName, tags));
						}
					}
					inShape.push(shapeRow);
				}
				const recipe: RawRecipe = { inShape, result };
				if (!byResultId[result.id]) byResultId[result.id] = [];
				byResultId[result.id]!.push(recipe);
			} else if (
				raw.type === "minecraft:crafting_shapeless" &&
				raw.ingredients
			) {
				// Shapeless recipe: flat ingredient list
				const ingredients: RawRecipeItem[] = [];
				for (const ing of raw.ingredients) {
					const ref = typeof ing === "string" ? ing : ing[0];
					if (!ref) continue;
					ingredients.push(resolveIngredient(ref, itemsByName, tags));
				}
				const recipe: RawRecipe = { ingredients, result };
				if (!byResultId[result.id]) byResultId[result.id] = [];
				byResultId[result.id]!.push(recipe);
			}
			// Skip smelting, stonecutting, smithing — not used by bot.craft()
		} catch {
			// Skip malformed recipe files
		}
	}

	return byResultId;
};

/**
 * Create a registry for a specific Minecraft version.
 * Loads data from src/data/ (generated by nix run .#datagen).
 */
export const createRegistry = (version: string): Registry => {
	// Load extracted data
	const blocksArray = loadJson<BlockDefinition[]>("blocks.json");
	const itemsArray = loadJson<ItemDefinition[]>("items.json");
	const entitiesArray = loadJson<EntityDefinition[]>("entities.json");
	const effectsArray = loadJson<EffectDefinition[]>("effects.json");
	const attributesArray = loadJson<AttributeDefinition[]>("attributes.json");
	const blockCollisionShapes = loadJson<BlockCollisionShapes>(
		"blockCollisionShapes.json",
	);

	// Load biomes from biomes-raw/ (name + temperature/downfall from datagen)
	const biomesRawDir = join(DATA_DIR, "biomes-raw");
	const biomesArray: BiomeDefinition[] = [];
	if (existsSync(biomesRawDir)) {
		const files = readdirSync(biomesRawDir)
			.filter((f) => f.endsWith(".json"))
			.sort();
		for (let i = 0; i < files.length; i++) {
			const name = files[i]!.replace(".json", "");
			const raw = JSON.parse(
				readFileSync(join(biomesRawDir, files[i]!), "utf8"),
			) as {
				temperature?: number;
				downfall?: number;
				effects?: { water_color?: string };
			};
			biomesArray.push({
				id: i,
				name,
				displayName: name,
				category: "none",
				temperature: raw.temperature ?? 0.5,
				dimension: "overworld",
				color: 0,
				rainfall: raw.downfall,
			});
		}
	}

	// These aren't extracted by datagen yet — provide empty defaults
	const enchantmentsArray: EnchantmentDefinition[] = [];
	const foodsArray: FoodDefinition[] = [];

	// Build indexes
	const blocksById = new Map<number, BlockDefinition>();
	const blocksByName = new Map<string, BlockDefinition>();
	const blocksByStateId = new Map<number, BlockDefinition>();

	for (const block of blocksArray) {
		blocksById.set(block.id, block);
		blocksByName.set(block.name, block);
		for (let s = block.minStateId; s <= block.maxStateId; s++) {
			blocksByStateId.set(s, block);
		}
	}

	const biomesById = new Map<number, BiomeDefinition>();
	const biomesByName = new Map<string, BiomeDefinition>();
	for (const biome of biomesArray) {
		biomesById.set(biome.id, biome);
		biomesByName.set(biome.name, biome);
	}

	const itemsById = new Map<number, ItemDefinition>();
	const itemsByName = new Map<string, ItemDefinition>();
	for (const item of itemsArray) {
		itemsById.set(item.id, item);
		itemsByName.set(item.name, item);
	}

	const enchantmentsById = new Map<number, EnchantmentDefinition>();
	const enchantmentsByName = new Map<string, EnchantmentDefinition>();
	for (const ench of enchantmentsArray) {
		enchantmentsById.set(ench.id, ench);
		enchantmentsByName.set(ench.name, ench);
	}

	const foodsById = new Map<number, FoodDefinition>();
	const foodsByName = new Map<string, FoodDefinition>();
	for (const food of foodsArray) {
		foodsById.set(food.id, food);
		foodsByName.set(food.name, food);
	}

	const entitiesById = new Map<number, EntityDefinition>();
	const entitiesByName = new Map<string, EntityDefinition>();
	for (const ent of entitiesArray) {
		entitiesById.set(ent.id, ent);
		entitiesByName.set(ent.name, ent);
	}

	const effectsById = new Map<number, EffectDefinition>();
	const effectsByName = new Map<string, EffectDefinition>();
	for (const eff of effectsArray) {
		effectsById.set(eff.id, eff);
		effectsByName.set(eff.name, eff);
	}

	const attributesByName = new Map<string, AttributeDefinition>();
	for (const attr of attributesArray) {
		attributesByName.set(attr.name, attr);
	}

	// Parse version from the string
	const parts = (version ?? "1.21.11").split(".");
	const major = `${parts[0]}.${parts[1]}`;

	const versionInfo: VersionInfo = {
		type: "pc",
		majorVersion: major,
		minecraftVersion: version,
		version: 774, // TODO: extract from datagen
		dataVersion: 4384, // TODO: extract from datagen
	};

	// Version comparison (simple numeric comparison on dataVersion)
	const dataVersion = versionInfo.dataVersion ?? 0;
	const versionLookup: Record<string, number> = {
		"1.8": 100,
		"1.9": 169,
		"1.10": 510,
		"1.11": 819,
		"1.12": 1139,
		"1.13": 1519,
		"1.14": 1901,
		"1.15": 2225,
		"1.16": 2566,
		"1.17": 2724,
		"1.18": 2860,
		"1.19": 3105,
		"1.20": 3463,
		"1.20.4": 3700,
		"1.20.5": 3837,
		"1.21": 3953,
		"1.21.1": 3955,
		"1.21.11": 4384,
	};

	const isNewerOrEqualTo = (v: string) =>
		dataVersion >= (versionLookup[v] ?? 0);
	const isOlderThan = (v: string) =>
		dataVersion < (versionLookup[v] ?? Infinity);

	// Feature flags derived from version — mirrors prismarine-data features.json
	const featureMap: Record<string, unknown> = {
		// Window system
		"village&pillageInventoryWindows": isNewerOrEqualTo("1.14"),
		netherUpdateInventoryWindows: isNewerOrEqualTo("1.16"),
		shieldSlot: isNewerOrEqualTo("1.9"),
		// Item serialization
		itemSerializationUsesBlockId: isOlderThan("1.13"),
		nbtNameForEnchant: isNewerOrEqualTo("1.13") ? "Enchantments" : "ench",
		typeOfValueForEnchantLevel: isNewerOrEqualTo("1.13") ? "string" : "short",
		booksUseStoredEnchantments: true,
		whereDurabilityIsSerialized: isNewerOrEqualTo("1.13")
			? "Damage"
			: "metadata",
		spawnEggsHaveSpawnedEntityInName: isNewerOrEqualTo("1.13"),
		spawnEggsUseEntityTagInNbt: isOlderThan("1.13"),
		// Entity / network
		fixedPointPosition: isOlderThan("1.9"),
		fixedPointDelta128: isOlderThan("1.9"),
		entityVelocityIsLpVec3: isNewerOrEqualTo("1.21"),
		playerInfoActionIsBitfield: isNewerOrEqualTo("1.19"),
		armAnimationBeforeUse: isNewerOrEqualTo("1.9"),
		newPlayerInputPacket: isNewerOrEqualTo("1.21"),
		entityActionUsesStringMapper: isNewerOrEqualTo("1.21"),
		// Game / world
		spawnRespawnWorldDataField: isNewerOrEqualTo("1.21"),
		dimensionIsAnInt: isOlderThan("1.16"),
		dimensionIsAString: isNewerOrEqualTo("1.16") && isOlderThan("1.19"),
		dimensionIsAWorld: isNewerOrEqualTo("1.19"),
		segmentedRegistryCodecData: isNewerOrEqualTo("1.20.5"),
		customChannelMCPrefixed: isNewerOrEqualTo("1.13"), // true = uses "minecraft:" prefix (1.13+), false = uses "MC|" prefix
		// Inventory / blocks
		stateIdUsed: isNewerOrEqualTo("1.17"),
		useItemWithOwnPacket: isNewerOrEqualTo("1.9"),
		usesBlockStates: isNewerOrEqualTo("1.13"),
		usesMultiblockSingleLong: isNewerOrEqualTo("1.16"),
		blockPlaceHasInsideBlock: isNewerOrEqualTo("1.19"),
		blockPlaceHasHandAndFloatCursor:
			isNewerOrEqualTo("1.9") && isOlderThan("1.19"),
		blockPlaceHasHandAndIntCursor: isOlderThan("1.9"),
		// Chat
		chatPacketsUseNbtComponents: isNewerOrEqualTo("1.20"),
		// Physics
		independentLiquidGravity: isNewerOrEqualTo("1.13"),
		velocityBlocksOnTop: isNewerOrEqualTo("1.9"),
		climbUsingJump: isOlderThan("1.14"),
		climbableTrapdoor: isNewerOrEqualTo("1.9"),
		// Respawn
		respawnIsPayload: isNewerOrEqualTo("1.20"),
	};

	const supportFeature = (f: string): unknown => featureMap[f] ?? false;

	return {
		version: versionInfo,
		blocksById,
		blocksByName,
		blocksByStateId,
		blocksArray,
		biomesById,
		biomesByName,
		biomesArray,
		itemsById,
		itemsByName,
		itemsArray,
		enchantmentsById,
		enchantmentsByName,
		enchantmentsArray,
		foodsById,
		foodsByName,
		foodsArray,
		entitiesById,
		entitiesByName,
		entitiesArray,
		effectsById,
		effectsByName,
		effectsArray,
		attributesByName,
		attributesArray,
		blockCollisionShapes,
		materials: {} as Readonly<Record<string, Readonly<Record<number, number>>>>,
		recipes: loadRecipes(itemsByName),
		language: {},
		isNewerOrEqualTo,
		isOlderThan,
		supportFeature,
	};
};
