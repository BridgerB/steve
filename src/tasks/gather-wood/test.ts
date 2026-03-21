/**
 * Test: Gather Wood
 * Spawns a bot and attempts to gather wood logs
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import {
  assertHasItems,
  giveCommands,
  runBotTest,
} from "../../lib/test-utils.ts";
import { gatherWood } from "./main.ts";

const TARGET_LOGS = 4;

it("gather-wood: can gather logs", { timeout: 60000 }, async () => {
  await runBotTest({
    username: "TestWood",
    timeout: 60000,
    setupCommands: giveCommands.woodStarter("TestWood"),
  }, async (bot) => {
    const result = await gatherWood(bot, TARGET_LOGS);
    assert.ok(result.success, `Expected success but got: ${result.message}`);
    assertHasItems(bot, "_log", TARGET_LOGS);
  });
});
