/**
 * IDEA "surface" — WINNER candidate. Find EXPOSED gravel and mine it by hand.
 *
 * Two hard constraints shape this:
 *  1. No-X-ray: typecraft's findBlocks only returns gravel that is exposed AND in
 *     line-of-sight, so buried gravel is invisible (correct). Exposed gravel —
 *     surface patches, beaches, ravine/cave walls — IS visible, and it's common.
 *  2. No pickaxe (prereq is just iron_ingot + crafting_table), so we CANNOT dig a
 *     shaft through stone (~7.5s/block by hand). Gravel itself breaks fast by hand,
 *     so we only ever mine gravel, never tunnel to it.
 *
 * So: scan wide for exposed gravel; walk to the nearest reachable one and mine it;
 * each broken block exposes its neighbours, so re-scanning naturally harvests the
 * whole patch. When a location has no visible gravel, wander to new terrain and
 * rescan. Flint drops ~10% per gravel, so we keep going (across patches if needed)
 * until we hold a flint, then place the table and craft.
 */
import type { Bot } from "typecraft";
import { distance, offset, vec3, type Vec3 } from "typecraft";
import {
	countItems,
	craftItem,
	exploreRandom,
	failure,
	findBlocks,
	findItem,
	getBlock,
	getCraftingTable,
	goTo,
	moveCloser,
} from "../src/lib/steve/lib/bot-utils.ts";
import type { StepResult } from "../src/lib/steve/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;

/** Dig one gravel block and vacuum up whatever it drops (gravel or flint). */
const mineGravel = async (bot: Bot, pos: Vec3): Promise<boolean> => {
	const blk = getBlock(bot, pos);
	if (!blk || blk.name !== "gravel") return false;
	try {
		await bot.lookAt(offset(pos, 0.5, 0.5, 0.5), true);
		await bot.dig(blk as never);
	} catch {
		return false;
	}
	await sleep(150); // let a falling-gravel drop settle to the floor
	try {
		await (
			bot as never as {
				collectDrops: (n: number, ms: number, cb: (p: Vec3) => Promise<void>) => Promise<void>;
			}
		).collectDrops(5, 2200, async (p) => {
			await goTo(bot, p, { range: 1.3, timeout: 2200 });
		});
	} catch {}
	return true;
};

export const gatherFlint = async (bot: Bot, deadlineMs: number): Promise<void> => {
	const blacklist = new Set<string>();
	let barren = 0;
	while (!findItem(bot, "flint") && Date.now() < deadlineMs) {
		if ((bot.health ?? 20) < 6) return; // don't die for a flint
		// Nearest reachable exposed gravel within the loaded view.
		const cands = findBlocks(bot, "gravel", 100, 60)
			.filter((p) => !blacklist.has(key(p)))
			.map((p) => ({ p, d: distance(bot.entity.position, p) }))
			.sort((a, b) => a.d - b.d);
		const target = cands[0]?.p;

		if (!target) {
			// No visible gravel here — roam to fresh terrain and rescan.
			if (++barren > 8) return;
			await exploreRandom(bot, 60);
			continue;
		}
		barren = 0;

		// Walk into reach (get to the gravel's own Y so the drop lands beside us).
		if (distance(bot.entity.position, target) > 3) {
			try {
				await goTo(bot, target, { range: 2.2, timeout: 12000 });
			} catch {}
		}
		if (distance(bot.entity.position, target) > 3.2) {
			try {
				await moveCloser(bot, target, { maxDistance: 3 });
			} catch {}
		}
		if (distance(bot.entity.position, target) > 4.5) {
			blacklist.add(key(target)); // can't reach it — skip and try another
			continue;
		}
		if (!(await mineGravel(bot, target))) blacklist.add(key(target));
	}
};

export const run = async (bot: Bot): Promise<StepResult> => {
	await bot.waitForChunksToLoad?.();
	const deadline = Date.now() + 100_000;
	await gatherFlint(bot, deadline);

	if (!findItem(bot, "flint")) {
		return failure(`Need flint (gravel mined=${countItems(bot, "gravel")})`);
	}
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "flint_and_steel", 1, table);
};
