/**
 * Window module — functions for managing Minecraft inventory windows.
 * Replaces prismarine-windows/lib/Window.js with a functional API.
 */

import { createItem, itemsEqual } from "../item/item.ts";
import type { Item } from "../item/types.ts";
import { equalNbt } from "../nbt/nbt.ts";
import type { NbtTag } from "../nbt/types.ts";
import type { Registry } from "../registry/types.ts";
import type { Click, Window } from "./types.ts";

// ── Helper: create an item with a different count ──

const withCount = (registry: Registry, item: Item, count: number): Item =>
	createItem(
		registry,
		item.type,
		count,
		item.metadata,
		item.nbt,
		item.components,
		item.removedComponents,
	);

// ── Construction ──

/** Create a window with the given slot layout. */
export const createWindow = (
	id: number,
	type: number | string,
	title: string,
	slotCount: number,
	inventoryRange: { start: number; end: number },
	craftingResultSlot: number,
	requiresConfirmation: boolean,
): Window => {
	const inventoryEnd = inventoryRange.end + 1;
	return {
		id,
		type,
		title,
		slots: new Array<Item | null>(slotCount).fill(null),
		inventoryStart: inventoryRange.start,
		inventoryEnd,
		hotbarStart: inventoryEnd - 9,
		craftingResultSlot,
		requiresConfirmation,
		selectedItem: null,
		onSlotUpdate: null,
	};
};

// ── Slot management ──

/** Update a slot, firing the onSlotUpdate callback. */
export const updateSlot = (
	window: Window,
	slot: number,
	newItem: Item | null,
): void => {
	const oldItem = window.slots[slot] ?? null;
	window.slots[slot] = newItem;
	window.onSlotUpdate?.(slot, oldItem, newItem);
};

/** Fill matching stacks in range, then dump remainder to an empty slot. */
export const fillAndDump = (
	window: Window,
	registry: Registry,
	sourceSlot: number,
	start: number,
	end: number,
	lastToFirst = false,
): void => {
	const matchingSlots = findItemsRange(
		window,
		start,
		end,
		window.slots[sourceSlot]!.type,
		window.slots[sourceSlot]!.metadata,
		true,
		window.slots[sourceSlot]!.nbt,
		true,
	);
	fillSlotsWithItem(window, registry, matchingSlots, sourceSlot, lastToFirst);
	if (window.slots[sourceSlot]) {
		dumpItem(window, sourceSlot, start, end, lastToFirst);
	}
};

/** Fill target slots from source slot. */
export const fillSlotsWithItem = (
	window: Window,
	registry: Registry,
	targetSlots: number[],
	sourceSlot: number,
	lastToFirst = false,
): void => {
	while (targetSlots.length && window.slots[sourceSlot]) {
		const target = lastToFirst ? targetSlots.pop()! : targetSlots.shift()!;
		fillSlotWithItem(window, registry, target, sourceSlot);
	}
};

/** Transfer items between two slots (fill one from the other). */
export const fillSlotWithItem = (
	window: Window,
	registry: Registry,
	fillSlot: number,
	takeSlot: number,
): void => {
	const itemToFill = window.slots[fillSlot]!;
	const itemToTake = window.slots[takeSlot]!;
	const newCount = itemToFill.count + itemToTake.count;
	const leftover = newCount - itemToFill.stackSize;

	if (leftover <= 0) {
		updateSlot(window, fillSlot, withCount(registry, itemToFill, newCount));
		updateSlot(window, takeSlot, null);
	} else {
		updateSlot(
			window,
			fillSlot,
			withCount(registry, itemToFill, itemToFill.stackSize),
		);
		updateSlot(window, takeSlot, withCount(registry, itemToTake, leftover));
	}
};

/** Transfer from cursor (selectedItem) to a slot. */
export const fillSlotWithSelectedItem = (
	window: Window,
	registry: Registry,
	slot: number,
	untilFull: boolean,
): void => {
	const item = window.slots[slot]!;
	const selected = window.selectedItem!;

	if (untilFull) {
		const newCount = item.count + selected.count;
		const leftover = newCount - item.stackSize;
		if (leftover <= 0) {
			updateSlot(window, slot, withCount(registry, item, newCount));
			window.selectedItem = null;
		} else {
			updateSlot(window, slot, withCount(registry, item, item.stackSize));
			window.selectedItem = withCount(registry, selected, leftover);
		}
	} else {
		if (item.count + 1 <= item.stackSize) {
			updateSlot(window, slot, withCount(registry, item, item.count + 1));
			if (selected.count - 1 === 0) {
				window.selectedItem = null;
			} else {
				window.selectedItem = withCount(registry, selected, selected.count - 1);
			}
		}
	}
};

