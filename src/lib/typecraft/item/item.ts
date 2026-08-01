/**
 * Item module — pure functions for creating, inspecting, and transforming
 * Minecraft items. Replaces prismarine-item with a functional API.
 */

import { equalNbt, nbtInt, nbtList, nbtShort, nbtString } from "../nbt/nbt.ts";
import type { NbtCompound, NbtTag } from "../nbt/types.ts";
import type { Registry } from "../registry/types.ts";
import { hashComponents } from "./component-hash.ts";
import type { Enchant, Item, ItemComponent, NotchItem } from "./types.ts";

// ── Construction ──

/** Create an item from a numeric type ID. */
export const createItem = (
	registry: Registry,
	type: number,
	count: number,
	metadata?: number,
	nbt?: NbtCompound | null,
	components?: readonly ItemComponent[],
	removedComponents?: readonly string[],
): Item => {
	const def = registry.itemsById.get(type);
	return {
		type,
		count,
		metadata: metadata ?? 0,
		nbt: nbt ?? null,
		name: def?.name ?? "unknown",
		displayName: def?.displayName ?? "Unknown",
		stackSize: def?.stackSize ?? 1,
		maxDurability: def?.maxDurability ?? null,
		components: components ?? [],
		removedComponents: removedComponents ?? [],
	};
};

/** Create an item by name. */
export const createItemByName = (
	registry: Registry,
	name: string,
	count: number,
	metadata?: number,
	nbt?: NbtCompound | null,
): Item => {
	const def = registry.itemsByName.get(name);
	if (!def) throw new Error(`Unknown item: ${name}`);
	return createItem(registry, def.id, count, metadata, nbt);
};

// ── NBT helpers ──

const getCompoundTag = (
	nbt: NbtCompound | null,
	key: string,
): NbtCompound | null => {
	if (!nbt) return null;
	const tag = nbt.value[key];
	return tag && tag.type === "compound" ? (tag as NbtCompound) : null;
};

const getDisplayTag = (item: Item): NbtCompound | null =>
	getCompoundTag(item.nbt, "display");

const withNbtValue = (item: Item, key: string, value: NbtTag): Item => ({
	...item,
	nbt: {
		type: "compound",
		value: { ...(item.nbt?.value ?? {}), [key]: value },
	},
});

const withDisplayValue = (item: Item, key: string, value: NbtTag): Item => {
	const display = getDisplayTag(item);
	return withNbtValue(item, "display", {
		type: "compound",
		value: { ...(display?.value ?? {}), [key]: value },
	});
};

// ── Enchantments ──

/** Read enchantments from an item's NBT. */
export const getEnchants = (
	registry: Registry,
	item: Item,
): readonly Enchant[] => {
	if (!item.nbt) return [];

	const enchantKey = registry.supportFeature("nbtNameForEnchant") as string;
	const levelType = registry.supportFeature(
		"typeOfValueForEnchantLevel",
	) as string;
	const useStored =
		registry.supportFeature("booksUseStoredEnchantments") &&
		item.name === "enchanted_book";

	const listTag = useStored
		? (item.nbt.value.StoredEnchantments ?? item.nbt.value[enchantKey])
		: item.nbt.value[enchantKey];

	if (!listTag || listTag.type !== "list") return [];

	const entries = (
		listTag as { value: { value: readonly Record<string, NbtTag>[] } }
	).value.value;

	return entries.map((entry) => {
		const lvl = (entry.lvl as { value: number }).value;

		if (levelType === "short" && enchantKey === "ench") {
			const numericId = (entry.id as { value: number }).value;
			const def = registry.enchantmentsById.get(numericId);
			return { name: def?.name ?? "unknown", level: lvl };
		}

		const stringId = (entry.id as { value: string }).value;
		return { name: stringId.replace("minecraft:", ""), level: lvl };
	});
};

/** Return a new item with the given enchantments. */
export const setEnchants = (
	registry: Registry,
	item: Item,
	enchants: readonly Enchant[],
): Item => {
	const enchantKey = registry.supportFeature("nbtNameForEnchant") as string;
	const levelType = registry.supportFeature(
		"typeOfValueForEnchantLevel",
	) as string;
	const useStored =
		registry.supportFeature("booksUseStoredEnchantments") &&
		item.name === "enchanted_book";
	const key = useStored ? "StoredEnchantments" : enchantKey;

	if (enchants.length === 0) {
		if (!item.nbt) return item;
		const { [key]: _, ...rest } = item.nbt.value;
		const remaining = Object.keys(rest).length > 0;
		return {
			...item,
			nbt: remaining ? { type: "compound", value: rest } : null,
		};
	}

	const enchantEntries = enchants.map(({ name, level }) => {
		const id =
			levelType === "short" && enchantKey === "ench"
				? nbtShort(registry.enchantmentsByName.get(name)?.id ?? 0)
				: nbtString(`minecraft:${name}`);
		return { id, lvl: nbtShort(level) } as Readonly<Record<string, NbtTag>>;
	});

	return withNbtValue(
		item,
		key,
		nbtList({ type: "compound", value: enchantEntries }),
	);
};

