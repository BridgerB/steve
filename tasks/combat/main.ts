/**
 * Combat tasks - fighting mobs and gathering food
 */

import type { Bot } from "mineflayer";
import type { StepResult } from "../../types.ts";

/**
 * Find and kill animals for food
 */
export const gatherFood = async (
  bot: Bot,
  targetCount: number,
): Promise<StepResult> => {
  const foodAnimals = ["pig", "cow", "sheep", "chicken", "rabbit"];
  let foodGathered = 0;

  // Get sword ready
  const sword = bot.inventory.items().find((i) => i.name.includes("sword"));
  if (sword) {
    await bot.equip(sword, "hand");
  }

  while (foodGathered < targetCount) {
    // Find nearest food animal
    const animals = Object.values(bot.entities).filter(
      (e) => e.name && foodAnimals.includes(e.name),
    );

    if (animals.length === 0) {
      // No animals nearby - try moving around
      bot.setControlState("forward", true);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      bot.setControlState("forward", false);

      // Check again
      const newAnimals = Object.values(bot.entities).filter(
        (e) => e.name && foodAnimals.includes(e.name),
      );
      if (newAnimals.length === 0) {
        return {
          success: foodGathered > 0,
          message: `Found ${foodGathered} food, no more animals nearby`,
        };
      }
    }

    // Get closest animal
    const animal = animals.sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position),
    )[0];

    if (!animal) continue;

    try {
      // Move towards animal
      const distance = bot.entity.position.distanceTo(animal.position);
      if (distance > 3) {
        await bot.lookAt(animal.position);
        bot.setControlState("forward", true);
        bot.setControlState("sprint", true);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(distance * 100, 2000))
        );
        bot.setControlState("forward", false);
        bot.setControlState("sprint", false);
      }

      // Attack the animal
      await bot.lookAt(animal.position.offset(0, animal.height * 0.5, 0));
      await bot.attack(animal);

      // Wait for death and item drops
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Count as food gathered (simplified - assumes drops)
      foodGathered++;
      console.log(`  Killed ${animal.name} (${foodGathered}/${targetCount})`);
    } catch {
      // Animal might have moved or died
      console.log(`  Lost track of ${animal.name}`);
    }
  }

  return {
    success: true,
    message: `Gathered food from ${foodGathered} animals`,
  };
};

/**
 * Hunt endermen for ender pearls
 */
export const huntEndermen = async (
  bot: Bot,
  targetPearls: number,
): Promise<StepResult> => {
  let pearlsCollected = 0;

  // Get sword ready
  const sword = bot.inventory.items().find((i) => i.name.includes("sword"));
  if (sword) {
    await bot.equip(sword, "hand");
  }

  const maxAttempts = 30; // Prevent infinite loops
  let attempts = 0;

  while (pearlsCollected < targetPearls && attempts < maxAttempts) {
    attempts++;

    // Find enderman
    const endermen = Object.values(bot.entities).filter(
      (e) => e.name === "enderman",
    );

    if (endermen.length === 0) {
      // In the Nether, try warped forest biome
      // In Overworld, wait for night or explore
      console.log("  Searching for endermen...");

      // Move around to find them
      bot.setControlState("forward", true);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      bot.setControlState("forward", false);
      continue;
    }

    const enderman = endermen[0];

    try {
      // IMPORTANT: Don't look at enderman's eyes before attacking
      // Look at their feet to avoid aggro until ready

      const distance = bot.entity.position.distanceTo(enderman.position);

      // Get closer without looking at eyes
      if (distance > 3) {
        // Look at ground near enderman
        await bot.lookAt(enderman.position.offset(0, 0, 0));
        bot.setControlState("forward", true);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(distance * 100, 2000))
        );
        bot.setControlState("forward", false);
      }

      // Now attack - look at legs, not head
      await bot.lookAt(enderman.position.offset(0, 1, 0));
      await bot.attack(enderman);

      // Keep attacking until dead
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Check if enderman still exists
        if (!bot.entities[enderman.id]) {
          console.log("  Enderman killed!");
          pearlsCollected++; // Assume drop
          break;
        }

        // Re-target and attack
        try {
          await bot.lookAt(enderman.position.offset(0, 1, 0));
          await bot.attack(enderman);
        } catch {
          break; // Enderman teleported or died
        }
      }
    } catch {
      console.log("  Enderman escaped or teleported");
    }
  }

  // Count actual pearls in inventory
  const pearls = bot.inventory.items().find((i) => i.name === "ender_pearl");
  const actualPearls = pearls?.count ?? 0;

  return {
    success: actualPearls >= targetPearls,
    message: `Collected ${actualPearls} ender pearls`,
  };
};
