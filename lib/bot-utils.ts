/**
 * Shared bot utilities for all tasks
 * Reduces code duplication across task implementations
 */

import type { Bot } from "mineflayer";
import { goals, Movements, pathfinder } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import type { StepResult } from "../types.ts";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** Bot with pathfinder - type helper for accessing pathfinder methods */
// deno-lint-ignore no-explicit-any
export type PathfinderBot = Bot & { pathfinder: any };

/** Options for goTo navigation */
export interface GoToOptions {
  /** How close to get to the target (default: 2) */
  range?: number;
  /** Timeout for stuck detection in ms (default: 2000) */
  stuckTimeout?: number;
  /** Whether to allow digging (default: true) */
  canDig?: boolean;
  /** Whether to allow sprinting (default: true) */
  allowSprinting?: boolean;
}

/** Options for moveCloser */
export interface MoveCloserOptions {
  /** Maximum distance to start walking (default: 4) */
  maxDistance?: number;
  /** Speed multiplier for walking time (default: 150ms per block) */
  speedFactor?: number;
  /** Maximum walk time in ms (default: 3000) */
  maxWalkTime?: number;
  /** Whether to sprint (default: false) */
  sprint?: boolean;
}

/** Options for mineAndCollect */
export interface MineAndCollectOptions {
  /** Maximum mining distance (default: 4.5) */
  maxMineDistance?: number;
  /** Time to wait after dig before checking (default: 100ms) */
  postDigDelay?: number;
  /** Time to wait for item collection (default: 300ms) */
  collectDelay?: number;
  /** Custom block validation function */
  isValidBlock?: (block: { name: string } | null) => boolean;
}

// =============================================================================
// PATHFINDER SETUP
// =============================================================================

/**
 * Ensure pathfinder is loaded and configured
 * Call this at the start of any task that needs navigation
 */
export const ensurePathfinder = (
  bot: Bot,
  options?: {
    canDig?: boolean;
    allowParkour?: boolean;
    allowSprinting?: boolean;
  },
): PathfinderBot => {
  // deno-lint-ignore no-explicit-any
  const botAny = bot as any;

  if (!botAny.pathfinder) {
    bot.loadPlugin(pathfinder);
  }

  // deno-lint-ignore no-explicit-any
  const movements = new Movements(bot as any);
  movements.canDig = options?.canDig ?? true;
  movements.allowParkour = options?.allowParkour ?? false;
  movements.allowSprinting = options?.allowSprinting ?? true;
  botAny.pathfinder.setMovements(movements);

  return botAny as PathfinderBot;
};

// =============================================================================
// NAVIGATION
// =============================================================================

/**
 * Navigate to a position using pathfinder with stuck detection
 *
 * @example
 * ```ts
 * const reached = await goTo(bot, new Vec3(100, 64, 200));
 * if (!reached) console.log("Could not reach destination");
 * ```
 */
export const goTo = async (
  bot: Bot,
  pos: Vec3,
  options: GoToOptions = {},
): Promise<boolean> => {
  const {
    range = 2,
    stuckTimeout = 2000,
    canDig = true,
    allowSprinting = true,
  } = options;

  const pathBot = ensurePathfinder(bot, { canDig, allowSprinting });
  const goal = new goals.GoalNear(pos.x, pos.y, pos.z, range);

  // Track position to detect stuck
  let lastPos = bot.entity.position.clone();
  let stuckTime = 0;
  let stopped = false;
  const checkInterval = 100;

  const stuckChecker = setInterval(() => {
    if (stopped) return;

    const currentPos = bot.entity.position;
    const moved = currentPos.distanceTo(lastPos) > 0.05;

    if (moved) {
      lastPos = currentPos.clone();
      stuckTime = 0;
    } else {
      stuckTime += checkInterval;
    }

    if (stuckTime >= stuckTimeout && !stopped) {
      stopped = true;
      console.log(`    Navigation stuck for ${stuckTimeout}ms, cancelling`);
      clearInterval(stuckChecker);
      pathBot.pathfinder.stop();
    }
  }, checkInterval);

  try {
    await pathBot.pathfinder.goto(goal);
    stopped = true;
    clearInterval(stuckChecker);
    return true;
  } catch (_err) {
    stopped = true;
    clearInterval(stuckChecker);
    // Consider success if we got close enough
    return bot.entity.position.distanceTo(pos) <= range + 1;
  }
};

