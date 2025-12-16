/**
 * Test: Gather Wood
 * Spawns bot(s) and attempts to gather wood logs
 * 
 * Usage:
 *   deno task test                           # runs 1 bot
 *   deno task test -- --bots=50              # runs 50 bots at different locations
 *   deno task test -- --bots=50 --spacing=500  # custom spacing between bots
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { gatherWood } from "./main.ts";

const TARGET_LOGS = 4;
const TIMEOUT = 60000;

// Parse args
const args = Deno.args;
const botsArg = args.find((a) => a.startsWith("--bots="));
const spacingArg = args.find((a) => a.startsWith("--spacing="));
const BOT_COUNT = botsArg ? parseInt(botsArg.split("=")[1]) : 1;
const SPACING = spacingArg ? parseInt(spacingArg.split("=")[1]) : 1000;

interface BotResult {
  id: number;
  x: number;
  z: number;
  success: boolean;
  logsGathered: number;
  message: string;
  duration: number;
}

async function runSingleBot(id: number): Promise<BotResult> {
  const x = id * SPACING;
  const z = 0;
  // Use TestWood for single/multi - it's opped and can tp itself
  const username = BOT_COUNT === 1 ? "TestWood" : `Wood${id}`;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const bot = mineflayer.createBot({
      host: "localhost",
      port: 25565,
      username,
    });

    const timeout = setTimeout(() => {
      try { bot.quit(); } catch (_) { /* ignore */ }
      resolve({
        id,
        x,
        z,
        success: false,
        logsGathered: 0,
        message: "Timeout after 60s",
        duration: Date.now() - startTime,
      });
    }, TIMEOUT);

    bot.once("spawn", async () => {
      try {
        // Wait for world to load
        await new Promise((r) => setTimeout(r, 1000));

        const result = await gatherWood(bot, TARGET_LOGS);

        const logsGathered = bot.inventory.items()
          .filter((i: { name: string }) => i.name.includes("_log"))
          .reduce((sum: number, i: { count: number }) => sum + i.count, 0);

        clearTimeout(timeout);
        bot.quit();

        resolve({
          id,
          x,
          z,
          success: result.success && logsGathered >= TARGET_LOGS,
          logsGathered,
          message: result.message,
          duration: Date.now() - startTime,
        });
      } catch (err) {
        clearTimeout(timeout);
        try { bot.quit(); } catch (_) { /* ignore */ }
        resolve({
          id,
          x,
          z,
          success: false,
          logsGathered: 0,
          message: err instanceof Error ? err.message : "Unknown error",
          duration: Date.now() - startTime,
        });
      }
    });

    bot.on("error", (err: Error) => {
      clearTimeout(timeout);
      try { bot.quit(); } catch (_) { /* ignore */ }
      resolve({
        id,
        x,
        z,
        success: false,
        logsGathered: 0,
        message: err.message,
        duration: Date.now() - startTime,
      });
    });
  });
}

Deno.test({
  name: `gather-wood: can gather logs (${BOT_COUNT} bot${BOT_COUNT > 1 ? "s" : ""})`,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (BOT_COUNT === 1) {
      // Simple single bot test
      const result = await runSingleBot(0);
      assert(result.success, `Expected success but got: ${result.message}`);
      assert(result.logsGathered >= TARGET_LOGS, `Expected ${TARGET_LOGS} logs but got ${result.logsGathered}`);
    } else {
      // Multi-bot stress test
      console.log(`\nRunning ${BOT_COUNT} bots with ${SPACING} block spacing...`);
      
      const BATCH_SIZE = 10;
      const results: BotResult[] = [];

      for (let batch = 0; batch < Math.ceil(BOT_COUNT / BATCH_SIZE); batch++) {
        const batchStart = batch * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, BOT_COUNT);

        const batchPromises = [];
        for (let i = batchStart; i < batchEnd; i++) {
          batchPromises.push(runSingleBot(i));
        }

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Print batch results
        for (const r of batchResults) {
          const status = r.success ? "PASS" : "FAIL";
          console.log(`[${status}] Bot ${r.id} @ (${r.x}, ${r.z}) - ${r.logsGathered} logs - ${(r.duration / 1000).toFixed(1)}s - ${r.message}`);
        }
      }

      // Summary
      const passed = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      console.log(`\n========== SUMMARY ==========`);
      console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
      console.log(`Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);

      // Failure reasons
      const failReasons = new Map<string, number>();
      for (const r of results.filter((r) => !r.success)) {
        failReasons.set(r.message, (failReasons.get(r.message) ?? 0) + 1);
      }

      if (failReasons.size > 0) {
        console.log(`\nFailure Reasons:`);
        for (const [reason, count] of failReasons.entries()) {
          console.log(`  ${count}x: ${reason}`);
        }
      }

      // Write results to JSON
      await Deno.writeTextFile(
        "gather-wood-results.json",
        JSON.stringify(results, null, 2)
      );
      console.log(`\nResults written to gather-wood-results.json`);

      // Assert at least 50% pass rate for multi-bot
      assert(passed / results.length >= 0.5, `Pass rate ${((passed / results.length) * 100).toFixed(1)}% is below 50%`);
    }
  },
});
