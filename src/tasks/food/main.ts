/**
 * Food tasks - hunting animals for food
 */

import type { Bot, Entity } from "typecraft";
import { offset } from "typecraft";
import type { StepResult } from "../../types.ts";
import {
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
