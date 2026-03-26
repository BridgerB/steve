/**
 * Bucket tasks - filling water buckets
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3, windowItems } from "typecraft";
import { exploreRandom, goTo, sleep } from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { StepResult } from "../../types.ts";

/**
 * Fill an empty bucket with water.
 */
export const fillWaterBucket = async (bot: Bot): Promise<StepResult> => {
	// Find water source blocks
	const waterPositions = bot.findBlocks({
		matching: (name) => name === "water",
		maxDistance: 128,
		count: 200,
	});

	// Prefer surface water (air/cave_air above), fall back to any
	let waterPos = null;
	for (const pos of waterPositions) {
		const above = bot.blockAt(offset(pos, 0, 1, 0));
		if (above && (above.name === "air" || above.name === "cave_air")) {
			waterPos = pos;
			break;
		}
	}
	if (!waterPos && waterPositions.length > 0) {
		waterPos = waterPositions[0] ?? null;
	}

	// Explore if no water found
	if (!waterPos) {
		for (let i = 0; i < 3; i++) {
			logEvent("bucket", "exploring", `looking for water ${i + 1}/3`);
			await exploreRandom(bot, 50);
			const more = bot.findBlocks({
				matching: (name) => name === "water",
				maxDistance: 128,
				count: 10,
			});
			for (const p of more) {
				const above = bot.blockAt(offset(p, 0, 1, 0));
				if (above && (above.name === "air" || above.name === "cave_air")) {
					waterPos = p;
					break;
				}
			}
			if (!waterPos && more.length > 0) {
				waterPos = more[0] ?? null;
			}
			if (waterPos) break;
		}
	}

	if (!waterPos) {
		return { success: false, message: "No water found nearby" };
	}

	logEvent(
		"bucket",
		"found_water",
		`at ${waterPos.x},${waterPos.y},${waterPos.z}`,
	);

	const bucket = windowItems(bot.inventory).find((i) => i.name === "bucket");
	if (!bucket) {
		return { success: false, message: "No empty bucket in inventory" };
	}

	// Navigate to stand directly above/next to water
	// Need to be within 1-2 blocks for reliable raytrace
	const aboveWater = vec3(waterPos.x + 0.5, waterPos.y + 1, waterPos.z + 0.5);
	const dist = distance(bot.entity.position, aboveWater);
	if (dist > 2) {
		await goTo(bot, aboveWater, { range: 1, timeout: 15000 });
	}

	try {
		// Equip bucket to hotbar and select
		const bucketSlot = bot.inventory.slots.findIndex(
			(s) => s?.name === "bucket",
		);
		if (bucketSlot < 0) return { success: false, message: "Bucket lost" };
		if (bucketSlot >= 36 && bucketSlot <= 44) {
			bot.setQuickBarSlot(bucketSlot - 36);
		} else {
			try {
				await bot.clickWindow(bucketSlot, 0, 0);
				await bot.clickWindow(36, 0, 0);
				bot.setQuickBarSlot(0);
			} catch {}
		}
		await sleep(300);

		// Look at water
		await bot.lookAt(
			vec3(waterPos.x + 0.5, waterPos.y + 0.5, waterPos.z + 0.5),
		);
		await sleep(300);

		// Use bucket on water
		bot.activateItem();
		await sleep(1500);

		const waterBucket = windowItems(bot.inventory).find(
			(i) => i.name === "water_bucket",
		);

		if (waterBucket) {
			logEvent("bucket", "filled", "water_bucket");
			return { success: true, message: "Filled water bucket" };
		}
		return { success: false, message: "Failed to fill bucket" };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Failed to fill bucket",
		};
	}
};
