/**
 * Bucket tasks - filling, placing, and picking up water
 */

import type { Bot } from "typecraft";
import { distance, offset, windowItems } from "typecraft";
import type { StepResult, Block } from "../../types.ts";

/**
 * Fill an empty bucket with water
 */
export const fillWaterBucket = async (bot: Bot): Promise<StepResult> => {
	// Find all water positions
	const waterPositions = bot.findBlocks({
		matching: (name) => name === "water",
		maxDistance: 64,
		count: 200,
	});

	console.log(`  Found ${waterPositions.length} water blocks total`);

	// Find surface water (has air above)
	let water: Block | null = null;
	for (const pos of waterPositions) {
		const above = bot.blockAt(offset(pos, 0, 1, 0)) as Block | null;
		if (above && above.name === "air") {
			water = bot.blockAt(pos) as Block | null;
			if (water) break;
		}
	}

	if (!water) {
		return { success: false, message: "No surface water found nearby" };
	}

	console.log(
		`  Found surface water at ${water.position.x}, ${water.position.y}, ${water.position.z}`,
	);

	// Get bucket from inventory
	const bucket = windowItems(bot.inventory).find((i) => i.name === "bucket");
	if (!bucket) {
		return { success: false, message: "No empty bucket in inventory" };
	}

	try {
		// Move closer to the water - need to be within 3 blocks
		let dist = distance(bot.entity.position, water.position);
		console.log(`  Distance to water: ${dist.toFixed(1)} blocks`);

		while (dist > 3) {
			await bot.lookAt(water.position);
			bot.setControlState("forward", true);
			bot.setControlState("sprint", true);
			await new Promise((resolve) => setTimeout(resolve, 500));

			const newDist = distance(bot.entity.position, water.position);
			console.log(`  Moving... distance: ${newDist.toFixed(1)}`);

			// If we're not getting closer, we might be stuck
			if (newDist >= dist - 0.5) {
				bot.setControlState("jump", true);
				await new Promise((resolve) => setTimeout(resolve, 300));
				bot.setControlState("jump", false);
			}

			dist = newDist;

			if (dist > 50) {
				bot.setControlState("forward", false);
				bot.setControlState("sprint", false);
				return { success: false, message: "Water too far away" };
			}
		}

		bot.setControlState("forward", false);
		bot.setControlState("sprint", false);
		console.log(`  Reached water, distance: ${dist.toFixed(1)}`);

		// Equip bucket
		await bot.equip(bucket, "hand");

		// Look at the water block
		await bot.lookAt(offset(water.position, 0.5, 0.5, 0.5));
		await new Promise((resolve) => setTimeout(resolve, 200));

		console.log(`  Looking at water and using bucket...`);

		bot.deactivateItem();
		await new Promise((resolve) => setTimeout(resolve, 100));

		bot.activateItem();
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Check if we got water bucket
		let waterBucket = windowItems(bot.inventory).find(
			(i) => i.name === "water_bucket",
		);

		if (!waterBucket) {
			const belowWater = bot.blockAt(
				offset(water.position, 0, -1, 0),
			) as Block | null;
			if (
				belowWater &&
				belowWater.name !== "water" &&
				belowWater.name !== "air"
			) {
				console.log(
					`  Trying to activate block below water: ${belowWater.name}`,
				);
				await bot.lookAt(offset(belowWater.position, 0.5, 1, 0.5));
				await new Promise((resolve) => setTimeout(resolve, 200));
				try {
					await bot.activateBlock(belowWater.position, { x: 0, y: 1, z: 0 });
					await new Promise((resolve) => setTimeout(resolve, 500));
				} catch {
					bot.activateItem();
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
			}
			waterBucket = windowItems(bot.inventory).find(
				(i) => i.name === "water_bucket",
			);
		}

		return {
			success: !!waterBucket,
			message: waterBucket ? "Filled water bucket" : "Failed to fill bucket",
		};
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Failed to fill bucket",
		};
	}
};
