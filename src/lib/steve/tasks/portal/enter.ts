/**
 * Portal entry - pathfind into nether/end portals
 */

import type { Bot } from "typecraft";
import { getPathfinder, goTo } from "../../lib/bot-utils.ts";
import type { Block, StepResult } from "../../types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Enter a portal by pathfinding into it (canDig disabled to avoid breaking obsidian)
 */
export const enterPortal = async (
	bot: Bot,
	portalPos?: { x: number; y: number; z: number },
): Promise<StepResult> => {
	let target = portalPos;

	if (!target) {
		const portal = bot.findBlock({
			matching: (name) => name === "nether_portal" || name === "end_portal",
			maxDistance: 64,
		}) as Block | null;
		if (!portal) return { success: false, message: "No portal found nearby" };
		target = portal.position;
	}

	const pf = getPathfinder(bot);
	pf.setMovements({ canDig: false });

	try {
		await goTo(bot, target, { range: 0, timeout: 30000 });
	} catch {
		// Even if nav errors, we might still be in the portal
	} finally {
		pf.setMovements({});
	}

	// Wait for dimension change
	const startDim = bot.game.dimension;
	for (let i = 0; i < 20; i++) {
		await sleep(500);
		if (bot.game.dimension !== startDim) {
			return {
				success: true,
				message: `Entered portal - now in ${bot.game.dimension}`,
			};
		}
	}

	return { success: false, message: "Portal did not teleport" };
};

/**
 * Enter the end portal
 */
export const enterEndPortal = async (bot: Bot): Promise<StepResult> => {
	const portal = bot.findBlock({
		matching: (name) => name === "end_portal",
		maxDistance: 64,
	}) as Block | null;

	if (!portal) {
		return { success: false, message: "End portal not found or not active" };
	}

	try {
		await goTo(bot, portal.position, { range: 0, timeout: 30000 });
	} catch {
		// May already be in the portal
	}

	for (let i = 0; i < 20; i++) {
		await sleep(500);
		if (String(bot.game.dimension).includes("end")) {
			return { success: true, message: "Entered The End!" };
		}
	}

	return { success: false, message: "Failed to enter The End" };
};
