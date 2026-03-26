/**
 * Wood gathering task - find closest log, walk to it, mine it, pick it up, repeat.
 */

import type { Bot } from "typecraft";
import {
	createGoalNear,
	distance,
	offset,
	type Vec3,
	vec3,
	worldSetBlockStateId,
} from "typecraft";
import {
	escapeWater,
	getBlock,
	getPathfinder,
	goTo,
	sleep,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { StepResult } from "../../types.ts";

const LOG_TYPES = [
	"oak_log",
	"birch_log",
	"spruce_log",
	"jungle_log",
	"acacia_log",
	"dark_oak_log",
	"mangrove_log",
	"cherry_log",
];

const isLogName = (name: string) => LOG_TYPES.includes(name);

export const gatherWood = async (
	bot: Bot,
	targetCount: number,
): Promise<StepResult> => {
	// Wait for bot to be ready
	if (!bot.entity?.position) {
		await new Promise<void>((resolve) => {
			const check = () => {
				if (bot.entity?.position) resolve();
				else setTimeout(check, 100);
			};
			check();
		});
	}
	await bot.waitForChunksToLoad();
	await escapeWater(bot);

	const pf = getPathfinder(bot);

	// Build set of log item type IDs from registry
	const logItemIds = new Set<number>();
	if (bot.registry) {
		for (const logName of LOG_TYPES) {
			const def = bot.registry.itemsByName.get(logName);
			if (def) logItemIds.add(def.id);
		}
	}
	logEvent("wood", "log_ids", `ids=${[...logItemIds].join(",")}`);

	const countLogs = () => {
		let total = 0;
		for (const item of bot.inventory.slots) {
			if (item && item.count > 0) {
				// Check by name OR by type ID (name can be "unknown" due to registry timing)
				if (item.name.includes("_log") || logItemIds.has(item.type)) {
					total += item.count;
				}
			}
		}
		return total;
	};

	const botPos = () => bot.entity?.position ?? vec3(0, 64, 0);

	// Skip positions we already failed to reach
	const unreachable = new Set<string>();
	// Key by X,Z only — blacklist entire tree column, not individual blocks
	const posKey = (p: Vec3) => `${Math.floor(p.x)},${Math.floor(p.z)}`;

	// Find the closest reachable log block
	const findClosestLog = (): { pos: Vec3; name: string } | null => {
		for (const radius of [16, 32, 48, 64]) {
			const positions = bot.findBlocks({
				matching: (name: string) => isLogName(name),
				maxDistance: radius,
				count: 50,
			});
			if (positions.length === 0) continue;

			const reachable = positions
				.filter((p) => !unreachable.has(posKey(p)))
				.sort((a, b) => distance(botPos(), a) - distance(botPos(), b));

			for (const pos of reachable) {
				const block = getBlock(bot, pos);
				if (block) {
					logEvent(
						"wood",
						"found_tree",
						`${block.name} dist=${distance(botPos(), pos).toFixed(1)}`,
						pos,
					);
					return { pos, name: block.name };
				}
			}
		}
		return null;
	};

	// Navigate to a position
	const navigateTo = async (target: Vec3): Promise<boolean> => {
		if (!bot.entity?.position) return false;
		const dist = distance(botPos(), target);
		if (dist <= 5) return true;

		const goal = createGoalNear(target.x, target.y, target.z, 3);
		pf.setGoal(goal);
		logEvent("wood", "nav_start", `dist=${dist.toFixed(1)}`, botPos());

		const timeout = 15000;
		const start = Date.now();
		let lastDist = dist;
		let stuckTicks = 0;

		while (Date.now() - start < timeout) {
			await sleep(250);
			if (!bot.entity?.position) {
				pf.stop();
				return false;
			}

			const currentDist = distance(botPos(), target);
			if (currentDist <= 5) {
				pf.stop();
				return true;
			}

			// Water escape
			if (bot.entity.isInWater) {
				pf.stop();
				await escapeWater(bot);
				pf.setGoal(goal);
				stuckTicks = 0;
				lastDist = distance(botPos(), target);
				continue;
			}

			// Stuck detection
			if (Math.abs(currentDist - lastDist) < 0.2) {
				stuckTicks++;
			} else {
				stuckTicks = 0;
			}
			lastDist = currentDist;

			if (stuckTicks >= 10) {
				logEvent(
					"wood",
					"nav_stuck",
					`dist=${currentDist.toFixed(1)} after ${stuckTicks} ticks`,
				);
				pf.stop();
				// Raw walk fallback
				await bot.lookAt(target);
				bot.setControlState("forward", true);
				bot.setControlState("jump", true);
				await sleep(3000);
				bot.setControlState("forward", false);
				bot.setControlState("jump", false);
				return distance(botPos(), target) <= 5;
			}

			if (!pf.isMoving() && stuckTicks >= 3) {
				pf.setGoal(goal);
				stuckTicks = 0;
			}
		}

		pf.stop();
		return distance(botPos(), target) <= 5;
	};

	// Mine a single block
	const mineBlock = async (pos: Vec3, _blockName: string): Promise<boolean> => {
		const blockCenter = offset(pos, 0.5, 0.5, 0.5);
		let dist = distance(botPos(), blockCenter);

		// Walk closer if needed
		if (dist > 4.5) {
			await bot.lookAt(blockCenter);
			bot.setControlState("forward", true);
			bot.setControlState("jump", true);
			await sleep(Math.min(dist * 300, 3000));
			bot.setControlState("forward", false);
			bot.setControlState("jump", false);
			await sleep(200);
			dist = distance(botPos(), blockCenter);
			if (dist > 4.5) return false;
		}

		const block = getBlock(bot, pos);
		if (!block || !isLogName(block.name)) return true; // already gone

		await bot.lookAt(blockCenter);

		logEvent("wood", "dig_start", `${block.name} dist=${dist.toFixed(1)}`, pos);
		const logsBefore = countLogs();

		try {
			await Promise.race([
				bot.dig(block, true),
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error("dig timeout")), 5000),
				),
			]);
			// Predict block break locally — server skips block_update for the digger in 1.21+
			if (bot.world) worldSetBlockStateId(bot.world, block.position, 0);
			logEvent("wood", "dig_done", block.name, pos);
		} catch (e) {
			const msg = String(e instanceof Error ? e.message : e);
			logEvent("wood", "dig_error", msg, pos);
			bot.stopDigging();
			return msg === "dig timeout"; // timeout = block probably broke, continue
		}

		// Navigate to dropped item for pickup
		await bot.collectDrops(6, 3000, async (p) => {
			await goTo(bot, p, { range: 1.4, timeout: 3000 });
		});

		const logsNow = countLogs();
		if (logsNow > logsBefore) {
			logEvent("wood", "pickup_ok", `${logsBefore} → ${logsNow}`, pos);
		} else {
			logEvent(
				"wood",
				"pickup_miss",
				`dug but didn't collect (${logsNow} logs)`,
				pos,
			);
		}

		return true;
	};

	// ── MAIN LOOP ──

	logEvent("wood", "start", `gathering ${targetCount} logs`);
	let attempts = 0;
	let blocksDug = 0;

	while (
		countLogs() < targetCount &&
		attempts < 50 &&
		blocksDug < targetCount * 3
	) {
		attempts++;

		const target = findClosestLog();
		if (!target) {
			logEvent("wood", "explore", "no trees nearby");
			const angle = Math.random() * Math.PI * 2;
			await bot.look(angle, 0);
			bot.setControlState("forward", true);
			bot.setControlState("sprint", true);
			await sleep(3000);
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
			continue;
		}

		const reached = await navigateTo(target.pos);
		if (!reached) {
			unreachable.add(posKey(target.pos));
			logEvent(
				"wood",
				"blacklist",
				`${target.name} at ${posKey(target.pos)}`,
				target.pos,
			);
			continue;
		}

		const dug = await mineBlock(target.pos, target.name);
		if (dug) blocksDug++;
	}

	const logs = countLogs();
	logEvent("wood", "done", `${logs}/${targetCount} logs`);
	return {
		success: logs >= targetCount,
		message: `Gathered ${logs}/${targetCount} logs`,
	};
};
