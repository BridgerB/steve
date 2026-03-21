/**
 * Combat tasks - fighting mobs and gathering food
 */

import type { Bot, Entity } from "typecraft";
import { offset } from "typecraft";
import type { StepResult } from "../../types.ts";
import {
  attackUntilDead,
  countItems,
  equipItem,
  findEntitiesByNames,
  findNearestEntity,
  moveCloser,
  searchForEntities,
  sleep,
  success,
} from "../../lib/bot-utils.ts";

const FOOD_ANIMALS = ["pig", "cow", "sheep", "chicken", "rabbit"];

/**
 * Find and kill animals for food
 */
export const gatherFood = async (
  bot: Bot,
  targetCount: number,
): Promise<StepResult> => {
  let foodGathered = 0;

  // Get sword ready
  await equipItem(bot, "sword", "hand");

  while (foodGathered < targetCount) {
    // Find nearest food animal
    const animals = findEntitiesByNames(bot, FOOD_ANIMALS);

    if (animals.length === 0) {
      // No animals nearby - try moving around
      await searchForEntities(bot, 2000);

      // Check again
      const newAnimals = findEntitiesByNames(bot, FOOD_ANIMALS);
      if (newAnimals.length === 0) {
        return {
          success: foodGathered > 0,
          message: `Found ${foodGathered} food, no more animals nearby`,
        };
      }
    }

    // Get closest animal
    const animal = findNearestEntity(
      bot,
      (e) => e.name && FOOD_ANIMALS.includes(e.name),
    );

    if (!animal) continue;

    try {
      // Move towards animal
      await moveCloser(bot, animal.position, {
        maxDistance: 3,
        sprint: true,
        maxWalkTime: 2000,
      });

      // Attack the animal
      await bot.lookAt(offset(animal.position, 0, (animal as Entity).height * 0.5, 0));
      await bot.attack(animal as Entity);

      // Wait for death and item drops
      await sleep(500);

      // Count as food gathered (simplified - assumes drops)
      foodGathered++;
      console.log(`  Killed ${animal.name} (${foodGathered}/${targetCount})`);
    } catch {
      // Animal might have moved or died
      console.log(`  Lost track of ${animal.name}`);
    }
  }

  return success(`Gathered food from ${foodGathered} animals`);
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
  await equipItem(bot, "sword", "hand");

  const maxAttempts = 30;
  let attempts = 0;

  while (pearlsCollected < targetPearls && attempts < maxAttempts) {
    attempts++;

    // Find enderman
    const enderman = findNearestEntity(bot, (e) => e.name === "enderman");

    if (!enderman) {
      console.log("  Searching for endermen...");
      await searchForEntities(bot, 3000);
      continue;
    }

    try {
      // IMPORTANT: Don't look at enderman's eyes before attacking
      // Look at their feet to avoid aggro until ready
      await moveCloser(bot, enderman.position, {
        maxDistance: 3,
        maxWalkTime: 2000,
      });

      // Attack - look at legs, not head
      await bot.lookAt(offset(enderman.position, 0, 1, 0));

      const killed = await attackUntilDead(bot, enderman, {
        maxHits: 10,
        hitDelay: 400,
        lookHeight: 1,
      });

      if (killed) {
        console.log("  Enderman killed!");
        pearlsCollected++;
      }
    } catch {
      console.log("  Enderman escaped or teleported");
    }
  }

  // Count actual pearls in inventory
  const actualPearls = countItems(bot, "ender_pearl");

  return {
    success: actualPearls >= targetPearls,
    message: `Collected ${actualPearls} ender pearls`,
  };
};
