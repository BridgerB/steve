/**
 * Mining tasks - dig blocks underground
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3 } from "typecraft";
import {
	escapeWater,
	exploreRandom,
	findBlock,
	forgetResource,
	getRememberedResource,
	goTo,
	moveCloser,
	sleep,
	success,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { Block, StepResult } from "../../types.ts";

/** Dig with timeout — bot.dig() can hang silently */
const safeDig = async (
	bot: Bot,
	block: Block,
	timeout = 8000,
): Promise<void> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			bot.dig(block),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("dig timeout")), timeout);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

export const mineBlock = async (
	bot: Bot,
	blockType: string,
	targetCount: number,
): Promise<StepResult> => {
	let mined = 0;
	const deadline = Date.now() + 110_000; // Return cleanly before 120s step timeout

	// Equip best pickaxe before mining — prioritize higher tier
	const pickTier = [
		"diamond_pickaxe",
		"iron_pickaxe",
		"stone_pickaxe",
		"wooden_pickaxe",
	];
	let pickSlot = -1;
	for (const tier of pickTier) {
		const idx = bot.inventory.slots.findIndex((s) => s?.name === tier);
		if (idx >= 0) {
			pickSlot = idx;
			break;
		}
	}
	if (pickSlot >= 36 && pickSlot <= 44) {
		bot.setQuickBarSlot(pickSlot - 36);
	} else if (pickSlot >= 0) {
		// Move to hotbar first via window click, then select
		try {
			await bot.clickWindow(pickSlot, 0, 0); // pick up
			await bot.clickWindow(36, 0, 0); // place in hotbar slot 0
			bot.setQuickBarSlot(0);
		} catch {}
	}

	// For stone, we get cobblestone drops
	const isStone = blockType === "stone";
	const searchTypes = isStone ? ["stone"] : [blockType];
	const isTarget = (name: string) => searchTypes.some((t) => name.includes(t));

	// Find initial block — check memory first, then scan
	const remembered = getRememberedResource(bot, blockType);
	let startBlock: Block | null = null;
	if (remembered) {
		const remBlock = bot.blockAt(
			vec3(remembered.x, remembered.y, remembered.z),
		);
		if (remBlock && isTarget(remBlock.name)) {
			startBlock = remBlock;
			logEvent(
				"mine",
				"from_memory",
				`${blockType} at ${remembered.x},${remembered.y},${remembered.z}`,
			);
		} else {
			forgetResource(bot, blockType, remembered);
		}
	}
	if (!startBlock) {
		startBlock = findBlock(bot, isTarget, 64);
	}
	// Explore before giving up — walk around and search wider
	if (!startBlock) {
		for (let attempt = 0; attempt < 3; attempt++) {
			logEvent("mine", "exploring", `${blockType} attempt ${attempt + 1}/3`);
			await exploreRandom(bot, 40);
			// Check memory again — blockSeen may have fired during exploration
			const newRemembered = getRememberedResource(bot, blockType);
			if (newRemembered) {
				const remBlock = bot.blockAt(
					vec3(newRemembered.x, newRemembered.y, newRemembered.z),
				);
				if (remBlock && isTarget(remBlock.name)) {
					startBlock = remBlock;
					logEvent(
						"mine",
						"found_exploring_memory",
						`${blockType} at ${newRemembered.x},${newRemembered.y},${newRemembered.z}`,
					);
					break;
				} else {
					forgetResource(bot, blockType, newRemembered);
				}
			}
			startBlock = findBlock(bot, isTarget, 64);
			if (startBlock) break;
		}
	}
	if (!startBlock) {
		return { success: false, message: `Could not find ${blockType}` };
	}
	try {
		const startDist = distance(bot.entity.position, startBlock.position);
		if (startDist > 4) {
			await goTo(bot, startBlock.position, { range: 2, timeout: 15000 });
		} else {
			await moveCloser(bot, startBlock.position, { maxDistance: 2 });
		}
	} catch {}

	// Pick a direction and mine in a straight line at the same Y level
	const p = bot.entity.position;
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];
	// Pick the direction with the most target blocks ahead
	let bestDir: [number, number] = dirs[0] ?? [1, 0];
	let bestCount = 0;
	for (const [dx, dz] of dirs) {
		let count = 0;
		for (let i = 1; i <= 8; i++) {
			const b = bot.blockAt(offset(p, dx * i, 0, dz * i)) as Block | null;
			const bBelow = bot.blockAt(offset(p, dx * i, -1, dz * i)) as Block | null;
			if ((b && isTarget(b.name)) || (bBelow && isTarget(bBelow.name))) count++;
		}
		if (count > bestCount) {
			bestCount = count;
			bestDir = [dx, dz];
		}
	}
	const [dirX, dirZ] = bestDir;
	logEvent("mine", "direction", `dx=${dirX} dz=${dirZ} ahead=${bestCount}`);

	while (mined < targetCount && Date.now() < deadline) {
		// Re-equip pickaxe if it got unset (crafting, window ops can clear held item)
		if (!bot.heldItem?.name.includes("pickaxe")) {
			for (const tier of pickTier) {
				const idx = bot.inventory.slots.findIndex((s) => s?.name === tier);
				if (idx >= 36 && idx <= 44) {
					bot.setQuickBarSlot(idx - 36);
					break;
				}
				if (idx >= 0) {
					try {
						await bot.clickWindow(idx, 0, 0);
						await bot.clickWindow(36, 0, 0);
						bot.setQuickBarSlot(0);
					} catch {}
					break;
				}
			}
		}

		// Health check — abort if drowning or low, forget current target
		if ((bot.health ?? 20) < 6) {
			const rem = getRememberedResource(bot, blockType);
			if (rem) forgetResource(bot, blockType, rem);
			if (bot.entity?.isInWater) await escapeWater(bot);
			return {
				success: false,
				message: `Aborted mining — low health (${bot.health})`,
			};
		}

		// Mine the block at feet level in our direction, or below feet
		const py = Math.floor(bot.entity.position.y);

		// Check: ahead at feet, ahead below, directly below
		const candidates = [
			bot.blockAt(offset(bot.entity.position, dirX, 0, dirZ)), // ahead at feet
			bot.blockAt(offset(bot.entity.position, dirX, -1, dirZ)), // ahead below
			bot.blockAt(offset(bot.entity.position, 0, -1, 0)), // below feet
			bot.blockAt(offset(bot.entity.position, -dirX, 0, -dirZ)), // behind (if stuck)
		] as (Block | null)[];

		let block: Block | null = null;
		for (const b of candidates) {
			if (b && isTarget(b.name)) {
				block = b;
				break;
			}
		}

		if (!block) {
			// Check memory first — did we see this resource earlier?
			const remembered = getRememberedResource(bot, blockType);
			if (remembered) {
				const remBlock = bot.blockAt(
					vec3(remembered.x, remembered.y, remembered.z),
				);
				if (remBlock && isTarget(remBlock.name)) {
					const remDist = distance(bot.entity.position, remBlock.position);
					logEvent(
						"mine",
						"from_memory",
						`${blockType} at ${remembered.x},${remembered.y},${remembered.z} dist=${remDist.toFixed(
							0,
						)}`,
					);
					try {
						if (remDist > 4) {
							await goTo(bot, remBlock.position, { range: 2, timeout: 15000 });
						} else {
							await moveCloser(bot, remBlock.position, { maxDistance: 2 });
						}
						block = remBlock;
					} catch {
						forgetResource(bot, blockType, remembered);
						continue;
					}
				} else {
					// Resource gone — forget it
					forgetResource(bot, blockType, remembered);
				}
			}

			// Search if memory didn't help
			if (!block) {
				block = findBlock(bot, isTarget, 32);
			}
			if (!block) {
				return {
					success: false,
					message: `Could not find ${blockType} (mined ${mined}/${targetCount})`,
				};
			}
			const dist = distance(bot.entity.position, block.position);
			try {
				if (dist > 4) {
					await goTo(bot, block.position, { range: 2, timeout: 8000 });
				} else {
					await moveCloser(bot, block.position, { maxDistance: 2 });
				}
			} catch {
				logEvent("mine", "nav_fail", "couldn't reach block");
				continue;
			}
		}

		// Also dig the block above if it's not air (clear headroom for walking)
		const above = bot.blockAt(offset(block.position, 0, 1, 0)) as Block | null;
		if (
			above &&
			above.name !== "air" &&
			above.name !== "water" &&
			block.position.y >= py
		) {
			try {
				await bot.lookAt(offset(above.position, 0.5, 0.5, 0.5));
				await safeDig(bot, above);
				await sleep(100);
			} catch {}
		}

		try {
			await bot.lookAt(offset(block.position, 0.5, 0.5, 0.5));
			await safeDig(bot, block);
			mined++;
			logEvent("mine", "mined", `${blockType} ${mined}/${targetCount}`);
			await sleep(100);

			// Walk to the mined block to collect drops — bot is already facing it from lookAt
			await sleep(200);
			bot.setControlState("forward", true);
			await sleep(1000);
			bot.setControlState("forward", false);
			await sleep(1000);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown";
			logEvent("mine", "fail", msg);
		}
	}

	return success(`Mined ${mined} ${blockType}`);
};
