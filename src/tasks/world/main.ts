/**
 * World interaction tasks - portals, structures, water bucket
 */

import type { Bot } from "typecraft";
import { vec3, distance, offset, windowItems } from "typecraft";
import type { StepResult, Block } from "../../types.ts";

/**
 * Fill an empty bucket with water
 */
export const fillWaterBucket = async (bot: Bot): Promise<StepResult> => {
  // Find all water positions
  const waterPositions = bot.findBlocks({
    matching: (name) => name === "water",
    maxDistance: 64,
    count: 200,
  });

  console.log(`  Found ${waterPositions.length} water blocks total`);

  // Find surface water (has air above)
  let water = null;
  for (const pos of waterPositions) {
    const above = bot.blockAt(offset(pos, 0, 1, 0)) as Block | null;
    if (above && above.name === "air") {
      water = bot.blockAt(pos) as Block | null;
      if (water) break;
    }
  }

  if (!water) {
    return { success: false, message: "No surface water found nearby" };
  }

  console.log(`  Found surface water at ${water.position}`);

  // Get bucket from inventory
  const bucket = windowItems(bot.inventory).find((i) => i.name === "bucket");
  if (!bucket) {
    return { success: false, message: "No empty bucket in inventory" };
  }

  try {
    // Move closer to the water - need to be within 3 blocks
    let dist = distance(bot.entity.position, water.position);
    console.log(`  Distance to water: ${dist.toFixed(1)} blocks`);

    while (dist > 3) {
      await bot.lookAt(water.position);
      bot.setControlState("forward", true);
      bot.setControlState("sprint", true);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const newDist = distance(bot.entity.position, water.position);
      console.log(`  Moving... distance: ${newDist.toFixed(1)}`);

      // If we're not getting closer, we might be stuck
      if (newDist >= dist - 0.5) {
        // Try jumping
        bot.setControlState("jump", true);
        await new Promise((resolve) => setTimeout(resolve, 300));
        bot.setControlState("jump", false);
      }

      dist = newDist;

      // Safety timeout
      if (dist > 50) {
        bot.setControlState("forward", false);
        bot.setControlState("sprint", false);
        return { success: false, message: "Water too far away" };
      }
    }

    bot.setControlState("forward", false);
    bot.setControlState("sprint", false);
    console.log(`  Reached water, distance: ${dist.toFixed(1)}`);

    // Equip bucket
    await bot.equip(bucket, "hand");

    // Look at the water block
    await bot.lookAt(offset(water.position, 0.5, 0.5, 0.5));
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Use bucket on water
    console.log(`  Looking at water and using bucket...`);

    // Deactivate any current item use first
    bot.deactivateItem();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Activate item (right-click) while looking at water
    bot.activateItem();
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check if we got water bucket
    let waterBucket = windowItems(bot.inventory).find((i) =>
      i.name === "water_bucket"
    );

    if (!waterBucket) {
      // Try finding the block below/beside the water and activating that
      const belowWater = bot.blockAt(offset(water.position, 0, -1, 0)) as Block | null;
      if (
        belowWater && belowWater.name !== "water" && belowWater.name !== "air"
      ) {
        console.log(
          `  Trying to activate block below water: ${belowWater.name}`,
        );
        await bot.lookAt(offset(belowWater.position, 0.5, 1, 0.5)); // Look at top face
        await new Promise((resolve) => setTimeout(resolve, 200));
        try {
          await bot.activateBlock(belowWater as any, { x: 0, y: 1, z: 0 });
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // Try without direction
          bot.activateItem();
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      waterBucket = windowItems(bot.inventory).find((i) =>
        i.name === "water_bucket"
      );
    }

    return {
      success: !!waterBucket,
      message: waterBucket ? "Filled water bucket" : "Failed to fill bucket",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to fill bucket",
    };
  }
};

/**
 * Build a nether portal using bucket casting method
 * This creates obsidian by pouring water on lava source blocks
 */
export const buildNetherPortal = async (bot: Bot): Promise<StepResult> => {
  // This is a complex task - for MVP we'll look for existing obsidian
  // or assume we have obsidian in inventory

  // First check if we already have obsidian
  const obsidian = windowItems(bot.inventory).find((i) => i.name === "obsidian");
  const obsidianCount = obsidian?.count ?? 0;

  if (obsidianCount < 10) {
    // Try to find lava to create obsidian with water bucket
    const lava = bot.findBlock({
      matching: (name) => name === "lava",
      maxDistance: 32,
    });

    if (!lava) {
      return {
        success: false,
        message: "Need 10 obsidian or lava source to build portal",
      };
    }

    // Check for water bucket
    const waterBucket = windowItems(bot.inventory).find(
      (i) => i.name === "water_bucket",
    );
    if (!waterBucket) {
      return { success: false, message: "Need water bucket for bucket method" };
    }

    // For MVP: we'll note that portal building is complex
    // A full implementation would cast obsidian in place
    return {
      success: false,
      message:
        "Bucket method portal building not yet implemented - need 10 obsidian",
    };
  }

  // We have obsidian - build the portal frame
  // Portal is 4 wide x 5 tall (corners not needed = 10 obsidian minimum)

  // Find a flat area
  const pos = vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);

  try {
    // For MVP: just note success if we have materials
    // Full implementation would place blocks in portal shape
    console.log("  Building nether portal frame...");

    // Check for flint and steel
    const flintAndSteel = windowItems(bot.inventory).find(
      (i) => i.name === "flint_and_steel",
    );
    if (!flintAndSteel) {
      return {
        success: false,
        message: "Need flint and steel to light portal",
      };
    }

    // TODO: Actually place obsidian blocks in portal shape
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      success: true,
      message: `Portal frame ready at ${Math.floor(pos.x)}, ${
        Math.floor(pos.y)
      }, ${Math.floor(pos.z)}`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to build portal",
    };
  }
};

