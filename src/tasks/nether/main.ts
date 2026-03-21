/**
 * Nether-specific tasks - fortress finding and blaze hunting
 */

import type { Bot } from "typecraft";
import { vec3, distance, offset, windowItems } from "typecraft";
import type { StepResult, Block } from "../../types.ts";

/**
 * Search for a Nether Fortress
 * Fortresses spawn along the X axis (east-west) in the Nether
 */
export const findFortress = async (bot: Bot): Promise<StepResult> => {
  // Look for nether brick blocks - signature of fortress
  const fortressBlocks = [
    "nether_bricks",
    "nether_brick_stairs",
    "nether_brick_fence",
  ];

  // First check if we can already see fortress blocks
  let fortress = bot.findBlock({
    matching: (name) => fortressBlocks.includes(name),
    maxDistance: 64,
  }) as Block | null;

  if (fortress) {
    return {
      success: true,
      message: `Found fortress at ${Math.floor(fortress.position.x)}, ${
        Math.floor(fortress.position.y)
      }, ${Math.floor(fortress.position.z)}`,
    };
  }

  // Search pattern: move along X axis (fortresses align on X)
  console.log("  Searching for fortress along X axis...");

  const startPos = vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
  const searchDistance = 200;
  const searchTime = 60000; // 1 minute max search
  const startTime = Date.now();

  // Head in positive X direction
  await bot.lookAt(offset(bot.entity.position, 100, 0, 0));
  bot.setControlState("forward", true);
  bot.setControlState("sprint", true);

  while (Date.now() - startTime < searchTime) {
    // Check for fortress blocks periodically
    fortress = bot.findBlock({
      matching: (name) => fortressBlocks.includes(name),
      maxDistance: 64,
    }) as Block | null;

    if (fortress) {
      bot.setControlState("forward", false);
      bot.setControlState("sprint", false);
      return {
        success: true,
        message: `Found fortress at ${Math.floor(fortress.position.x)}, ${
          Math.floor(fortress.position.y)
        }, ${Math.floor(fortress.position.z)}`,
      };
    }

    // Check for dangerous terrain (lava lakes)
    const blockBelow = bot.blockAt(offset(bot.entity.position, 0, -1, 0)) as Block | null;
    if (
      blockBelow && (blockBelow.name === "lava" || blockBelow.name === "air")
    ) {
      // Stop and reassess
      bot.setControlState("forward", false);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to jump or find safe path
      bot.setControlState("jump", true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      bot.setControlState("jump", false);
      bot.setControlState("forward", true);
    }

    // Periodically change Y level to search different heights
    const currentDist = Math.abs(bot.entity.position.x - startPos.x);
    if (currentDist > searchDistance) {
      // Turn around and try negative X
      bot.setControlState("forward", false);
      await bot.lookAt(offset(bot.entity.position, -100, 0, 0));
      bot.setControlState("forward", true);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  bot.setControlState("forward", false);
  bot.setControlState("sprint", false);

  return {
    success: false,
    message: "Could not find fortress within search time",
  };
};

/**
 * Find and kill blazes for blaze rods
 */
export const killBlazes = async (
  bot: Bot,
  targetRods: number,
): Promise<StepResult> => {
  let rodsCollected = 0;

  // Get sword ready
  const sword = windowItems(bot.inventory).find((i) => i.name.includes("sword"));
  if (sword) {
    await bot.equip(sword, "hand");
  }

  const maxAttempts = 50;
  let attempts = 0;

  while (rodsCollected < targetRods && attempts < maxAttempts) {
    attempts++;

    // Find blaze spawner or blazes
    const blazes = Object.values(bot.entities).filter(
      (e) => e.name === "blaze",
    );

    if (blazes.length === 0) {
      // Look for blaze spawner
      const spawner = bot.findBlock({
        matching: (name) => name === "spawner",
        maxDistance: 32,
      }) as Block | null;

      if (spawner) {
        // Move near spawner and wait
        const dist = distance(bot.entity.position, spawner.position);
        if (dist > 8) {
          await bot.lookAt(spawner.position);
          bot.setControlState("forward", true);
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(dist * 100, 3000))
          );
          bot.setControlState("forward", false);
        }

        // Wait for blaze to spawn
        console.log("  Waiting near spawner for blazes...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      // Explore to find blazes
      bot.setControlState("forward", true);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      bot.setControlState("forward", false);
      continue;
    }

    // Attack nearest blaze
    const blaze = blazes.sort(
      (a, b) =>
        distance(bot.entity.position, a.position) -
        distance(bot.entity.position, b.position),
    )[0];

    try {
      // Blazes fly - try to get closer
      const dist = distance(bot.entity.position, blaze.position);

      if (dist > 4) {
        await bot.lookAt(blaze.position);
        bot.setControlState("forward", true);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(dist * 80, 2000))
        );
        bot.setControlState("forward", false);
      }

      // Attack blaze - they're usually airborne so look up at them
      for (let i = 0; i < 15; i++) {
        if (!bot.entities[blaze.id]) {
          console.log(`  Blaze killed! (${rodsCollected + 1}/${targetRods})`);
          rodsCollected++;
          break;
        }

        try {
          await bot.lookAt(blaze.position);
          await bot.attack(blaze);
        } catch {
          break; // Blaze died or moved too far
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } catch {
      console.log("  Lost blaze target");
    }

    // Brief pause between fights
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Count actual rods
  const rods = windowItems(bot.inventory).find((i) => i.name === "blaze_rod");
  const actualRods = rods?.count ?? 0;

  return {
    success: actualRods >= targetRods,
    message: `Collected ${actualRods} blaze rods`,
  };
};
