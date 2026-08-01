import type { Item } from "../item/types.ts";

/** Window type definition — slot layout for a specific window kind. */
export type WindowInfo = {
	readonly type: number | string;
	readonly key: string;
	readonly inventory: { readonly start: number; readonly end: number };
	readonly slots: number;
	readonly craft: number;
	readonly requireConfirmation: boolean;
};

/** A click action on a window slot (mirrors wiki.vg Click Window packet). */
export type Click = {
	readonly mode: number;
	readonly mouseButton: number;
	readonly slot: number;
};

/** Callback fired when a slot is updated. */
export type SlotUpdateHandler = (
	slot: number,
	oldItem: Item | null,
	newItem: Item | null,
) => void;

/** A Minecraft inventory window — player inventory, chest, furnace, etc. */
export type Window = {
	id: number;
	type: number | string;
	title: string;
	slots: (Item | null)[];
	inventoryStart: number;
	inventoryEnd: number;
	hotbarStart: number;
	craftingResultSlot: number;
	requiresConfirmation: boolean;
	selectedItem: Item | null;
	onSlotUpdate: SlotUpdateHandler | null;
};

/** All known window type names (1.14+). */
export type WindowName =
	| "minecraft:inventory"
	| "minecraft:generic_9x1"
	| "minecraft:generic_9x2"
	| "minecraft:generic_9x3"
	| "minecraft:generic_9x4"
	| "minecraft:generic_9x5"
	| "minecraft:generic_9x6"
	| "minecraft:generic_3x3"
	| "minecraft:crafter_3x3"
	| "minecraft:anvil"
	| "minecraft:beacon"
	| "minecraft:blast_furnace"
	| "minecraft:brewing_stand"
	| "minecraft:crafting"
	| "minecraft:enchantment"
	| "minecraft:furnace"
	| "minecraft:grindstone"
	| "minecraft:hopper"
	| "minecraft:lectern"
	| "minecraft:loom"
	| "minecraft:merchant"
	| "minecraft:shulker_box"
	| "minecraft:smithing"
	| "minecraft:smoker"
	| "minecraft:cartography"
	| "minecraft:stonecutter";
