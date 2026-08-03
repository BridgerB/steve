/**
 * DIAGNOSTIC — not a real strategy. At the spawn spot, report where gravel is:
 * surface scan at several radii, then probe straight down. Also do a small manual
 * gravel-mine to measure whether flint drops actually land in inventory. Always
 * returns failure so the harness just records the observation.
 */
import type { Bot } from "typecraft";
import {
	countItems,
	failure,
	findBlocks,
	getBlock,
	goTo,
} from "../src/lib/steve/lib/bot-utils.ts";
import type { StepResult } from "../src/lib/steve/types.ts";

const log = (...a: unknown[]) => console.log("  [diag]", ...a);

export const run = async (bot: Bot): Promise<StepResult> => {
	await bot.waitForChunksToLoad?.();
	const p = bot.entity.position;
	for (const r of [16, 32, 64, 96]) {
		const g = findBlocks(bot, "gravel", r, 5);
		log(`gravel within ${r}: ${g.length}`, g[0] ? `nearest ${g[0].x},${g[0].y},${g[0].z}` : "");
	}
	// Probe straight down: what blocks do we pass through?
	const px = Math.floor(p.x);
	const pz = Math.floor(p.z);
	const counts: Record<string, number> = {};
	for (let dy = 0; dy < 70; dy++) {
		const b = getBlock(bot, { x: px, y: Math.floor(p.y) - dy, z: pz } as never);
		if (b) counts[b.name] = (counts[b.name] ?? 0) + 1;
	}
	log("column below:", JSON.stringify(counts));

	// If gravel is within 32, walk to it and mine 8, count gravel+flint collected.
	const near = findBlocks(bot, "gravel", 32, 20);
	if (near.length) {
		log(`mining test on ${near.length} gravel nearby`);
		const g0 = countItems(bot, "gravel");
		const f0 = countItems(bot, "flint");
		let mined = 0;
		for (const pos of near.slice(0, 12)) {
			const blk = getBlock(bot, pos as never);
			if (!blk || blk.name !== "gravel") continue;
			try {
				await goTo(bot, pos as never, { range: 2.5, timeout: 6000 });
				await (bot as never as { dig: (b: unknown) => Promise<void> }).dig(blk);
				mined++;
				await (bot as never as { collectDrops: (n: number, ms: number, cb: (p: unknown) => Promise<void>) => Promise<void> }).collectDrops(6, 2500, async (pp) => {
					await goTo(bot, pp as never, { range: 1.4, timeout: 2500 });
				});
			} catch (e) {
				log("dig err", e instanceof Error ? e.message : e);
			}
		}
		log(`mined=${mined} gravelΔ=${countItems(bot, "gravel") - g0} flintΔ=${countItems(bot, "flint") - f0}`);
	}
	return failure("diag done");
};
