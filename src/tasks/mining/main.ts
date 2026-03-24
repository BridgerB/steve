/**
 * Mining tasks - dig blocks underground
 */

import type { Bot } from "typecraft";
import { distance, offset } from "typecraft";
import type { StepResult, Block } from "../../types.ts";
import { findBlock, getPathfinder, goTo, moveCloser, sleep, success } from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";

export const mineBlock = async (
  bot: Bot,
  blockType: string,
  targetCount: number,
): Promise<StepResult> => {
  let mined = 0;

  // Equip best pickaxe before mining — find it and select its hotbar slot
  const pickSlot = bot.inventory.slots.findIndex((s) =>
    s && s.name.includes("pickaxe"),
  );
  if (pickSlot >= 36 && pickSlot <= 44) {
    bot.setQuickBarSlot(pickSlot - 36);
  } else if (pickSlot >= 0) {
    // Move to hotbar first via window click, then select
    try {
      await bot.clickWindow(pickSlot, 0, 0);   // pick up
      await bot.clickWindow(36, 0, 0);          // place in hotbar slot 0
      bot.setQuickBarSlot(0);
    } catch {}
  }

  // For stone, we get cobblestone drops
  const isStone = blockType === "stone";
  const searchTypes = isStone ? ["stone"] : [blockType];

  // Try to find a nearby target block first, then dig blocks adjacent to bot
  // This ensures drops land within auto-pickup range
  const findAdjacentBlock = (): Block | null => {
    const p = bot.entity.position;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    // Prioritize side blocks to avoid falling into holes
    const offsets = [
      [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],  // sides at feet
      [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],  // sides below
      [0, -1, 0], [0, -2, 0],  // below feet (last resort)
    ];
    for (const [dx, dy, dz] of offsets) {
      const b = bot.blockAt(offset(p, dx, dy, dz)) as Block | null;
      if (b && searchTypes.some((type) => b.name.includes(type))) return b;
    }
    return null;
  };

  while (mined < targetCount) {
    // First try adjacent blocks (drops land at bot's feet)
    let block = findAdjacentBlock();

    if (!block) {
      // No adjacent target — find one nearby and walk to it
      block = findBlock(
        bot,
        (name) => searchTypes.some((type) => name.includes(type)),
        32,
      );
      if (!block) {
        return {
          success: mined > 0,
          message: `Could not find ${blockType} (mined ${mined}/${targetCount})`,
        };
      }
      try {
        await moveCloser(bot, block.position, { maxDistance: 2 });
      } catch {
        logEvent("mine", "nav_fail", "couldn't reach block");
        continue;
      }
      // Re-check for adjacent blocks after moving
      block = findAdjacentBlock() ?? block;
    }

    try {
      await bot.lookAt(offset(block.position, 0.5, 0.5, 0.5));
      await bot.dig(block);
      mined++;
      logEvent("mine", "mined", `${blockType} ${mined}/${targetCount}`);
      await sleep(200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      logEvent("mine", "fail", msg);
    }
  }

  return success(`Mined ${mined} ${blockType}`);
};