/** Move an item to the first empty slot in range. */
export const dumpItem = (
	window: Window,
	sourceSlot: number,
	start: number,
	end: number,
	lastToFirst = false,
): void => {
	const emptySlot = lastToFirst
		? lastEmptySlotRange(window, start, end)
		: firstEmptySlotRange(window, start, end);
	if (emptySlot !== null && emptySlot !== window.craftingResultSlot) {
		const item = window.slots[sourceSlot] ?? null;
		updateSlot(window, emptySlot, item);
		updateSlot(window, sourceSlot, null);
	}
};

/** Split a stack in half — half stays, half goes to cursor. */
export const splitSlot = (
	window: Window,
	registry: Registry,
	slot: number,
): void => {
	const item = window.slots[slot];
	if (!item) return;
	const cursorCount = Math.ceil(item.count / 2);
	window.selectedItem = withCount(registry, item, cursorCount);
	const remaining = item.count - cursorCount;
	if (remaining === 0) {
		updateSlot(window, slot, null);
	} else {
		updateSlot(window, slot, withCount(registry, item, remaining));
	}
};

/** Swap a slot's item with the cursor item. */
export const swapSelectedItem = (window: Window, slot: number): void => {
	const item = window.slots[slot] ?? null;
	updateSlot(window, slot, window.selectedItem);
	window.selectedItem = item;
};

/** Drop the cursor item. */
export const dropSelectedItem = (window: Window, untilEmpty: boolean): void => {
	if (untilEmpty || window.selectedItem!.count - 1 === 0) {
		window.selectedItem = null;
	} else {
		window.selectedItem = {
			...window.selectedItem!,
			count: window.selectedItem!.count - 1,
		};
	}
};

// ── Click handling ──

/** Accept a click and dispatch to the appropriate handler. */
export const acceptClick = (
	window: Window,
	registry: Registry,
	click: Click,
	gamemode = 0,
): number[] => {
	switch (click.mode) {
		case 0:
			return mouseClick(window, registry, click);
		case 1:
			shiftClick(window, registry, click);
			return [];
		case 2:
			numberClick(window, registry, click);
			return [];
		case 3:
			return middleClick(window, registry, click, gamemode);
		case 4:
			return dropClick(window, registry, click);
		default:
			return [];
	}
};

/** Mode 0: left/right click. */
export const mouseClick = (
	window: Window,
	registry: Registry,
	click: Click,
): number[] => {
	if (click.slot === -999) {
		dropSelectedItem(window, click.mouseButton === 0);
		return [];
	}

	const item = window.slots[click.slot];

	if (click.mouseButton === 0) {
		// Left click
		if (item && window.selectedItem) {
			if (itemsEqual(item, window.selectedItem, false)) {
				if (click.slot === window.craftingResultSlot) {
					const maxTransferrable =
						window.selectedItem.stackSize - window.selectedItem.count;
					if (item.count > maxTransferrable) {
						window.selectedItem = withCount(
							registry,
							window.selectedItem,
							window.selectedItem.count + maxTransferrable,
						);
						updateSlot(
							window,
							click.slot,
							withCount(registry, item, item.count - maxTransferrable),
						);
					} else {
						window.selectedItem = withCount(
							registry,
							window.selectedItem,
							window.selectedItem.count + item.count,
						);
						updateSlot(window, click.slot, null);
					}
				} else {
					fillSlotWithSelectedItem(window, registry, click.slot, true);
				}
			} else {
				swapSelectedItem(window, click.slot);
			}
			return [click.slot];
		}
		if (window.selectedItem || item) {
			swapSelectedItem(window, click.slot);
			return [click.slot];
		}
	} else if (click.mouseButton === 1) {
		// Right click
		if (window.selectedItem) {
			if (item) {
				if (itemsEqual(item, window.selectedItem, false)) {
					fillSlotWithSelectedItem(window, registry, click.slot, false);
				} else {
					swapSelectedItem(window, click.slot);
				}
			} else {
				// Place one into empty slot
				const newItem = withCount(registry, window.selectedItem, 0);
				updateSlot(window, click.slot, newItem);
				fillSlotWithSelectedItem(window, registry, click.slot, false);
			}
			return [click.slot];
		}
		if (item && click.slot !== window.craftingResultSlot) {
			splitSlot(window, registry, click.slot);
			return [click.slot];
		}
	}

	return [];
};

