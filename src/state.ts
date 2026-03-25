/**
 * GameState functions and state management
 * All functions are pure - no side effects, no mutations
 */

import type { Bot } from "typecraft";
import type {
	ArmorTier,
	Dimension,
	Equipment,
	GameState,
	Inventory,
	Phase,
	PickaxeTier,
	SwordTier,
	WorldState,
} from "./types.ts";

// Re-export types for convenience
export type { Equipment, GameState, Inventory, Phase, WorldState };

// ============================================
// INITIAL STATE
// ============================================

export const createInitialState = (): GameState => ({
	inventory: {
		logs: 0,
		planks: 0,
		sticks: 0,
		cobblestone: 0,
		coal: 0,
		ironOre: 0,
		ironIngots: 0,
		goldIngots: 0,
		diamonds: 0,
		obsidian: 0,
		blazeRods: 0,
		enderPearls: 0,
		eyesOfEnder: 0,
		food: 0,
		arrows: 0,
		blocks: 0,
		beds: 0,
		wool: 0,
		string: 0,
		flintAndSteel: 0,
		gravel: 0,
		flint: 0,
	},
	equipment: {
		pickaxe: "none",
		sword: "none",
		armor: "none",
		hasCraftingTable: false,
		hasFurnace: false,
		hasBucket: false,
		hasWaterBucket: false,
		hasBow: false,
		hasShield: false,
	},
	world: {
		dimension: "overworld",
		portalBuilt: false,
		portalLocation: null,
		fortressFound: false,
		fortressLocation: null,
		strongholdFound: false,
		strongholdLocation: null,
		portalActivated: false,
		crystalsDestroyed: 0,
		dragonDead: false,
	},
	health: 20,
	food: 20,
	position: { x: 0, y: 64, z: 0 },
	alive: true,
});

// ============================================
// PURE STATE UPDATERS
// ============================================

export const updateInventory = (
	state: GameState,
	updates: Partial<Inventory>,
): GameState => ({
	...state,
	inventory: { ...state.inventory, ...updates },
});

export const updateEquipment = (
	state: GameState,
	updates: Partial<Equipment>,
): GameState => ({
	...state,
	equipment: { ...state.equipment, ...updates },
});

export const updateWorld = (
	state: GameState,
	updates: Partial<WorldState>,
): GameState => ({
	...state,
	world: { ...state.world, ...updates },
});

// ============================================
// TIER HELPERS
// ============================================

const PICKAXE_TIERS: Record<PickaxeTier, number> = {
	none: 0,
	wood: 1,
	stone: 2,
	iron: 3,
	diamond: 4,
};

export const getPickaxeTier = (pick: PickaxeTier): number =>
	PICKAXE_TIERS[pick];

export const canMineStone = (state: GameState): boolean =>
	getPickaxeTier(state.equipment.pickaxe) >= 1;

export const canMineIron = (state: GameState): boolean =>
	getPickaxeTier(state.equipment.pickaxe) >= 2;

export const canMineDiamonds = (state: GameState): boolean =>
	getPickaxeTier(state.equipment.pickaxe) >= 3;

export const canMineObsidian = (state: GameState): boolean =>
	getPickaxeTier(state.equipment.pickaxe) >= 4;

// ============================================
// PHASE DETECTION
// ============================================

export const getPhase = (state: GameState): Phase => {
	if (state.world.dragonDead) return "VICTORY";
	if (state.world.dimension === "end") return "END";
	if (state.world.portalActivated) return "END_PREP";
	if (state.world.strongholdFound) return "STRONGHOLD";
	if (state.world.dimension === "nether") return "NETHER";
	if (state.world.portalBuilt) return "NETHER_PREP";
	if (getPickaxeTier(state.equipment.pickaxe) >= 3) return "IRON";
	if (getPickaxeTier(state.equipment.pickaxe) >= 2) return "STONE";
	if (state.inventory.logs > 0 || state.equipment.hasCraftingTable) {
		return "WOOD";
	}
	return "STARTING";
};

export const isDragonDead = (state: GameState): boolean =>
	state.world.dragonDead;

// ============================================
// SYNC FROM BOT (reads mineflayer state)
// ============================================

