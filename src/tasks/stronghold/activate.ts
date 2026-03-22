/**
 * Stronghold activation - finding and filling end portal frames
 */

import type { Bot } from "typecraft";
import { windowItems } from "typecraft";
import type { StepResult, Block } from "../../types.ts";

/**
 * Activate the end portal by placing eyes of ender in frames
 */
export const activateEndPortal = async (bot: Bot): Promise<StepResult> => {
  const frame = bot.findBlock({
    matching: (name) => name === "end_portal_frame",
    maxDistance: 16,
  }) as Block | null;

  if (!frame) {
    return { success: false, message: "End portal frame not found" };
  }

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