/** Mode 1: shift-click. */
export const shiftClick = (
	window: Window,
	registry: Registry,
	click: Click,
): void => {
	const item = window.slots[click.slot];
	if (!item) return;

	if (window.type === "minecraft:inventory") {
		if (click.slot < window.inventoryStart) {
			fillAndDump(
				window,
				registry,
				click.slot,
				window.inventoryStart,
				window.inventoryEnd,
				click.slot === window.craftingResultSlot,
			);
		} else if (click.slot < window.inventoryEnd - 10) {
			fillAndDump(
				window,
				registry,
				click.slot,
				window.hotbarStart,
				window.inventoryEnd,
			);
		} else {
			fillAndDump(
				window,
				registry,
				click.slot,
				window.inventoryStart,
				window.inventoryEnd,
			);
		}
	} else {
		if (click.slot < window.inventoryStart) {
			fillAndDump(
				window,
				registry,
				click.slot,
				window.inventoryStart,
				window.inventoryEnd,
				window.craftingResultSlot === -1 ||
					click.slot === window.craftingResultSlot,
			);
		} else {
			fillAndDump(window, registry, click.slot, 0, window.inventoryStart - 1);
		}
	}
};

/** Mode 2: number key click (hotbar swap). */
export const numberClick = (
	window: Window,
	registry: Registry,
	click: Click,
): void => {
	if (window.selectedItem) return;

	const item = window.slots[click.slot] ?? null;
	const hotbarSlot = window.hotbarStart + click.mouseButton;
	const itemAtHotbar = window.slots[hotbarSlot] ?? null;

	// Same slot click does nothing
	if (
		itemsEqual(item, itemAtHotbar) &&
		item !== null &&
		click.slot === hotbarSlot
	)
		return;

	if (item) {
		if (itemAtHotbar) {
			if (
				(window.type === "minecraft:inventory" ||
					registry.isNewerOrEqualTo("1.9")) &&
				click.slot !== window.craftingResultSlot
			) {
				// Swap the two items
				updateSlot(window, click.slot, itemAtHotbar);
				updateSlot(window, hotbarSlot, item);
			} else {
				// Dump hotbar item to make room, then move
				dumpItem(window, hotbarSlot, window.hotbarStart, window.inventoryEnd);
				if (window.slots[hotbarSlot]) {
					dumpItem(
						window,
						hotbarSlot,
						window.inventoryStart,
						window.hotbarStart - 1,
					);
				}
				if (window.slots[hotbarSlot] === null) {
					updateSlot(window, click.slot, null);
					updateSlot(window, hotbarSlot, item);
					// Consolidate the dumped item's stacks
					let slots = findItemsRange(
						window,
						window.hotbarStart,
						window.inventoryEnd,
						itemAtHotbar.type,
						itemAtHotbar.metadata,
						true,
						itemAtHotbar.nbt,
					);
					slots.push(
						...findItemsRange(
							window,
							window.inventoryStart,
							window.hotbarStart - 1,
							itemAtHotbar.type,
							itemAtHotbar.metadata,
							true,
							itemAtHotbar.nbt,
						),
					);
					// Filter out the slot where the original hotbar item was dumped
					const dumpedSlot = findItemRange(
						window,
						0,
						window.inventoryEnd,
						itemAtHotbar.type,
						itemAtHotbar.metadata,
						false,
						itemAtHotbar.nbt,
					);
					if (dumpedSlot !== null) {
						slots = slots.filter((s) => s !== dumpedSlot);
						fillSlotsWithItem(window, registry, slots, dumpedSlot);
					}
				}
			}
		} else {
			updateSlot(window, click.slot, null);
			updateSlot(window, hotbarSlot, item);
		}
	} else if (itemAtHotbar && click.slot !== window.craftingResultSlot) {
		updateSlot(window, click.slot, itemAtHotbar);
		updateSlot(window, hotbarSlot, null);
	}
};

