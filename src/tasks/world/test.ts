/**
 * Test: World
 * Spawns a bot and attempts to fill a water bucket
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { createBot, windowItems } from "typecraft";
import { fillWaterBucket } from "./main.ts";

const USERNAME = "TestWorld";
const TIMEOUT = 60000;

it("world: can fill water bucket", { timeout: TIMEOUT }, async () => {
  await Promise.race([
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Test timed out after 60s")), TIMEOUT)
    ),
    (async () => {
      const bot = createBot({
        host: "localhost",
        port: 25565,
        username: USERNAME,
        version: "1.21",
      });

      await new Promise<void>((resolve, reject) => {
        bot.once("spawn", async () => {
          try {
            bot.chat("/give TestWorld bucket 1");
            await new Promise((r) => setTimeout(r, 500));

            const result = await fillWaterBucket(bot);

            const waterBucket = windowItems(bot.inventory).find((i) =>
              i.name === "water_bucket"
            );

            bot.quit();

            assert.ok(
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
});
