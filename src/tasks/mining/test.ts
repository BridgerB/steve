/**
 * Test: Mining
 * Spawns a bot and attempts to mine stone
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { offset, vec3 } from "typecraft";
import { goTo } from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
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

it(
	"mining: dig 100 dirt and collect every drop",
	{ timeout: 600000 },
	async () => {
		await runBotTest(
			{
				username: "TestDigCollect",
				timeout: 600000,
				setupCommands: ["/clear TestDigCollect"],
			},
			async (bot) => {
				let picked = 0;
				let missed = 0;
				let noBlock = 0;
				const timings: number[] = [];

				for (let i = 0; i < 100; i++) {
					const pos = bot.entity.position;
					let target = null;
					let minDist = Infinity;
					for (let dx = -10; dx <= 10; dx++) {
						for (let dz = -10; dz <= 10; dz++) {
							for (let dy = -3; dy <= 3; dy++) {
								const b = bot.blockAt({
									x: Math.floor(pos.x) + dx,
									y: Math.floor(pos.y) + dy,
									z: Math.floor(pos.z) + dz,
								});
								if (b && (b.name === "dirt" || b.name === "grass_block")) {
									const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
									if (d > 1.5 && d < minDist) {
										minDist = d;
										target = b;
									}
								}
							}
						}
					}

					if (!target) {
						noBlock++;
						logEvent("test", "dig_collect", `${i}: no dirt found`);
						// Move somewhere new
						await goTo(
							bot,
							vec3(
								pos.x + (Math.random() - 0.5) * 20,
								pos.y,
								pos.z + (Math.random() - 0.5) * 20,
							),
							{ range: 2, timeout: 5000 },
						);
						continue;
					}

					await goTo(bot, target.position, { range: 3, timeout: 5000 });

					const before = bot.inventory.slots
						.filter((s) => s?.name === "dirt")
						.reduce((n, s) => n + s!.count, 0);

					const t0 = Date.now();
					try {
						await bot.dig(target);
					} catch {
						logEvent("test", "dig_collect", `${i}: dig failed`);
						continue;
					}

					await bot.collectDrops(6, 10000, async (p) => {
						await goTo(bot, p, { range: 1.4, timeout: 5000 });
					});
					const elapsed = Date.now() - t0;

					const after = bot.inventory.slots
						.filter((s) => s?.name === "dirt")
						.reduce((n, s) => n + s!.count, 0);

					const got = after - before;
					if (got > 0) {
						picked++;
						timings.push(elapsed);
					} else {
						missed++;
						// Full debug dump on miss
						const bp = bot.entity.position;
						const items = Object.values(bot.entities)
							.filter((e: any) => e.name === "item")
							.map((e: any) => ({
								x: +e.position.x.toFixed(1),
								y: +e.position.y.toFixed(1),
								z: +e.position.z.toFixed(1),
							}));
						const nearby: string[] = [];
						for (let dx = -3; dx <= 3; dx++) {
							for (let dz = -3; dz <= 3; dz++) {
								for (let dy = -2; dy <= 2; dy++) {
									const nb = bot.blockAt({
										x: Math.floor(bp.x) + dx,
										y: Math.floor(bp.y) + dy,
										z: Math.floor(bp.z) + dz,
									});
									if (nb && nb.name !== "air")
										nearby.push(`(${dx},${dy},${dz})=${nb.name}`);
								}
							}
						}
						const report = {
							attempt: i,
							botPos: {
								x: +bp.x.toFixed(1),
								y: +bp.y.toFixed(1),
								z: +bp.z.toFixed(1),
							},
							targetPos: target.position,
							dist: minDist.toFixed(1),
							elapsed,
							itemEntities: items,
							inWater: bot.entity.isInWater,
							blocksAround: nearby,
						};
						logEvent("test", "dig_collect_MISS", JSON.stringify(report));
						assert.fail(
							`MISSED pickup on attempt ${i}\n${JSON.stringify(report, null, 2)}`,
						);
					}

					logEvent(
						"test",
						"dig_collect",
						`${i}: picked ${elapsed}ms dist=${minDist.toFixed(1)}`,
					);
				}

				const avg = timings.length
					? Math.round(timings.reduce((a, b) => a + b) / timings.length)
					: 0;
				const summary = `picked=${picked} missed=${missed} noBlock=${noBlock} avgMs=${avg}`;
				logEvent("test", "dig_collect_summary", summary);

				assert.ok(
					picked >= 90,
					`Should pick up ≥90/100 dirt but got ${picked} (${summary})`,
				);
			},
		);
	},
);
