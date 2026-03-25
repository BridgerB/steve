/**
 * Test: Food
 * Spawns a bot and attempts to gather food from animals
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { gatherFood } from "./main.ts";

it("food: can gather food from animals", { timeout: 60000 }, async () => {
	await runBotTest(
		{
			username: "TestFood",
			setupCommands: giveCommands.combatStarter("TestFood"),
		},
		async (bot) => {
			const result = await gatherFood(bot, 3);
			assert.ok(result.success, `Expected success but got: ${result.message}`);
		},
	);
});
