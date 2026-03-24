/**
 * Mining tasks - dig blocks underground
 */

import type { Bot } from "typecraft";
import { distance, offset } from "typecraft";
import type { StepResult, Block } from "../../types.ts";
import { findBlock, getPathfinder, getRememberedResource, forgetResource, goTo, moveCloser, sleep, success } from "../../lib/bot-utils.ts";
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
  const isTarget = (name: string) => searchTypes.some((t) => name.includes(t));

  // Find initial stone to start mining
  let startBlock = findBlock(bot, isTarget, 32);
  if (!startBlock) {
    return { success: false, message: `Could not find ${blockType}` };
  }
  try {
    await moveCloser(bot, startBlock.position, { maxDistance: 2 });
  } catch {}

  // Pick a direction and mine in a straight line at the same Y level
  const p = bot.entity.position;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // Pick the direction with the most target blocks ahead
  let bestDir = dirs[0]!;
  let bestCount = 0;
  for (const [dx, dz] of dirs) {
    let count = 0;
    for (let i = 1; i <= 8; i++) {
      const b = bot.blockAt(offset(p, dx * i, 0, dz * i)) as Block | null;
      const bBelow = bot.blockAt(offset(p, dx * i, -1, dz * i)) as Block | null;
      if ((b && isTarget(b.name)) || (bBelow && isTarget(bBelow.name))) count++;
    }
    if (count > bestCount) { bestCount = count; bestDir = [dx, dz]; }
  }
  const [dirX, dirZ] = bestDir;
  logEvent("mine", "direction", `dx=${dirX} dz=${dirZ} ahead=${bestCount}`);

  while (mined < targetCount) {
    // Mine the block at feet level in our direction, or below feet
    const px = Math.floor(bot.entity.position.x);
    const py = Math.floor(bot.entity.position.y);
    const pz = Math.floor(bot.entity.position.z);

    // Check: ahead at feet, ahead below, directly below
    const candidates = [
      bot.blockAt(offset(bot.entity.position, dirX, 0, dirZ)),    // ahead at feet
      bot.blockAt(offset(bot.entity.position, dirX, -1, dirZ)),   // ahead below
      bot.blockAt(offset(bot.entity.position, 0, -1, 0)),         // below feet
      bot.blockAt(offset(bot.entity.position, -dirX, 0, -dirZ)),  // behind (if stuck)
    ] as (Block | null)[];

    let block: Block | null = null;
    for (const b of candidates) {
      if (b && isTarget(b.name)) { block = b; break; }
    }

    if (!block) {
      // Check memory first — did we see this resource earlier?
      const remembered = getRememberedResource(bot, blockType);
      if (remembered) {
        const remBlock = bot.blockAt(remembered as any) as Block | null;
        if (remBlock && isTarget(remBlock.name)) {
          logEvent("mine", "from_memory", `${blockType} at ${remembered.x},${remembered.y},${remembered.z}`);
          try {
            await moveCloser(bot, remBlock.position, { maxDistance: 2 });
            block = remBlock;
          } catch {
            forgetResource(bot, blockType, remembered);
            continue;
          }
        } else {
          // Resource gone — forget it
          forgetResource(bot, blockType, remembered);
        }
      }

      // Search if memory didn't help
      if (!block) {
        block = findBlock(bot, isTarget, 32);
      }
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
    }

    // Also dig the block above if it's not air (clear headroom for walking)
    const above = bot.blockAt(offset(block.position, 0, 1, 0)) as Block | null;
    if (above && above.name !== "air" && above.name !== "water" && block.position.y >= py) {
      try {
        await bot.lookAt(offset(above.position, 0.5, 0.5, 0.5));
        await bot.dig(above);
        await sleep(100);
      } catch {}
    }

    try {
      await bot.lookAt(offset(block.position, 0.5, 0.5, 0.5));
      await bot.dig(block);
      mined++;
      logEvent("mine", "mined", `${blockType} ${mined}/${targetCount}`);
      await sleep(100);

      // Step forward into the cleared space
      bot.setControlState("forward", true);
      await sleep(200);
      bot.setControlState("forward", false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      logEvent("mine", "fail", msg);
    }
  }

  return success(`Mined ${mined} ${blockType}`);
};
