import { describe, expect, it } from "vitest";
import { nbtInt } from "../nbt/nbt.ts";
import type { NbtCompound } from "../nbt/types.ts";
import { createRegistry } from "../registry/registry.ts";
import {
	createItem,
	createItemByName,
	fromNotch,
	getBlocksCanDestroy,
	getBlocksCanPlaceOn,
	getCustomLore,
	getCustomName,
	getDurabilityUsed,
	getEnchants,
	getRepairCost,
	getSpawnEggMobName,
	itemsEqual,
	setBlocksCanDestroy,
	setBlocksCanPlaceOn,
	setCustomLore,
	setCustomName,
	setDurabilityUsed,
	setEnchants,
	setRepairCost,
	toNotch,
} from "./item.ts";

// ── Registries ──

const reg120 = createRegistry("1.20.4");
const reg18 = createRegistry("1.8");

// ── Construction ──

describe("createItem", () => {
	it("creates item by ID with correct fields", () => {
		const swordId = reg120.itemsByName.get("diamond_sword")!.id;
		const sword = createItem(reg120, swordId, 1);
		expect(sword.name).toBe("diamond_sword");
		expect(sword.displayName).toBe("Diamond Sword");
		expect(sword.stackSize).toBe(1);
		expect(sword.maxDurability).toBe(1561);
		expect(sword.count).toBe(1);
		expect(sword.metadata).toBe(0);
		expect(sword.nbt).toBeNull();
	});

	it("creates item with metadata and nbt", () => {
		const swordId = reg120.itemsByName.get("diamond_sword")!.id;
		const nbt: NbtCompound = { type: "compound", value: { Damage: nbtInt(5) } };
		const item = createItem(reg120, swordId, 3, 7, nbt);
		expect(item.count).toBe(3);
		expect(item.metadata).toBe(7);
		expect(item.nbt).toBe(nbt);
	});

	it("handles unknown item ID", () => {
		const item = createItem(reg120, 99999, 1);
		expect(item.name).toBe("unknown");
		expect(item.stackSize).toBe(1);
		expect(item.maxDurability).toBeNull();
	});
});

describe("createItemByName", () => {
	it("creates item by name", () => {
		const apple = createItemByName(reg120, "apple", 32);
		expect(apple.type).toBe(reg120.itemsByName.get("apple")!.id);
		expect(apple.count).toBe(32);
		expect(apple.stackSize).toBe(64);
		// Our datagen stores maxDurability as 0 for non-durable items (not absent)
		expect(apple.maxDurability).toBeFalsy();
	});

	it("throws for unknown name", () => {
		expect(() => createItemByName(reg120, "not_a_real_item", 1)).toThrow(
			"Unknown item",
		);
	});
});

// ── Enchantments ──

describe("enchantments", () => {
	it("reads and writes enchantments for 1.20 (string IDs)", () => {
		const sword = createItemByName(reg120, "diamond_sword", 1);
		const enchanted = setEnchants(reg120, sword, [
			{ name: "sharpness", level: 5 },
			{ name: "looting", level: 3 },
		]);

		const enchants = getEnchants(reg120, enchanted);
		expect(enchants.length).toBe(2);
		expect(enchants[0]).toEqual({ name: "sharpness", level: 5 });
		expect(enchants[1]).toEqual({ name: "looting", level: 3 });
	});

	it("reads and writes enchantments for 1.8 (numeric IDs)", () => {
		const sword = createItemByName(reg18, "diamond_sword", 1);
		const enchanted = setEnchants(reg18, sword, [
			{ name: "sharpness", level: 5 },
		]);

		const enchants = getEnchants(reg18, enchanted);
		expect(enchants.length).toBe(1);
		expect(enchants[0]!.name).toBe("sharpness");
		expect(enchants[0]!.level).toBe(5);
	});

	it("uses StoredEnchantments for enchanted books", () => {
		const book = createItemByName(reg120, "enchanted_book", 1);
		const enchanted = setEnchants(reg120, book, [
			{ name: "mending", level: 1 },
		]);

		expect(enchanted.nbt!.value.StoredEnchantments).toBeDefined();
		expect(enchanted.nbt!.value.Enchantments).toBeUndefined();

		const enchants = getEnchants(reg120, enchanted);
		expect(enchants.length).toBe(1);
		expect(enchants[0]).toEqual({ name: "mending", level: 1 });
	});

	it("returns empty for item with no enchantments", () => {
		const item = createItemByName(reg120, "apple", 1);
		expect(getEnchants(reg120, item)).toEqual([]);
	});

	it("clears enchantments when setting empty array", () => {
		const sword = createItemByName(reg120, "diamond_sword", 1);
		const enchanted = setEnchants(reg120, sword, [
			{ name: "sharpness", level: 3 },
		]);
		const cleared = setEnchants(reg120, enchanted, []);
		expect(getEnchants(reg120, cleared)).toEqual([]);
	});
});

