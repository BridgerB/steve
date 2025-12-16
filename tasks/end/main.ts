/**
 * End dimension tasks - crystal destruction and dragon fight
 */

import type { Bot } from "mineflayer";
import type { StepResult } from "../../types.ts";

/**
 * Destroy all end crystals on obsidian towers
 * Uses bow for distant crystals, climbs for caged ones
 */
export const destroyCrystals = async (bot: Bot): Promise<StepResult> => {
  let crystalsDestroyed = 0;
  const totalCrystals = 10;

  // Equip bow
  const bow = bot.inventory.items().find((i) => i.name === "bow");
  if (!bow) {
    return { success: false, message: "Need bow to destroy crystals" };
  }

  await bot.equip(bow, "hand");

  // Find end crystals
  const findCrystals = () =>
    Object.values(bot.entities).filter((e) => e.name === "end_crystal");

  let attempts = 0;
  const maxAttempts = 30;

  while (crystalsDestroyed < totalCrystals && attempts < maxAttempts) {
    attempts++;

    const crystals = findCrystals();

    if (crystals.length === 0) {
      console.log("  No more crystals visible");
      break;
    }

    // Sort by distance
    const crystal = crystals.sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position),
    )[0];

    if (!crystal) continue;

    const distance = bot.entity.position.distanceTo(crystal.position);

    try {
      // Look at crystal
      await bot.lookAt(crystal.position);

      if (distance > 64) {
        // Move closer
        bot.setControlState("forward", true);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        bot.setControlState("forward", false);
        continue;
      }

      // Shoot crystal with bow
      console.log(`  Shooting crystal at distance ${Math.floor(distance)}...`);

      // Activate bow (start drawing)
      await bot.activateItem();

      // Hold for accuracy based on distance
      const drawTime = Math.min(1000, distance * 10);
      await new Promise((resolve) => setTimeout(resolve, drawTime));

      // Release
      await bot.deactivateItem();

      // Wait for arrow to hit
      await new Promise((resolve) => setTimeout(resolve, 500 + distance * 20));

      // Check if crystal is gone
      if (!bot.entities[crystal.id]) {
        crystalsDestroyed++;
        console.log(
          `  Crystal destroyed! (${crystalsDestroyed}/${totalCrystals})`,
        );
      } else {
        // Try again with better aim
        console.log("  Missed - adjusting aim");
      }
    } catch {
      console.log("  Failed to shoot crystal");
    }

    // Brief pause between shots
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    success: crystalsDestroyed >= 8, // Some might be caged
    message: `Destroyed ${crystalsDestroyed} crystals`,
  };
};

/**
 * Fight and kill the Ender Dragon
 * Attack when it perches on the fountain, avoid when flying
 */
export const killDragon = async (bot: Bot): Promise<StepResult> => {
  // Get sword ready
  const sword = bot.inventory.items().find((i) => i.name.includes("sword"));
  if (sword) {
    await bot.equip(sword, "hand");
  }

  const maxFightTime = 300000; // 5 minutes max
  const startTime = Date.now();

  while (Date.now() - startTime < maxFightTime) {
    // Find the dragon
    const dragon = Object.values(bot.entities).find(
      (e) => e.name === "ender_dragon",
    );

    if (!dragon) {
      // Dragon might be dead!
      console.log("  Dragon not found - checking for victory...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check for dragon egg or portal
      const egg = bot.findBlock({
        matching: (b) => b.name === "dragon_egg",
        maxDistance: 32,
      });

      const returnPortal = bot.findBlock({
        matching: (b) => b.name === "end_gateway",
        maxDistance: 32,
      });

      if (egg || returnPortal) {
        return { success: true, message: "ENDER DRAGON DEFEATED!" };
      }

      continue;
    }

    const distance = bot.entity.position.distanceTo(dragon.position);

    // Dragon has phases:
    // 1. Flying around - shoot with bow or wait
    // 2. Perching on fountain - attack with sword!
    // 3. Charging - dodge!

    // Check if dragon is near the fountain (Y around 64-68)
    const isPerching = dragon.position.y < 70 && dragon.position.y > 62;

    if (isPerching && distance < 10) {
      // ATTACK NOW!
      console.log("  Dragon perching - ATTACK!");

      // Hit as many times as possible
      for (let i = 0; i < 10; i++) {
        try {
          await bot.lookAt(dragon.position);
          await bot.attack(dragon);
          await new Promise((resolve) => setTimeout(resolve, 400));

          // Check if dragon flew away
          if (dragon.position.y > 70) break;
        } catch {
          break;
        }
      }
    } else if (distance < 15) {
      // Dragon is close but flying - try to dodge
      bot.setControlState("back", true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      bot.setControlState("back", false);
    } else {
      // Dragon is far - move towards fountain (center of arena)
      // The fountain is at 0, 64, 0 in The End
      const fountainDir = {
        x: -bot.entity.position.x,
        z: -bot.entity.position.z,
      };

      // Normalize and move
      const dist = Math.sqrt(
        fountainDir.x * fountainDir.x + fountainDir.z * fountainDir.z,
      );

      if (dist > 10) {
        await bot.lookAt(
          bot.entity.position.offset(
            fountainDir.x / dist,
            0,
            fountainDir.z / dist,
          ),
        );
        bot.setControlState("forward", true);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        bot.setControlState("forward", false);
      } else {
        // At fountain - wait for dragon to perch
        console.log("  At fountain, waiting for dragon to perch...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Check health and eat if needed
    if (bot.health < 10) {
      const food = bot.inventory.items().find(
        (i) =>
          i.name.includes("cooked_") ||
          i.name === "bread" ||
          i.name === "golden_apple",
      );
      if (food) {
        await bot.equip(food, "hand");
        await bot.activateItem();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await bot.deactivateItem();
        // Re-equip sword
        if (sword) await bot.equip(sword, "hand");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    success: false,
    message: "Fight timed out - dragon still alive",
  };
};
