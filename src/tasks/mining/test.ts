/**
 * Test: Mining
 * Spawns a bot and attempts to mine stone
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { mineBlock } from "./main.ts";

it("mining: can mine stone blocks", { timeout: 60000 }, async () => {
  await runBotTest({
    username: "TestMine",
    setupCommands: giveCommands.miningStarter("TestMine"),
  }, async (bot) => {
    const result = await mineBlock(bot, "stone", 8);
    assert.ok(result.success, `Expected success but got: ${result.message}`);
  });
});
