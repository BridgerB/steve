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

const craftChain = new WeakMap<Bot, Promise<void>>();

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
		// Host-provided cancellation: steve's run-loop lets a timed-out step keep
		// running in the background and dispatches the next one; two crafts then
		// interleave clicks on different window ids and both fail ("No craft
		// result" / "Promise timed out", race41 721). The host sets bot.preemptCheck
		// to throw once its epoch moved on; we call it before every click.
		const check = (): void =>
			(bot as unknown as { preemptCheck?: () => void }).preemptCheck?.();

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
								// 12s (was 5s): under server load / network latency the table
								// window can take >5s to open, and the too-short wait threw
								// "Promise timed out" — the #1 recurring craft-desync that stalled
								// race bots (Craft Stone Pickaxe/Table/Bucket looping). A fast open
								// still resolves immediately; this only extends the slow case.
								const [win] = await once<[Window]>(bot, "windowOpen", 12000);
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
						// A 2×2 craft clicks the player's own grid (window 0). The server ignores
						// clicks for any window but the one it has open, so a table or furnace
						// still open (a timed-out step's, or one the bot walked away from) must be
						// closed first; its 3×3 slot numbers would also map to other cells.
						if (bot.currentWindow && bot.currentWindow !== bot.inventory) {
							bot.emit("debug", "craft", { event: "close_before_2x2", windowId: bot.currentWindow.id });
							bot.closeWindow(bot.currentWindow);
						}
						window = bot.inventory;
						w = 2;
						h = 2;
					}

					// Reclaim anything the server still holds in the grid (an interrupted
					// craft) before placing: stray items change the recipe's result.
					for (let s = w * h; s >= 1; s--) {
						if (window.slots[s]) {
							check();
							await bot.clickWindow(s, 0, 1, window);
						}
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

					// Forget the client's idea of the result slot before placing: the
					// server clears slot 0 after a result is taken and resends it once the
					// grid changes, so anything still cached here is stale (race42 725:
					// grid empty, result "crafting_table" — a leftover from the previous
					// craft — which the take-the-result step then trusted).
					window.slots[0] = null;
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
									check();
									await bot.clickWindow(sourceSlot, 0, 0, window);
								}

								check();
								await bot.clickWindow(slot(x, y), 1, 0, window);
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
								check();
								await bot.clickWindow(sourceSlot, 0, 0, window);
							}

							check();
							await bot.clickWindow(destSlot, 1, 0, window);
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
							}, 3000);
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

					// VERIFY the result is the recipe's item before taking it. A right-click
					// that didn't land (window desync under load) leaves e.g. ONE plank in the
					// grid, whose result is a button/pressure plate; taking it blindly wasted
					// the wood (race34 692: 25 birch buttons, 25 planks gone; 686: a door +
					// stairs). Put the grid back and let the caller retry instead.
					const got = window.slots[0];
					// One line per craft showing what actually sits in the grid vs the
					// result the server offered — the only way to tell a rejected click
					// from a wrong pattern when "No craft result" comes back.
					bot.emit("debug", "craft", {
						event: "grid",
						window: window.id,
						grid: Array.from({ length: w * h }, (_, i) => {
							const it = window.slots[i + 1];
							return it ? `${it.name}x${it.count}` : "-";
						}).join(","),
						result: got ? `${got.name}x${got.count}` : null,
						cursor: window.selectedItem?.name ?? null,
					});
					check();
					if (got && got.type !== recipe.result.id) {
						bot.emit("debug", "craft", { event: "wrong_result", got: got.name, want: recipe.result.id });
						for (let s = 1; s <= w * h; s++) {
							if (window.slots[s]) await bot.putAway(s, window);
						}
						throw new Error(`Wrong craft result: ${got.name}`);
					}
					if (!got) {
						for (let s = 1; s <= w * h; s++) {
							if (window.slots[s]) await bot.putAway(s, window);
						}
						throw new Error("No craft result");
					}

					// Take the result from slot 0
					await bot.putAway(0, window);

					// Handle outShape leftovers (e.g. buckets from cake recipe)
					if (recipe.outShape) {
						for (let y = 0; y < recipe.outShape.length; y++) {
							const row = recipe.outShape[y]!;
							for (let x = 0; x < row.length; x++) {
								if (row[x]!.id !== -1) {
									await bot.putAway(slot(x, y), window);
								}
							}
						}
					}

					// Clear any items left in the crafting grid back to inventory. GRID FIRST,
					// result slot LAST: taking slot 0 while a stray plank still sits in the
					// grid *crafts* that plank into a button (race35 696/699 still minted
					// oak_buttons after the result check — from this sweep, not the take).
					for (let s = w * h; s >= 1; s--) {
						if (window.slots[s]) {
							await bot.putAway(s, window);
						}
					}
					if (window.slots[0] && window.slots[0].type === recipe.result.id) {
						await bot.putAway(0, window);
					}
				}
			} finally {
				// Closing a window while an item is on the cursor DROPS it on the ground.
				// Park it in any inventory slot first and say so (race38 710: 14 planks
				// vanished at a table craft).
				const w = windowCraftingTable ?? bot.inventory;
				if (w?.selectedItem) {
					bot.emit("debug", "craft", { event: "cursor_stuck", item: w.selectedItem.name, count: w.selectedItem.count });
					try {
						await bot.putSelectedItemRange(w.inventoryStart, w.inventoryEnd, w, 0);
					} catch {}
				}
				if (windowCraftingTable) {
					bot.closeWindow(windowCraftingTable);
				}
			}
		};

		// One craft at a time per bot: two crafts interleaving clicks on the same grid mint
		// junk (race c5 808 at 12:51:22: a preempted plank craft still clicking while the next
		// one placed → oak_button, then the grid desync behind 100 "No craft result").
		const prev = craftChain.get(bot) ?? Promise.resolve();
		let release!: () => void;
		const mine = new Promise<void>((r) => (release = r));
		craftChain.set(bot, prev.then(() => mine));
		try {
			await withTimeout(prev, 30000).catch(() => {});
			await withTimeout(doCraft(), 30000);
		} finally {
			if (windowCraftingTable) {
				bot.closeWindow(windowCraftingTable);
			}
			release();
		}
	};
};
