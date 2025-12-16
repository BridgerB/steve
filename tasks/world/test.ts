/**
 * Test: World
 * Spawns a bot and attempts to fill a water bucket
 * Prerequisites: bucket x1 (auto-given)
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { fillWaterBucket } from "./main.ts";

const USERNAME = "TestWorld";
const TIMEOUT = 60000;

Deno.test({
  name: "world: can fill water bucket",
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
              bot.chat("/give TestWorld bucket 1");
              await new Promise((r) => setTimeout(r, 500));

              const result = await fillWaterBucket(bot);

              const waterBucket = bot.inventory.items().find((i) =>
                i.name === "water_bucket"
              );

              bot.quit();

              assert(
                result.success && waterBucket,
                `Expected water bucket but got: ${result.message}`,
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
