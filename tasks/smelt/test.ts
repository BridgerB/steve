/**
 * Test: Smelting
 * Spawns a bot and attempts to smelt items
 * Prerequisites: raw_iron x8, coal x8, furnace x1 (auto-given)
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { smeltItems } from "./main.ts";

const USERNAME = "TestSmelt";
const TIMEOUT = 60000;

Deno.test({
  name: "smelt: can smelt raw iron into ingots",
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
              bot.chat("/give TestSmelt raw_iron 8");
              await new Promise((r) => setTimeout(r, 300));
              bot.chat("/give TestSmelt coal 8");
              await new Promise((r) => setTimeout(r, 300));
              bot.chat("/give TestSmelt furnace 1");
              await new Promise((r) => setTimeout(r, 500));

              const result = await smeltItems(bot, "raw_iron", 4);

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
