/**
 * Crafting recipes — lookup and craft execution.
 * Uses src/recipe/ for recipe data.
 */

import { findRecipes, type Recipe, type RecipeItem } from "../recipe/index.ts";
import { type Vec3, vec3 } from "../vec3/index.ts";
import { findInventoryItem, type Window } from "../window/index.ts";
import type { Bot, BotOptions } from "./types.ts";
import { once, withTimeout } from "./utils.ts";

/** Whether an item type satisfies a recipe ingredient (tag-aware). */
const ingredientMatches = (type: number, ingredient: RecipeItem): boolean =>
	type === ingredient.id || (ingredient.choices?.includes(type) ?? false);

/**
 * Find an inventory slot holding any item that satisfies the ingredient.
 * Tries the representative ID first, then each tag choice (e.g. a recipe asking
 * for #planks is satisfied by oak, birch, or any other plank the bot holds).
 */
const findIngredientSlot = (
	window: Window,
	ingredient: RecipeItem,
): number | null => {
	const direct = findInventoryItem(window, ingredient.id, ingredient.metadata);
	if (direct !== null) return direct;
	for (const id of ingredient.choices ?? []) {
		const slot = findInventoryItem(window, id, ingredient.metadata);
		if (slot !== null) return slot;
	}
	return null;
};