export const syncFromBot = (bot: Bot): GameState => {
	const allSlots = bot.inventory?.slots ?? [];
	const registry = bot.registry;

	// Resolve item name — use registry if item.name is "unknown"
	const itemName = (item: { name: string; type: number }): string => {
		if (item.name !== "unknown") return item.name;
		if (registry) {
			const def = registry.itemsById.get(item.type);
			if (def) return def.name;
		}
		return "unknown";
	};

	const countItem = (name: string): number => {
		let total = 0;
		for (const item of allSlots) {
			if (item && item.count > 0 && itemName(item).includes(name)) {
				total += item.count;
			}
		}
		return total;
	};

	const hasItem = (name: string): boolean =>
		allSlots.some(
			(item) => item && item.count > 0 && itemName(item).includes(name),
		);

	// Detect best pickaxe
	const getPickaxe = (): PickaxeTier => {
		if (hasItem("diamond_pickaxe")) return "diamond";
		if (hasItem("iron_pickaxe")) return "iron";
		if (hasItem("stone_pickaxe")) return "stone";
		if (hasItem("wooden_pickaxe")) return "wood";
		return "none";
	};

	// Detect best sword
	const getSword = (): SwordTier => {
		if (hasItem("diamond_sword")) return "diamond";
		if (hasItem("iron_sword")) return "iron";
		if (hasItem("stone_sword")) return "stone";
		if (hasItem("wooden_sword")) return "wood";
		return "none";
	};

	// Detect armor (simplified - just check for any iron/diamond)
	const getArmor = (): ArmorTier => {
		if (hasItem("diamond_chestplate") || hasItem("diamond_leggings")) {
			return "diamond";
		}
		if (hasItem("iron_chestplate") || hasItem("iron_leggings")) return "iron";
		if (hasItem("leather_chestplate")) return "leather";
		return "none";
	};

	// Detect dimension
	const getDimension = (): Dimension => {
		const dim = String(bot.game.dimension);
		if (dim.includes("nether")) return "nether";
		if (dim.includes("end")) return "end";
		return "overworld";
	};

	return {
		inventory: {
			logs: countItem("_log"),
			planks: countItem("_planks"),
			sticks: countItem("stick"),
			cobblestone: countItem("cobblestone"),
			coal: countItem("coal"),
			ironOre: countItem("raw_iron"),
			ironIngots: countItem("iron_ingot"),
			goldIngots: countItem("gold_ingot"),
			diamonds: countItem("diamond") - countItem("diamond_"), // exclude tools
			obsidian: countItem("obsidian"),
			blazeRods: countItem("blaze_rod"),
			enderPearls: countItem("ender_pearl"),
			eyesOfEnder: countItem("ender_eye"),
			food: countItem("cooked_") + countItem("bread") + countItem("apple"),
			arrows: countItem("arrow"),
			blocks:
				countItem("cobblestone") + countItem("dirt") + countItem("netherrack"),
			beds: countItem("_bed"),
			wool: countItem("_wool"),
			string: countItem("string"),
			flintAndSteel: countItem("flint_and_steel"),
			gravel: countItem("gravel"),
			flint: countItem("flint"),
		},
		equipment: {
			pickaxe: getPickaxe(),
			sword: getSword(),
			armor: getArmor(),
			hasCraftingTable: hasItem("crafting_table"),
			hasFurnace: hasItem("furnace"),
			hasBucket:
				hasItem("bucket") || hasItem("water_bucket") || hasItem("lava_bucket"),
			hasWaterBucket: hasItem("water_bucket"),
			hasBow: hasItem("bow"),
			hasShield: hasItem("shield"),
		},
		world: {
			dimension: getDimension(),
			portalBuilt: false, // Can't easily detect from inventory
			portalLocation: null,
			fortressFound: false,
			fortressLocation: null,
			strongholdFound: false,
			strongholdLocation: null,
			portalActivated: false,
			crystalsDestroyed: 0,
			dragonDead: false,
		},
		health: bot.health ?? 20,
		food: bot.food ?? 20,
		position: bot.entity?.position
			? {
					x: bot.entity.position.x,
					y: bot.entity.position.y,
					z: bot.entity.position.z,
				}
			: { x: 0, y: 64, z: 0 },
		alive: bot.health > 0,
	};
};