/**
 * Move closer to a target by walking forward
 * Simpler than pathfinder, good for short distances
 *
 * @example
 * ```ts
 * await moveCloser(bot, block.position, { maxDistance: 4 });
 * ```
 */
export const moveCloser = async (
  bot: Bot,
  target: Vec3,
  options: MoveCloserOptions = {},
): Promise<void> => {
  const {
    maxDistance = 4,
    speedFactor = 150,
    maxWalkTime = 3000,
    sprint = false,
  } = options;

  const distance = bot.entity.position.distanceTo(target);
  if (distance <= maxDistance) return;

  await bot.lookAt(target);
  bot.setControlState("forward", true);
  if (sprint) bot.setControlState("sprint", true);

  await sleep(Math.min(distance * speedFactor, maxWalkTime));

  bot.setControlState("forward", false);
  if (sprint) bot.setControlState("sprint", false);
};

/**
 * Walk in a direction until reaching a target XZ position
 * Useful for precise positioning (e.g., walking into a tree column)
 *
 * @example
 * ```ts
 * await walkToXZ(bot, treeX + 0.5, treeZ + 0.5, { targetDist: 0.5 });
 * ```
 */
export const walkToXZ = async (
  bot: Bot,
  targetX: number,
  targetZ: number,
  options: { targetDist?: number; maxTime?: number } = {},
): Promise<boolean> => {
  const { targetDist = 0.5, maxTime = 2000 } = options;

  const target = new Vec3(targetX, bot.entity.position.y + 0.5, targetZ);
  await bot.lookAt(target);
  await sleep(100);

  const startTime = Date.now();
  bot.setControlState("forward", true);

  while (Date.now() - startTime < maxTime) {
    const dx = targetX - bot.entity.position.x;
    const dz = targetZ - bot.entity.position.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);

    if (distXZ < targetDist) {
      bot.setControlState("forward", false);
      return true;
    }
    await sleep(50);
  }

  bot.setControlState("forward", false);
  return false;
};

// =============================================================================
// MINING
// =============================================================================

/**
 * Mine a block and collect the dropped item
 * Handles distance checking, looking, digging, and item collection
 *
 * @example
 * ```ts
 * const success = await mineAndCollect(bot, logPos, {
 *   isValidBlock: (b) => b?.name.includes("_log") ?? false,
 * });
 * ```
 */
export const mineAndCollect = async (
  bot: Bot,
  pos: Vec3,
  options: MineAndCollectOptions = {},
): Promise<boolean> => {
  const {
    maxMineDistance = 4.5,
    postDigDelay = 100,
    collectDelay = 300,
    isValidBlock = () => true,
  } = options;

  // Re-fetch the block fresh
  const block = bot.blockAt(pos);
  if (!block || block.name === "air" || !isValidBlock(block)) {
    return true; // Block already gone or invalid
  }

  // Check distance
  const blockCenter = pos.offset(0.5, 0.5, 0.5);
  const dist = bot.entity.position.distanceTo(blockCenter);

  if (dist > maxMineDistance) {
    console.log(`    Too far to mine: ${dist.toFixed(2)} > ${maxMineDistance}`);
    return false;
  }

  // Look at the block center
  await bot.lookAt(blockCenter);
  await sleep(100);

  // Dig the block
  try {
    await bot.dig(block, true);
  } catch (e) {
    console.log(`    Dig error: ${e}`);
    return false;
  }

  // Verify it's gone
  await sleep(postDigDelay);
  const after = bot.blockAt(pos);
  if (after && after.name !== "air" && isValidBlock(after)) {
    console.log(`    Block still there after dig!`);
    return false;
  }

  // Walk to collect drop
  const dropPos = pos.offset(0.5, 0, 0.5);
  await bot.lookAt(dropPos);

  bot.setControlState("forward", true);
  await sleep(500);
  bot.setControlState("forward", false);
  await sleep(collectDelay);

  return true;
};

// =============================================================================
// INVENTORY UTILITIES
// =============================================================================

/**
 * Count items in inventory matching a name pattern
 *
 * @example
 * ```ts
 * const logCount = countItems(bot, "_log");
 * const ironIngots = countItems(bot, "iron_ingot");
 * ```
 */
export const countItems = (bot: Bot, namePattern: string): number => {
  return bot.inventory.items()
    .filter((i) => i.name.includes(namePattern))
    .reduce((sum, i) => sum + i.count, 0);
};

/**
 * Check if inventory contains an item matching a pattern
 *
 * @example
 * ```ts
 * if (hasItem(bot, "diamond_pickaxe")) { ... }
 * ```
 */
