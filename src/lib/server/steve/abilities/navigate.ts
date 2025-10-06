import pathfinder from "mineflayer-pathfinder";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";

export function initializeNavigation(bot: Bot): void {
  // Initialize pathfinder plugin
  bot.loadPlugin(pathfinder.pathfinder);
  const movements = new pathfinder.Movements(bot);

  // Configure movement options for better pathfinding
  movements.canDig = false; // Disable digging for safety
  movements.scafoldingBlocks = []; // Disable block placing (note: typo in original library)

  bot.pathfinder.setMovements(movements);
}

export async function findNearestBlock(
  bot: Bot,
  blockType: number,
  maxDistance = 32,
): Promise<any | null> {
  // First try the standard find
  let block = bot.findBlock({
    matching: blockType,
    maxDistance: maxDistance,
  });

  // If we don't find it immediately, do a 360 degree scan
  if (!block) {
    block = await scanAreaForBlock(bot, blockType, maxDistance);
  }

  return block;
}

export async function scanAreaForBlock(
  bot: Bot,
  blockType: number,
  maxDistance: number,
): Promise<any | null> {
  // Do a full 360 degree scan in increments
  for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
    // Look at each angle
    await bot.look(yaw, 0);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to find block at this angle
    const block = bot.findBlock({
      matching: blockType,
      maxDistance: maxDistance,
    });

    if (block) return block;
  }

  // Also try looking up and down at each angle
  for (const pitch of [-Math.PI / 4, Math.PI / 4]) {
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
      await bot.look(yaw, pitch);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const block = bot.findBlock({
        matching: blockType,
        maxDistance: maxDistance,
      });

      if (block) return block;
    }
  }

  return null;
}

export async function goTo(bot: Bot, position: Vec3): Promise<boolean> {
  // Add error handling and timeout for pathfinding
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bot.pathfinder.stop();
      reject(new Error("Navigation timeout"));
    }, 10000); // 10 second timeout

    try {
      const goal = new pathfinder.goals.GoalNear(
        position.x,
        position.y,
        position.z,
        1, // Within 1 block
      );

      bot.pathfinder
        .goto(goal)
        .then(() => {
          clearTimeout(timeout);
          resolve(true);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

export async function followPlayer(
  bot: Bot,
  playerName: string,
): Promise<boolean> {
  const player = bot.players[playerName]?.entity;
  if (!player) return false;

  try {
    await goTo(bot, player.position);
    return true;
  } catch (error) {
    // Silently fail - pathfinding errors are expected when following
    return false;
  }
}
