/**
 * Step benchmark: test any step individually with N bots.
 *
 * Usage:
 *   node src/bench.ts <step_id> [bot_count] [timeout_sec]
 *   node src/bench.ts gather_wood          # 10 bots, 120s
 *   node src/bench.ts mine_stone 5 60      # 5 bots, 60s
 *   node src/bench.ts list                 # list all step IDs
 *
 * Requires: MC server running (nix run .#server)
 */

import type { Bot } from "typecraft";
import { createBot } from "typecraft";
import { initLogger, logEvent, registerRace } from "./lib/logger.ts";
import { connect as rconConnect } from "./lib/rcon.ts";
import { syncFromBot } from "./state.ts";
import { steps } from "./steps.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let rconClient: Awaited<ReturnType<typeof rconConnect>> | null = null;
const rcon = async (cmd: string) => {
	if (!rconClient) rconClient = await rconConnect();
	return rconClient.command(cmd);
};

const SETUP: Record<string, string[]> = {
	gather_wood: [],
	craft_planks: ["oak_log 5"],
	craft_crafting_table: ["oak_log 5"],
	craft_sticks: ["oak_log 5"],
	craft_wooden_pickaxe: ["oak_log 8"],
	mine_stone: ["wooden_pickaxe 1"],
	craft_stone_pickaxe: ["cobblestone 8", "stick 4", "crafting_table 1"],
	craft_stone_sword: ["cobblestone 8", "stick 4", "crafting_table 1"],
	craft_furnace: ["cobblestone 16", "crafting_table 1"],
	mine_coal: ["stone_pickaxe 1"],
	mine_iron: ["stone_pickaxe 1"],
	smelt_iron: ["raw_iron 16", "coal 8", "furnace 1", "cobblestone 4"],
	craft_iron_pickaxe: ["iron_ingot 8", "stick 4", "crafting_table 1"],
	craft_bucket: ["iron_ingot 8", "stick 4", "crafting_table 1"],
	get_water_bucket: ["bucket 1"],
	gather_food: ["stone_sword 1"],
	get_flint_and_steel: ["iron_ingot 2", "flint 1", "crafting_table 1"],
};

interface Result {
	name: string;
	elapsed: number;
	success: boolean;
	message: string;
	inventory: string;
}

const runBot = async (
	idx: number,
	stepId: string,
	count: number,
	timeoutMs: number,
): Promise<Result> => {
	const step = steps.find((s) => s.id === stepId);
	if (!step) throw new Error(`Unknown step: ${stepId}`);
	const name = `Bench${idx}`;

	// Stagger connections
	await sleep(idx * 1000);

	await rcon(`op ${name}`);

	const bot: Bot = createBot({
		host: "localhost",
		port: parseInt(process.env.MC_PORT ?? "25565", 10),
		username: name,
		version: "1.21.11",
		auth: "offline",
	});
	bot.on("error", () => {});
	bot.on("debug", (category: string, detail: Record<string, unknown>) => {
		if (category === "packet_rx" || category === "packet_tx") return;
		logEvent(category, "debug", JSON.stringify(detail));
	});

	return new Promise<Result>((resolve) => {
		const timer = setTimeout(() => {
			const inv =
				bot.inventory?.slots
					?.filter((s): s is NonNullable<typeof s> => s != null && s.count > 0)
					.map((s) => `${s.name}x${s.count}`)
					.join(", ") ?? "";
			try {
				bot.end();
			} catch {}
			resolve({
				name,
				elapsed: Math.round(timeoutMs / 1000),
				success: false,
				message: "timeout",
				inventory: inv,
			});
		}, timeoutMs);

		bot.once("spawn", async () => {
			try {
				await bot.waitForChunksToLoad();

				// Wait for initial inventory sync from server
				await new Promise<void>((res) => {
					const check = () => {
						if (bot.inventory?.slots) res();
						else setTimeout(check, 100);
					};
					check();
				});
				await sleep(1000);

				// Spread
				const angle = (idx / count) * 2 * Math.PI;
				const x = Math.floor(Math.cos(angle) * 40);
				const z = Math.floor(Math.sin(angle) * 40);
				await rcon(`spreadplayers ${x} ${z} 0 5 false ${name}`);
				await sleep(1000);

				// Give items via bot chat (bot is opped, avoids RCON inventory sync issues)
				bot.chat(`/clear`);
				await sleep(500);
				const items = SETUP[stepId] ?? [];
				for (const item of items) {
					bot.chat(`/give @s ${item}`);
					await sleep(500);
				}
				// Wait for items to appear in inventory
				let pickSlot = -1;
				for (let i = 0; i < 30; i++) {
					await sleep(200);
					pickSlot = bot.inventory.slots.findIndex((s) => s && s.count > 0);
					if (pickSlot >= 0) break;
				}

				// For mining — find the pickaxe and select it
				if (stepId.startsWith("mine")) {
					pickSlot = bot.inventory.slots.findIndex((s) =>
						s?.name?.includes("pickaxe"),
					);
					if (pickSlot >= 0) {
						if (pickSlot >= 36 && pickSlot <= 44) {
							bot.setQuickBarSlot(pickSlot - 36);
						} else {
							try {
								await bot.clickWindow(pickSlot, 0, 0);
								await bot.clickWindow(36, 0, 0);
								bot.setQuickBarSlot(0);
							} catch {}
						}
						console.log(
							`[${name}] pickaxe in slot ${pickSlot}, held: ${
								bot.heldItem?.name ?? "null"
							}`,
						);
					} else {
						console.log(`[${name}] NO PICKAXE FOUND in inventory`);
						// Dump what we have
						const slots = bot.inventory.slots
							.filter(
								(s): s is NonNullable<typeof s> => s != null && s.count > 0,
							)
							.map((s, i) => `${i}:${s.name}`);
						console.log(`[${name}] slots: ${slots.join(", ") || "empty"}`);
					}
				}

				const start = Date.now();
				const state = syncFromBot(bot);
				console.log(`[${name}] starting ${stepId}`);
				const result = await step.execute(bot, state);
				const elapsed = Math.round((Date.now() - start) / 1000);

				clearTimeout(timer);
				const s = syncFromBot(bot);
				const complete = step.isComplete(s);
				const inv = bot.inventory.slots
					.filter((s): s is NonNullable<typeof s> => s != null && s.count > 0)
					.map((s) => `${s.name}x${s.count}`)
					.join(", ");
				try {
					bot.end();
				} catch {}
				resolve({
					name,
					elapsed,
					success: result.success && complete,
					message: complete
						? result.message
						: `${result.message} | isComplete: false`,
					inventory: inv,
				});
			} catch (err) {
				clearTimeout(timer);
				try {
					bot.end();
				} catch {}
				resolve({
					name,
					elapsed: 0,
					success: false,
					message: err instanceof Error ? err.message : String(err),
					inventory: "",
				});
			}
		});
	});
};

