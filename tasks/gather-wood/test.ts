/**
 * Test: Gather Wood
 * Spawns a bot and attempts to gather wood logs
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { gatherWood } from "./main.ts";

const USERNAME = "TestWood";
const TARGET_LOGS = 4;
const TIMEOUT = 60000;

Deno.test({
  name: "gather-wood: can gather logs from trees",
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
              const result = await gatherWood(bot, TARGET_LOGS);

              const logsAfter = bot.inventory.items()
                .filter((i) => i.name.includes("_log"))
                .reduce((sum, i) => sum + i.count, 0);

              bot.quit();

              assert(
                result.success,
                `Expected success but got: ${result.message}`,
              );
              assert(
                logsAfter >= TARGET_LOGS,
                `Expected ${TARGET_LOGS} logs but got ${logsAfter}`,
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
