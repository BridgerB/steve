/**
 * Mining tasks - dig blocks underground
 */

import type { Bot } from "mineflayer";
import type { StepResult } from "../../types.ts";
import { findBlock, moveCloser, sleep, success } from "../../lib/bot-utils.ts";

export const mineBlock = async (
  bot: Bot,
  blockType: string,
  targetCount: number,
): Promise<StepResult> => {
  let mined = 0;

  // For stone, we get cobblestone drops
  const isStone = blockType === "stone";
  const searchTypes = isStone ? ["stone"] : [blockType];

  while (mined < targetCount) {
    const block = findBlock(
      bot,
      (b) => searchTypes.some((type) => b.name.includes(type)),
      32,
    );

    if (!block) {
      // If looking for ore, try to dig down to find it
      if (blockType.includes("ore")) {
        const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (below && below.name !== "air" && below.name !== "water") {
          try {
            await bot.dig(below);
            continue;
          } catch {
            // Keep trying
          }
        }
      }
      return {
        success: mined > 0,
        message: `Could not find ${blockType} (mined ${mined}/${targetCount})`,
      };
    }

    try {
      // Move closer if needed
      await moveCloser(bot, block.position, { maxDistance: 4 });

      await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
      await bot.dig(block);
      mined++;
      console.log(`  Mined ${blockType} ${mined}/${targetCount}`);

      // Wait for item to drop then pick it up
      await sleep(200);

      // Find nearby items and collect them
      const nearbyItems = Object.values(bot.entities).filter(
        (e) =>
          e.entityType === bot.registry.entitiesByName.item?.id &&
          e.position.distanceTo(bot.entity.position) < 10,
      );

      for (const item of nearbyItems) {
        const dist = bot.entity.position.distanceTo(item.position);
        if (dist > 1.5) {
          await bot.lookAt(item.position);
          bot.setControlState("forward", true);

          for (let i = 0; i < 30; i++) {
            await sleep(100);
            if (
              !bot.entities[item.id] ||
              bot.entity.position.distanceTo(item.position) < 1.5
            ) {
              break;
            }
          }

          bot.setControlState("forward", false);
        }
      }

      await sleep(200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.log(`  Failed to mine: ${msg}`);
    }
  }

  return success(`Mined ${mined} ${blockType}`);
};
