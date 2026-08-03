/**
 * IDEA "exposed": no digging down at all. Coal ore is very often exposed on
 * mountainsides, cliffs, ravines and shallow caves. Repeatedly scan for the
 * nearest EXPOSED coal_ore (line-of-sight, no X-ray), walk to it and mine it;
 * when none is in range, explore to load fresh terrain and try again. This
 * measures how far pure surface foraging gets across random spawns.
 */
import type { Bot } from "typecraft";
import { exploreRandom } from "../src/lib/steve/lib/bot-utils.ts";
import type { StepResult } from "../src/lib/steve/types.ts";
import { ensurePick, floorY, invCount, mineNearbyCoal } from "./common.ts";

export const run = async (bot: Bot, target = 6): Promise<StepResult> => {
	const deadline = Date.now() + 100_000;
	await ensurePick(bot);
	const have = () => invCount(bot, "coal");

	let dry = 0;
	while (have() < target && Date.now() < deadline) {
		if ((bot.health ?? 20) < 7) break;
		await ensurePick(bot);
		// Wide line-of-sight scan; harvest whatever is visible.
		if (await mineNearbyCoal(bot, 96)) {
			dry = 0;
			continue;
		}
		// Nothing exposed nearby — roam to reveal new cliffs/caves.
		await exploreRandom(bot, 24);
		if (++dry > 20) break; // give up rather than wander forever
	}
	const c = have();
	return { success: c >= 3, message: `exposed: ${c} coal (y=${floorY(bot)})` };
};

export default run;
