/**
 * Portal entry - entering nether and end portals
 */

import type { Bot } from "typecraft";
import type { Block, StepResult } from "../../types.ts";

/**
 * Enter a portal (nether or end)
 */
export const enterPortal = async (bot: Bot): Promise<StepResult> => {
	const portal = bot.findBlock({
		matching: (name) => name === "nether_portal" || name === "end_portal",
		maxDistance: 16,
	}) as Block | null;

	if (!portal) {
		return { success: false, message: "No portal found nearby" };
	}

	try {
		await bot.lookAt(portal.position);
		bot.setControlState("forward", true);

		const startDim = bot.game.dimension;
		let changed = false;

		for (let i = 0; i < 20; i++) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			if (bot.game.dimension !== startDim) {
				changed = true;
				break;
			}
		}

		bot.setControlState("forward", false);

		if (changed) {
			return {
				success: true,
				message: `Entered portal - now in ${bot.game.dimension}`,
			};
		} else {
			return { success: false, message: "Portal did not teleport" };
		}
	} catch (err) {
		bot.setControlState("forward", false);
		return {
			success: false,
			message: err instanceof Error ? err.message : "Failed to enter portal",
		};
	}
};

/**
 * Enter the end portal
 */
export const enterEndPortal = async (bot: Bot): Promise<StepResult> => {
	const portal = bot.findBlock({
		matching: (name) => name === "end_portal",
		maxDistance: 16,
	}) as Block | null;

	if (!portal) {
		return { success: false, message: "End portal not found or not active" };
	}

	try {
		await bot.lookAt(portal.position);
		bot.setControlState("forward", true);

		for (let i = 0; i < 20; i++) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			if (String(bot.game.dimension).includes("end")) {
				bot.setControlState("forward", false);
				return { success: true, message: "Entered The End!" };
			}
		}

		bot.setControlState("forward", false);
		return { success: false, message: "Failed to enter The End" };
	} catch (err) {
		bot.setControlState("forward", false);
		return {
			success: false,
			message: err instanceof Error ? err.message : "Failed to enter portal",
		};
	}
};