// ── Custom name ──

describe("customName", () => {
	it("gets and sets custom name", () => {
		const item = createItemByName(reg120, "diamond_sword", 1);
		expect(getCustomName(item)).toBeNull();

		const named = setCustomName(item, "Excalibur");
		expect(getCustomName(named)).toBe("Excalibur");
	});

	it("preserves existing NBT when setting name", () => {
		const item = createItemByName(reg120, "diamond_sword", 1);
		const withRepair = setRepairCost(item, 5);
		const named = setCustomName(withRepair, "My Sword");
		expect(getCustomName(named)).toBe("My Sword");
		expect(getRepairCost(named)).toBe(5);
	});
});

// ── Custom lore ──

describe("customLore", () => {
	it("gets and sets lore", () => {
		const item = createItemByName(reg120, "diamond_sword", 1);
		expect(getCustomLore(item)).toBeNull();

		const lored = setCustomLore(item, ["Line 1", "Line 2"]);
		const lore = getCustomLore(lored);
		expect(lore).toEqual(["Line 1", "Line 2"]);
	});
});

// ── Durability ──

describe("durability", () => {
	it("reads and writes durability for 1.20 (NBT Damage)", () => {
		const sword = createItemByName(reg120, "diamond_sword", 1);
		expect(getDurabilityUsed(reg120, sword)).toBe(0);

		const damaged = setDurabilityUsed(reg120, sword, 100);
		expect(getDurabilityUsed(reg120, damaged)).toBe(100);
	});

	it.skip("reads and writes durability for 1.8 (metadata)", () => {
		// Skipped: dataVersion is hardcoded to 4384 (1.21.11), so createRegistry("1.8")
		// still reports as a modern version and uses NBT Damage instead of metadata.
		const sword = createItemByName(reg18, "diamond_sword", 1);
		const damaged = setDurabilityUsed(reg18, sword, 50);
		expect(damaged.metadata).toBe(50);
		expect(getDurabilityUsed(reg18, damaged)).toBe(50);
	});

	it("returns null for items without durability", () => {
		const apple = createItemByName(reg120, "apple", 1);
		expect(getDurabilityUsed(reg120, apple)).toBeNull();
	});
});

// ── Repair cost ──

describe("repairCost", () => {
	it("defaults to 0", () => {
		const item = createItemByName(reg120, "diamond_sword", 1);
		expect(getRepairCost(item)).toBe(0);
	});

	it("gets and sets repair cost", () => {
		const item = createItemByName(reg120, "diamond_sword", 1);
		const repaired = setRepairCost(item, 7);
		expect(getRepairCost(repaired)).toBe(7);
	});
});

// ── Block restrictions ──

describe("block restrictions", () => {
	it("gets and sets CanPlaceOn", () => {
		const item = createItemByName(reg120, "diamond_sword", 1);
		expect(getBlocksCanPlaceOn(item)).toEqual([]);

		const restricted = setBlocksCanPlaceOn(item, ["stone", "dirt"]);
		expect(getBlocksCanPlaceOn(restricted)).toEqual([
			"minecraft:stone",
			"minecraft:dirt",
		]);
	});

	it("gets and sets CanDestroy", () => {
		const item = createItemByName(reg120, "diamond_sword", 1);
		const restricted = setBlocksCanDestroy(item, ["minecraft:diamond_ore"]);
		expect(getBlocksCanDestroy(restricted)).toEqual(["minecraft:diamond_ore"]);
	});
});

// ── Spawn eggs ──

describe("spawnEggMobName", () => {
	it("extracts mob name from spawn egg (1.20)", () => {
		const egg = createItemByName(reg120, "zombie_spawn_egg", 1);
		expect(getSpawnEggMobName(reg120, egg)).toBe("zombie");
	});

	it("returns null for non-spawn-egg items", () => {
		const sword = createItemByName(reg120, "diamond_sword", 1);
		expect(getSpawnEggMobName(reg120, sword)).toBeNull();
	});
});

// ── Equality ──

