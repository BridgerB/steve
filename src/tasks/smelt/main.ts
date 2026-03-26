/**
 * Smelting tasks - use furnace to process ores and food
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3, windowItems } from "typecraft";
import { goTo, sleep } from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { Block, StepResult } from "../../types.ts";

const isFurnace = (name: string) =>
	name === "furnace" || name === "lit_furnace";

/**
 * Place furnace if not already placed, then smelt items
 */
export const smeltItems = async (
	bot: Bot,
	inputItem: string,
	count: number,
): Promise<StepResult> => {
	// Find furnace — check adjacent blocks first (findBlock misses recently placed)
	let furnace: Block | null = null;
	const pos = bot.entity.position;
	for (const [dx, dy, dz] of [
		[0, 0, 0],
		[1, 0, 0],
		[-1, 0, 0],
		[0, 0, 1],
		[0, 0, -1],
		[0, -1, 0],
		[0, 1, 0],
		[1, 0, 1],
		[-1, 0, 1],
		[1, 0, -1],
		[-1, 0, -1],
		[1, 1, 0],
		[-1, 1, 0],
		[0, 1, 1],
	] as const) {
		const b = bot.blockAt(
			vec3(
				Math.floor(pos.x) + dx,
				Math.floor(pos.y) + dy,
				Math.floor(pos.z) + dz,
			),
		);
		if (b && isFurnace(b.name)) {
			furnace = b;
			break;
		}
	}

	// Fallback to findBlock
	if (!furnace) {
		const found = bot.findBlock({
			matching: (name) => isFurnace(name),
			maxDistance: 32,
		});
		if (found) furnace = found;
	}

	if (!furnace) {
		// Place furnace from inventory
		const furnaceItem = windowItems(bot.inventory).find(
			(i) => i.name === "furnace",
		);
		if (!furnaceItem) {
			return { success: false, message: "No furnace in inventory or nearby" };
		}

		// Find solid ground to place on
		const positions = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		] as const;
		let ground: Block | null = null;
		for (const [dx, dz] of positions) {
			const g = bot.blockAt(offset(bot.entity.position, dx, -1, dz));
			if (!g || g.name === "air" || g.name === "water" || g.name === "lava")
				continue;
			const above = bot.blockAt(offset(g.position, 0, 1, 0));
			if (above && above.name !== "air") continue;
			// Don't place on top of existing furnace/table
			if (isFurnace(g.name) || g.name === "crafting_table") continue;
			ground = g;
			break;
		}

		if (!ground) {
			return { success: false, message: "Cannot find place for furnace" };
		}

		try {
			await bot.equip(furnaceItem, "hand");
			await sleep(300);
			await bot.placeBlock(ground, vec3(0, 1, 0));
			await sleep(500);

			// Check exact expected position
			const placed = bot.blockAt(offset(ground.position, 0, 1, 0));
			if (placed && isFurnace(placed.name)) {
				furnace = placed;
			} else {
				// Fallback search
				const found = bot.findBlock({
					matching: (name) => isFurnace(name),
					maxDistance: 4,
				});
				if (found) furnace = found;
			}

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

	// Navigate to furnace
	const furnaceDist = distance(bot.entity.position, furnace.position);
	if (furnaceDist > 4) {
		await goTo(bot, furnace.position, { range: 2, timeout: 10000 });
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

		// Get fuel — coal/charcoal preferred, planks/logs as fallback
		let fuel = windowItems(bot.inventory).find(
			(i) => i.name === "coal" || i.name === "charcoal",
		);
		if (!fuel) {
			fuel = windowItems(bot.inventory).find(
				(i) => i.name.includes("planks") || i.name.includes("_log"),
			);
		}

		if (!fuel) {
			bot.closeWindow(furnaceWindow);
			return { success: false, message: "No fuel for furnace" };
		}

		// Put fuel in furnace
		await furnaceWindow.putFuel(fuel.type, null, Math.min(fuel.count, 8));

		// Put items to smelt
		const toSmelt = itemsToSmelt[0];
		if (!toSmelt) {
			bot.closeWindow(furnaceWindow);
			return { success: false, message: `No ${inputItem} in inventory` };
		}
		const smeltCount = Math.min(toSmelt.count, count);
		await furnaceWindow.putInput(toSmelt.type, null, smeltCount);

		// Wait for smelting (10s per item)
		const smeltTime = smeltCount * 10 * 1000;
		const maxWait = Math.min(smeltTime, 60000);

		logEvent(
			"smelt",
			"waiting",
			`${smeltCount}x ${inputItem} (${maxWait / 1000}s)`,
		);
		await sleep(maxWait);

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