export const hasItem = (bot: Bot, namePattern: string): boolean => {
  return bot.inventory.items().some((i) => i.name.includes(namePattern));
};

/**
 * Find an item in inventory by name pattern
 *
 * @example
 * ```ts
 * const sword = findItem(bot, "sword");
 * if (sword) await bot.equip(sword, "hand");
 * ```
 */
export const findItem = (
  bot: Bot,
  namePattern: string,
): { name: string; count: number; type: number; slot: number } | undefined => {
  // deno-lint-ignore no-explicit-any
  return bot.inventory.items().find((i) => i.name.includes(namePattern)) as any;
};

/**
 * Equip an item by name pattern if available
 *
 * @example
 * ```ts
 * await equipItem(bot, "sword", "hand");
 * await equipItem(bot, "pickaxe", "hand");
 * ```
 */
export const equipItem = async (
  bot: Bot,
  namePattern: string,
  destination: "hand" | "head" | "torso" | "legs" | "feet" | "off-hand" =
    "hand",
): Promise<boolean> => {
  const item = findItem(bot, namePattern);
  if (!item) return false;

  try {
    // deno-lint-ignore no-explicit-any
    await bot.equip(item as any, destination);
    return true;
  } catch {
    return false;
  }
};

// =============================================================================
// ENTITY UTILITIES
// =============================================================================

/**
 * Find entities by name
 *
 * @example
 * ```ts
 * const pigs = findEntities(bot, "pig");
 * const endermen = findEntities(bot, "enderman");
 * ```
 */
export const findEntities = (
  bot: Bot,
  name: string,
  // deno-lint-ignore no-explicit-any
): any[] => {
  return Object.values(bot.entities).filter((e) => e.name === name);
};

/**
 * Find entities by multiple names
 *
 * @example
 * ```ts
 * const animals = findEntitiesByNames(bot, ["pig", "cow", "sheep", "chicken"]);
 * ```
 */
export const findEntitiesByNames = (
  bot: Bot,
  names: string[],
  // deno-lint-ignore no-explicit-any
): any[] => {
  return Object.values(bot.entities).filter(
    (e) => e.name && names.includes(e.name),
  );
};

/**
 * Find the nearest entity matching criteria
 *
 * @example
 * ```ts
 * const nearestPig = findNearestEntity(bot, (e) => e.name === "pig");
 * ```
 */
export const findNearestEntity = (
  bot: Bot,
  // deno-lint-ignore no-explicit-any
  filter: (entity: any) => boolean,
  // deno-lint-ignore no-explicit-any
): any | null => {
  const entities = Object.values(bot.entities).filter(filter);
  if (entities.length === 0) return null;

  return entities.sort(
    // deno-lint-ignore no-explicit-any
    (a: any, b: any) =>
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position),
  )[0];
};

// =============================================================================
// BLOCK UTILITIES
// =============================================================================

/**
 * Find a block matching criteria
 * Wrapper around bot.findBlock with better typing
 *
 * @example
 * ```ts
 * const water = findBlock(bot, "water", 64);
 * const log = findBlock(bot, (b) => b.name.includes("_log"), 64);
 * ```
 */
export const findBlock = (
  bot: Bot,
  matcher: string | ((block: { name: string }) => boolean),
  maxDistance = 32,
  // deno-lint-ignore no-explicit-any
): any | null => {
  const matchFn = typeof matcher === "string"
    ? (b: { name: string }) => b.name === matcher
    : matcher;

  return bot.findBlock({
    matching: matchFn,
    maxDistance,
  });
};

/**
 * Find multiple blocks matching criteria
 *
 * @example
 * ```ts
 * const waterBlocks = findBlocks(bot, "water", 64, 100);
 * ```
 */
export const findBlocks = (
  bot: Bot,
  matcher: string | ((block: { name: string }) => boolean),
  maxDistance = 32,
  count = 100,
): Vec3[] => {
  const matchFn = typeof matcher === "string"
    ? (b: { name: string }) => b.name === matcher
    : matcher;

  return bot.findBlocks({
    matching: matchFn,
    maxDistance,
    count,
  });
};

// =============================================================================
// CRAFTING UTILITIES
// =============================================================================

/**
 * Find or place a crafting table
 * Returns the crafting table block or null
 *
 * @example
 * ```ts
 * const table = await getCraftingTable(bot);
 * if (table) {
 *   const recipes = bot.recipesFor(itemId, null, 1, table);
 * }
 * ```
 */
