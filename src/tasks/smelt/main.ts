/**
 * Smelting tasks - use furnace to process ores and food
 */

import type { Bot } from "typecraft";
import { distance, offset, windowItems } from "typecraft";
import type { StepResult, Block } from "../../types.ts";

/**
 * Place furnace if not already placed, then smelt items
 */
export const smeltItems = async (
	bot: Bot,
	inputItem: string,
	count: number,
): Promise<StepResult> => {
	// Find or place a furnace
	let furnace = bot.findBlock({
		matching: (name) => name === "furnace" || name === "lit_furnace",
		maxDistance: 32,
	}) as Block | null;

	if (!furnace) {
		// Try to place a furnace from inventory
		const furnaceItem = windowItems(bot.inventory).find(
			(i) => i.name === "furnace",
		);

		if (!furnaceItem) {
			return { success: false, message: "No furnace in inventory or nearby" };
		}

		// Find a place to put it
		const ground = bot.blockAt(
			offset(bot.entity.position, 1, -1, 0),
		) as Block | null;
		if (!ground) {
			return { success: false, message: "Cannot find place for furnace" };
		}

		try {
			await bot.equip(furnaceItem, "hand");
			await bot.placeBlock(ground, { x: 0, y: 1, z: 0 });

			// Find the placed furnace
			furnace = bot.findBlock({
				matching: (name) => name === "furnace",
				maxDistance: 4,
			}) as Block | null;

			if (!furnace) {
				return { success: false, message: "Failed to place furnace" };
			}
		} catch (err) {
			return {
				success: false,
				message: err instanceof Error ? err.message : "Failed to place furnace",
			};
		}
	}

	// Move closer to furnace if needed
	const dist = distance(bot.entity.position, furnace.position);
	if (dist > 4) {
		await bot.lookAt(furnace.position);
		bot.setControlState("forward", true);
		await new Promise((resolve) =>
			setTimeout(resolve, Math.min(dist * 150, 2000)),
		);
		bot.setControlState("forward", false);
	}

	try {
		// Open the furnace
		const furnaceWindow = await bot.openFurnace(furnace);

		// Get the items to smelt
		const itemsToSmelt = windowItems(bot.inventory).filter((i) =>
			i.name.includes(inputItem),
		);

		if (itemsToSmelt.length === 0) {
			bot.closeWindow(furnaceWindow);
			return { success: false, message: `No ${inputItem} to smelt` };
		}

		// Get fuel (coal or charcoal)
		const fuel = windowItems(bot.inventory).find(
			(i) => i.name === "coal" || i.name === "charcoal",
		);

		if (!fuel) {
			bot.closeWindow(furnaceWindow);
			return { success: false, message: "No fuel for furnace" };
		}

		// Put fuel in furnace
		await furnaceWindow.putFuel(fuel.type, null, Math.min(fuel.count, 8));

		// Put items to smelt
		const toSmelt = itemsToSmelt[0];
		const smeltCount = Math.min(toSmelt.count, count);
		await furnaceWindow.putInput(toSmelt.type, null, smeltCount);

		// Wait for smelting (roughly 10 seconds per item, but we'll wait in chunks)
		const smeltTime = smeltCount * 10 * 1000;
		const maxWait = Math.min(smeltTime, 60000); // Max 1 minute wait

		console.log(
			`  Smelting ${smeltCount} ${inputItem}... (waiting ${maxWait / 1000}s)`,
		);
		await new Promise((resolve) => setTimeout(resolve, maxWait));

		// Take output
		const output = furnaceWindow.outputItem();
		if (output) {
			await furnaceWindow.takeOutput();
		}

		bot.closeWindow(furnaceWindow);

		return {
			success: true,
			message: `Smelted ${smeltCount} ${inputItem}`,
		};
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Smelting failed",
		};
	}
};
