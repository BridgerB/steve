/**
 * IDEA "hybrid": opportunistic exposed-coal harvest + shallow branch-mine. First
 * grab any coal already exposed near spawn (mountains/cliffs give free coal), then
 * drop into stone and strip a main tunnel with periodic perpendicular side
 * branches — the branches expose far more wall per second than a single tunnel,
 * and each loop also does a WIDE exposed scan so cave/cliff coal counts too.
 * Combines the reliability of digging into guaranteed ore-bearing rock with the
 * speed of grabbing whatever is already uncovered.
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
	sleep,
	stripStep,
} from "./common.ts";

const BRANCH_EVERY = 3;
const BRANCH_LEN = 5;

export const run = async (bot: Bot, target = 6): Promise<StepResult> => {
	const deadline = Date.now() + 100_000;
	await ensurePick(bot);
	const have = () => invCount(bot, "coal");

	// Phase 1: cheap surface grab — harvest coal already exposed within sight.
	const grabDeadline = Math.min(deadline, Date.now() + 20_000);
	while (have() < target && Date.now() < grabDeadline) {
		if (!(await mineNearbyCoal(bot, 64))) break;
	}
	if (have() >= target)
		return { success: true, message: `hybrid(surface): ${have()} coal` };

	// Phase 2: drop into stone and branch-mine.
	await digDownToStone(bot, 12);
	let dir = pickDigDir(bot);
	let blocked = 0;
	let sinceBranch = 0;

	const branch = async (perp: [number, number]) => {
		let depth = 0;
		for (let i = 0; i < BRANCH_LEN && have() < target && Date.now() < deadline; i++) {
			if (await mineNearbyCoal(bot, 16)) continue;
			if ((await stripStep(bot, perp[0], perp[1])) !== "ok") break;
			depth++;
			await mineNearbyCoal(bot, 16);
		}
		// Walk back out through the cleared branch to the spine.
		for (let i = 0; i < depth; i++) {
			const p = bot.entity.position;
			await bot.lookAt({ x: p.x - perp[0], y: p.y, z: p.z - perp[1] } as never);
			bot.setControlState("forward", true);
			await sleep(320);
			bot.setControlState("forward", false);
			await sleep(120);
		}
	};

	while (have() < target && Date.now() < deadline) {
		if ((bot.health ?? 20) < 7) break;
		await ensurePick(bot);
		if (await mineNearbyCoal(bot, 24)) {
			blocked = 0;
			continue;
		}
		if (sinceBranch >= BRANCH_EVERY) {
			sinceBranch = 0;
			await branch(rotate(dir));
			continue;
		}
		const r = await stripStep(bot, dir[0], dir[1]);
		if (r === "ok") {
			blocked = 0;
			sinceBranch++;
		} else {
			dir = rotate(dir);
			if (++blocked >= 4) {
				await digDownToStone(bot, 4);
				blocked = 0;
				dir = pickDigDir(bot);
			}
		}
	}
	const c = have();
	return { success: c >= 3, message: `hybrid: ${c} coal (y=${floorY(bot)})` };
};

export default run;
