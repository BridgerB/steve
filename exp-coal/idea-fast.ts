/**
 * IDEA "fast": the winning insight is throughput, not cleverness. Stone breaks in
 * ~0.56s with a stone pickaxe, so ~150+ blocks are diggable inside the budget —
 * far more than the ~1% coal density needs for 3 coal. Earlier ideas failed on
 * OVERHEAD (findBlocks sphere-scans + goTo pathing + long sleeps), not density.
 *
 * This strategy strips a straight 1x2 tunnel just below the surface as fast as
 * possible: minimal sleeps, NO findBlocks scan (checks the handful of immediate
 * neighbour cells directly), and NO goTo — coal it digs (in-path or in the
 * adjacent wall) is auto-collected by the server as the bot stands next to it.
 * A short collectDrops sweep runs only right after a coal block is broken.
 */
import type { Bot } from "typecraft";
import { offset, vec3 } from "typecraft";
import { digExposesLava, digExposesWater } from "../src/lib/steve/lib/bot-utils.ts";
import type { Block, StepResult } from "../src/lib/steve/types.ts";
import { ensurePick, floorY, invCount, isAir, isLava, isLiquid, isWater, pickDigDir, rotate, safeDig, sleep } from "./common.ts";

const dig = async (bot: Bot, b: Block | null): Promise<boolean> => {
	if (isAir(b) || isLiquid(b)) return false;
	const block = b as Block;
	if (digExposesLava(bot, block.position)) return false;
	if (digExposesWater(bot, block.position)) return false;
	try {
		await bot.lookAt(offset(block.position, 0.5, 0.5, 0.5));
		await safeDig(bot, block, 6000);
		return true;
	} catch {
		return false;
	}
};

const isCoal = (b: Block | null): boolean => !!b && b.name.includes("coal_ore");

/**
 * Cheap opportunistic harvest: check the cells around the bot's feet+head (and one
 * step ahead) directly — no sphere scan. Dig any coal_ore that's adjacent; the drop
 * lands within a block, so the server auto-collects it. A tiny collectDrops sweep
 * runs only when coal was actually broken, to vacuum a side drop the bot didn't
 * step onto. Returns how many coal blocks were broken.
 */
const harvestAdjacent = async (bot: Bot, dx: number, dz: number): Promise<number> => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	// Feet-level + head-level laterals + floor/ceiling + the cell one step ahead.
	const cells: [number, number, number][] = [
		[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
		[1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
		[0, -1, 0], [0, 2, 0],
		[dx, 0, dz], [dx, 1, dz], [2 * dx, 0, 2 * dz], [2 * dx, 1, 2 * dz],
	];
	let broke = 0;
	for (const [ox, oy, oz] of cells) {
		const b = bot.blockAt(vec3(fx + ox, fy + oy, fz + oz));
		if (!isCoal(b)) continue;
		if (await dig(bot, b)) broke++;
	}
	if (broke > 0) {
		// Vacuum any side drop that didn't auto-collect (short, no long pathing).
		await bot.collectDrops(3.5, 1500, async () => {}).catch(() => {});
	}
	return broke;
};

/** Dig straight down a few blocks into solid stone (past the dirt cap). */
const digDown = async (bot: Bot, n: number): Promise<void> => {
	for (let i = 0; i < n; i++) {
		const below = bot.blockAt(offset(bot.entity.position, 0, -1, 0)) as Block | null;
		if (!below || isAir(below)) {
			await sleep(150);
			continue;
		}
		if (isLiquid(below) || digExposesLava(bot, below.position) || digExposesWater(bot, below.position)) return;
		await ensurePick(bot);
		if (!(await dig(bot, below))) return;
		await sleep(200);
	}
};

/** Advance one 1x2 step forward in (dx,dz). Stays level; refuses lava/water/ledge. */
const stepForward = async (bot: Bot, dx: number, dz: number): Promise<boolean> => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	const head = bot.blockAt(vec3(fx + dx, fy + 1, fz + dz));
	const feet = bot.blockAt(vec3(fx + dx, fy, fz + dz));
	const floor = bot.blockAt(vec3(fx + dx, fy - 1, fz + dz));
	if ([head, feet, floor].some(isLava) || [head, feet, floor].some(isWater)) return false;
	if (digExposesLava(bot, vec3(fx + dx, fy, fz + dz))) return false;
	if (digExposesWater(bot, vec3(fx + dx, fy, fz + dz))) return false;
	if (isAir(floor)) return false; // don't walk off a ledge into a cave
	await dig(bot, head);
	await dig(bot, feet);
	await bot.lookAt(vec3(p.x + dx, p.y, p.z + dz));
	bot.setControlState("forward", true);
	await sleep(300);
	bot.setControlState("forward", false);
	await sleep(90);
	return Math.floor(bot.entity.position.x) !== fx || Math.floor(bot.entity.position.z) !== fz;
};

export const run = async (bot: Bot, target = 4): Promise<StepResult> => {
	const dbg = !!process.env.DEBUG;
	const deadline = Date.now() + 105_000;
	const equipped = await ensurePick(bot);
	const have = () => invCount(bot, "coal");
	if (dbg) console.log(`  [fast] start y=${floorY(bot)} pick=${equipped} held=${bot.heldItem?.name}`);

	// Drop ~6 blocks into stone so the tunnel is in ore-bearing rock, not dirt/air.
	await digDown(bot, 6);
	if (dbg) console.log(`  [fast] afterDigDown y=${floorY(bot)} held=${bot.heldItem?.name}`);

	let dir = pickDigDir(bot);
	let blocked = 0;
	let steps = 0;
	let moves = 0;
	let broke = 0;
	while (have() < target && Date.now() < deadline) {
		if ((bot.health ?? 20) < 7) break;
		if (bot.entity?.isInWater) break;
		await ensurePick(bot);
		broke += await harvestAdjacent(bot, dir[0], dir[1]);
		if (have() >= 3 && have() >= target) break;
		const moved = await stepForward(bot, dir[0], dir[1]);
		if (moved) {
			moves++;
			blocked = 0;
		} else {
			dir = rotate(dir);
			if (++blocked >= 4) {
				// Boxed on all four sides — drop into fresh rock and pick a new heading.
				await digDown(bot, 3);
				dir = pickDigDir(bot);
				blocked = 0;
			}
		}
		if (dbg && ++steps % 10 === 0)
			console.log(`  [fast] step=${steps} moves=${moves} coalBroke=${broke} coal=${have()} y=${floorY(bot)} pos=${Math.floor(bot.entity.position.x)},${Math.floor(bot.entity.position.z)} held=${bot.heldItem?.name}`);
	}
	const c = have();
	if (dbg) console.log(`  [fast] END steps=${steps} moves=${moves} coalBroke=${broke} coal=${c} y=${floorY(bot)}`);
	return { success: c >= 3, message: `fast: ${c} coal (y=${floorY(bot)})` };
};

export default run;
