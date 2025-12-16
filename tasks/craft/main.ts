/**
 * Crafting tasks - create items from materials
 */

import type { Bot } from "mineflayer";
import type { StepResult } from "../../types.ts";

// Helper to find or place crafting table
const getCraftingTable = async (bot: Bot) => {
  // Check if we already have one placed nearby
  const table = bot.findBlock({
    matching: (b) => b.name === "crafting_table",
    maxDistance: 4,
  });

  if (table) return table;

  // Place one from inventory
  const tableItem = bot.inventory.items().find(
    (i) => i.name === "crafting_table",
  );

  if (!tableItem) return null;

  // Find a spot to place it
  const ground = bot.blockAt(bot.entity.position.offset(1, -1, 0));
  if (!ground) return null;

  try {
    await bot.equip(tableItem, "hand");
    // @ts-ignore - Vec3 compatibility
    await bot.placeBlock(ground, { x: 0, y: 1, z: 0 });
    // Find the placed table
    return bot.findBlock({
      matching: (b) => b.name === "crafting_table",
      maxDistance: 4,
    });
  } catch {
    return null;
  }
};

export const craftPlanks = async (bot: Bot): Promise<StepResult> => {
  const logs = bot.inventory.items().filter((i) => i.name.includes("_log"));
  if (logs.length === 0) {
    return { success: false, message: "No logs in inventory" };
  }

  try {
    // Craft planks - 1 log = 4 planks, no crafting table needed
    for (const log of logs) {
      const plankName = log.name.replace("_log", "_planks");
      const plankId = bot.registry.itemsByName[plankName]?.id ??
        bot.registry.itemsByName["oak_planks"]?.id;
      if (!plankId) continue;

      const recipes = bot.recipesFor(plankId, null, 1, null);
      const recipe = recipes[0];
      if (recipe) {
        await bot.craft(recipe, Math.min(log.count, 8));
      }
    }
    return { success: true, message: "Crafted planks from logs" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to craft planks",
    };
  }
};

export const craftCraftingTable = async (bot: Bot): Promise<StepResult> => {
  try {
    const tableId = bot.registry.itemsByName["crafting_table"]?.id;
    if (!tableId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(tableId, null, 1, null);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for crafting table" };
    }
    await bot.craft(recipe, 1);
    return { success: true, message: "Crafted crafting table" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to craft table",
    };
  }
};

export const craftSticks = async (bot: Bot): Promise<StepResult> => {
  try {
    const stickId = bot.registry.itemsByName["stick"]?.id;
    if (!stickId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(stickId, null, 1, null);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for sticks" };
    }
    await bot.craft(recipe, 8);
    return { success: true, message: "Crafted sticks" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to craft sticks",
    };
  }
};

export const craftWoodenPickaxe = async (bot: Bot): Promise<StepResult> => {
  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    const pickId = bot.registry.itemsByName["wooden_pickaxe"]?.id;
    if (!pickId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(pickId, null, 1, table);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for wooden pickaxe" };
    }
    await bot.craft(recipe, 1, table);
    return { success: true, message: "Crafted wooden pickaxe" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to craft pickaxe",
    };
  }
};

export const craftStonePickaxe = async (bot: Bot): Promise<StepResult> => {
  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    const pickId = bot.registry.itemsByName["stone_pickaxe"]?.id;
    if (!pickId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(pickId, null, 1, table);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for stone pickaxe" };
    }
    await bot.craft(recipe, 1, table);
    return { success: true, message: "Crafted stone pickaxe" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};

export const craftStoneSword = async (bot: Bot): Promise<StepResult> => {
  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    const swordId = bot.registry.itemsByName["stone_sword"]?.id;
    if (!swordId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(swordId, null, 1, table);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for stone sword" };
    }
    await bot.craft(recipe, 1, table);
    return { success: true, message: "Crafted stone sword" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};

export const craftFurnace = async (bot: Bot): Promise<StepResult> => {
  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    const furnaceId = bot.registry.itemsByName["furnace"]?.id;
    if (!furnaceId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(furnaceId, null, 1, table);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for furnace" };
    }
    await bot.craft(recipe, 1, table);
    return { success: true, message: "Crafted furnace" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};

export const craftIronPickaxe = async (bot: Bot): Promise<StepResult> => {
  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    const pickId = bot.registry.itemsByName["iron_pickaxe"]?.id;
    if (!pickId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(pickId, null, 1, table);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for iron pickaxe" };
    }
    await bot.craft(recipe, 1, table);
    return { success: true, message: "Crafted iron pickaxe" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};

export const craftBucket = async (bot: Bot): Promise<StepResult> => {
  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    const bucketId = bot.registry.itemsByName["bucket"]?.id;
    if (!bucketId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(bucketId, null, 1, table);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for bucket" };
    }
    await bot.craft(recipe, 1, table);
    return { success: true, message: "Crafted bucket" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};

export const craftFlintAndSteel = async (bot: Bot): Promise<StepResult> => {
  // First need flint from gravel
  const gravel = bot.findBlock({
    matching: (b) => b.name === "gravel",
    maxDistance: 32,
  });

  if (gravel) {
    try {
      await bot.dig(gravel);
    } catch {
      // Ignore
    }
  }

  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    const fnsId = bot.registry.itemsByName["flint_and_steel"]?.id;
    if (!fnsId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(fnsId, null, 1, table);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe (need flint + iron)" };
    }
    await bot.craft(recipe, 1, table);
    return { success: true, message: "Crafted flint and steel" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};

export const craftEyesOfEnder = async (
  bot: Bot,
  count: number,
): Promise<StepResult> => {
  try {
    // First craft blaze powder from rods
    const blazeRods = bot.inventory.items().filter(
      (i) => i.name === "blaze_rod",
    );
    if (blazeRods.length > 0) {
      const powderId = bot.registry.itemsByName["blaze_powder"]?.id;
      if (powderId) {
        const powderRecipes = bot.recipesFor(powderId, null, 1, null);
        const powderRecipe = powderRecipes[0];
        if (powderRecipe) {
          await bot.craft(powderRecipe, Math.min(blazeRods[0].count, 7));
        }
      }
    }

    // Craft eyes
    const eyeId = bot.registry.itemsByName["ender_eye"]?.id;
    if (!eyeId) return { success: false, message: "Unknown item" };

    const recipes = bot.recipesFor(eyeId, null, 1, null);
    const recipe = recipes[0];
    if (!recipe) {
      return { success: false, message: "No recipe for ender eye" };
    }
    await bot.craft(recipe, count);
    return { success: true, message: `Crafted ${count} eyes of ender` };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};

export const craftBowAndArrows = async (bot: Bot): Promise<StepResult> => {
  const table = await getCraftingTable(bot);
  if (!table) {
    return { success: false, message: "Need crafting table" };
  }

  try {
    // Craft bow
    const bowId = bot.registry.itemsByName["bow"]?.id;
    if (bowId) {
      const bowRecipes = bot.recipesFor(bowId, null, 1, table);
      const bowRecipe = bowRecipes[0];
      if (bowRecipe) {
        await bot.craft(bowRecipe, 1, table);
      }
    }

    // Craft arrows
    const arrowId = bot.registry.itemsByName["arrow"]?.id;
    if (arrowId) {
      const arrowRecipes = bot.recipesFor(arrowId, null, 1, table);
      const arrowRecipe = arrowRecipes[0];
      if (arrowRecipe) {
        await bot.craft(arrowRecipe, 64, table);
      }
    }

    return { success: true, message: "Crafted bow and arrows" };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed",
    };
  }
};
