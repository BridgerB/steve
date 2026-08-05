/**
 * Portal entry - pathfind into nether/end portals
 */

import type { Bot } from "typecraft";
import { vec3 } from "typecraft";
import { getPathfinder, goTo, walkToXZ } from "../../lib/bot-utils.ts";
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

	const startDim = bot.game.dimension;
	// Success = specifically reaching the nether/end — NOT merely any dimension change.
	// (The old `!= startDim` check false-fired on a transient overworld baseline.)
	const teleported = () => {
		const d = String(bot.game.dimension ?? "");
		return d !== String(startDim) && (d.includes("nether") || d.includes("end"));
	};

	const pf = getPathfinder(bot);
	pf.setMovements({ canDig: false });
	try {
		await goTo(bot, target, { range: 0, timeout: 30000 });
	} catch {
		// Even if nav errors, we might still be in the portal.
	}

	// A nether portal only teleports after ~4s STANDING inside it. goTo can leave the bot
	// on the portal's edge or let it drift out, so actively re-center ON the portal column
	// each pass and hold there until the dimension flips (up to ~12s).
	const cx = target.x + 0.5;
	const cz = target.z + 0.5;
	try {
		for (let i = 0; i < 24 && !teleported(); i++) {
			const p = bot.entity.position;
			if (Math.abs(p.x - cx) > 0.4 || Math.abs(p.z - cz) > 0.4) {
				await walkToXZ(bot, cx, cz, { targetDist: 0.3, maxTime: 1500 });
			} else {
				bot.lookAt?.(vec3(cx, target.y + 1, cz));
				await sleep(500);
			}
		}
	} finally {
		bot.setControlState("forward", false);
		pf.setMovements({});
	}

	if (teleported()) {
		return {
			success: true,
			message: `Entered portal - now in ${bot.game.dimension}`,
		};
	}
	return {
		success: false,
		message: `Portal did not teleport (dim=${bot.game.dimension})`,
	};
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
