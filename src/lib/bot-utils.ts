/**
 * Shared bot utilities for all tasks
 * Reduces code duplication across task implementations
 */

import type { Bot, Pathfinder, Item } from "typecraft";
import { createPathfinder, createGoalNear, windowItems } from "typecraft";
import { vec3, distance, offset, type Vec3, logEvent } from "typecraft";
import type { StepResult } from "../types.ts";

/** Block with position and hardness — enriched from typecraft's blockAt + registry */
type Block = {
  position: Vec3;
  name: string;
  stateId: number;
  hardness: number | null;
};

/** Get block at position with position and hardness attached */
export const getBlock = (bot: Bot, pos: Vec3): Block | null => {
  // Floor position — block coords must be integers
  pos = vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  const info = bot.blockAt(pos) as { name: string; stateId?: number; properties?: Record<string, string> } | null;
  if (!info) return null;

  // Look up hardness from registry
  let hardness: number | null = null;
  if (bot.registry) {
    const blockName = info.name.startsWith("minecraft:") ? info.name : `minecraft:${info.name}`;
    const def = bot.registry.blocksByName.get(blockName) ?? bot.registry.blocksByName.get(info.name);
    if (def) hardness = def.hardness;
  }

  return { position: pos, name: info.name, stateId: info.stateId ?? 0, hardness };
};

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

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

const pathfinderCache = new WeakMap<Bot, Pathfinder>();

/**
 * Get or create a cached pathfinder instance for a bot
 */
export const getPathfinder = (bot: Bot): Pathfinder => {
  let pf = pathfinderCache.get(bot);
  if (!pf) {
    pf = createPathfinder(bot);
    pathfinderCache.set(bot, pf);
  }
  return pf;
};

// =============================================================================
// NAVIGATION
// =============================================================================

/**
 * Navigate to a position using pathfinder with stuck detection
 *
 * @example
 * ```ts
 * const reached = await goTo(bot, vec3(100, 64, 200));
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
  } = options;

  const pf = getPathfinder(bot);
  const goal = createGoalNear(pos.x, pos.y, pos.z, range);

  // Track position to detect stuck
  let lastPos = vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
  let stuckTime = 0;
  let stopped = false;
  const checkInterval = 100;

  const stuckChecker = setInterval(() => {
    if (stopped) return;

    const currentPos = bot.entity.position;
    const moved = distance(currentPos, lastPos) > 0.05;

    if (moved) {
      lastPos = vec3(currentPos.x, currentPos.y, currentPos.z);
      stuckTime = 0;
    } else {
      stuckTime += checkInterval;
    }

    if (stuckTime >= stuckTimeout && !stopped) {
      stopped = true;
      console.log(`    Navigation stuck for ${stuckTimeout}ms, cancelling`);
      clearInterval(stuckChecker);
      pf.stop();
    }
  }, checkInterval);

  try {
    await pf.goto(goal);
    stopped = true;
    clearInterval(stuckChecker);
    return true;
  } catch (_err) {
    stopped = true;
    clearInterval(stuckChecker);
    // Consider success if we got close enough
    return distance(bot.entity.position, pos) <= range + 1;
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

  const dist = distance(bot.entity.position, target);
  if (dist <= maxDistance) return;

  await bot.lookAt(target);
  bot.setControlState("forward", true);
  if (sprint) bot.setControlState("sprint", true);

  await sleep(Math.min(dist * speedFactor, maxWalkTime));

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

  const target = vec3(targetX, bot.entity.position.y + 0.5, targetZ);
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
  const block = getBlock(bot, pos);
  if (!block || block.name === "air" || !isValidBlock(block)) {
    return true; // Block already gone or invalid
  }

  // Check distance
  const blockCenter = offset(pos, 0.5, 0.5, 0.5);
  const dist = distance(bot.entity.position, blockCenter);

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
  const after = getBlock(bot, pos);
  if (after && after.name !== "air" && isValidBlock(after)) {
    console.log(`    Block still there after dig!`);
    return false;
  }

  // Walk to collect drop
  const dropPos = offset(pos, 0.5, 0, 0.5);
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
  return windowItems(bot.inventory)
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
  return windowItems(bot.inventory).some((i) => i.name.includes(namePattern));
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
): Item | undefined => {
  return windowItems(bot.inventory).find((i) => i.name.includes(namePattern));
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
    await bot.equip(item, destination);
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
  filter: (entity: any) => boolean,
): any | null => {
  const entities = Object.values(bot.entities).filter(filter);
  if (entities.length === 0) return null;

  return entities.sort(
    (a: any, b: any) =>
      distance(bot.entity.position, a.position) -
      distance(bot.entity.position, b.position),
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
 * const log = findBlock(bot, (name) => name.includes("_log"), 64);
 * ```
 */
