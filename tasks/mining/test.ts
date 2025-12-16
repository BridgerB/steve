/**
 * Test: Mining
 * Spawns a bot and attempts to mine stone
 * Prerequisites: wooden_pickaxe (auto-given)
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { mineBlock } from "./main.ts";

const USERNAME = "TestMine";
const TARGET_COUNT = 8;
const TIMEOUT = 60000;

Deno.test({
  name: "mining: can mine stone blocks",
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
              bot.chat("/give TestMine wooden_pickaxe 1");
              await new Promise((r) => setTimeout(r, 1000));

              const result = await mineBlock(bot, "stone", TARGET_COUNT);

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
