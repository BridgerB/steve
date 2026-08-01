import { describe, expect, it } from "vitest";
import { createItem } from "../item/index.ts";
import type { Item } from "../item/types.ts";
import { createRegistry } from "../registry/index.ts";
import type { Registry } from "../registry/types.ts";
import {
	acceptClick,
	clearWindow,
	containerCount,
	containerItems,
	countRange,
	createWindowFromType,
	dropClick,
	emptySlotCount,
	findContainerItem,
	findInventoryItem,
	findItemRange,
	findItemRangeName,
	findItemsRange,
	firstEmptyContainerSlot,
	firstEmptyHotbarSlot,
	firstEmptyInventorySlot,
	firstEmptySlotRange,
	getWindowTypes,
	itemsRange,
	lastEmptySlotRange,
	middleClick,
	mouseClick,
	numberClick,
	shiftClick,
	splitSlot,
	sumRange,
	transactionRequiresConfirmation,
	updateSlot,
	windowCount,
	windowItems,
} from "./index.ts";
import type { Window } from "./types.ts";

// ── Helpers ──

const reg = createRegistry("1.21.11");

const mkItem = (registry: Registry, typeId: number, count: number): Item =>
	createItem(registry, typeId, count);

const mkChestWindow = (registry: Registry): Window => {
	const win = createWindowFromType(
		registry,
		1,
		"minecraft:generic_9x3",
		"Chest",
	)!;
	expect(win).not.toBeNull();
	return win;
};

const mkInventoryWindow = (registry: Registry): Window => {
	const win = createWindowFromType(
		registry,
		0,
		"minecraft:inventory",
		"Inventory",
	)!;
	expect(win).not.toBeNull();
	return win;
};

// ── Window type definitions ──

describe("window types", () => {
	it("returns modern window types", () => {
		const types = getWindowTypes(reg);
		expect(types["minecraft:inventory"]).toBeDefined();
		expect(types["minecraft:crafting"]).toBeDefined();
		expect(types["minecraft:generic_9x3"]).toBeDefined();
		expect(types["minecraft:furnace"]).toBeDefined();
		// Modern types use numeric protocol IDs
		expect(typeof types["minecraft:inventory"].type).toBe("number");
		expect(typeof types["minecraft:furnace"].type).toBe("number");
	});

	it("includes crafter for 1.21.11", () => {
		const types = getWindowTypes(reg);
		expect(types["minecraft:crafter_3x3"]).toBeDefined();
	});

	it("includes smithing table", () => {
		const types = getWindowTypes(reg);
		expect(types["minecraft:smithing"]).toBeDefined();
	});
});

// ── Window creation ──

describe("createWindowFromType", () => {
	it("creates a chest window", () => {
		const win = mkChestWindow(reg);
		expect(win.slots).toHaveLength(63);
		expect(win.inventoryStart).toBe(27);
		expect(win.inventoryEnd).toBe(63);
		expect(win.hotbarStart).toBe(54);
		expect(win.craftingResultSlot).toBe(-1);
	});

	it("creates an inventory window", () => {
		const win = mkInventoryWindow(reg);
		expect(win.slots).toHaveLength(46);
		expect(win.inventoryStart).toBe(9);
		expect(win.inventoryEnd).toBe(45);
		expect(win.craftingResultSlot).toBe(0);
	});

	it("returns null for unknown type without slotCount", () => {
		const win = createWindowFromType(reg, 1, "minecraft:unknown", "Test");
		expect(win).toBeNull();
	});

	it("creates fallback window with slotCount", () => {
		const win = createWindowFromType(reg, 1, "minecraft:container", "Test", 27);
		expect(win).not.toBeNull();
		expect(win!.slots).toHaveLength(63);
		expect(win!.inventoryStart).toBe(27);
	});
});

// ── updateSlot ──

describe("updateSlot", () => {
	it("sets a slot and fires callback", () => {
		const win = mkChestWindow(reg);
		const updates: {
			slot: number;
			oldItem: Item | null;
			newItem: Item | null;
		}[] = [];
		win.onSlotUpdate = (slot, oldItem, newItem) => {
			updates.push({ slot, oldItem, newItem });
		};

		const item = mkItem(reg, 1, 64);
		updateSlot(win, 0, item);

		expect(win.slots[0]).toBe(item);
		expect(updates).toHaveLength(1);
		expect(updates[0].slot).toBe(0);
		expect(updates[0].oldItem).toBeNull();
		expect(updates[0].newItem).toBe(item);
	});

	it("replaces an existing item", () => {
		const win = mkChestWindow(reg);
		const item1 = mkItem(reg, 1, 32);
		const item2 = mkItem(reg, 2, 16);
		updateSlot(win, 5, item1);
		updateSlot(win, 5, item2);

		expect(win.slots[5]).toBe(item2);
	});
});

