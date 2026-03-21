/**
 * Test: Smelting
 * Spawns a bot and attempts to smelt items
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { smeltItems } from "./main.ts";

it("smelt: can smelt raw iron into ingots", { timeout: 60000 }, async () => {
  await runBotTest({
    username: "TestSmelt",
    setupCommands: giveCommands.smeltingStarter("TestSmelt"),
  }, async (bot) => {
    const result = await smeltItems(bot, "raw_iron", 4);
    assert.ok(result.success, `Expected success but got: ${result.message}`);
  });
});
