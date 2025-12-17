/**
 * Shared test utilities for all task tests
 * Reduces boilerplate across test files
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { StepResult } from "../types.ts";

// =============================================================================
// TYPES
// =============================================================================

/** Configuration for a bot test */
export interface BotTestConfig {
  /** Bot username */
  username: string;
  /** Test timeout in ms (default: 60000) */
  timeout?: number;
  /** Server host (default: localhost) */
  host?: string;
  /** Server port (default: 25565) */
  port?: number;
  /** Commands to run after spawn for setup (e.g., /give commands) */
  setupCommands?: string[];
  /** Delay after each setup command in ms (default: 500) */
  setupDelay?: number;
  /** Delay after spawn before running test (default: 1000) */
  spawnDelay?: number;
}

/** Result from a single bot test run */
export interface BotTestResult {
  success: boolean;
  message: string;
  duration: number;
  error?: Error;
}

/** Multi-bot test configuration */
export interface MultiBotTestConfig extends Omit<BotTestConfig, "username"> {
  /** Base username (will be appended with index) */
  usernamePrefix: string;
  /** Number of bots to spawn */
  botCount: number;
  /** Spacing between bot spawn positions */
  spacing?: number;
  /** Whether to run bots in batches (default: 10) */
  batchSize?: number;
}

// =============================================================================
// SINGLE BOT TEST HELPERS
// =============================================================================

/**
 * Run a test with a single bot
 * Handles connection, setup, cleanup, and timeout
 *
 * @example
 * ```ts
 * Deno.test("my test", async () => {
 *   await runBotTest({
 *     username: "TestBot",
 *     setupCommands: ["/give TestBot diamond_pickaxe 1"],
 *   }, async (bot) => {
 *     const result = await myTask(bot);
 *     assert(result.success, result.message);
 *   });
 * });
 * ```
 */