// ── Click mode 0: mouse click ──

describe("mouseClick", () => {
	it("picks up item with left click", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		const changed = mouseClick(win, reg, {
			mode: 0,
			mouseButton: 0,
			slot: 0,
		});

		expect(win.slots[0]).toBeNull();
		expect(win.selectedItem).not.toBeNull();
		expect(win.selectedItem!.count).toBe(64);
		expect(changed).toContain(0);
	});

	it("places selected item into empty slot with left click", () => {
		const win = mkChestWindow(reg);
		win.selectedItem = mkItem(reg, 1, 1);

		mouseClick(win, reg, { mode: 0, mouseButton: 0, slot: 0 });

		expect(win.slots[0]).not.toBeNull();
		expect(win.slots[0]!.count).toBe(1);
		expect(win.selectedItem).toBeNull();
	});

	it("stacks compatible items with left click", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 60));
		win.selectedItem = mkItem(reg, 1, 64);

		mouseClick(win, reg, { mode: 0, mouseButton: 0, slot: 0 });

		expect(win.slots[0]!.count).toBe(64);
		expect(win.selectedItem!.count).toBe(60);
	});

	it("swaps different items with left click", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));
		win.selectedItem = mkItem(reg, 2, 32);

		mouseClick(win, reg, { mode: 0, mouseButton: 0, slot: 0 });

		expect(win.slots[0]!.type).toBe(2);
		expect(win.selectedItem!.type).toBe(1);
	});

	it("right click drops one into empty slot", () => {
		const win = mkChestWindow(reg);
		win.selectedItem = mkItem(reg, 1, 64);

		mouseClick(win, reg, { mode: 0, mouseButton: 1, slot: 0 });

		expect(win.slots[0]!.count).toBe(1);
		expect(win.selectedItem!.count).toBe(63);
	});

	it("right click drops one into same-type slot", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 1));
		win.selectedItem = mkItem(reg, 1, 64);

		mouseClick(win, reg, { mode: 0, mouseButton: 1, slot: 0 });

		expect(win.slots[0]!.count).toBe(2);
		expect(win.selectedItem!.count).toBe(63);
	});

	it("right click splits stack when no selected item", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		mouseClick(win, reg, { mode: 0, mouseButton: 1, slot: 0 });

		expect(win.slots[0]!.count).toBe(32);
		expect(win.selectedItem!.count).toBe(32);
	});

	it("drops last selected item into empty slot", () => {
		const win = mkChestWindow(reg);
		win.selectedItem = mkItem(reg, 1, 1);

		mouseClick(win, reg, { mode: 0, mouseButton: 1, slot: 0 });

		expect(win.slots[0]!.count).toBe(1);
		expect(win.selectedItem).toBeNull();
	});
});

// ── Click mode 1: shift click ──

describe("shiftClick", () => {
	it("shifts item from container to inventory", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		shiftClick(win, reg, { mode: 1, mouseButton: 0, slot: 0 });

		expect(win.slots[0]).toBeNull();
		// Should be in the inventory section (last hotbar slot)
		const invItems = windowItems(win);
		expect(invItems).toHaveLength(1);
		expect(invItems[0].count).toBe(64);
	});

	it("shifts item from inventory to container", () => {
		const win = mkChestWindow(reg);
		const lastSlot = win.inventoryEnd - 1;
		updateSlot(win, lastSlot, mkItem(reg, 1, 64));

		shiftClick(win, reg, { mode: 1, mouseButton: 0, slot: lastSlot });

		expect(win.slots[lastSlot]).toBeNull();
		expect(win.slots[0]!.count).toBe(64);
	});
});

// ── Click mode 2: number click ──

describe("numberClick", () => {
	it("swaps container slot with hotbar", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		numberClick(win, reg, { mode: 2, mouseButton: 0, slot: 0 });

		expect(win.slots[0]).toBeNull();
		expect(win.slots[win.hotbarStart]!.count).toBe(64);
	});

	it("swaps hotbar into empty container slot", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, win.hotbarStart, mkItem(reg, 1, 64));

		numberClick(win, reg, { mode: 2, mouseButton: 0, slot: 0 });

		expect(win.slots[0]!.count).toBe(64);
		expect(win.slots[win.hotbarStart]).toBeNull();
	});

	it("same slot click does nothing", () => {
		const win = mkChestWindow(reg);
		const hotbarEnd = win.inventoryEnd - 1;
		updateSlot(win, hotbarEnd, mkItem(reg, 1, 64));

		numberClick(win, reg, { mode: 2, mouseButton: 8, slot: hotbarEnd });

		expect(win.slots[hotbarEnd]!.count).toBe(64);
	});
});

