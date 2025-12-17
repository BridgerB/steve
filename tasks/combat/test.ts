/**
 * Test: Combat
 * Spawns a bot and attempts to gather food from animals
 */

import { assert } from "@std/assert";
import { botTest, giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { gatherFood } from "./main.ts";

Deno.test(botTest("combat: can gather food from animals", async () => {
  await runBotTest({
    username: "TestCombat",
    setupCommands: giveCommands.combatStarter("TestCombat"),
  }, async (bot) => {
    const result = await gatherFood(bot, 3);
    assert(result.success, `Expected success but got: ${result.message}`);
  });
}));
