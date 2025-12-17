/**
 * Test: Crafting
 * Spawns a bot and attempts to craft planks, crafting table, sticks
 */

import { assert } from "@std/assert";
import { botTest, giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { craftCraftingTable, craftPlanks } from "./main.ts";

Deno.test(
  botTest("craft: can craft planks, crafting table, and sticks", async () => {
    await runBotTest({
      username: "TestCraft",
      setupCommands: giveCommands.craftingStarter("TestCraft"),
    }, async (bot) => {
      const planksResult = await craftPlanks(bot);
      assert(
        planksResult.success,
        `craftPlanks failed: ${planksResult.message}`,
      );

      const tableResult = await craftCraftingTable(bot);
      assert(
        tableResult.success,
        `craftCraftingTable failed: ${tableResult.message}`,
      );
    });
  }),
);
