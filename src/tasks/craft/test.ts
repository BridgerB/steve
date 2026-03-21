/**
 * Test: Crafting
 * Spawns a bot and attempts to craft planks, crafting table, sticks
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { craftCraftingTable, craftPlanks } from "./main.ts";

it("craft: can craft planks, crafting table, and sticks", { timeout: 60000 }, async () => {
  await runBotTest({
    username: "TestCraft",
    setupCommands: giveCommands.craftingStarter("TestCraft"),
  }, async (bot) => {
    const planksResult = await craftPlanks(bot);
    assert.ok(
      planksResult.success,
      `craftPlanks failed: ${planksResult.message}`,
    );

    const tableResult = await craftCraftingTable(bot);
    assert.ok(
      tableResult.success,
      `craftCraftingTable failed: ${tableResult.message}`,
    );
  });
});
