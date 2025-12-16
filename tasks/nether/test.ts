/**
 * Test: Nether
 * Spawns a bot in the Nether and attempts to find a fortress
 * Prerequisites: Teleports to nether, gives iron_sword and golden_apples (auto-given)
 */

import { assert } from "@std/assert";
import mineflayer from "mineflayer";
import { findFortress } from "./main.ts";

const USERNAME = "TestNether";
const TIMEOUT = 60000;

Deno.test({
  name: "nether: can find fortress",
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
