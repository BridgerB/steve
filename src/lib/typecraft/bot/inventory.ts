/**
 * Inventory and window management — slot updates, clicking, item transfer.
 * Combines upstream inventory.js and simple_inventory.js.
 */

import type { Entity } from "../entity/index.ts";
import { fromNotch, type Item, itemsEqual, toNotch } from "../item/index.ts";
import type { Vec3 } from "../vec3/index.ts";
import {
	acceptClick,
	createWindow,
	getWindowTypes,
	updateSlot,
	type Window,
} from "../window/index.ts";
import { toNotchianPitch, toNotchianYaw } from "./conversions.ts";
import type {
	Bot,
	BotOptions,
	EquipmentDestination,
	TransferOptions,
} from "./types.ts";
import { nextSequence, once } from "./utils.ts";

const WINDOW_TIMEOUT = 5000;

export const initInventory = (bot: Bot, _options: BotOptions): void => {
	let nextActionId = 0;

	// ── Create inventory on login ──

	bot.client.on("login", () => {
		if (!bot.registry) return;
		const windowTypes = getWindowTypes(bot.registry);
		const invInfo = windowTypes["minecraft:inventory"];
		if (invInfo) {
			bot.inventory = createWindow(
				0,
				invInfo.type,
				"Inventory",
				invInfo.slots,
				invInfo.inventory,
				invInfo.craft,
				invInfo.requireConfirmation,
			);
		}
	});

	// ── Window items (bulk slot update) ──

	bot.client.on("container_set_content", (packet: Record<string, unknown>) => {
		if (!bot.registry) {
			bot.emit("debug", "inventory", { event: "set_content_no_registry" });
			return;
		}
		const windowId = packet.windowId as number;
		const items = packet.items as unknown[];

		const window =
			windowId === 0
				? bot.inventory
				: bot.currentWindow?.id === windowId
					? bot.currentWindow
					: null;
		if (!window) {
			bot.emit("debug", "inventory", {
				event: "set_content_no_window",
				windowId,
			});
			return;
		}

		let nonEmpty = 0;
		for (let i = 0; i < items.length; i++) {
			const item = fromNotch(bot.registry, items[i] as never);
			updateSlot(window, i, item);
			if (item) nonEmpty++;
		}

		// State ID tracking (1.17+)
		if (packet.stateId != null) {
			(window as Record<string, unknown>).stateId = packet.stateId as number;
		}

		bot.emit("debug", "inventory", {
			event: "set_content",
			windowId,
			totalSlots: items.length,
			nonEmpty,
			stateId: packet.stateId ?? null,
		});

		// Auto-move items from crafting grid (slots 1-4) to main inventory after resync
		// Prevents items getting stuck in the grid from server resyncs
		if (windowId === 0 && window === bot.inventory) {
			for (let s = 1; s <= 4; s++) {
				if (window.slots[s]) {
					// Find an empty slot in main inventory (9-44) to move to
					for (let dest = 9; dest < 45; dest++) {
						if (!window.slots[dest]) {
							updateSlot(window, dest, window.slots[s]!);
							updateSlot(window, s, null);
							break;
						}
					}
				}
			}
		}
	});

	// ── Set slot (single slot update) ──

	bot.client.on("container_set_slot", (packet: Record<string, unknown>) => {
		if (!bot.registry) {
			bot.emit("debug", "inventory", { event: "set_slot_no_registry" });
			return;
		}
		const windowId = packet.windowId as number;
		const slot = packet.slot as number;
		const item = fromNotch(bot.registry, packet.item as never);

		const window =
			windowId === -1
				? bot.inventory
				: windowId === 0
					? bot.inventory
					: bot.currentWindow?.id === windowId
						? bot.currentWindow
						: null;

		bot.emit("debug", "inventory", {
			event: "set_slot",
			windowId,
			slot,
			item: item?.name ?? null,
			count: item?.count ?? 0,
			hasWindow: !!window,
			invExists: !!bot.inventory,
		});

		if (window) {
			updateSlot(window, slot, item);
			// Track stateId for window_click
			if (packet.stateId != null) {
				(window as Record<string, unknown>).stateId = packet.stateId as number;
			}
		}

		// Update held item if main hand slot changed
		if (windowId === 0 && slot === bot.quickBarSlot + 36) {
			bot.heldItem = item;
		}
	});

	// ── Set player inventory (1.21.11+) ──

	bot.client.on("set_player_inventory", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const slotId = packet.slotId as number;
		const item = fromNotch(bot.registry, packet.contents as never);
		updateSlot(bot.inventory, slotId, item);

		if (slotId === bot.quickBarSlot + 36) {
			bot.heldItem = item;
		}

		bot.emit("debug", "inventory", {
			event: "set_player_inventory",
			slotId,
			item: item?.name ?? null,
			count: item?.count ?? 0,
		});
	});

	// ── Open window ──

	bot.client.on("open_screen", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const windowId = packet.windowId as number;
		const windowType = packet.inventoryType as string | number;
		const title = (packet.windowTitle as string) ?? "";

		const windowTypes = getWindowTypes(bot.registry);
		let info: ReturnType<typeof getWindowTypes>[string] | null = null;
		if (typeof windowType === "string") {
			info = windowTypes[windowType] ?? null;
		} else {
			// Numeric type ID — find by matching .type field
			info =
				Object.values(windowTypes).find((w) => w.type === windowType) ?? null;
		}

		bot.emit("debug", "window", {
			event: "open",
			windowId,
			windowType,
			info: info?.key ?? null,
		});

		if (info) {
			bot.currentWindow = createWindow(
				windowId,
				info.key,
				title,
				info.slots,
				info.inventory,
				info.craft,
				info.requireConfirmation,
			);
		}

		if (bot.currentWindow) {
			bot.emit("windowOpen", bot.currentWindow);
		}
	});

	// ── Close window ──

	bot.client.on("container_close", (_packet: Record<string, unknown>) => {
		if (bot.currentWindow) {
			const w = bot.currentWindow;
			// Sync inventory slots from container window back to player inventory
			const invLen = w.inventoryEnd - w.inventoryStart;
			for (let i = 0; i < invLen; i++) {
				const containerSlot = w.inventoryStart + i;
				const playerSlot = bot.inventory.inventoryStart + i;
				if (
					containerSlot < w.slots.length &&
					playerSlot < bot.inventory.slots.length
				) {
					bot.inventory.slots[playerSlot] = w.slots[containerSlot]!;
				}
			}
			bot.currentWindow = null;
			bot.emit("windowClose", w);
		}
	});

	// ── Held item slot ──

	bot.client.on("set_held_slot", (packet: Record<string, unknown>) => {
		bot.quickBarSlot = packet.slot as number;
		bot.updateHeldItem();
	});

	// ── Click window ──

	bot.clickWindow = async (
		slot: number,
		mouseButton: number,
		mode: number,
	): Promise<void> => {
		const window = bot.currentWindow ?? bot.inventory;
		if (!window || !bot.registry) return;

		const actionId = nextActionId++;

		if (bot.supportFeature("stateIdUsed")) {
			const stateId =
				((window as Record<string, unknown>).stateId as number) ?? 0;

			// Snapshot old slots, simulate the click client-side, then diff
			const oldSlots = window.slots.map((s) => (s ? { ...s } : null));
			acceptClick(window, bot.registry, { slot, mouseButton, mode });

			// Compute changed slots
			const changedSlots: { location: number; item: unknown }[] = [];
			for (let i = 0; i < window.slots.length; i++) {
				if (!itemsEqual(oldSlots[i] ?? null, window.slots[i] ?? null)) {
					changedSlots.push({
						location: i,
						item: toNotch(bot.registry!, window.slots[i] ?? null),
					});
				}
			}

			bot.emit("debug", "click", {
				slot,
				mouseButton,
				mode,
				stateId,
				changed: changedSlots.length,
				cursor: window.selectedItem?.name ?? null,
			});

			bot.client.write("container_click", {
				windowId: window.id,
				slot,
				mouseButton,
				mode,
				stateId,
				changedSlots,
				cursorItem: toNotch(bot.registry!, window.selectedItem),
			});

			// Wait for server confirmation (either set_slot or full resync)
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					bot.client.removeListener("container_set_slot", onSlot);
					bot.client.removeListener("container_set_content", onItems);
					resolve();
				}, 1000);
				const onSlot = () => {
					clearTimeout(timeout);
					bot.client.removeListener("container_set_content", onItems);
					resolve();
				};
				const onItems = () => {
					clearTimeout(timeout);
					bot.client.removeListener("container_set_slot", onSlot);
					resolve();
				};
				bot.client.once("container_set_slot", onSlot);
				bot.client.once("container_set_content", onItems);
			});
		} else {
			bot.client.write("container_click", {
				windowId: window.id,
				slot,
				mouseButton,
				action: actionId,
				mode,
				item: { blockId: -1 },
			});
		}
	};

	// ── Close window (client-side) ──

	bot.closeWindow = (window: Window) => {
		bot.client.write("container_close", { windowId: window.id });
		if (bot.currentWindow === window) {
			// Sync inventory slots from container back to player inventory
			const invLen = window.inventoryEnd - window.inventoryStart;
			for (let i = 0; i < invLen; i++) {
				const containerSlot = window.inventoryStart + i;
				const playerSlot = bot.inventory.inventoryStart + i;
				if (
					containerSlot < window.slots.length &&
					playerSlot < bot.inventory.slots.length
				) {
					bot.inventory.slots[playerSlot] = window.slots[containerSlot]!;
				}
			}
			bot.currentWindow = null;
		}
		bot.emit("windowClose", window);
	};

	// ── Set quick bar slot ──

	bot.setQuickBarSlot = (slot: number) => {
		bot.quickBarSlot = slot;
		bot.client.write("set_carried_item", { slotId: slot });
		bot.updateHeldItem();
	};

	// ── Update held item ──

	bot.updateHeldItem = () => {
		if (!bot.inventory) return;
		bot.heldItem = bot.inventory.slots[bot.quickBarSlot + 36] ?? null;
	};

	// ── Activate item (use held item) ──

	bot.activateItem = (offhand?: boolean) => {
		bot.usingHeldItem = true;
		if (bot.supportFeature("useItemWithOwnPacket")) {
			bot.client.write("use_item", {
				hand: offhand ? 1 : 0,
				sequence: nextSequence(),
				rotation: {
					x: toNotchianYaw(bot.entity.yaw),
					y: toNotchianPitch(bot.entity.pitch),
				},
			});
		} else {
			bot.client.write("use_item_on", {
				location: { x: -1, y: -1, z: -1 },
				direction: -1,
				heldItem: { blockId: -1 },
				cursorX: 0,
				cursorY: 0,
				cursorZ: 0,
			});
		}
	};

	// ── Deactivate item ──

	bot.deactivateItem = () => {
		bot.usingHeldItem = false;
		bot.client.write("player_action", {
			status: 5,
			location: { x: 0, y: 0, z: 0 },
			face: 0,
			sequence: nextSequence(),
		});
	};

	// ── Consume (eat/drink) ──

	bot.consume = async (): Promise<void> => {
		bot.activateItem();
		// Wait for entity_status id=9 (eating complete) or timeout
		return new Promise<void>((resolve) => {
			const onStatus = (packet: Record<string, unknown>) => {
				if (
					(packet.entityId as number) === bot.entity.id &&
					(packet.entityStatus as number) === 9
				) {
					bot.client.removeListener("entity_event", onStatus);
					bot.usingHeldItem = false;
					resolve();
				}
			};
			bot.client.on("entity_event", onStatus);
			setTimeout(() => {
				bot.client.removeListener("entity_event", onStatus);
				bot.usingHeldItem = false;
				resolve();
			}, 5000);
		});
	};

	// ── Transfer ──

	bot.transfer = async (opts: TransferOptions): Promise<void> => {
		const {
			window: win,
			sourceStart,
			sourceEnd,
			destStart,
			destEnd,
			itemType,
			metadata,
		} = opts;
		let remaining = opts.count ?? Number.POSITIVE_INFINITY;
		let firstSourceSlot: number | null = null;

		for (let i = sourceStart; i < sourceEnd && remaining > 0; i++) {
			const item = win.slots[i];
			if (!item || item.type !== itemType) continue;
			if (metadata != null && item.metadata !== metadata) continue;

			if (firstSourceSlot === null) firstSourceSlot = i;

			// Pick up the source item
			if (remaining < item.count) {
				// Need only part of this stack — right-click to pick up half, or pick up all and put back
				await bot.clickWindow(i, 0, 0);
			} else {
				await bot.clickWindow(i, 0, 0);
			}

			// Try to place into destination range
			for (let j = destStart; j < destEnd; j++) {
				const destItem = win.slots[j];
				if (destItem == null) {
					// Empty slot — drop all
					await bot.clickWindow(j, 0, 0);
					break;
				} else if (
					destItem.type === itemType &&
					(metadata == null || destItem.metadata === metadata) &&
					destItem.count < destItem.stackSize
				) {
					// Matching partial stack — fill it
					await bot.clickWindow(j, 0, 0);
					if (!win.selectedItem) break;
				}
			}

			// If still holding items, put them back
			if (win.selectedItem) {
				await bot.putSelectedItemRange(
					sourceStart,
					sourceEnd,
					win,
					firstSourceSlot,
				);
			}

			remaining -= item.count;
		}
	};

	// ── Open block/entity ──

	bot.openBlock = async (
		block: Vec3,
		direction?: Vec3,
		cursorPos?: Vec3,
	): Promise<Window> => {
		bot.activateBlock(block, direction, cursorPos);
		const [window] = await once<[Window]>(bot, "windowOpen", WINDOW_TIMEOUT);
		return window;
	};

	bot.openEntity = async (entity: Entity): Promise<Window> => {
		bot.useOn(entity);
		const [window] = await once<[Window]>(bot, "windowOpen", WINDOW_TIMEOUT);
		return window;
	};

	// ── Equip ──

	bot.equip = async (
		item: Item | number,
		destination: EquipmentDestination | null,
	): Promise<void> => {
		// Simplified: find item in inventory, click to equip slot
		const destSlot = getEquipSlot(destination);
		if (destSlot === -1) return;

		const itemType = typeof item === "number" ? item : item.type;
		for (let i = 0; i < bot.inventory.slots.length; i++) {
			const slotItem = bot.inventory.slots[i];
			if (slotItem && slotItem.type === itemType) {
				await bot.clickWindow(i, 0, 0);
				await bot.clickWindow(destSlot, 0, 0);
				return;
			}
		}
	};

	bot.unequip = async (
		destination: EquipmentDestination | null,
	): Promise<void> => {
		const destSlot = getEquipSlot(destination);
		if (destSlot === -1) return;
		if (bot.inventory.slots[destSlot]) {
			await bot.clickWindow(destSlot, 0, 0);
			// Put away
			for (let i = 9; i < 45; i++) {
				if (!bot.inventory.slots[i]) {
					await bot.clickWindow(i, 0, 0);
					return;
				}
			}
		}
	};

	// ── Toss ──

	bot.tossStack = async (item: Item): Promise<void> => {
		for (let i = 0; i < bot.inventory.slots.length; i++) {
			if (bot.inventory.slots[i] === item) {
				await bot.clickWindow(i, 0, 4); // mode 4 = drop
				return;
			}
		}
	};

	bot.toss = async (
		itemType: number,
		_metadata: number | null,
		count: number | null,
	): Promise<void> => {
		let remaining = count ?? 1;
		for (let i = 0; i < bot.inventory.slots.length && remaining > 0; i++) {
			const item = bot.inventory.slots[i];
			if (item && item.type === itemType) {
				await bot.clickWindow(i, 0, 4);
				remaining--;
			}
		}
	};

	bot.putSelectedItemRange = async (
		start: number,
		end: number,
		window: Window,
		slot: number,
	): Promise<void> => {
		// While we're holding an item (selectedItem), try to put it away
		while (window.selectedItem) {
			// First, try to find a matching partial stack to fill
			let destSlot: number | null = null;
			for (let i = start; i < end; i++) {
				const item = window.slots[i];
				if (
					item &&
					item.type === window.selectedItem.type &&
					item.metadata === window.selectedItem.metadata &&
					item.count < item.stackSize
				) {
					destSlot = i;
					break;
				}
			}

			// If no partial stack, find an empty slot
			if (destSlot === null) {
				for (let i = start; i < end; i++) {
					if (!window.slots[i]) {
						destSlot = i;
						break;
					}
				}
			}

			// If no space at all, toss
			if (destSlot === null) {
				if (slot != null) {
					await bot.clickWindow(slot, 0, 0);
				}
				await bot.clickWindow(-999, 0, 0);
				break;
			}

			await bot.clickWindow(destSlot, 0, 0);
		}
	};

	bot.putAway = async (slot: number): Promise<void> => {
		const window = bot.currentWindow ?? bot.inventory;
		if (!window) return;
		await bot.clickWindow(slot, 0, 0); // Pick up the item
		await bot.putSelectedItemRange(
			window.inventoryStart,
			window.inventoryEnd,
			window,
			slot,
		);
	};

	bot.moveSlotItem = async (
		sourceSlot: number,
		destSlot: number,
	): Promise<void> => {
		await bot.clickWindow(sourceSlot, 0, 0); // Pick up from source
		await bot.clickWindow(destSlot, 0, 0); // Place at dest
		// If we still have an item (swap occurred), put it back
		const window = bot.currentWindow ?? bot.inventory;
		if (window?.selectedItem) {
			await bot.clickWindow(sourceSlot, 0, 0);
		}
	};
};

const getEquipSlot = (dest: EquipmentDestination | null): number => {
	switch (dest) {
		case "hand":
			return 36;
		case "off-hand":
			return 45;
		case "head":
			return 5;
		case "torso":
			return 6;
		case "legs":
			return 7;
		case "feet":
			return 8;
		default:
			return -1;
	}
};
