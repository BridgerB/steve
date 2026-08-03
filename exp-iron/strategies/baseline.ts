/** Control: the REAL mineBlock, called once, exactly as the gym does today. */
import type { Bot } from "typecraft";
import { mineBlock } from "../../src/lib/steve/tasks/mining/main.ts";
import type { StepResult } from "../../src/lib/steve/types.ts";

export const run = (bot: Bot): Promise<StepResult> => mineBlock(bot, "iron_ore", 5);
