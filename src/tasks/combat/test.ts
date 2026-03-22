/**
 * Test: Combat
 * Spawns a bot and attempts to hunt endermen
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { huntEndermen } from "./main.ts";

it("combat: can hunt endermen", { timeout: 60000 }, async () => {
  await runBotTest({
    username: "TestCombat",
    setupCommands: giveCommands.combatStarter("TestCombat"),
  }, async (bot) => {
    const result = await huntEndermen(bot, 1);
    assert.ok(result.success, `Expected success but got: ${result.message}`);
  });
});