export const initCrafting = (bot: Bot, _options: BotOptions): void => {
	bot.recipesFor = (
		itemType: number,
		metadata: number | null,
		minResultCount: number | null,
		craftingTable: boolean | null,
	): Recipe[] => {
		if (!bot.registry) return [];

		const recipes = findRecipes(bot.registry, itemType, metadata ?? undefined);

		return recipes.filter((recipe) => {
			// Filter by minimum result count
			if (minResultCount != null && recipe.result.count < minResultCount) {
				return false;
			}
			// Filter by crafting table requirement
			if (!craftingTable && recipe.requiresTable) return false;
			return true;
		});
	};

	bot.recipesAll = (
		itemType: number,
		metadata: number | null,
		craftingTable: boolean | null,
	): Recipe[] => bot.recipesFor(itemType, metadata, null, craftingTable);

	bot.craft = async (
		recipe: Recipe,
		count?: number,
		craftingTable?: unknown,
	): Promise<void> => {
		if (recipe.requiresTable && !craftingTable) {
			throw new Error("Recipe requires crafting table");
		}

		const times = count ?? 1;
		let windowCraftingTable: Window | null = null;

		const doCraft = async () => {
			bot.emit("debug", "craft", {
				event: "start",
				times,
				requiresTable: recipe.requiresTable,
				hasTable: !!craftingTable,
				shaped: !!recipe.inShape,
				shapeless: !!recipe.ingredients,
			});
			try {
				for (let i = 0; i < times; i++) {
					let window: Window;
					let w: number;
					let h: number;

					if (craftingTable) {
						if (!windowCraftingTable) {
							// Reuse already-open crafting window if available
							if (
								bot.currentWindow &&
								String(bot.currentWindow.type).startsWith("minecraft:crafting")
							) {
								windowCraftingTable = bot.currentWindow;
							} else {
								const block = craftingTable as { position: Vec3 };
								// Look at the table before activating
								await bot.lookAt(
									vec3(
										block.position.x + 0.5,
										block.position.y + 0.5,
										block.position.z + 0.5,
									),
									true,
								);
								await bot.activateBlock(block.position);
								const [win] = await once<[Window]>(bot, "windowOpen", 5000);
								windowCraftingTable = win;
								// Wait for window_items to sync player inventory into the crafting window
								await new Promise((r) => setTimeout(r, 500));
							}
						}
						if (
							!windowCraftingTable.type
								.toString()
								.startsWith("minecraft:crafting")
						) {
							throw new Error(
								`Non-crafting table block used: ${windowCraftingTable.type}`,
							);
						}
						window = windowCraftingTable;
						w = 3;
						h = 3;
					} else {
						window = bot.inventory;
						w = 2;
						h = 2;
					}

					// Convert grid x,y to slot index (slot 0 is result, 1+ is grid)
					const slot = (x: number, y: number) => 1 + x + w * y;

					// Compute unused recipe slots (for shapeless ingredient placement)
					const unusedSlots: number[] = [];
					if (recipe.inShape) {
						for (let y = 0; y < recipe.inShape.length; y++) {
							const row = recipe.inShape[y]!;
							for (let x = 0; x < row.length; x++) {
								if (row[x]!.id === -1) unusedSlots.push(slot(x, y));
							}
							for (let x = row.length; x < w; x++) {
								unusedSlots.push(slot(x, y));
							}
						}
						for (let y = recipe.inShape.length; y < h; y++) {
							for (let x = 0; x < w; x++) {
								unusedSlots.push(slot(x, y));
							}
						}
					} else {
						for (let y = 0; y < h; y++) {
							for (let x = 0; x < w; x++) {
								unusedSlots.push(slot(x, y));
							}
						}
					}

					let originalSourceSlot: number | null = null;

					// Place shaped ingredients
					bot.emit("debug", "craft", {
						event: "place",
						windowType: String(window.type),
						invStart: window.inventoryStart,
						slotCount: window.slots.length,
					});
					if (recipe.inShape) {
						for (let y = 0; y < recipe.inShape.length; y++) {
							const row = recipe.inShape[y]!;
							for (let x = 0; x < row.length; x++) {
								const ingredient = row[x]!;
								if (ingredient.id === -1) continue;

								if (
									!window.selectedItem ||
									!ingredientMatches(window.selectedItem.type, ingredient) ||
									(ingredient.metadata != null &&
										window.selectedItem.metadata !== ingredient.metadata)
								) {
									const sourceSlot = findIngredientSlot(window, ingredient);
									if (sourceSlot === null)
										throw new Error("Missing ingredient");
									if (originalSourceSlot === null)
										originalSourceSlot = sourceSlot;
									await bot.clickWindow(sourceSlot, 0, 0);
								}

								await bot.clickWindow(slot(x, y), 1, 0);
							}
						}
					}

					// Place shapeless ingredients (into unused slots)
					if (recipe.ingredients) {
						for (const ingredient of recipe.ingredients) {
							const destSlot = unusedSlots.pop();
							if (destSlot === undefined)
								throw new Error("No free craft slots");

							if (
								!window.selectedItem ||
								!ingredientMatches(window.selectedItem.type, ingredient) ||
								(ingredient.metadata != null &&
									window.selectedItem.metadata !== ingredient.metadata)
							) {
								const sourceSlot = findIngredientSlot(window, ingredient);
								if (sourceSlot === null) {
									const allItems = window.slots
										.filter((s) => s)
										.map((s, i) => `${s!.name}(${s!.type})@${i}`);
									throw new Error(
										`Missing ingredient id=${ingredient.id} meta=${ingredient.metadata} inv=[${allItems}]`,
									);
								}
								bot.emit("debug", "craft", {
									event: "ingredient",
									ingredientId: ingredient.id,
									sourceSlot,
								});
								if (originalSourceSlot === null)
									originalSourceSlot = sourceSlot;
								await bot.clickWindow(sourceSlot, 0, 0);
							}

							await bot.clickWindow(destSlot, 1, 0);
						}
					}

					// Put back any remaining held items
					await bot.putSelectedItemRange(
						window.inventoryStart,
						window.inventoryEnd,
						window,
						originalSourceSlot ?? 0,
					);

					// Wait for server to populate the craft result in slot 0
					if (!window.slots[0]) {
						await new Promise<void>((resolve) => {
							const prevCb = window.onSlotUpdate;
							const timeout = setTimeout(() => {
								window.onSlotUpdate = prevCb;
								resolve();
							}, 2000);
							window.onSlotUpdate = (slot, _old, newItem) => {
								prevCb?.(slot, _old, newItem);
								if (slot === 0 && newItem) {
									clearTimeout(timeout);
									window.onSlotUpdate = prevCb;
									resolve();
								}
							};
						});
					}

					// Take the result from slot 0
					await bot.putAway(0);

					// Handle outShape leftovers (e.g. buckets from cake recipe)
					if (recipe.outShape) {
						for (let y = 0; y < recipe.outShape.length; y++) {
							const row = recipe.outShape[y]!;
							for (let x = 0; x < row.length; x++) {
								if (row[x]!.id !== -1) {
									await bot.putAway(slot(x, y));
								}
							}
						}
					}

					// Clear any items left in the crafting grid back to inventory (including result slot 0)
					for (let s = 0; s <= w * h; s++) {
						if (window.slots[s]) {
							await bot.putAway(s);
						}
					}
				}
			} finally {
				if (windowCraftingTable) {
					bot.closeWindow(windowCraftingTable);
				}
			}
		};

		try {
			await withTimeout(doCraft(), 30000);
		} finally {
			if (windowCraftingTable) {
				bot.closeWindow(windowCraftingTable);
			}
		}
	};
};
