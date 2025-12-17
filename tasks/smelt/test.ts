/**
 * Test: Smelting
 * Spawns a bot and attempts to smelt items
 */

import { assert } from "@std/assert";
import { botTest, giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { smeltItems } from "./main.ts";

Deno.test(botTest("smelt: can smelt raw iron into ingots", async () => {
  await runBotTest({
    username: "TestSmelt",
    setupCommands: giveCommands.smeltingStarter("TestSmelt"),
  }, async (bot) => {
    const result = await smeltItems(bot, "raw_iron", 4);
    assert(result.success, `Expected success but got: ${result.message}`);
  });
}));