/** Mode 3: middle click (creative pick). */
export const middleClick = (
	window: Window,
	registry: Registry,
	click: Click,
	gamemode: number,
): number[] => {
	if (window.selectedItem) return [];
	const item = window.slots[click.slot];
	if (gamemode === 1 && item) {
		window.selectedItem = withCount(registry, item, item.stackSize);
	}
	return [];
};

/** Mode 4: drop click. */
export const dropClick = (
	window: Window,
	registry: Registry,
	click: Click,
): number[] => {
	const item = window.slots[click.slot];
	if (window.selectedItem || item == null) return [];

	if (click.mouseButton === 0) {
		// Drop one
		if (item.count - 1 === 0) {
			updateSlot(window, click.slot, null);
		} else {
			updateSlot(window, click.slot, withCount(registry, item, item.count - 1));
		}
		return [click.slot];
	}
	if (click.mouseButton === 1) {
		// Drop all
		updateSlot(window, click.slot, null);
		return [click.slot];
	}

	return [];
};

// ── Search ──

/** Find the first matching item in a slot range. Returns slot index or null. */
export const findItemRange = (
	window: Window,
	start: number,
	end: number,
	itemType: number,
	metadata: number | null = null,
	notFull = false,
	nbt: NbtTag | null = null,
	skipCraftResult = false,
): number | null => {
	for (let i = start; i < end; i++) {
		const item = window.slots[i];
		if (
			item &&
			itemType === item.type &&
			(metadata === null || metadata === item.metadata) &&
			(!notFull || item.count < item.stackSize) &&
			(nbt === null || (item.nbt !== null && equalNbt(nbt, item.nbt))) &&
			!(i === window.craftingResultSlot && skipCraftResult)
		) {
			return i;
		}
	}
	return null;
};

/** Find all matching items in a slot range. Returns array of slot indices. */
export const findItemsRange = (
	window: Window,
	start: number,
	end: number,
	itemType: number,
	metadata: number | null = null,
	notFull = false,
	nbt: NbtTag | null = null,
	skipCraftResult = false,
): number[] => {
	const result: number[] = [];
	let pos = start;
	while (pos < end) {
		const found = findItemRange(
			window,
			pos,
			end,
			itemType,
			metadata,
			notFull,
			nbt,
			skipCraftResult,
		);
		if (found === null) break;
		result.push(found);
		pos = found + 1;
	}
	return result;
};

/** Find the first item matching by name in a slot range. Returns slot index or null. */
export const findItemRangeName = (
	window: Window,
	start: number,
	end: number,
	itemName: string,
	metadata: number | null = null,
	notFull = false,
): number | null => {
	for (let i = start; i < end; i++) {
		const item = window.slots[i];
		if (
			item &&
			itemName === item.name &&
			(metadata === null || metadata === item.metadata) &&
			(!notFull || item.count < item.stackSize)
		) {
			return i;
		}
	}
	return null;
};

/** Search the inventory section for a matching item. */
export const findInventoryItem = (
	window: Window,
	itemType: number | string,
	metadata: number | null = null,
	notFull = false,
): number | null =>
	typeof itemType === "number"
		? findItemRange(
				window,
				window.inventoryStart,
				window.inventoryEnd,
				itemType,
				metadata,
				notFull,
			)
		: findItemRangeName(
				window,
				window.inventoryStart,
				window.inventoryEnd,
				itemType,
				metadata,
				notFull,
			);

/** Search the container section for a matching item. */
export const findContainerItem = (
	window: Window,
	itemType: number | string,
	metadata: number | null = null,
	notFull = false,
): number | null =>
	typeof itemType === "number"
		? findItemRange(
				window,
				0,
				window.inventoryStart,
				itemType,
				metadata,
				notFull,
			)
		: findItemRangeName(
				window,
				0,
				window.inventoryStart,
				itemType,
				metadata,
				notFull,
			);

// ── Empty slot finders ──

/** Find the first empty slot in a range. */
export const firstEmptySlotRange = (
	window: Window,
	start: number,
	end: number,
): number | null => {
	for (let i = start; i < end; i++) {
		if (window.slots[i] === null) return i;
	}
	return null;
};

/** Find the last empty slot in a range. */
export const lastEmptySlotRange = (
	window: Window,
	start: number,
	end: number,
): number | null => {
	for (let i = end; i >= start; i--) {
		if (window.slots[i] === null) return i;
	}
	return null;
};

