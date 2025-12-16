/**
 * Wood gathering task - punch trees to get logs
 */

import type { Bot } from "mineflayer";
import type { StepResult } from "../../types.ts";

export const gatherWood = async (
  bot: Bot,
  targetCount: number,
): Promise<StepResult> => {
  const logTypes = [
    "oak_log",
    "birch_log",
    "spruce_log",
    "jungle_log",
    "acacia_log",
    "dark_oak_log",
    "mangrove_log",
    "cherry_log",
  ];

  let logsGathered = 0;
  let searchAttempts = 0;
  const maxSearchAttempts = 5;

  while (logsGathered < targetCount) {
    // Find nearest log
    const log = bot.findBlock({
      matching: (block) => logTypes.includes(block.name),
      maxDistance: 64,
    });

    if (!log) {
      // Try exploring to find trees
      if (searchAttempts < maxSearchAttempts) {
        searchAttempts++;
        console.log(
          `  No trees found, exploring... (attempt ${searchAttempts}/${maxSearchAttempts})`,
        );

        // Walk in a random direction
        const angle = Math.random() * Math.PI * 2;
        const lookX = bot.entity.position.x + Math.cos(angle) * 10;
        const lookZ = bot.entity.position.z + Math.sin(angle) * 10;
        await bot.lookAt(
          bot.entity.position.offset(
            lookX - bot.entity.position.x,
            0,
            lookZ - bot.entity.position.z,
          ),
        );

        bot.setControlState("forward", true);
        bot.setControlState("sprint", true);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        bot.setControlState("forward", false);
        bot.setControlState("sprint", false);
        continue;
      }

      return {
        success: false,
        message:
          `Could not find any trees nearby (gathered ${logsGathered}/${targetCount})`,
      };
    }

    // Reset search attempts when we find a log
    searchAttempts = 0;

    try {
      // Navigate to the log if needed
      const distance = bot.entity.position.distanceTo(log.position);
      if (distance > 4) {
        // Simple walk towards block
        await bot.lookAt(log.position);
        bot.setControlState("forward", true);
        await new Promise((resolve) => setTimeout(resolve, distance * 200));
        bot.setControlState("forward", false);
      }

      // Mine the log
      await bot.lookAt(log.position.offset(0.5, 0.5, 0.5));
      await bot.dig(log);
      logsGathered++;
      console.log(`  Gathered log ${logsGathered}/${targetCount}`);

      // Wait for item to drop and pick it up
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Find items close to where the log was (not all items everywhere)
      const nearbyItems = Object.values(bot.entities).filter(
        (e) =>
          e.entityType === bot.registry.entitiesByName.item?.id &&
          e.position.distanceTo(log.position) < 5,
      );

      // Sort by distance to pick up closest first
      nearbyItems.sort((a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position)
      );

      for (const item of nearbyItems) {
        if (!bot.entities[item.id]) continue; // Already picked up

        const dist = bot.entity.position.distanceTo(item.position);
        if (dist > 2) {
          await bot.lookAt(item.position);
          bot.setControlState("forward", true);

          // Walk until we pick it up (item disappears from entities)
          for (let i = 0; i < 50; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (!bot.entities[item.id]) {
              break; // Picked up!
            }
            // Re-aim if item moved
            if (bot.entities[item.id]) {
              await bot.lookAt(bot.entities[item.id].position);
            }
          }

          bot.setControlState("forward", false);
        } else {
          // Close enough, just wait a moment for auto-pickup
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.log(`  Failed to mine log: ${msg}`);
      // Continue trying other logs
    }
  }

  return {
    success: true,
    message: `Gathered ${logsGathered} logs`,
  };
};