export const findBlock = (
  bot: Bot,
  matcher: string | ((name: string, stateId: number) => boolean),
  maxDistance = 32,
): Block | null => {
  const matchFn = typeof matcher === "string"
    ? (name: string) => name === matcher
    : matcher;

  const positions = bot.findBlocks({
    matching: matchFn,
    maxDistance,
    count: 1,
  });

  if (positions.length === 0) return null;

  const pos = positions[0]!;
  return getBlock(bot, pos);
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
  matcher: string | ((name: string, stateId: number) => boolean),
  maxDistance = 32,
  count = 100,
): Vec3[] => {
  const matchFn = typeof matcher === "string"
    ? (name: string) => name === matcher
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
export const getCraftingTable = async (bot: Bot): Promise<Block | null> => {
  // Check if one is already nearby
  const table = findBlock(bot, "crafting_table", 4);
  if (table) { logEvent("craft", "table_found"); return table; }

  // Try to place one from inventory
  const tableItem = findItem(bot, "crafting_table");
  console.log(`[craft] findItem("crafting_table") = ${tableItem ? `${tableItem.name}(${tableItem.type})` : "null"}`);
  if (!tableItem) { logEvent("craft", "table_missing", "not in inventory"); return null; }

  // Find a solid block to place on — try several positions
  let ground: Block | null = null;
  for (const [dx, dz] of [[1,0], [0,1], [-1,0], [0,-1], [0,0]]) {
    const candidate = getBlock(bot, offset(bot.entity.position, dx, -1, dz));
    if (candidate && candidate.name !== "air" && candidate.name !== "water" && !candidate.name.includes("leaves")) {
      ground = candidate;
      break;
    }
  }
  if (!ground) {
    console.log("[craft] No solid ground found for table placement");
    logEvent("craft", "table_no_ground", "no solid block nearby");
    return null;
  }

  console.log(`[craft] Placing table on ${ground.name} at ${ground.position.x},${ground.position.y},${ground.position.z}`);
  logEvent("craft", "table_placing", `on ${ground.name} at ${ground.position.x},${ground.position.y},${ground.position.z}`);

  try {
    // Move table to hand without losing other items — use setQuickBarSlot to the table's slot
    const tableSlot = bot.inventory.slots.findIndex((s) => s && s.name === "crafting_table");
    if (tableSlot >= 36 && tableSlot <= 44) {
      // Already in hotbar — just select that slot
      bot.setQuickBarSlot(tableSlot - 36);
    } else if (tableSlot >= 0) {
      // In inventory — equip it
      await bot.equip(tableItem, "hand");
    }
    await sleep(200);
    try {
      await bot.placeBlock(ground as any, vec3(0, 1, 0));
    } catch {
      // placeBlock may timeout but block could still be placed
    }
    // Wait for the crafting window to open (placing a table opens it)
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      if (bot.currentWindow) break;
    }
    const placed = findBlock(bot, "crafting_table", 4);
    if (placed) {
      logEvent("craft", "table_placed");
    } else {
      logEvent("craft", "table_place_failed", "placed but not found");
    }
    return placed;
  } catch (e) {
    console.log(`[craft] Table place ERROR: ${e}`);
    if (e instanceof Error) console.log(e.stack);
    logEvent("craft", "table_place_error", String(e));
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
  craftingTable?: any,
): Promise<StepResult> => {
  const itemId = bot.registry?.itemsByName.get(itemName)?.id;
  if (!itemId) {
    return { success: false, message: `Unknown item: ${itemName}` };
  }

  const recipes = bot.recipesFor(itemId, null, 1, craftingTable ?? null);

  if (recipes.length === 0) {
    logEvent("craft", "no_recipe", `${itemName} (id=${itemId})`);
    return { success: false, message: `No recipe for ${itemName}` };
  }

  // Pick a recipe whose ingredients we actually have
  // When a container window is open, player items are in currentWindow's inventory section
  const win = bot.currentWindow ?? bot.inventory;
  const invStart = win === bot.inventory ? 0 : (win as any).inventoryStart ?? 0;
  const hasIngredient = (id: number): boolean =>
    win.slots.some((s, i) => s && i >= invStart && s.type === id && s.count > 0);

  const recipe = recipes.find((r) => {
    if (r.inShape) {
      return r.inShape.every((row) => row.every((item) => item.id === -1 || hasIngredient(item.id)));
    }
    if (r.ingredients) {
      return r.ingredients.every((item) => hasIngredient(item.id));
    }
    return false;
  });

  if (!recipe) {
    try {
      const invTypes = Array.from(win.slots).filter(s => s && s.count > 0).map(s => `${s!.name}(${s!.type})`);
      console.log(`[craft] No matching recipe for ${itemName}. inv=[${invTypes.join(",")}]`);
    } catch { /* ignore debug errors */ }
    return { success: false, message: `No matching recipe for ${itemName}` };
  }

  const ingredientIds = (recipe.inShape ?? recipe.ingredients)?.flat().filter(i => i.id !== -1).map(i => i.id);
  console.log(`[craft] Crafting ${itemName} needs=[${ingredientIds}] currentWindow=${bot.currentWindow?.type} invSlots=${bot.inventory.slots.filter(s=>s&&s.count>0).length}`);

  try {
    await bot.craft(recipe, count, craftingTable ?? undefined);
    // Close crafting window and wait for inventory to sync
    if (bot.currentWindow) {
      bot.closeWindow(bot.currentWindow);
      await sleep(1000);
    }
    // Debug: dump inventory after craft
    const afterSlots = bot.inventory.slots
      .map((s, i) => s && s.count > 0 ? `${i}:${s.name}(${s.type})x${s.count}` : null)
      .filter(Boolean);
    console.log(`[craft] After crafting ${itemName}: ${afterSlots.join(", ") || "empty"}`);
    return { success: true, message: `Crafted ${count}x ${itemName}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : `Failed to craft ${itemName}`;
    console.log(`[craft] ERROR: ${msg}`);
    if (err instanceof Error) console.log(err.stack);
    // Dump both windows
    console.log(`[craft] currentWindow after error: type=${bot.currentWindow?.type} slots=${bot.currentWindow?.slots?.length}`);
    const cwItems = bot.currentWindow?.slots?.map((s, i) => s && s.count > 0 ? `${i}:${s.name}(${s.type})` : null).filter(Boolean);
    if (cwItems?.length) console.log(`[craft] window: ${cwItems.join(", ")}`);
    const invItems = bot.inventory.slots.map((s, i) => s && s.count > 0 ? `${i}:${s.name}(${s.type})` : null).filter(Boolean);
    console.log(`[craft] inventory: ${invItems.join(", ") || "empty"}`);
    return { success: false, message: msg };
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
      await bot.lookAt(offset(entity.position, 0, lookHeight, 0));
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
// WATER HANDLING
// =============================================================================

/**
 * If bot is in water, swim up and try to get to land.
 * Holds jump to swim up, then walks forward to find shore.
 */
export const escapeWater = async (bot: Bot): Promise<boolean> => {
  if (!bot.entity?.isInWater) return true; // not in water

  console.log("  Swimming out of water...");

  // Hold jump to swim up
  bot.setControlState("jump", true);
  bot.setControlState("forward", true);
  bot.setControlState("sprint", true);

  const start = Date.now();
  const timeout = 10000;

  while (Date.now() - start < timeout) {
    await sleep(200);
    if (!bot.entity?.isInWater) {
      // Out of water, keep moving forward briefly to get on land
      await sleep(500);
      bot.setControlState("jump", false);
      bot.setControlState("forward", false);
      bot.setControlState("sprint", false);
      console.log("  Escaped water!");
      return true;
    }
    // Rotate randomly to find shore
    if ((Date.now() - start) % 2000 < 200) {
      const angle = Math.random() * Math.PI * 2;
      await bot.look(angle, 0);
    }
  }

  bot.setControlState("jump", false);
  bot.setControlState("forward", false);
  bot.setControlState("sprint", false);
  console.log("  Failed to escape water");
  return false;
};

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
  dist = 30,
): Promise<void> => {
  if (!bot.entity?.position) return;
  const angle = Math.random() * Math.PI * 2;
  const target = vec3(
    bot.entity.position.x + Math.cos(angle) * dist,
    bot.entity.position.y,
    bot.entity.position.z + Math.sin(angle) * dist,
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
