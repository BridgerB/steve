/**
 * Test: End
 * Spawns a bot in The End and attempts to destroy crystals / fight dragon
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { createBot } from "typecraft";
import { destroyCrystals } from "./main.ts";

const USERNAME = "TestEnd";
const TIMEOUT = 60000;

it("end: can destroy crystals", { timeout: TIMEOUT }, async () => {
  await Promise.race([
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Test timed out after 60s")), TIMEOUT)
    ),
    (async () => {
      const bot = createBot({
        host: "localhost",
        port: 25565,
        username: USERNAME,
        version: "1.21.11",
      });

      await new Promise<void>((resolve, reject) => {
        bot.once("spawn", async () => {
          try {
            bot.chat("/execute in minecraft:the_end run tp TestEnd 0 70 0");
            await new Promise((r) => setTimeout(r, 1000));
            bot.chat("/give TestEnd bow 1");
            await new Promise((r) => setTimeout(r, 300));
            bot.chat("/give TestEnd arrow 64");
            await new Promise((r) => setTimeout(r, 300));
            bot.chat("/give TestEnd diamond_sword 1");
            await new Promise((r) => setTimeout(r, 300));
            bot.chat("/give TestEnd golden_apple 16");
            await new Promise((r) => setTimeout(r, 500));

            const result = await destroyCrystals(bot);

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