// deno-lint-ignore no-explicit-any
export const getCraftingTable = async (bot: Bot): Promise<any | null> => {
  // Check if one is already nearby
  const table = findBlock(bot, "crafting_table", 4);
  if (table) return table;

  // Try to place one from inventory
  const tableItem = findItem(bot, "crafting_table");
  if (!tableItem) return null;

  // Find a spot to place it
  const ground = bot.blockAt(bot.entity.position.offset(1, -1, 0));
  if (!ground) return null;

  try {
    // deno-lint-ignore no-explicit-any
    await bot.equip(tableItem as any, "hand");
    // @ts-ignore - Vec3 compatibility
    await bot.placeBlock(ground, { x: 0, y: 1, z: 0 });
    return findBlock(bot, "crafting_table", 4);
  } catch {
    return null;
  }
};

/**
 * Craft an item by name
 * Handles recipe lookup and crafting
 *
 * @example
 * ```ts
 * const result = await craftItem(bot, "wooden_pickaxe", 1, table);
 * const result = await craftItem(bot, "stick", 8); // No table needed
 * ```
 */
export const craftItem = async (
  bot: Bot,
  itemName: string,
  count = 1,
  // deno-lint-ignore no-explicit-any
  craftingTable?: any,
): Promise<StepResult> => {
  const itemId = bot.registry.itemsByName[itemName]?.id;
  if (!itemId) {
    return { success: false, message: `Unknown item: ${itemName}` };
  }

  const recipes = bot.recipesFor(itemId, null, 1, craftingTable ?? null);
  const recipe = recipes[0];

  if (!recipe) {
    return { success: false, message: `No recipe for ${itemName}` };
  }

  try {
    await bot.craft(recipe, count, craftingTable ?? undefined);
    return { success: true, message: `Crafted ${count}x ${itemName}` };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error
        ? err.message
        : `Failed to craft ${itemName}`,
    };
  }
};

// =============================================================================
// COMBAT UTILITIES
// =============================================================================

/**
 * Attack an entity repeatedly until dead or escaped
 *
 * @example
 * ```ts
 * const killed = await attackUntilDead(bot, blaze, { maxHits: 15 });
 * ```
 */
export const attackUntilDead = async (
  bot: Bot,
  // deno-lint-ignore no-explicit-any
  entity: any,
  options: { maxHits?: number; hitDelay?: number; lookHeight?: number } = {},
): Promise<boolean> => {
  const { maxHits = 10, hitDelay = 400, lookHeight = 1 } = options;

  for (let i = 0; i < maxHits; i++) {
    // Check if entity still exists
    if (!bot.entities[entity.id]) {
      return true; // Dead
    }

    try {
      await bot.lookAt(entity.position.offset(0, lookHeight, 0));
      await bot.attack(entity);
    } catch {
      return false; // Lost target
    }

    await sleep(hitDelay);
  }

  return !bot.entities[entity.id];
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Sleep for a specified duration
 *
 * @example
 * ```ts
 * await sleep(1000); // Wait 1 second
 * ```
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Create a success result
 */
export const success = (message: string): StepResult => ({
  success: true,
  message,
});

/**
 * Create a failure result
 */
export const failure = (message: string): StepResult => ({
  success: false,
  message,
});

/**
 * Wrap an error into a failure result
 */
export const errorResult = (err: unknown, fallback: string): StepResult => ({
  success: false,
  message: err instanceof Error ? err.message : fallback,
});

// =============================================================================
// EXPLORATION
// =============================================================================

/**
 * Explore in a random direction
 * Useful when searching for resources
 *
 * @example
 * ```ts
 * await exploreRandom(bot, 30);
 * ```
 */
export const exploreRandom = async (
  bot: Bot,
  distance = 30,
): Promise<void> => {
  const angle = Math.random() * Math.PI * 2;
  const target = new Vec3(
    bot.entity.position.x + Math.cos(angle) * distance,
    bot.entity.position.y,
    bot.entity.position.z + Math.sin(angle) * distance,
  );
  await goTo(bot, target, { range: 5 });
};

/**
 * Move around to search for entities
 *
 * @example
 * ```ts
 * await searchForEntities(bot, 2000);
 * ```
 */
export const searchForEntities = async (
  bot: Bot,
  duration = 2000,
): Promise<void> => {
  bot.setControlState("forward", true);
  await sleep(duration);
  bot.setControlState("forward", false);
};