export const runBotTest = async (
  config: BotTestConfig,
  testFn: (bot: Bot) => Promise<void>,
): Promise<void> => {
  const {
    username,
    timeout = 60000,
    host = "localhost",
    port = 25565,
    setupCommands = [],
    setupDelay = 500,
    spawnDelay = 1000,
  } = config;

  await Promise.race([
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Test timed out after ${timeout}ms`)),
        timeout,
      )
    ),
    (async () => {
      const bot = mineflayer.createBot({
        host,
        port,
        username,
      });

      await new Promise<void>((resolve, reject) => {
        bot.once("spawn", async () => {
          try {
            // Wait for world to load
            await sleep(spawnDelay);

            // Run setup commands
            for (const cmd of setupCommands) {
              bot.chat(cmd);
              await sleep(setupDelay);
            }

            // Run the actual test
            await testFn(bot);

            bot.quit();
            resolve();
          } catch (err) {
            bot.quit();
            reject(err);
          }
        });

        bot.on("error", (err) => {
          bot.quit();
          reject(err);
        });
      });
    })(),
  ]);
};

/**
 * Create a standard Deno.test configuration for bot tests
 * Disables sanitizers that don't work well with mineflayer
 *
 * @example
 * ```ts
 * Deno.test(botTest("my-test: does something", async () => {
 *   await runBotTest({ username: "TestBot" }, async (bot) => {
 *     // test code
 *   });
 * }));
 * ```
 */
export const botTest = (
  name: string,
  fn: () => Promise<void>,
): Deno.TestDefinition => ({
  name,
  sanitizeOps: false,
  sanitizeResources: false,
  fn,
});

/**
 * Run a task and assert success
 * Shorthand for common test pattern
 *
 * @example
 * ```ts
 * await assertTaskSuccess(bot, () => gatherWood(bot, 4));
 * ```
 */
export const assertTaskSuccess = async (
  taskFn: () => Promise<StepResult>,
  errorPrefix?: string,
): Promise<StepResult> => {
  const result = await taskFn();
  assert(
    result.success,
    `${errorPrefix ? errorPrefix + ": " : ""}${result.message}`,
  );
  return result;
};

// =============================================================================
// MULTI-BOT TEST HELPERS
// =============================================================================

/**
 * Run a test function on a single bot and return result
 * Used internally by runMultiBotTest
 */
export const runSingleBotTest = (
  config: BotTestConfig,
  testFn: (bot: Bot) => Promise<StepResult>,
): Promise<BotTestResult> => {
  const {
    username,
    timeout = 60000,
    host = "localhost",
    port = 25565,
    setupCommands = [],
    setupDelay = 500,
    spawnDelay = 1000,
  } = config;

  const startTime = Date.now();

  return new Promise((resolve) => {
    const bot = mineflayer.createBot({
      host,
      port,
      username,
    });

    const timeoutId = setTimeout(() => {
      try {
        bot.quit();
      } catch { /* ignore */ }
      resolve({
        success: false,
        message: `Timeout after ${timeout}ms`,
        duration: Date.now() - startTime,
      });
    }, timeout);

    bot.once("spawn", async () => {
      try {
        await sleep(spawnDelay);

        for (const cmd of setupCommands) {
          bot.chat(cmd);
          await sleep(setupDelay);
        }

        const result = await testFn(bot);

        clearTimeout(timeoutId);
        bot.quit();

        resolve({
          success: result.success,
          message: result.message,
          duration: Date.now() - startTime,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        try {
          bot.quit();
        } catch { /* ignore */ }
        resolve({
          success: false,
          message: err instanceof Error ? err.message : "Unknown error",
          duration: Date.now() - startTime,
          error: err instanceof Error ? err : undefined,
        });
      }
    });

    bot.on("error", (err) => {
      clearTimeout(timeoutId);
      try {
        bot.quit();
      } catch { /* ignore */ }
      resolve({
        success: false,
        message: err.message,
        duration: Date.now() - startTime,
        error: err,
      });
    });
  });
};

/**
 * Run a test with multiple bots in parallel batches
 *
 * @example
 * ```ts
 * const results = await runMultiBotTest({
 *   usernamePrefix: "Wood",
 *   botCount: 10,
 *   setupCommands: ["/clear"],
 * }, async (bot) => {
 *   return await gatherWood(bot, 4);
 * });
 *
 * console.log(`Pass rate: ${results.passRate}%`);
 * ```
 */
export const runMultiBotTest = async (
  config: MultiBotTestConfig,
  testFn: (bot: Bot, index: number) => Promise<StepResult>,
): Promise<{
  results: BotTestResult[];
  passed: number;
  failed: number;
  passRate: number;
}> => {
  const {
    usernamePrefix,
    botCount,
    batchSize = 10,
    spacing: _spacing = 1000,
    ...restConfig
  } = config;

  const results: BotTestResult[] = [];

  for (let batch = 0; batch < Math.ceil(botCount / batchSize); batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, botCount);

    const batchPromises: Promise<BotTestResult>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const username = `${usernamePrefix}${i}`;
      batchPromises.push(
        runSingleBotTest(
          { ...restConfig, username },
          (bot) => testFn(bot, i),
        ),
      );
    }

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Log batch results
    for (let i = 0; i < batchResults.length; i++) {
      const r = batchResults[i];
      const globalIdx = batchStart + i;
      const status = r.success ? "PASS" : "FAIL";
      console.log(
        `[${status}] ${usernamePrefix}${globalIdx} - ${
          (r.duration / 1000).toFixed(1)
        }s - ${r.message}`,
      );
    }
  }

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const passRate = Math.round((passed / results.length) * 100);

  return { results, passed, failed, passRate };
};

/**
 * Print a summary of multi-bot test results
 */
export const printTestSummary = (results: {
  results: BotTestResult[];
  passed: number;
  failed: number;
  passRate: number;
}): void => {
  console.log(`\n========== SUMMARY ==========`);
  console.log(
    `Total: ${results.results.length} | Passed: ${results.passed} | Failed: ${results.failed}`,
  );
  console.log(`Pass rate: ${results.passRate}%`);

  // Group failures by reason
  const failReasons = new Map<string, number>();
  for (const r of results.results.filter((r) => !r.success)) {
    failReasons.set(r.message, (failReasons.get(r.message) ?? 0) + 1);
  }

  if (failReasons.size > 0) {
    console.log(`\nFailure Reasons:`);
    for (const [reason, count] of failReasons.entries()) {
      console.log(`  ${count}x: ${reason}`);
    }
  }
};

// =============================================================================
// SETUP HELPERS
// =============================================================================

/**
 * Generate /give commands for common test setups
 */
export const giveCommands = {
  /** Give basic wood gathering starter items */
  woodStarter: (username: string): string[] => [
    `/clear ${username}`,
  ],

  /** Give items for crafting tests */
  craftingStarter: (username: string): string[] => [
    `/clear ${username}`,
    `/give ${username} oak_log 16`,
  ],

  /** Give items for mining tests */
  miningStarter: (username: string): string[] => [
    `/clear ${username}`,
    `/give ${username} wooden_pickaxe 1`,
  ],

  /** Give items for stone+ mining */
  stoneMiningStarter: (username: string): string[] => [
    `/clear ${username}`,
    `/give ${username} stone_pickaxe 1`,
  ],

  /** Give items for combat tests */
  combatStarter: (username: string): string[] => [
    `/clear ${username}`,
    `/give ${username} stone_sword 1`,
    `/give ${username} cooked_beef 16`,
  ],

  /** Give items for smelting tests */
  smeltingStarter: (username: string): string[] => [
    `/clear ${username}`,
    `/give ${username} raw_iron 16`,
    `/give ${username} coal 16`,
    `/give ${username} furnace 1`,
  ],

  /** Give items for nether exploration */
  netherStarter: (username: string): string[] => [
    `/clear ${username}`,
    `/give ${username} iron_sword 1`,
    `/give ${username} iron_pickaxe 1`,
    `/give ${username} cooked_beef 32`,
    `/give ${username} cobblestone 64`,
  ],

  /** Give items for end fight */
  endStarter: (username: string): string[] => [
    `/clear ${username}`,
    `/give ${username} diamond_sword 1`,
    `/give ${username} bow 1`,
    `/give ${username} arrow 64`,
    `/give ${username} cooked_beef 64`,
    `/give ${username} ender_pearl 16`,
    `/give ${username} golden_apple 8`,
  ],
};

/**
 * Teleport command generator
 */
export const teleportCommand = (
  username: string,
  x: number,
  y: number,
  z: number,
): string => `/tp ${username} ${x} ${y} ${z}`;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Count items in bot inventory matching pattern
 */
export const countInventoryItems = (bot: Bot, pattern: string): number =>
  bot.inventory.items()
    .filter((i) => i.name.includes(pattern))
    .reduce((sum, i) => sum + i.count, 0);

/**
 * Assert bot has at least N items matching pattern
 */
export const assertHasItems = (
  bot: Bot,
  pattern: string,
  minCount: number,
): void => {
  const count = countInventoryItems(bot, pattern);
  assert(
    count >= minCount,
    `Expected at least ${minCount} ${pattern} but got ${count}`,
  );
};

/**
 * Write test results to a JSON file
 */
export const writeResultsJson = async (
  filename: string,
  results: BotTestResult[],
): Promise<void> => {
  await Deno.writeTextFile(filename, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${filename}`);
};
