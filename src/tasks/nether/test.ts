/**
 * Test: Nether
 * Spawns a bot in the Nether and attempts to find a fortress
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { createBot } from "typecraft";
import { findFortress } from "./main.ts";

const USERNAME = "TestNether";
const TIMEOUT = 60000;

it("nether: can find fortress", { timeout: TIMEOUT }, async () => {
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
            bot.chat(
              "/execute in minecraft:the_nether run tp TestNether 0 70 0",
            );
            await new Promise((r) => setTimeout(r, 1000));
            bot.chat("/give TestNether iron_sword 1");
            await new Promise((r) => setTimeout(r, 300));
            bot.chat("/give TestNether golden_apple 8");
            await new Promise((r) => setTimeout(r, 500));

            const result = await findFortress(bot);

            bot.quit();

            assert.ok(
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
});