const main = async () => {
	const stepId = process.argv[2];

	if (!stepId || stepId === "list") {
		console.log("Available steps:");
		for (const s of steps) {
			const has = SETUP[s.id] ? "✓" : " ";
			console.log(`  ${has} ${s.id.padEnd(25)} ${s.name}`);
		}
		console.log(
			"\nUsage: node src/bench.ts <step_id> [bot_count] [timeout_sec]",
		);
		process.exit(0);
	}

	const step = steps.find((s) => s.id === stepId);
	if (!step) {
		console.error(`Unknown step: ${stepId}`);
		process.exit(1);
	}

	const count = parseInt(process.argv[3] ?? "10", 10);
	const timeoutSec = parseInt(process.argv[4] ?? "120", 10);

	const raceId = `bench-${stepId}-${new Date().toISOString().replace(/:/g, "-")}`;
	initLogger(raceId);
	registerRace(raceId, "bench", count, timeoutSec, stepId);
	console.log(
		`Bench: ${step.name} (${stepId}) — ${count} bots, ${timeoutSec}s timeout`,
	);
	console.log(`Race: ${raceId}`);
	console.log(`Setup: ${(SETUP[stepId] ?? []).join(", ") || "(none)"}\n`);

	let winner: Result | null = null;
	const allResults: Result[] = [];

	await new Promise<void>((raceOver) => {
		for (let i = 0; i < count; i++) {
			runBot(i, stepId, count, timeoutSec * 1000).then((result) => {
				allResults.push(result);
				if (result.success && !winner) {
					winner = result;
					console.log(
						`\n${result.name} WINS — ${result.message} in ${result.elapsed}s\n`,
					);
					raceOver();
				}
				if (allResults.length === count) raceOver();
			});
		}
	});

	await sleep(500);

	console.log(`${"─".repeat(70)}`);
	console.log(
		`${"bot".padEnd(10)} ${"time".padEnd(8)} ${"result".padEnd(8)} message`,
	);
	console.log(`${"─".repeat(70)}`);
	for (const r of allResults.sort((a, b) => a.name.localeCompare(b.name))) {
		const tag = r === winner ? "WINNER" : r.success ? "OK" : "FAIL";
		console.log(
			`${r.name.padEnd(10)} ${(`${r.elapsed}s`).padEnd(8)} ${tag.padEnd(
				8,
			)} ${r.message}`,
		);
	}
	console.log(`${"─".repeat(70)}`);

	const ok = allResults.filter((r) => r.success);
	console.log(`${ok.length}/${count} completed`);
	if (winner) {
		const w = winner as Result;
		console.log(`winner: ${w.name} in ${w.elapsed}s`);
	}
	process.exit(0);
};

main();
