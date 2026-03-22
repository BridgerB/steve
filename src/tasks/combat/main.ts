/**
 * Combat tasks - fighting hostile mobs
 */

import type { Bot } from "typecraft";
import { offset } from "typecraft";
import type { StepResult } from "../../types.ts";
import {
  attackUntilDead,
  countItems,
  equipItem,
  findNearestEntity,
  moveCloser,
  searchForEntities,
} from "../../lib/bot-utils.ts";

/**
 * Hunt endermen for ender pearls
 */
export const huntEndermen = async (
  bot: Bot,
  targetPearls: number,
): Promise<StepResult> => {
  let pearlsCollected = 0;

  // Get sword ready
  await equipItem(bot, "sword", "hand");

  const maxAttempts = 30;
  let attempts = 0;

  while (pearlsCollected < targetPearls && attempts < maxAttempts) {
    attempts++;

    // Find enderman
    const enderman = findNearestEntity(bot, (e) => e.name === "enderman");

    if (!enderman) {
      console.log("  Searching for endermen...");
      await searchForEntities(bot, 3000);
      continue;
    }

    try {
      // IMPORTANT: Don't look at enderman's eyes before attacking
      // Look at their feet to avoid aggro until ready
      await moveCloser(bot, enderman.position, {
        maxDistance: 3,
        maxWalkTime: 2000,
      });

      // Attack - look at legs, not head
      await bot.lookAt(offset(enderman.position, 0, 1, 0));

      const killed = await attackUntilDead(bot, enderman, {
        maxHits: 10,
        hitDelay: 400,
        lookHeight: 1,
      });

      if (killed) {
        console.log("  Enderman killed!");
        pearlsCollected++;
      }
    } catch {
      console.log("  Enderman escaped or teleported");
    }
  }

  // Count actual pearls in inventory
  const actualPearls = countItems(bot, "ender_pearl");

  return {
    success: actualPearls >= targetPearls,
    message: `Collected ${actualPearls} ender pearls`,
  };
};
