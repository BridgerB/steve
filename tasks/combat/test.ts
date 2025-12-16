/**
 * Test: Combat
 * Spawns a bot and attempts to gather food from animals
 * Prerequisites: stone_sword x1 (auto-given)
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { gatherFood } from "./main.ts";

const USERNAME = "TestCombat";
const TIMEOUT = 60000;

Deno.test({
  name: "combat: can gather food from animals",
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
              bot.chat("/give TestCombat stone_sword 1");
              await new Promise((r) => setTimeout(r, 500));

              const result = await gatherFood(bot, 3);

              bot.quit();

              assert(
                result.success,
                `Expected success but got: ${result.message}`,
              );
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