// ── Click mode 3: middle click ──

describe("middleClick", () => {
	it("does nothing in survival mode", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 1));

		middleClick(win, reg, { mode: 3, mouseButton: 2, slot: 0 }, 0);

		expect(win.selectedItem).toBeNull();
	});

	it("picks full stack in creative mode", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 1));

		middleClick(win, reg, { mode: 3, mouseButton: 2, slot: 0 }, 1);

		expect(win.selectedItem).not.toBeNull();
		expect(win.selectedItem!.count).toBe(win.selectedItem!.stackSize);
	});
});

// ── Click mode 4: drop click ──

describe("dropClick", () => {
	it("drops one item", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		const changed = dropClick(win, reg, {
			mode: 4,
			mouseButton: 0,
			slot: 0,
		});

		expect(win.slots[0]!.count).toBe(63);
		expect(changed).toContain(0);
	});

	it("drops entire stack", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		dropClick(win, reg, { mode: 4, mouseButton: 1, slot: 0 });

		expect(win.slots[0]).toBeNull();
	});

	it("does nothing with selected item", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));
		win.selectedItem = mkItem(reg, 2, 1);

		const changed = dropClick(win, reg, {
			mode: 4,
			mouseButton: 0,
			slot: 0,
		});

		expect(changed).toHaveLength(0);
		expect(win.slots[0]!.count).toBe(64);
	});
});

// ── acceptClick dispatch ──

describe("acceptClick", () => {
	it("dispatches mode 0", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		const changed = acceptClick(win, reg, {
			mode: 0,
			mouseButton: 0,
			slot: 0,
		});

		expect(win.selectedItem).not.toBeNull();
		expect(changed).toContain(0);
	});

	it("returns changed slots from mouse click", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		const changed = acceptClick(win, reg, {
			mode: 0,
			mouseButton: 0,
			slot: 0,
		});

		expect(changed).toEqual([0]);
	});
});

// ── Search functions ──

describe("search", () => {
	it("findItemRange finds matching item", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 5, mkItem(reg, 1, 32));

		const slot = findItemRange(win, 0, 27, 1);
		expect(slot).toBe(5);
	});

	it("findItemRange returns null when not found", () => {
		const win = mkChestWindow(reg);
		const slot = findItemRange(win, 0, 27, 1);
		expect(slot).toBeNull();
	});

	it("findItemsRange finds all matching items", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 2, mkItem(reg, 1, 32));
		updateSlot(win, 7, mkItem(reg, 1, 16));
		updateSlot(win, 10, mkItem(reg, 2, 64));

		const slots = findItemsRange(win, 0, 27, 1);
		expect(slots).toEqual([2, 7]);
	});

	it("findItemRangeName finds by name", () => {
		const win = mkChestWindow(reg);
		const item = mkItem(reg, 1, 1);
		updateSlot(win, 3, item);

		const slot = findItemRangeName(win, 0, 27, item.name);
		expect(slot).toBe(3);
	});

	it("findInventoryItem searches inventory", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, win.inventoryStart + 5, mkItem(reg, 1, 10));

		const slot = findInventoryItem(win, 1);
		expect(slot).toBe(win.inventoryStart + 5);
	});

	it("findContainerItem searches container", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 3, mkItem(reg, 1, 10));

		const slot = findContainerItem(win, 1);
		expect(slot).toBe(3);
	});

	it("findItemRange respects notFull", () => {
		const win = mkChestWindow(reg);
		const fullItem = mkItem(reg, 1, 64); // stackSize is 64
		updateSlot(win, 0, fullItem);
		updateSlot(win, 1, mkItem(reg, 1, 32));

		const slot = findItemRange(win, 0, 27, 1, null, true);
		expect(slot).toBe(1);
	});

	it("findItemRange respects metadata", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, createItem(reg, 1, 64, 1));
		updateSlot(win, 1, createItem(reg, 1, 64, 2));

		const slot = findItemRange(win, 0, 27, 1, 2);
		expect(slot).toBe(1);
	});
});

// ── Empty slot finders ──

