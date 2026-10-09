/**
 * Test: Nether Portal
 * TPs bot to a random overworld location, gives it 14 obsidian + flint and steel via RCON,
 * then verifies it can build and enter a nether portal.
 */

import assert from "node:assert/strict";
import { it } from "node:test";
import { createBot } from "typecraft";
import { connect } from "../../lib/rcon.ts";
import { buildNetherPortal } from "./build.ts";
import { enterPortal } from "./enter.ts";

const USERNAME = "TestPortal";
const TIMEOUT = 120_000;

it(
	"portal: can build and enter nether portal",
	{ timeout: TIMEOUT },
	async () => {
		await Promise.race([
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error("Test timed out after 120s")),
					TIMEOUT,
				),
			),
			(async () => {
				const rcon = await connect();

				const bot = createBot({
					host: "localhost",
					port: 25565,
					username: USERNAME,
					version: "1.21.11",
				});

				await new Promise<void>((resolve, reject) => {
					bot.once("spawn", async () => {
						try {
							// TP to random surface location between (0,0) and (10000,10000)
							const x = Math.floor(Math.random() * 10000);
							const z = Math.floor(Math.random() * 10000);
							await rcon.command(
								`spreadplayers ${x} ${z} 0 1 false ${USERNAME}`,
							);
							await new Promise((r) => setTimeout(r, 1000));

							// Setup inventory via RCON
							await rcon.command(`clear ${USERNAME}`);
							await new Promise((r) => setTimeout(r, 300));
							await rcon.command(`give ${USERNAME} obsidian 14`);
							await new Promise((r) => setTimeout(r, 300));
							await rcon.command(`give ${USERNAME} flint_and_steel 1`);
							await new Promise((r) => setTimeout(r, 500));

							const buildResult = await buildNetherPortal(bot);
							assert.ok(
								buildResult.success,
								`Build failed: ${buildResult.message}`,
							);

							const portalPos = (
								buildResult as {
									portalPos?: { x: number; y: number; z: number };
								}
							).portalPos;
							const enterResult = await enterPortal(bot, portalPos);
							assert.ok(
								enterResult.success,
								`Enter failed: ${enterResult.message}`,
							);

							bot.quit();
							rcon.close();
							resolve();
						} catch (err) {
							bot.quit();
							rcon.close();
							reject(err);
						}
					});

					bot.on("error", (err) => {
						rcon.close();
						reject(err);
					});
				});
			})(),
		]);
	},
);