// ── Custom name ──

/** Get the custom display name, or null if none. */
export const getCustomName = (item: Item): string | null => {
	const display = getDisplayTag(item);
	if (!display) return null;
	const nameTag = display.value.Name;
	return nameTag && nameTag.type === "string"
		? (nameTag as { value: string }).value
		: null;
};

/** Return a new item with the given custom name. */
export const setCustomName = (item: Item, name: string): Item =>
	withDisplayValue(item, "Name", nbtString(name));

// ── Custom lore ──

/** Get custom lore lines, or null if none. */
export const getCustomLore = (item: Item): readonly string[] | null => {
	const display = getDisplayTag(item);
	if (!display) return null;
	const loreTag = display.value.Lore;
	if (!loreTag) return null;
	if (loreTag.type === "string") return [(loreTag as { value: string }).value];
	if (loreTag.type === "list") {
		return (loreTag as { value: { value: readonly string[] } }).value
			.value as readonly string[];
	}
	return null;
};

/** Return a new item with the given lore lines. */
export const setCustomLore = (item: Item, lore: readonly string[]): Item =>
	withDisplayValue(item, "Lore", nbtList({ type: "string", value: [...lore] }));

// ── Durability ──

/** Get durability used (damage taken), or null if item has no durability. */
export const getDurabilityUsed = (
	registry: Registry,
	item: Item,
): number | null => {
	if (!item.maxDurability) return null;

	const where = registry.supportFeature(
		"whereDurabilityIsSerialized",
	) as string;
	if (where === "Damage") {
		const tag = item.nbt?.value?.Damage;
		return tag && tag.type === "int" ? (tag as { value: number }).value : 0;
	}
	if (where === "metadata") return item.metadata;
	return 0;
};

/** Return a new item with durability used set. */
export const setDurabilityUsed = (
	registry: Registry,
	item: Item,
	durability: number,
): Item => {
	const where = registry.supportFeature(
		"whereDurabilityIsSerialized",
	) as string;
	if (where === "Damage")
		return withNbtValue(item, "Damage", nbtInt(durability));
	if (where === "metadata") return { ...item, metadata: durability };
	return item;
};

// ── Repair cost ──

/** Get the anvil repair cost, defaulting to 0. */
export const getRepairCost = (item: Item): number => {
	const tag = item.nbt?.value?.RepairCost;
	return tag && tag.type === "int" ? (tag as { value: number }).value : 0;
};

/** Return a new item with the given repair cost. */
export const setRepairCost = (item: Item, cost: number): Item =>
	withNbtValue(item, "RepairCost", nbtInt(cost));

// ── Block restrictions ──

const getStringList = (item: Item, key: string): readonly string[] => {
	const tag = item.nbt?.value?.[key];
	if (!tag || tag.type !== "list") return [];
	return (tag as { value: { value: readonly string[] } }).value
		.value as readonly string[];
};

const setStringList = (
	item: Item,
	key: string,
	values: readonly string[],
): Item => {
	const normalized = values.map((v) =>
		v.includes(":") ? v : `minecraft:${v}`,
	);
	return withNbtValue(
		item,
		key,
		nbtList({ type: "string", value: [...normalized] }),
	);
};

/** Get blocks this item can be placed on (adventure mode). */
export const getBlocksCanPlaceOn = (item: Item): readonly string[] =>
	getStringList(item, "CanPlaceOn");

/** Return a new item with CanPlaceOn restriction. */
export const setBlocksCanPlaceOn = (
	item: Item,
	blocks: readonly string[],
): Item => setStringList(item, "CanPlaceOn", blocks);

/** Get blocks this item can destroy (adventure mode). */
export const getBlocksCanDestroy = (item: Item): readonly string[] =>
	getStringList(item, "CanDestroy");

/** Return a new item with CanDestroy restriction. */
export const setBlocksCanDestroy = (
	item: Item,
	blocks: readonly string[],
): Item => setStringList(item, "CanDestroy", blocks);

