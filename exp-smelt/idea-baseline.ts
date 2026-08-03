/**
 * BASELINE — the current production task called EXACTLY the way the gym does it:
 * smeltItems(bot, 8). Confirms the "No 8 to smelt" root cause live.
 */
import type { Bot } from "typecraft";
import { smeltItems } from "../src/lib/steve/tasks/smelt/main.ts";
import type { StepResult } from "../src/lib/steve/types.ts";

export const run = (bot: Bot): Promise<StepResult> =>
	(smeltItems as unknown as (b: Bot, n: number) => Promise<StepResult>)(bot, 8);
