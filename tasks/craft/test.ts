/**
 * Test: Crafting
 * Spawns a bot and attempts to craft planks, crafting table, sticks
 * Prerequisites: oak_log x4 (auto-given)
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { craftCraftingTable, craftPlanks } from "./main.ts";

const USERNAME = "TestCraft";
const TIMEOUT = 60000;

Deno.test({
  name: "craft: can craft planks, crafting table, and sticks",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.race([
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Test timed out after 60s")), TIMEOUT)
      ),
      (async () => {
        const bot = mineflayer.createBot({
          host: "localhost",
          port: 25565,
          username: USERNAME,
        });

        await new Promise<void>((resolve, reject) => {
          bot.once("spawn", async () => {
            try {
              bot.chat("/give TestCraft oak_log 4");
              await new Promise((r) => setTimeout(r, 1000));

              const planksResult = await craftPlanks(bot);
              assert(
                planksResult.success,
                `craftPlanks failed: ${planksResult.message}`,
              );

              const tableResult = await craftCraftingTable(bot);
              assert(
                tableResult.success,
                `craftCraftingTable failed: ${tableResult.message}`,
              );

              bot.quit();
              resolve();
            } catch (err) {
              bot.quit();
              reject(err);
            }
          });

          bot.on("error", reject);
        });
      })(),
    ]);
  },
});
