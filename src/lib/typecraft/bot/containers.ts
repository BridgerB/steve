/**
 * Specialized container interactions — chest, furnace, anvil, enchantment table,
 * villager, creative mode, command blocks.
 */

import type { Entity } from "../entity/index.ts";
import { fromNotch, type Item } from "../item/index.ts";
import type { Vec3 } from "../vec3/index.ts";
import type { Window } from "../window/index.ts";
import type {
	AnvilWindow,
	Bot,
	BotOptions,
	EnchantmentTableWindow,
	FurnaceWindow,
	VillagerTrade,
	VillagerWindow,
} from "./types.ts";

/** Writable version of Vec3 for entity position mutation. */
type MutableVec3 = { x: number; y: number; z: number };

export const initContainers = (bot: Bot, _options: BotOptions): void => {
	bot.openChest = async (
		chestBlock: unknown,
		direction?: Vec3,
		cursorPos?: Vec3,
	): Promise<Window> => {
		const block = chestBlock as { position: Vec3 };
		return bot.openBlock(block.position, direction, cursorPos);
	};

	bot.openFurnace = async (furnaceBlock: unknown): Promise<FurnaceWindow> => {
		const block = furnaceBlock as { position: Vec3 };
		const window = await bot.openBlock(block.position);

		const allowedTypes = [
			"minecraft:furnace",
			"minecraft:blast_furnace",
			"minecraft:smoker",
		];
		const isMatch = allowedTypes.some((t) =>
			window.type.toString().startsWith(t),
		);
		if (!isMatch) throw new Error(`Not a furnace-like window: ${window.type}`);

		const furnace = window as unknown as FurnaceWindow;
		furnace.fuel = null;
		furnace.totalFuel = null;
		furnace.fuelSeconds = null;
		furnace.totalFuelSeconds = null;
		furnace.progress = null;
		furnace.totalProgress = null;
		furnace.progressSeconds = null;
		furnace.totalProgressSeconds = null;

		furnace.inputItem = () => furnace.slots[0] ?? null;
		furnace.fuelItem = () => furnace.slots[1] ?? null;
		furnace.outputItem = () => furnace.slots[2] ?? null;

		furnace.takeInput = async () => {
			if (furnace.slots[0]) await bot.putAway(0);
		};
		furnace.takeFuel = async () => {
			if (furnace.slots[1]) await bot.putAway(1);
		};
		furnace.takeOutput = async () => {
			if (furnace.slots[2]) await bot.putAway(2);
		};

		furnace.putInput = async (
			itemType: number,
			metadata: number | null,
			count: number,
		) => {
			await bot.transfer({
				window: furnace,
				itemType,
				metadata,
				count,
				sourceStart: furnace.inventoryStart,
				sourceEnd: furnace.inventoryEnd,
				destStart: 0,
				destEnd: 1,
			});
		};

		furnace.putFuel = async (
			itemType: number,
			metadata: number | null,
			count: number,
		) => {
			await bot.transfer({
				window: furnace,
				itemType,
				metadata,
				count,
				sourceStart: furnace.inventoryStart,
				sourceEnd: furnace.inventoryEnd,
				destStart: 1,
				destEnd: 2,
			});
		};

		const onProperty = (packet: Record<string, unknown>) => {
			if ((packet.windowId as number) !== furnace.id) return;
			const prop = packet.property as number;
			const value = packet.value as number;

			switch (prop) {
				case 0: // Current fuel tick
					furnace.fuel = furnace.totalFuel ? value / furnace.totalFuel : 0;
					furnace.fuelSeconds = furnace.totalFuelSeconds
						? furnace.fuel * furnace.totalFuelSeconds
						: 0;
					break;
				case 1: // Total fuel ticks
					furnace.totalFuel = value;
					furnace.totalFuelSeconds = value * 0.05;
					break;
				case 2: // Current progress
					furnace.progress = furnace.totalProgress
						? value / furnace.totalProgress
						: 0;
					furnace.progressSeconds = furnace.totalProgressSeconds
						? furnace.totalProgressSeconds -
							furnace.progress * furnace.totalProgressSeconds
						: 0;
					break;
				case 3: // Total progress
					furnace.totalProgress = value;
					furnace.totalProgressSeconds = value * 0.05;
					break;
			}
		};

		bot.client.on("container_set_data", onProperty);

		// Clean up listener when window closes
		bot.on("windowClose", (w: Window) => {
			if (w.id === furnace.id) {
				bot.client.removeListener("container_set_data", onProperty);
			}
		});

		return furnace;
	};

	bot.openAnvil = async (anvilBlock: unknown): Promise<AnvilWindow> => {
		const block = anvilBlock as { position: Vec3 };
		const window = await bot.openBlock(block.position);

		if (!/minecraft:(?:chipped_|damaged_)?anvil/.test(window.type.toString())) {
			throw new Error(`Not an anvil window: ${window.type}`);
		}

		const anvil = window as unknown as AnvilWindow;

		const sendItemName = (name: string) => {
			bot.client.write("rename_item", { name });
		};

		const addCustomName = async (name?: string) => {
			if (!name) return;
			for (let i = 1; i <= name.length; i++) {
				sendItemName(name.substring(0, i));
				await new Promise((r) => setTimeout(r, 50));
			}
		};

		const putSomething = async (
			destSlot: number,
			itemType: number,
			metadata: number | null,
			count: number,
		) => {
			await bot.transfer({
				window: anvil,
				itemType,
				metadata,
				count,
				sourceStart: anvil.inventoryStart,
				sourceEnd: anvil.inventoryEnd,
				destStart: destSlot,
				destEnd: destSlot + 1,
			});
		};

		anvil.combine = async (
			itemOne: Item,
			itemTwo: Item,
			name?: string,
		): Promise<void> => {
			if (name && name.length > 35) throw new Error("Name is too long");

			// Place items in slots
			await putSomething(0, itemOne.type, itemOne.metadata, itemOne.count);
			sendItemName("");
			sendItemName("");
			await putSomething(1, itemTwo.type, itemTwo.metadata, itemTwo.count);

			// Type custom name character by character
			await addCustomName(name);

			// Take result
			await bot.putAway(2);
		};

		anvil.rename = async (item: Item, name?: string): Promise<void> => {
			if (name && name.length > 35) throw new Error("Name is too long");

			await putSomething(0, item.type, item.metadata, item.count);
			sendItemName("");
			sendItemName("");
			await addCustomName(name);

			// Take result
			await bot.putAway(2);
		};

		return anvil;
	};

	bot.openEnchantmentTable = async (
		tableBlock: unknown,
	): Promise<EnchantmentTableWindow> => {
		const block = tableBlock as { position: Vec3 };
		const window = await bot.openBlock(block.position);

		if (!window.type.toString().startsWith("minecraft:enchant")) {
			throw new Error(`Not an enchantment table: ${window.type}`);
		}

		const table = window as unknown as EnchantmentTableWindow;
		table.xpseed = -1;
		table.enchantments = [
			{ level: -1, expected: { enchant: -1, level: -1 } },
			{ level: -1, expected: { enchant: -1, level: -1 } },
			{ level: -1, expected: { enchant: -1, level: -1 } },
		];

		let ready = false;

		table.targetItem = () => table.slots[0] ?? null;

		table.enchant = async (choice: number): Promise<Item | null> => {
			if (!ready) {
				await new Promise<void>((resolve) => {
					const check = () => {
						if (
							table.enchantments[0]!.level >= 0 &&
							table.enchantments[1]!.level >= 0 &&
							table.enchantments[2]!.level >= 0
						) {
							resolve();
						} else {
							setTimeout(check, 50);
						}
					};
					check();
				});
			}

			bot.client.write("container_button_click", {
				windowId: table.id,
				enchantment: choice,
			});

			// Wait for the item to update in slot 0
			await new Promise<void>((resolve) => {
				const onSlot = (
					slot: number,
					_old: Item | null,
					_newItem: Item | null,
				) => {
					if (slot === 0) {
						table.onSlotUpdate = prevOnSlot;
						resolve();
					}
				};
				const prevOnSlot = table.onSlotUpdate;
				table.onSlotUpdate = (slot, old, newItem) => {
					prevOnSlot?.(slot, old, newItem);
					onSlot(slot, old, newItem);
				};
			});

			return table.slots[0] ?? null;
		};

		table.takeTargetItem = async () => {
			if (table.slots[0]) await bot.putAway(0);
		};

		table.putTargetItem = async (item: Item) => {
			await bot.moveSlotItem((item as Item & { slot: number }).slot, 0);
		};

		table.putLapis = async (item: Item) => {
			await bot.moveSlotItem((item as Item & { slot: number }).slot, 1);
		};

		const onProperty = (packet: Record<string, unknown>) => {
			if ((packet.windowId as number) !== table.id) return;
			const prop = packet.property as number;
			const value = packet.value as number;

			if (prop < 3) {
				table.enchantments[prop]!.level = value;
			} else if (prop === 3) {
				table.xpseed = value;
			} else if (prop < 7) {
				table.enchantments[prop - 4]!.expected.enchant = value;
			} else if (prop < 10) {
				table.enchantments[prop - 7]!.expected.level = value;
			}

			if (
				!ready &&
				table.enchantments[0]!.level >= 0 &&
				table.enchantments[1]!.level >= 0 &&
				table.enchantments[2]!.level >= 0
			) {
				ready = true;
			}
		};

		bot.client.on("container_set_data", onProperty);
		bot.on("windowClose", (w: Window) => {
			if (w.id === table.id) {
				bot.client.removeListener("container_set_data", onProperty);
			}
		});

		return table;
	};

	bot.openVillager = async (
		villagerEntity: Entity,
	): Promise<VillagerWindow> => {
		const villagerPromise = bot.openEntity(villagerEntity);

		// Set up trade list listener before awaiting
		let tradesReady = false;
		let resolveReady: (() => void) | null = null;
		const readyPromise = new Promise<void>((r) => {
			resolveReady = r;
		});

		let villager: VillagerWindow;

		const onTradeList = (packet: Record<string, unknown>) => {
			const windowId = packet.windowId as number;
			if (villager && windowId !== villager.id) return;

			const trades = packet.trades as Array<Record<string, unknown>>;
			if (!trades || !bot.registry) return;

			villager.trades = trades.map((trade) => {
				const inputItem1 = fromNotch(bot.registry!, trade.inputItem1 as never);
				const outputItem = fromNotch(bot.registry!, trade.outputItem as never);
				const inputItem2Raw = trade.inputItem2;
				const inputItem2 = inputItem2Raw
					? fromNotch(bot.registry!, inputItem2Raw as never)
					: null;
				const hasItem2 = !!(inputItem2?.type && inputItem2.count);

				const demand = (trade.demand as number) ?? 0;
				const specialPrice = (trade.specialPrice as number) ?? 0;
				const priceMultiplier = (trade.priceMultiplier as number) ?? 0;
				const nbTradeUses = (trade.nbTradeUses as number) ?? 0;
				const maximumNbTradeUses = (trade.maximumNbTradeUses as number) ?? 0;
				const xp = (trade.xp as number) ?? 0;
				const tradeDisabled = (trade.tradeDisabled as boolean) ?? false;

				let realPrice = inputItem1?.count ?? 1;
				if (
					trade.demand !== undefined &&
					trade.specialPrice !== undefined &&
					inputItem1
				) {
					const demandDiff = Math.max(
						0,
						Math.floor(inputItem1.count * demand * priceMultiplier),
					);
					realPrice = Math.min(
						Math.max(inputItem1.count + specialPrice + demandDiff, 1),
						inputItem1.stackSize,
					);
				}

				return {
					inputItem1: inputItem1!,
					outputItem: outputItem!,
					inputItem2,
					hasItem2,
					tradeDisabled,
					nbTradeUses,
					maximumNbTradeUses,
					xp,
					specialPrice,
					priceMultiplier,
					demand,
					realPrice,
				} satisfies VillagerTrade;
			});

			if (!tradesReady) {
				tradesReady = true;
				resolveReady?.();
			}
		};

		bot.client.on("merchant_offers", onTradeList);

		const window = await villagerPromise;
		villager = window as unknown as VillagerWindow;
		villager.trades = null;
		villager.selectedTrade = null;

		villager.trade = async (index: number, count?: number) => {
			await bot.trade(villager, index, count);
		};

		// Clean up on close
		bot.on("windowClose", (w: Window) => {
			if (w.id === villager.id) {
				bot.client.removeListener("merchant_offers", onTradeList);
			}
		});

		// Wait for trades to be ready
		if (!tradesReady) await readyPromise;

		return villager;
	};

	// ── Trading ──

	bot.trade = async (
		villagerWindow: Window,
		index: number,
		count?: number,
	): Promise<void> => {
		const villager = villagerWindow as unknown as VillagerWindow;
		if (!villager.trades) throw new Error("No trades available");

		const trade = villager.trades[index];
		if (!trade) throw new Error("Invalid trade index");

		const times = count ?? trade.maximumNbTradeUses - trade.nbTradeUses;
		if (trade.maximumNbTradeUses - trade.nbTradeUses <= 0)
			throw new Error("Trade blocked");

		// Select the trade
		bot.client.write("select_trade", { slot: index });

		for (let i = 0; i < times; i++) {
			// Deposit required items
			const slot1 = villager.slots[0];
			const input1Needed = slot1
				? Math.max(0, trade.realPrice - slot1.count)
				: trade.realPrice;

			if (input1Needed > 0) {
				await bot.transfer({
					window: villager,
					itemType: trade.inputItem1.type,
					metadata: trade.inputItem1.metadata,
					count: input1Needed,
					sourceStart: villager.inventoryStart,
					sourceEnd: villager.inventoryEnd,
					destStart: 0,
					destEnd: 1,
				});
			}

			if (trade.hasItem2 && trade.inputItem2) {
				const slot2 = villager.slots[1];
				const input2Needed = slot2
					? Math.max(0, trade.inputItem2.count - slot2.count)
					: trade.inputItem2.count;

				if (input2Needed > 0) {
					await bot.transfer({
						window: villager,
						itemType: trade.inputItem2.type,
						metadata: trade.inputItem2.metadata,
						count: input2Needed,
						sourceStart: villager.inventoryStart,
						sourceEnd: villager.inventoryEnd,
						destStart: 1,
						destEnd: 2,
					});
				}
			}

			trade.nbTradeUses++;
			if (trade.maximumNbTradeUses - trade.nbTradeUses === 0) {
				trade.tradeDisabled = true;
			}

			// Take the output
			await bot.putAway(2);
		}

		// Clean up leftover items in input slots
		if (villager.slots[0]) await bot.putAway(0);
		if (villager.slots[1]) await bot.putAway(1);
	};

	// ── Creative mode ──

	bot.creative = {
		setInventorySlot: async (
			slot: number,
			item: Item | null,
		): Promise<void> => {
			bot.client.write("set_creative_mode_slot", {
				slot,
				item: item
					? {
							present: true,
							itemId: item.type,
							itemCount: item.count,
							nbtData: item.nbt ?? undefined,
						}
					: { present: false },
			});
		},

		clearSlot: async (slot: number): Promise<void> => {
			await bot.creative.setInventorySlot(slot, null);
		},

		clearInventory: async (): Promise<void> => {
			for (let i = 0; i < 46; i++) {
				await bot.creative.setInventorySlot(i, null);
			}
		},

		flyTo: async (destination: Vec3): Promise<void> => {
			bot.creative.startFlying();
			const speed = 0.5; // blocks per tick

			while (true) {
				const pos = bot.entity.position;
				const dx = destination.x - pos.x;
				const dy = destination.y - pos.y;
				const dz = destination.z - pos.z;
				const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

				if (dist <= speed) {
					// Close enough — snap to destination
					const mpos = bot.entity.position as MutableVec3;
					mpos.x = destination.x;
					mpos.y = destination.y;
					mpos.z = destination.z;
					break;
				}

				// Move one step toward destination
				const factor = speed / dist;
				const mpos = bot.entity.position as MutableVec3;
				mpos.x += dx * factor;
				mpos.y += dy * factor;
				mpos.z += dz * factor;

				// Zero velocity to prevent physics interference
				const vel = bot.entity.velocity as MutableVec3;
				vel.x = 0;
				vel.y = 0;
				vel.z = 0;

				await bot.waitForTicks(1);
			}

			// Wait one tick for server to sync
			await bot.waitForTicks(1);
		},

		startFlying: () => {
			bot.client.write("player_abilities", {
				flags: 0x06, // flying + allow flying
				flyingSpeed: 0.05,
				walkingSpeed: 0.1,
			});
		},

		stopFlying: () => {
			bot.client.write("player_abilities", {
				flags: 0x04, // allow flying but not flying
				flyingSpeed: 0.05,
				walkingSpeed: 0.1,
			});
		},
	};
};
