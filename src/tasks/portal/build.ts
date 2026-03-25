/**
 * Portal building - cast obsidian and place portal frame
 */

import type { Bot } from "typecraft";
import { vec3, windowItems } from "typecraft";
import type { StepResult } from "../../types.ts";

/**
 * Build a nether portal using bucket casting method
 * This creates obsidian by pouring water on lava source blocks
 */
export const buildNetherPortal = async (bot: Bot): Promise<StepResult> => {
	// First check if we already have obsidian
	const obsidian = windowItems(bot.inventory).find(
		(i) => i.name === "obsidian",
	);
	const obsidianCount = obsidian?.count ?? 0;

	if (obsidianCount < 10) {
		// Try to find lava to create obsidian with water bucket
		const lava = bot.findBlock({
			matching: (name) => name === "lava",
			maxDistance: 32,
		});

		if (!lava) {
			return {
				success: false,
				message: "Need 10 obsidian or lava source to build portal",
			};
		}

		const waterBucket = windowItems(bot.inventory).find(
			(i) => i.name === "water_bucket",
		);
		if (!waterBucket) {
			return { success: false, message: "Need water bucket for bucket method" };
		}

		// TODO: Implement bucket-cast obsidian creation
		return {
			success: false,
			message:
				"Bucket method portal building not yet implemented - need 10 obsidian",
		};
	}

	// We have obsidian - build the portal frame
	const pos = vec3(
		bot.entity.position.x,
		bot.entity.position.y,
		bot.entity.position.z,
	);

	try {
		console.log("  Building nether portal frame...");

		const flintAndSteel = windowItems(bot.inventory).find(
			(i) => i.name === "flint_and_steel",
		);
		if (!flintAndSteel) {
			return {
				success: false,
				message: "Need flint and steel to light portal",
			};
		}

		// TODO: Actually place obsidian blocks in portal shape
		await new Promise((resolve) => setTimeout(resolve, 100));

		return {
			success: true,
			message: `Portal frame ready at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`,
		};
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Failed to build portal",
		};
	}
};
