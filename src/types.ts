/**
 * Shared type definitions for Steve - Ender Dragon Speedrun Bot
 */

import type { Bot, Vec3 } from "typecraft";

/** Block object returned by bot.blockAt() / bot.findBlock() */
export type Block = {
	position: Vec3;
	name: string;
	stateId: number;
};

// ============================================
// TIER TYPES
// ============================================

export type PickaxeTier = "none" | "wood" | "stone" | "iron" | "diamond";
export type SwordTier = "none" | "wood" | "stone" | "iron" | "diamond";
export type ArmorTier = "none" | "leather" | "iron" | "diamond";
export type Dimension = "overworld" | "nether" | "end";

// ============================================
// INVENTORY & EQUIPMENT
// ============================================

export type Inventory = Readonly<{
	logs: number;
	planks: number;
	sticks: number;
	cobblestone: number;
	coal: number;
	ironOre: number;
	ironIngots: number;
	goldIngots: number;
	diamonds: number;
	obsidian: number;
	blazeRods: number;
	enderPearls: number;
	eyesOfEnder: number;
	food: number;
	arrows: number;
	blocks: number;
	beds: number;
	wool: number;
	string: number;
	flintAndSteel: number;
	gravel: number;
	flint: number;
}>;

export type Equipment = Readonly<{
	pickaxe: PickaxeTier;
	sword: SwordTier;
	armor: ArmorTier;
	hasCraftingTable: boolean;
	hasFurnace: boolean;
	hasBucket: boolean;
	hasWaterBucket: boolean;
	hasBow: boolean;
	hasShield: boolean;
}>;

// ============================================
// WORLD STATE
// ============================================

export type WorldState = Readonly<{
	dimension: Dimension;
	portalBuilt: boolean;
	portalLocation: { x: number; y: number; z: number } | null;
	fortressFound: boolean;
	fortressLocation: { x: number; y: number; z: number } | null;
	strongholdFound: boolean;
	strongholdLocation: { x: number; y: number; z: number } | null;
	portalActivated: boolean;
	crystalsDestroyed: number;
	dragonDead: boolean;
}>;

// ============================================
// GAME STATE
// ============================================

export type GameState = Readonly<{
	inventory: Inventory;
	equipment: Equipment;
	world: WorldState;
	health: number;
	food: number;
	position: { x: number; y: number; z: number };
	alive: boolean;
}>;

// ============================================
// PHASE
// ============================================

export type Phase =
	| "STARTING"
	| "WOOD"
	| "STONE"
	| "IRON"
	| "NETHER_PREP"
	| "NETHER"
	| "STRONGHOLD"
	| "END_PREP"
	| "END"
	| "VICTORY";

// ============================================
// STEP TYPES
// ============================================

export type StepResult =
	| { success: true; message: string }
	| { success: false; message: string };

export type Step = Readonly<{
	id: string;
	name: string;
	priority: number;
	canExecute: (state: GameState) => boolean;
	isComplete: (state: GameState) => boolean;
	execute: (bot: Bot, state: GameState) => Promise<StepResult>;
}>;
