/**
 * Bucket tasks - filling water buckets
 */

import type { Bot } from "typecraft";
import { distance, offset, type Vec3, vec3, windowItems } from "typecraft";
import {
	exploreRandom,
	getMineEntry,
	goTo,
	returnToSurface,
	sleep,
} from "../../lib/bot-utils.ts";
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
	let waterPos: Vec3 | null = null;
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

	const pickWater = (list: Vec3[]): Vec3 | null => {
		for (const p of list) {
			const above = bot.blockAt(offset(p, 0, 1, 0));
			if (above && (above.name === "air" || above.name === "cave_air")) return p;
		}
		return list[0] ?? null;
	};

	// Deep underground (after mining iron) there's rarely water in sight — climb
	// back to the surface first, where lakes/rivers are, then look again.
	if (!waterPos) {
		const entry = getMineEntry(bot);
		if (entry && bot.entity.position.y < entry.y - 6) {
			logEvent(
				"bucket",
				"return_surface",
				`for water, from y=${Math.floor(bot.entity.position.y)}`,
			);
			await returnToSurface(bot);
			waterPos = pickWater(
				bot.findBlocks({
					matching: (name) => name === "water",
					maxDistance: 128,
					count: 100,
				}),
			);
		}
	}

	// Explore (on the surface now) if still no water found.
	if (!waterPos) {
		for (let i = 0; i < 6; i++) {
			logEvent("bucket", "exploring", `looking for water ${i + 1}/6`);
			await exploreRandom(bot, 60);
			waterPos = pickWater(
				bot.findBlocks({
					matching: (name) => name === "water",
					maxDistance: 128,
					count: 20,
				}),
			);
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

		// Use bucket on water — retry, clearing the stuck `usingHeldItem` state
		// that otherwise blocks repeated bucket use on 26.1.2.
		for (let attempt = 0; attempt < 4; attempt++) {
			await bot.lookAt(
				vec3(waterPos.x + 0.5, waterPos.y + 0.5, waterPos.z + 0.5),
			);
			await sleep(350);
			bot.activateItem();
			await sleep(900);
			try {
				bot.deactivateItem();
			} catch {
				/* ignore */
			}
			(bot as unknown as { usingHeldItem: boolean }).usingHeldItem = false;
			if (windowItems(bot.inventory).some((i) => i.name === "water_bucket")) {
				logEvent("bucket", "filled", "water_bucket");
				return { success: true, message: "Filled water bucket" };
			}
		}
		return { success: false, message: "Failed to fill bucket" };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Failed to fill bucket",
		};
	}
};
