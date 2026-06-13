/**
 * Bucket tasks - filling water buckets
 */

import type { Bot } from "typecraft";
import { distance, offset, type Vec3, vec3, windowItems } from "typecraft";
import {
	exploreRandom,
	forgetResource,
	getMineEntry,
	getRememberedResource,
	goTo,
	interactReliably,
	returnToSurface,
	sleep,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { StepResult } from "../../types.ts";

/**
 * Fill an empty bucket with water.
 */
export const fillWaterBucket = async (bot: Bot): Promise<StepResult> => {
	const pickWater = (list: Vec3[]): Vec3 | null => {
		for (const p of list) {
			const above = bot.blockAt(offset(p, 0, 1, 0));
			if (above && (above.name === "air" || above.name === "cave_air")) return p;
		}
		return list[0] ?? null;
	};
	const search = (dist: number, count: number): Vec3 | null =>
		pickWater(
			bot.findBlocks({ matching: (n) => n === "water", maxDistance: dist, count }),
		);

	let waterPos: Vec3 | null = null;

	// 1. Water the bot already saw (blockSeen memory) — cave water it passed while
	//    mining. In this world type water is underground, not on the surface.
	const remembered = getRememberedResource(bot, "water");
	if (remembered) {
		const rb = bot.blockAt(vec3(remembered.x, remembered.y, remembered.z));
		if (rb && rb.name === "water")
			waterPos = vec3(remembered.x, remembered.y, remembered.z);
		else forgetResource(bot, "water", remembered);
	}

	// 2. Anything currently in line-of-sight.
	if (!waterPos) waterPos = search(128, 200);

	// 3. Explore around the current level for more cave water.
	if (!waterPos) {
		for (let i = 0; i < 5; i++) {
			logEvent("bucket", "exploring", `looking for water ${i + 1}/5`);
			await exploreRandom(bot, 60);
			waterPos = search(128, 30);
			if (waterPos) break;
		}
	}

	// 4. Last resort: surface water (lakes/rivers) — climb up if deep, then look.
	if (!waterPos) {
		const entry = getMineEntry(bot);
		if (entry && bot.entity.position.y < entry.y - 6) {
			logEvent(
				"bucket",
				"return_surface",
				`for water, from y=${Math.floor(bot.entity.position.y)}`,
			);
			await returnToSurface(bot);
			waterPos = search(128, 100);
			for (let i = 0; i < 3 && !waterPos; i++) {
				await exploreRandom(bot, 80);
				waterPos = search(128, 30);
			}
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

		// Use bucket on water — get into reach + face it + retry (the scoop lands
		// only ~70-85% per attempt, and the bot often ends up above/beside the pool
		// rather than in raytrace range).
		const filled = await interactReliably(bot, {
			target: waterPos,
			reach: 2.5,
			attempts: 5,
			settleMs: 1000,
			action: async () => {
				bot.activateItem();
				await sleep(900);
				try {
					bot.deactivateItem();
				} catch {
					/* ignore */
				}
				(bot as unknown as { usingHeldItem: boolean }).usingHeldItem = false;
			},
			verify: () =>
				windowItems(bot.inventory).some((i) => i.name === "water_bucket"),
		});
		if (filled) {
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
