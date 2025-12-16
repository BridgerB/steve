/**
 * Test: End
 * Spawns a bot in The End and attempts to destroy crystals / fight dragon
 * Prerequisites: Teleports to end, gives bow, arrows, diamond_sword (auto-given)
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { destroyCrystals } from "./main.ts";

const USERNAME = "TestEnd";
const TIMEOUT = 60000;

Deno.test({
  name: "end: can destroy crystals",
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
