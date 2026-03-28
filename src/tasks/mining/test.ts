/**
 * Test: Mining
 * Spawns a bot and attempts to mine stone
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { offset, vec3 } from "typecraft";
import { giveCommands, runBotTest } from "../../lib/test-utils.ts";
import { mineBlock } from "./main.ts";

it("mining: can mine stone blocks", { timeout: 60000 }, async () => {
	await runBotTest(
		{
			username: "TestMine",
			setupCommands: giveCommands.miningStarter("TestMine"),
		},
		async (bot) => {
			const result = await mineBlock(bot, "stone", 8);
			assert.ok(result.success, `Expected success but got: ${result.message}`);
		},
	);
});

it(
	"mining: dig updates world state without manual prediction",
	{ timeout: 30000 },
	async () => {
		await runBotTest(
			{
				username: "TestDigSync",
				setupCommands: [
					"/clear TestDigSync",
					"/give TestDigSync diamond_pickaxe 1",
				],
			},
			async (bot) => {
				const pos = bot.entity.position;
				const target = vec3(
					Math.floor(pos.x) + 1,
					Math.floor(pos.y),
					Math.floor(pos.z),
				);

				const before = bot.blockAt(target);
				assert.ok(before, "Expected solid block ahead");
				assert.notEqual(before.name, "air");

				await bot.lookAt(offset(target, 0.5, 0.5, 0.5));
				await bot.dig(before);

				// Wait for server block_update
				await new Promise((r) => setTimeout(r, 500));

				const after = bot.blockAt(target);
				assert.equal(
					after,
					null,
					"Block should be air (null) after dig without worldSetBlockStateId",
				);
			},
		);
	},
);

it("mining: bot can walk through dug space", { timeout: 30000 }, async () => {
	await runBotTest(
		{
			username: "TestDigWalk",
			setupCommands: [
				"/clear TestDigWalk",
				"/give TestDigWalk diamond_pickaxe 1",
			],
		},
		async (bot) => {
			const pos = bot.entity.position;
			const ahead = vec3(
				Math.floor(pos.x) + 1,
				Math.floor(pos.y),
				Math.floor(pos.z),
			);
			const headAhead = vec3(ahead.x, ahead.y + 1, ahead.z);

			// Dig 2-high tunnel ahead
			for (const target of [headAhead, ahead]) {
				const block = bot.blockAt(target);
				if (block) {
					await bot.lookAt(offset(target, 0.5, 0.5, 0.5));
					await bot.dig(block);
				}
			}

			await new Promise((r) => setTimeout(r, 500));

			const startX = bot.entity.position.x;

			// Walk forward
			await bot.lookAt(vec3(ahead.x + 5, ahead.y + 0.5, ahead.z + 0.5));
			bot.setControlState("forward", true);
			await new Promise((r) => setTimeout(r, 1500));
			bot.setControlState("forward", false);

			const moved = bot.entity.position.x - startX;
			assert.ok(
				moved > 0.5,
				`Bot should move forward but only moved ${moved.toFixed(2)}`,
			);
		},
	);
});

it(
	"mining: staircase descent actually decreases Y",
	{ timeout: 60000 },
	async () => {
		await runBotTest(
			{
				username: "TestStaircase",
				setupCommands: [
					"/clear TestStaircase",
					"/give TestStaircase diamond_pickaxe 1",
				],
			},
			async (bot) => {
				const startY = bot.entity.position.y;

				for (let step = 0; step < 10; step++) {
					const p = bot.entity.position;

					// Dig head, wall, floor ahead
					for (const [dx, dy] of [
						[1, 1],
						[1, 0],
						[1, -1],
					] as const) {
						const b = bot.blockAt(offset(p, dx, dy, 0));
						if (!b) continue;
						if (b.name === "bedrock") break;
						await bot.lookAt(offset(b.position, 0.5, 0.5, 0.5));
						try {
							await bot.dig(b);
						} catch {}
					}

					// Walk forward + fall
					bot.setControlState("forward", true);
					await new Promise((r) => setTimeout(r, 350));
					bot.setControlState("forward", false);
					await new Promise((r) => setTimeout(r, 300));
				}

				const dropped = startY - bot.entity.position.y;
				assert.ok(
					dropped >= 5,
					`Should descend at least 5 blocks but only dropped ${dropped.toFixed(1)}`,
				);
			},
		);
	},
);