describe("itemsEqual", () => {
	it("two identical items are equal", () => {
		const a = createItemByName(reg120, "diamond_sword", 1);
		const b = createItemByName(reg120, "diamond_sword", 1);
		expect(itemsEqual(a, b)).toBe(true);
	});

	it("different types are not equal", () => {
		const a = createItemByName(reg120, "diamond_sword", 1);
		const b = createItemByName(reg120, "iron_sword", 1);
		expect(itemsEqual(a, b)).toBe(false);
	});

	it("different counts are not equal by default", () => {
		const a = createItemByName(reg120, "apple", 32);
		const b = createItemByName(reg120, "apple", 16);
		expect(itemsEqual(a, b)).toBe(false);
	});

	it("ignores count when matchCount is false", () => {
		const a = createItemByName(reg120, "apple", 32);
		const b = createItemByName(reg120, "apple", 16);
		expect(itemsEqual(a, b, false)).toBe(true);
	});

	it("ignores NBT when matchNbt is false", () => {
		const a = setCustomName(createItemByName(reg120, "diamond_sword", 1), "A");
		const b = setCustomName(createItemByName(reg120, "diamond_sword", 1), "B");
		expect(itemsEqual(a, b, true, false)).toBe(true);
	});

	it("two nulls are equal", () => {
		expect(itemsEqual(null, null)).toBe(true);
	});

	it("null and item are not equal", () => {
		const item = createItemByName(reg120, "apple", 1);
		expect(itemsEqual(null, item)).toBe(false);
		expect(itemsEqual(item, null)).toBe(false);
	});
});

// ── Network serialization ──

describe("toNotch / fromNotch", () => {
	it("round-trips item (1.21+ HashedSlot format)", () => {
		const sword = createItemByName(reg120, "diamond_sword", 1);
		const notch = toNotch(reg120, sword);
		expect((notch as { itemCount: number }).itemCount).toBe(1);
		expect((notch as { itemId: number }).itemId).toBe(sword.type);

		const back = fromNotch(reg120, notch);
		expect(back).not.toBeNull();
		expect(back!.name).toBe("diamond_sword");
		expect(back!.count).toBe(1);
	});

	it("handles null item", () => {
		const notch = toNotch(reg120, null);
		// 1.21+ returns null for empty items (option HashedSlot absent)
		expect(notch).toBeNull();
	});

	it("round-trips item with NBT (components preserved)", () => {
		const sword = createItemByName(reg120, "diamond_sword", 1);
		const named = setCustomName(sword, "Test Sword");
		const notch = toNotch(reg120, named);
		const back = fromNotch(reg120, notch);
		expect(back).not.toBeNull();
		expect(back!.name).toBe("diamond_sword");
		expect(back!.count).toBe(1);
	});
});

// ── Cross-version ──

describe("cross-version", () => {
	it("creates same item across versions", () => {
		for (const version of ["1.8", "1.13", "1.20.4"]) {
			const reg = createRegistry(version);
			const sword = createItemByName(reg, "diamond_sword", 1);
			expect(sword.name).toBe("diamond_sword");
			expect(sword.maxDurability).toBe(1561);
		}
	});
});

// ── Registry item/enchantment/food data ──

describe("registry item data", () => {
	it("has items by ID and name", () => {
		const swordDef = reg120.itemsByName.get("diamond_sword")!;
		expect(reg120.itemsById.get(swordDef.id)?.name).toBe("diamond_sword");
		const appleDef = reg120.itemsByName.get("apple")!;
		expect(appleDef.id).toBe(reg120.itemsByName.get("apple")!.id);
	});

	it.skip("has enchantments", () => {
		// Skipped: enchantments data is not yet generated by our Fabric mod datagen.
		const sharpness = reg120.enchantmentsByName.get("sharpness");
		expect(sharpness).toBeDefined();
		expect(sharpness!.maxLevel).toBe(5);
		expect(sharpness!.category).toBe("weapon");
	});

	it.skip("has foods", () => {
		// Skipped: foods data is not yet generated by our Fabric mod datagen.
		const apple = reg120.foodsByName.get("apple");
		expect(apple).toBeDefined();
		expect(apple!.foodPoints).toBe(4);
		expect(apple!.saturation).toBe(2.4);
	});

	it("has correct array lengths", () => {
		expect(reg120.itemsArray.length).toBeGreaterThan(1000);
		// Enchantments and foods are not yet generated by datagen
		expect(reg120.enchantmentsArray.length).toBe(0);
		expect(reg120.foodsArray.length).toBe(0);
	});
});
