/**
 * Test: Mining
 * Spawns a bot and attempts to mine stone
 */

import { assert } from "@std/assert";
import { botTest, giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { mineBlock } from "./main.ts";

Deno.test(botTest("mining: can mine stone blocks", async () => {
  await runBotTest({
    username: "TestMine",
    setupCommands: giveCommands.miningStarter("TestMine"),
  }, async (bot) => {
    const result = await mineBlock(bot, "stone", 8);
    assert(result.success, `Expected success but got: ${result.message}`);
  });
}));
