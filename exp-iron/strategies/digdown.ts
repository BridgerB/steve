/**
 * WINNER candidate: replace the slow diagonal staircase descent with a FAST vertical
 * dig-down to the iron band, then hand off to the REAL branch-miner (mineBlock, which
 * at y<=42 skips its own descent and strip-mines the band). This is the exact shape of
 * the proposed patch to mining/main.ts.
 */
import type { Bot } from "typecraft";
import { mineBlock } from "../../src/lib/steve/tasks/mining/main.ts";
import { countInventoryItems } from "../../src/lib/steve/lib/test-utils.ts";
import type { StepResult } from "../../src/lib/steve/types.ts";
import { digDownTo, floorY } from "./common.ts";

const TARGET_Y = Number(process.env.TARGET_Y ?? 42);

export const run = async (bot: Bot): Promise<StepResult> => {
	const budget = Date.now() + 145000;
	// Fast vertical descent to just above the iron band (mineDeepOre uses level=40).
	const dd = await digDownTo(bot, TARGET_Y, Date.now() + 55000);
	// Now branch-mine at the band. mineBlock re-descends only if floorY>level+2, so once
	// we're near y42 it goes straight to strip-mining. Loop in case a single call bails.
	let last: StepResult = { success: true, message: `descended to y=${dd.y} (${dd.stopped ?? "band"})` };
	while (Date.now() < budget && countInventoryItems(bot, "raw_iron") < 3) {
		last = await mineBlock(bot, "iron_ore", 5);
		if (floorY(bot) < 8) break; // fell into the deeps somehow — stop
	}
	return last;
};