/** First empty hotbar slot. */
export const firstEmptyHotbarSlot = (window: Window): number | null =>
	firstEmptySlotRange(window, window.hotbarStart, window.inventoryEnd);

/** First empty container slot. */
export const firstEmptyContainerSlot = (window: Window): number | null =>
	firstEmptySlotRange(window, 0, window.inventoryStart);

/** First empty inventory slot. */
export const firstEmptyInventorySlot = (
	window: Window,
	hotbarFirst = true,
): number | null => {
	if (hotbarFirst) {
		const slot = firstEmptyHotbarSlot(window);
		if (slot !== null) return slot;
	}
	return firstEmptySlotRange(
		window,
		window.inventoryStart,
		window.inventoryEnd,
	);
};

// ── Counting & listing ──

/** Total item count in a range. */
export const sumRange = (
	window: Window,
	start: number,
	end: number,
): number => {
	let sum = 0;
	for (let i = start; i < end; i++) {
		const item = window.slots[i];
		if (item) sum += item.count;
	}
	return sum;
};

/** Count of a specific item type in a range. */
export const countRange = (
	window: Window,
	start: number,
	end: number,
	itemType: number,
	metadata: number | null = null,
): number => {
	let sum = 0;
	for (let i = start; i < end; i++) {
		const item = window.slots[i];
		if (
			item &&
			itemType === item.type &&
			(metadata === null || item.metadata === metadata)
		) {
			sum += item.count;
		}
	}
	return sum;
};

/** Count of an item in the inventory section. */
export const windowCount = (
	window: Window,
	itemType: number,
	metadata: number | null = null,
): number =>
	countRange(
		window,
		window.inventoryStart,
		window.inventoryEnd,
		itemType,
		metadata,
	);

/** Count of an item in the container section. */
export const containerCount = (
	window: Window,
	itemType: number,
	metadata: number | null = null,
): number => countRange(window, 0, window.inventoryStart, itemType, metadata);

/** All non-null items in a range. */
export const itemsRange = (
	window: Window,
	start: number,
	end: number,
): Item[] => {
	const result: Item[] = [];
	for (let i = start; i < end; i++) {
		const item = window.slots[i];
		if (item) result.push(item);
	}
	return result;
};

/** Items in the inventory section. */
export const windowItems = (window: Window): Item[] =>
	itemsRange(window, window.inventoryStart, window.inventoryEnd);

/** Items in the container section. */
export const containerItems = (window: Window): Item[] =>
	itemsRange(window, 0, window.inventoryStart);

/** Number of empty inventory slots. */
export const emptySlotCount = (window: Window): number => {
	let count = 0;
	for (let i = window.inventoryStart; i < window.inventoryEnd; i++) {
		if (window.slots[i] === null) count++;
	}
	return count;
};

// ── Misc ──

/** Whether transactions require server confirmation. */
export const transactionRequiresConfirmation = (window: Window): boolean =>
	window.requiresConfirmation;

/** Clear items from the inventory. Returns the number of items cleared. */
export const clearWindow = (
	window: Window,
	registry: Registry,
	blockId?: number,
	count?: number,
): number => {
	let clearedCount = 0;

	const iterSlot = (i: number): boolean => {
		const slot = window.slots[i];
		if (!slot || (blockId !== undefined && slot.type !== blockId)) return false;

		if (count !== undefined) {
			const blocksNeeded = count - clearedCount;
			if (slot.count > blocksNeeded) {
				clearedCount += blocksNeeded;
				updateSlot(
					window,
					i,
					withCount(registry, slot, slot.count - blocksNeeded),
				);
			} else {
				clearedCount += slot.count;
				updateSlot(window, i, null);
			}
			return count === clearedCount;
		}

		clearedCount += slot.count;
		updateSlot(window, i, null);
		return false;
	};

	// Clear hotbar first (from end), then rest of inventory
	for (let i = window.inventoryEnd; i > window.hotbarStart - 1; i--) {
		if (iterSlot(i)) return clearedCount;
	}
	if (count === undefined || clearedCount !== count) {
		for (let i = window.inventoryStart; i < window.hotbarStart; i++) {
			if (iterSlot(i)) return clearedCount;
		}
	}

	return clearedCount;
};
