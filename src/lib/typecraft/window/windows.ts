/**
 * Window type definitions — version-aware slot layouts for all Minecraft window types.
 * Replaces the loader logic from prismarine-windows/index.js.
 */

import type { Registry } from "../registry/types.ts";
import type { Window, WindowInfo } from "./types.ts";
import { createWindow } from "./window.ts";

/** Build the version-specific window type registry. */
export const getWindowTypes = (
	registry: Registry,
): Record<string, WindowInfo> => {
	if (registry.supportFeature("village&pillageInventoryWindows")) {
		return getModernWindowTypes(registry);
	}
	return getLegacyWindowTypes(registry);
};

const getModernWindowTypes = (
	registry: Registry,
): Record<string, WindowInfo> => {
	const windows: Record<string, WindowInfo> = {};
	let protocolId = -1;

	const add = (
		key: string,
		inventory: { start: number; end: number },
		slots: number,
		craft: number,
		requireConfirmation = true,
	): void => {
		windows[key] = {
			type: protocolId++,
			key,
			inventory,
			slots,
			craft,
			requireConfirmation,
		};
	};

	add("minecraft:inventory", { start: 9, end: 44 }, 46, 0);
	add("minecraft:generic_9x1", { start: 9, end: 9 + 35 }, 9 + 36, -1);
	add("minecraft:generic_9x2", { start: 18, end: 18 + 35 }, 18 + 36, -1);
	add("minecraft:generic_9x3", { start: 27, end: 27 + 35 }, 27 + 36, -1);
	add("minecraft:generic_9x4", { start: 36, end: 36 + 35 }, 36 + 36, -1);
	add("minecraft:generic_9x5", { start: 45, end: 45 + 35 }, 45 + 36, -1);
	add("minecraft:generic_9x6", { start: 54, end: 54 + 35 }, 54 + 36, -1);
	add("minecraft:generic_3x3", { start: 9, end: 9 + 35 }, 9 + 36, -1);

	if (registry.isNewerOrEqualTo("1.20.3")) {
		add("minecraft:crafter_3x3", { start: 10, end: 45 }, 46, -1);
	}

	add("minecraft:anvil", { start: 3, end: 38 }, 39, 2);
	add("minecraft:beacon", { start: 1, end: 36 }, 37, -1);
	add("minecraft:blast_furnace", { start: 3, end: 38 }, 39, 2);
	add("minecraft:brewing_stand", { start: 5, end: 40 }, 41, -1);
	add("minecraft:crafting", { start: 10, end: 45 }, 46, 0);
	add("minecraft:enchantment", { start: 2, end: 37 }, 38, -1);
	add("minecraft:furnace", { start: 3, end: 38 }, 39, 2);
	add("minecraft:grindstone", { start: 3, end: 38 }, 39, 2);
	add("minecraft:hopper", { start: 5, end: 40 }, 41, -1);
	add("minecraft:lectern", { start: 1, end: 36 }, 37, -1);
	add("minecraft:loom", { start: 4, end: 39 }, 40, 3);
	add("minecraft:merchant", { start: 3, end: 38 }, 39, 2);
	add("minecraft:shulker_box", { start: 27, end: 62 }, 63, -1);

	if (registry.supportFeature("netherUpdateInventoryWindows")) {
		add("minecraft:smithing", { start: 3, end: 38 }, 39, 2);
	}

	add("minecraft:smoker", { start: 3, end: 38 }, 39, 2);
	add("minecraft:cartography", { start: 3, end: 38 }, 39, 2);
	add("minecraft:stonecutter", { start: 2, end: 37 }, 38, 1);

	return windows;
};

const getLegacyWindowTypes = (
	registry: Registry,
): Record<string, WindowInfo> => {
	const inventorySlots = registry.supportFeature("shieldSlot") ? 46 : 45;
	const mk = (
		key: string,
		inventory: { start: number; end: number },
		slots: number,
		craft: number,
	): WindowInfo => ({
		type: key,
		key,
		inventory,
		slots,
		craft,
		requireConfirmation: true,
	});

	return {
		"minecraft:inventory": mk(
			"minecraft:inventory",
			{ start: 9, end: 44 },
			inventorySlots,
			0,
		),
		"minecraft:crafting_table": mk(
			"minecraft:crafting_table",
			{ start: 10, end: 45 },
			46,
			0,
		),
		"minecraft:furnace": mk("minecraft:furnace", { start: 3, end: 38 }, 39, 2),
		"minecraft:dispenser": mk(
			"minecraft:dispenser",
			{ start: 9, end: 9 + 35 },
			9 + 36,
			-1,
		),
		"minecraft:enchanting_table": mk(
			"minecraft:enchanting_table",
			{ start: 2, end: 37 },
			38,
			-1,
		),
		"minecraft:brewing_stand": mk(
			"minecraft:brewing_stand",
			{ start: 5, end: 40 },
			41,
			-1,
		),
		"minecraft:villager": mk(
			"minecraft:villager",
			{ start: 3, end: 38 },
			39,
			2,
		),
		"minecraft:beacon": mk("minecraft:beacon", { start: 1, end: 36 }, 37, -1),
		"minecraft:anvil": mk("minecraft:anvil", { start: 3, end: 38 }, 39, 2),
		"minecraft:hopper": mk("minecraft:hopper", { start: 5, end: 40 }, 41, -1),
		"minecraft:dropper": mk(
			"minecraft:dropper",
			{ start: 9, end: 9 + 35 },
			9 + 36,
			-1,
		),
		"minecraft:shulker_box": mk(
			"minecraft:shulker_box",
			{ start: 27, end: 62 },
			63,
			-1,
		),
	};
};

/** Create a window from a type identifier, using version-specific window data. */
export const createWindowFromType = (
	registry: Registry,
	id: number,
	type: number | string,
	title: string,
	slotCount?: number,
): Window | null => {
	const windowTypes = getWindowTypes(registry);

	// Look up by type value (numeric protocol ID) or by key (string name)
	let winData: WindowInfo | undefined;
	for (const info of Object.values(windowTypes)) {
		if (info.type === type) {
			winData = info;
			break;
		}
	}
	winData ??= windowTypes[type as string];

	if (!winData) {
		if (slotCount === undefined) return null;
		return createWindow(
			id,
			type,
			title,
			slotCount + 36,
			{ start: slotCount, end: slotCount + 35 },
			-1,
			type !== "minecraft:container",
		);
	}

	return createWindow(
		id,
		winData.key,
		title,
		winData.slots,
		winData.inventory,
		winData.craft,
		winData.requireConfirmation,
	);
};
