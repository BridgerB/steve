/**
 * WINNER: the PATCHED mineBlock (from exp-iron/mining-patched.ts), called ONCE —
 * exactly as the gym invokes the real step. This measures the true end-to-end
 * behaviour of the proposed patch (fast vertical descent + fall-through branch-mine).
 */
import type { Bot } from "typecraft";
import { mineBlock } from "../mining-patched.ts";
import type { StepResult } from "../../src/lib/steve/types.ts";

export const run = (bot: Bot): Promise<StepResult> => mineBlock(bot, "iron_ore", 5);