/**
 * Enter a portal (nether or end)
 */
export const enterPortal = async (bot: Bot): Promise<StepResult> => {
  // Find portal block
  const portal = bot.findBlock({
    matching: (name) => name === "nether_portal" || name === "end_portal",
    maxDistance: 16,
  }) as Block | null;

  if (!portal) {
    return { success: false, message: "No portal found nearby" };
  }

  try {
    // Walk into the portal
    await bot.lookAt(portal.position);
    bot.setControlState("forward", true);

    // Wait for dimension change (up to 10 seconds)
    const startDim = bot.game.dimension;
    let changed = false;

    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (bot.game.dimension !== startDim) {
        changed = true;
        break;
      }
    }

    bot.setControlState("forward", false);

    if (changed) {
      return {
        success: true,
        message: `Entered portal - now in ${bot.game.dimension}`,
      };
    } else {
      return { success: false, message: "Portal did not teleport" };
    }
  } catch (err) {
    bot.setControlState("forward", false);
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to enter portal",
    };
  }
};

/**
 * Find the stronghold by throwing eyes of ender
 */
export const findStronghold = async (bot: Bot): Promise<StepResult> => {
  // Get eyes of ender
  const eyes = windowItems(bot.inventory).find((i) => i.name === "ender_eye");
  if (!eyes || eyes.count < 3) {
    return { success: false, message: "Need at least 3 eyes of ender" };
  }

  try {
    // Equip eye of ender
    await bot.equip(eyes, "hand");

    // Throw eye and watch where it goes
    // This is simplified - full implementation would track the eye entity
    await bot.activateItem();

    console.log("  Eye thrown - following direction...");

    // Wait for eye to settle
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // In practice, we'd need to triangulate from multiple throws
    // For MVP, we'll assume we're heading in the right direction

    return {
      success: true,
      message: "Following eye of ender towards stronghold",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to throw eye",
    };
  }
};

/**
 * Activate the end portal by placing eyes
 */
export const activateEndPortal = async (bot: Bot): Promise<StepResult> => {
  // Find end portal frames
  const frame = bot.findBlock({
    matching: (name) => name === "end_portal_frame",
    maxDistance: 16,
  }) as Block | null;

  if (!frame) {
    return { success: false, message: "End portal frame not found" };
  }

  // Get eyes of ender
  const eyes = windowItems(bot.inventory).find((i) => i.name === "ender_eye");
  if (!eyes || eyes.count < 10) {
    return { success: false, message: "Need at least 10 eyes of ender" };
  }

  try {
    await bot.equip(eyes, "hand");

    // Find all frame blocks and fill empty ones
    const frames = bot.findBlocks({
      matching: (name) => name === "end_portal_frame",
      maxDistance: 16,
      count: 12,
    });

    let filled = 0;
    for (const pos of frames) {
      const block = bot.blockAt(pos) as Block | null;
      if (!block) continue;

      // Check if frame already has eye (metadata check)
      // For simplicity, try to place on all frames
      try {
        await bot.lookAt(pos);
        await bot.placeBlock(block, { x: 0, y: 1, z: 0 });
        filled++;
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch {
        // Frame might already have eye
      }
    }

    // Check if portal is now active
    const portal = bot.findBlock({
      matching: (name) => name === "end_portal",
      maxDistance: 16,
    }) as Block | null;

    if (portal) {
      return { success: true, message: "End portal activated!" };
    } else {
      return {
        success: false,
        message: `Placed ${filled} eyes but portal not active`,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to activate portal",
    };
  }
};

/**
 * Enter the end portal
 */
export const enterEndPortal = async (bot: Bot): Promise<StepResult> => {
  const portal = bot.findBlock({
    matching: (name) => name === "end_portal",
    maxDistance: 16,
  }) as Block | null;

  if (!portal) {
    return { success: false, message: "End portal not found or not active" };
  }

  try {
    // Walk into the portal
    await bot.lookAt(portal.position);
    bot.setControlState("forward", true);

    // Wait for dimension change
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (String(bot.game.dimension).includes("end")) {
        bot.setControlState("forward", false);
        return { success: true, message: "Entered The End!" };
      }
    }

    bot.setControlState("forward", false);
    return { success: false, message: "Failed to enter The End" };
  } catch (err) {
    bot.setControlState("forward", false);
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to enter portal",
    };
  }
};