// ── Spawn eggs ──

/** Get the mob name from a spawn egg, or null if not a spawn egg. */
export const getSpawnEggMobName = (
	registry: Registry,
	item: Item,
): string | null => {
	if (!item.name.endsWith("_spawn_egg")) return null;

	if (registry.supportFeature("spawnEggsHaveSpawnedEntityInName"))
		return item.name.replace("_spawn_egg", "");

	if (registry.supportFeature("spawnEggsUseEntityTagInNbt") && item.nbt) {
		const entityTag = getCompoundTag(item.nbt, "EntityTag");
		if (entityTag) {
			const idTag = entityTag.value.id;
			if (idTag && idTag.type === "string")
				return (idTag as { value: string }).value.replace("minecraft:", "");
		}
	}

	return null;
};

// ── Equality ──

/** Compare two items for equality. Two nulls are equal. */
export const itemsEqual = (
	a: Item | null,
	b: Item | null,
	matchCount = true,
	matchNbt = true,
): boolean => {
	if (a === null && b === null) return true;
	if (a === null || b === null) return false;
	if (a.type !== b.type || a.metadata !== b.metadata) return false;
	if (matchCount && a.count !== b.count) return false;
	if (matchNbt) {
		// Compare 1.21+ components by type+hash
		if (a.components.length !== b.components.length) return false;
		for (let i = 0; i < a.components.length; i++) {
			if (
				a.components[i]!.type !== b.components[i]!.type ||
				a.components[i]!.hash !== b.components[i]!.hash
			)
				return false;
		}
		if (a.removedComponents.length !== b.removedComponents.length) return false;
		for (let i = 0; i < a.removedComponents.length; i++) {
			if (a.removedComponents[i] !== b.removedComponents[i]) return false;
		}
		// Legacy NBT comparison
		if (a.nbt !== null || b.nbt !== null) {
			if (a.nbt === null || b.nbt === null) return false;
			return equalNbt(a.nbt, b.nbt);
		}
	}
	return true;
};

// ── Network serialization ──

/** Convert an item to network (Notch) format. */
export const toNotch = (registry: Registry, item: Item | null): NotchItem => {
	// 1.21+ HashedSlot format: { itemId, itemCount, components (type+hash), removeComponents }
	if (!registry.supportFeature("itemSerializationUsesBlockId")) {
		if (!item) return null as unknown as NotchItem;
		return {
			itemId: item.type,
			itemCount: item.count,
			components: item.components.map((c) => ({
				type: c.type,
				hash: c.hash,
			})),
			removeComponents: item.removedComponents.map((type) => ({ type })),
		} as unknown as NotchItem;
	}

	// Legacy blockId format
	if (!item) return { blockId: -1, itemCount: 0, itemDamage: 0 };
	const hasNbt = item.nbt !== null && Object.keys(item.nbt.value).length > 0;
	return {
		blockId: item.type,
		itemCount: item.count,
		itemDamage: item.metadata,
		...(hasNbt ? { nbtData: item.nbt! } : {}),
	};
};

/** Convert a network (Notch) format item back, or null if empty. */
export const fromNotch = (
	registry: Registry,
	networkItem: NotchItem,
): Item | null => {
	if (!networkItem) return null;
	const ni = networkItem as Record<string, unknown>;

	// 1.21+ format: { itemCount, itemId, components, removeComponents }
	// itemCount=0 means empty slot
	if ("itemCount" in ni) {
		const count = ni.itemCount as number;
		if (count === 0) return null;
		const id = ni.itemId as number;

		const rawComponents = (ni.components ?? []) as {
			type: string;
			data: unknown;
		}[];
		const rawRemoved = (ni.removeComponents ?? []) as { type: string }[];

		const components = hashComponents(rawComponents);
		const removedComponents = rawRemoved.map((r) => r.type);

		return createItem(
			registry,
			id,
			count,
			0,
			null,
			components,
			removedComponents,
		);
	}

	// Legacy format with "present" field
	if ("present" in ni) {
		if (!ni.present) return null;
		return createItem(
			registry,
			ni.itemId as number,
			ni.itemCount as number,
			0,
			(ni.nbtData as NbtCompound | null) ?? null,
		);
	}

	// Legacy format with blockId
	if ("blockId" in ni) {
		if ((ni.blockId as number) === -1) return null;
		return createItem(
			registry,
			ni.blockId as number,
			ni.itemCount as number,
			(ni.itemDamage as number) ?? 0,
			(ni.nbtData as NbtCompound | null) ?? null,
		);
	}

	return null;
};