describe("empty slot finders", () => {
	it("firstEmptySlotRange", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 1));
		updateSlot(win, 1, mkItem(reg, 1, 1));

		expect(firstEmptySlotRange(win, 0, 27)).toBe(2);
	});

	it("lastEmptySlotRange", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 26, mkItem(reg, 1, 1));

		expect(lastEmptySlotRange(win, 0, 26)).toBe(25);
	});

	it("firstEmptyHotbarSlot", () => {
		const win = mkChestWindow(reg);
		expect(firstEmptyHotbarSlot(win)).toBe(win.hotbarStart);
	});

	it("firstEmptyContainerSlot", () => {
		const win = mkChestWindow(reg);
		expect(firstEmptyContainerSlot(win)).toBe(0);
	});

	it("firstEmptyInventorySlot prefers hotbar", () => {
		const win = mkChestWindow(reg);
		expect(firstEmptyInventorySlot(win)).toBe(win.hotbarStart);
	});

	it("firstEmptyInventorySlot skips hotbar when told", () => {
		const win = mkChestWindow(reg);
		expect(firstEmptyInventorySlot(win, false)).toBe(win.inventoryStart);
	});
});

// ── Counting ──

describe("counting", () => {
	it("sumRange totals item counts", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 32));
		updateSlot(win, 1, mkItem(reg, 2, 16));

		expect(sumRange(win, 0, 27)).toBe(48);
	});

	it("countRange counts specific item type", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 32));
		updateSlot(win, 1, mkItem(reg, 2, 16));
		updateSlot(win, 2, mkItem(reg, 1, 8));

		expect(countRange(win, 0, 27, 1)).toBe(40);
	});

	it("windowCount counts inventory section", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, win.inventoryStart, mkItem(reg, 1, 20));

		expect(windowCount(win, 1)).toBe(20);
	});

	it("containerCount counts container section", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 10));

		expect(containerCount(win, 1)).toBe(10);
	});

	it("emptySlotCount", () => {
		const win = mkChestWindow(reg);
		const totalInv = win.inventoryEnd - win.inventoryStart;
		expect(emptySlotCount(win)).toBe(totalInv);

		updateSlot(win, win.inventoryStart, mkItem(reg, 1, 1));
		expect(emptySlotCount(win)).toBe(totalInv - 1);
	});
});

// ── Listing ──

describe("listing", () => {
	it("itemsRange returns non-null items", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 10));
		updateSlot(win, 5, mkItem(reg, 2, 20));

		const items = itemsRange(win, 0, 27);
		expect(items).toHaveLength(2);
	});

	it("windowItems returns inventory items", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, win.inventoryStart, mkItem(reg, 1, 5));

		expect(windowItems(win)).toHaveLength(1);
	});

	it("containerItems returns container items", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 5));
		updateSlot(win, 3, mkItem(reg, 2, 10));

		expect(containerItems(win)).toHaveLength(2);
	});
});

// ── Misc ──

describe("misc", () => {
	it("transactionRequiresConfirmation", () => {
		const win = mkChestWindow(reg);
		expect(transactionRequiresConfirmation(win)).toBe(true);
	});

	it("clearWindow clears all items", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, win.inventoryStart, mkItem(reg, 1, 32));
		updateSlot(win, win.hotbarStart, mkItem(reg, 2, 16));

		const cleared = clearWindow(win, reg);

		expect(cleared).toBe(48);
		expect(windowItems(win)).toHaveLength(0);
	});

	it("clearWindow clears specific block type", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, win.inventoryStart, mkItem(reg, 1, 32));
		updateSlot(win, win.hotbarStart, mkItem(reg, 2, 16));

		const cleared = clearWindow(win, reg, 1);

		expect(cleared).toBe(32);
		// Type 2 should still be there
		expect(win.slots[win.hotbarStart]).not.toBeNull();
	});

	it("clearWindow with count limit", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, win.hotbarStart, mkItem(reg, 1, 64));

		const cleared = clearWindow(win, reg, 1, 10);

		expect(cleared).toBe(10);
		expect(win.slots[win.hotbarStart]!.count).toBe(54);
	});
});

// ── splitSlot ──

describe("splitSlot", () => {
	it("splits even stack", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 64));

		splitSlot(win, reg, 0);

		expect(win.slots[0]!.count).toBe(32);
		expect(win.selectedItem!.count).toBe(32);
	});

	it("splits odd stack (cursor gets more)", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 3));

		splitSlot(win, reg, 0);

		expect(win.slots[0]!.count).toBe(1);
		expect(win.selectedItem!.count).toBe(2);
	});

	it("splits single item (slot becomes empty)", () => {
		const win = mkChestWindow(reg);
		updateSlot(win, 0, mkItem(reg, 1, 1));

		splitSlot(win, reg, 0);

		expect(win.slots[0]).toBeNull();
		expect(win.selectedItem!.count).toBe(1);
	});
});
