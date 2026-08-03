/**
 * IDEA "strip": ignore the deep-ore descent. Dig down a handful of blocks into
 * stone (past the dirt cap), then strip-mine a straight 1x2 tunnel at that
 * shallow level, harvesting whatever coal the walls expose. Coal veins are dense
 * in stone at essentially every Y, so a short tunnel near the surface exposes
 * coal fast — no 75s staircase to y50.
 */
import type { Bot } from "typecraft";
import type { StepResult } from "../src/lib/steve/types.ts";
import {
	digDownToStone,
	ensurePick,
	floorY,
	invCount,
	mineNearbyCoal,
	pickDigDir,
	rotate,
	stripStep,
} from "./common.ts";

export const run = async (bot: Bot, target = 6): Promise<StepResult> => {
	const deadline = Date.now() + 100_000;
	await ensurePick(bot);
	const have = () => invCount(bot, "coal");

	const dbg = !!process.env.DEBUG;
	// Drop into solid stone so the strip tunnel is in ore-bearing rock, not dirt.
	await digDownToStone(bot, 12);
	if (dbg) console.log(`  [strip] after digDown y=${floorY(bot)}`);

	let dir = pickDigDir(bot);
	let blocked = 0;
	let steps = 0;
	while (have() < target && Date.now() < deadline) {
		if ((bot.health ?? 20) < 7) break;
		await ensurePick(bot);
		// Grab any coal the tunnel already exposed in walls/floor/ceiling.
		if (await mineNearbyCoal(bot, 24)) {
			blocked = 0;
			if (dbg) console.log(`  [strip] mined coal → ${have()} y=${floorY(bot)}`);
			continue;
		}
		const r = await stripStep(bot, dir[0], dir[1]);
		if (dbg && ++steps % 5 === 0)
			console.log(`  [strip] step ${steps} r=${r} y=${floorY(bot)} pos=${Math.floor(bot.entity.position.x)},${Math.floor(bot.entity.position.z)}`);
		if (r === "ok") {
			blocked = 0;
		} else {
			dir = rotate(dir);
			if (++blocked >= 4) {
				// Boxed on all sides at this level — drop a few more into fresh rock.
				await digDownToStone(bot, 4);
				blocked = 0;
				dir = pickDigDir(bot);
			}
		}
	}
	const c = have();
	return { success: c >= 3, message: `strip: ${c} coal (y=${floorY(bot)})` };
};

export default run;
