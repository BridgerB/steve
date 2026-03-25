/**
 * Crafting tests — minimal, isolated tests for each crafting step.
 * Each test gives the bot exactly what it needs and verifies the result.
 *
 * Run: node --test src/tasks/craft/test.ts
 * Requires: MC server on localhost:25565
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { countInventoryItems, runBotTest } from "../../lib/test-utils.ts";
import {
	craftCraftingTable,
	craftPlanks,
	craftSticks,
	craftWoodenPickaxe,
} from "./main.ts";

// --- Test 1: Logs → Planks ---
it("craft: logs → planks", { timeout: 30000 }, async () => {
	await runBotTest(
		{
			username: "TestCraft",
			setupCommands: ["/clear TestCraft", "/give TestCraft oak_log 3"],
		},
		async (bot) => {
			const result = await craftPlanks(bot);
			assert.ok(result.success, `craftPlanks: ${result.message}`);
			const planks = countInventoryItems(bot, "_planks");
			assert.ok(planks >= 4, `Expected planks >= 4, got ${planks}`);
		},
	);
});

// --- Test 2: Planks → Crafting Table ---
it("craft: planks → crafting_table", { timeout: 30000 }, async () => {
	await runBotTest(
		{
			username: "TestCraft",
			setupCommands: ["/clear TestCraft", "/give TestCraft oak_planks 4"],
		},
		async (bot) => {
			const result = await craftCraftingTable(bot);
			assert.ok(result.success, `craftCraftingTable: ${result.message}`);
			const tables = countInventoryItems(bot, "crafting_table");
			assert.ok(tables >= 1, `Expected crafting_table >= 1, got ${tables}`);
		},
	);
});

// --- Test 3: Planks → Sticks ---
it("craft: planks → sticks", { timeout: 30000 }, async () => {
	await runBotTest(
		{
			username: "TestCraft",
			setupCommands: ["/clear TestCraft", "/give TestCraft oak_planks 4"],
		},
		async (bot) => {
			const result = await craftSticks(bot);
			assert.ok(result.success, `craftSticks: ${result.message}`);
			const sticks = countInventoryItems(bot, "stick");
			assert.ok(sticks >= 4, `Expected sticks >= 4, got ${sticks}`);
		},
	);
});

// --- Test 4: Place table + craft wooden pickaxe ---
it(
	"craft: place table + craft wooden pickaxe",
	{
		timeout: 60000,
	},
	async () => {
		await runBotTest(
			{
				username: "TestCraft",
				setupCommands: [
					"/tp TestCraft 150 71 150",
					"/clear TestCraft",
					"/give TestCraft oak_planks 3",
					"/give TestCraft stick 2",
					"/give TestCraft crafting_table 1",
				],
			},
			async (bot) => {
				const result = await craftWoodenPickaxe(bot);
				assert.ok(result.success, `craftWoodenPickaxe: ${result.message}`);
				const picks = countInventoryItems(bot, "pickaxe");
				assert.ok(picks >= 1, `Expected pickaxe >= 1, got ${picks}`);
			},
		);
	},
);

// --- Test 5: Full chain — 3 logs → wooden pickaxe ---
it(
	"craft: full chain — 3 logs → wooden pickaxe",
	{
		timeout: 60000,
	},
	async () => {
		await runBotTest(
			{
				username: "TestCraft",
				setupCommands: [
					"/tp TestCraft 150 71 150",
					"/clear TestCraft",
					"/give TestCraft oak_log 3",
				],
			},
			async (bot) => {
				// Step 1: logs → planks
				const planks = await craftPlanks(bot);
				assert.ok(planks.success, `planks: ${planks.message}`);

				// Step 2: planks → crafting table
				const table = await craftCraftingTable(bot);
				assert.ok(table.success, `table: ${table.message}`);

				// Step 3: planks → sticks
				const sticks = await craftSticks(bot);
				assert.ok(sticks.success, `sticks: ${sticks.message}`);

				// Step 4: place table + craft pickaxe
				const pickaxe = await craftWoodenPickaxe(bot);
				assert.ok(pickaxe.success, `pickaxe: ${pickaxe.message}`);

				const picks = countInventoryItems(bot, "pickaxe");
				assert.ok(picks >= 1, `Expected pickaxe >= 1, got ${picks}`);
			},
		);
	},
);
