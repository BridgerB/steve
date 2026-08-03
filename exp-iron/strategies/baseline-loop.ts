/**
 * Control #2: call the REAL mineBlock REPEATEDLY (like the production run-loop does),
 * until raw_iron>=3 or the 150s budget runs out. Isolates "slow-but-resumable descent"
 * from "single-call early-return" — if this passes but baseline doesn't, the descent is
 * merely too slow to finish in one call.
 */
import type { Bot } from "typecraft";
import { mineBlock } from "../../src/lib/steve/tasks/mining/main.ts";
import { countInventoryItems } from "../../src/lib/steve/lib/test-utils.ts";
import type { StepResult } from "../../src/lib/steve/types.ts";

export const run = async (bot: Bot): Promise<StepResult> => {
	const deadline = Date.now() + 145000;
	let last: StepResult = { success: false, message: "no call" };
	while (Date.now() < deadline && countInventoryItems(bot, "raw_iron") < 3) {
		last = await mineBlock(bot, "iron_ore", 5);
	}
	return last;
};
