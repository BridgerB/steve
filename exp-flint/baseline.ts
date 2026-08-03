/**
 * BASELINE — the current production craftFlintAndSteel, to reproduce ~0%.
 */
import type { Bot } from "typecraft";
import { craftFlintAndSteel } from "../src/lib/steve/tasks/craft/main.ts";
import type { StepResult } from "../src/lib/steve/types.ts";

export const run = (bot: Bot): Promise<StepResult> => craftFlintAndSteel(bot);
