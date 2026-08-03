/**
 * IDEA "scan" (the winner): the mining task fails because typecraft's
 * bot.findBlocks({exposed:true}) returns 0 exposed ore even when 10-17 exposed
 * coal blocks sit in nearby caves — its canSeeBlock line-of-sight filter is
 * broken. bot.blockAt(), however, reads the loaded world correctly.
 *
 * So find coal ourselves with a bounded blockAt scan, keeping only blocks that
 * have an air/liquid neighbour (EXPOSED — identical semantics to the sanctioned
 * blockSeen path, so still no X-ray). Coal starts ~y56 and caves expose plenty,
 * so we harvest exposed coal near us and, when none is reachable, dig down a few
 * blocks into the coal band to bring more caves/veins into range.
 */
import type { Bot } from "typecraft";
import { distance, offset, vec3 } from "typecraft";
import { digExposesLava, digExposesWater, goTo, moveCloser } from "../src/lib/steve/lib/bot-utils.ts";
import { descendStaircase } from "../src/lib/steve/tasks/mining/main.ts";
import type { Block, StepResult } from "../src/lib/steve/types.ts";
import { ensurePick, floorY, invCount, isAir, isLava, isLiquid, isWater, pickDigDir, rotate, safeDig, sleep, stripStep } from "./common.ts";

const dbg = () => !!process.env.DEBUG;

const exposedNeighbor = (bot: Bot, x: number, y: number, z: number): boolean =>
	([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const).some(([a, b, c]) => {
		const nb = bot.blockAt(vec3(x + a, y + b, z + c));
		return isAir(nb) || (!!nb && nb.name.includes("water"));
	});

/**
 * Nearest EXPOSED coal_ore within the box, by blockAt scan (findBlocks is broken).
 * "Exposed" = has an air/water neighbour, exactly what blockSeen keys on. Skips
 * coal whose drop would fall into lava. Returns the block or null.
 */
const findExposedCoal = (bot: Bot, rXZ = 18, rDown = 14, rUp = 4): Block | null => {
	const px = Math.floor(bot.entity.position.x);
	const py = Math.floor(bot.entity.position.y);
	const pz = Math.floor(bot.entity.position.z);
	let best: Block | null = null;
	let bestD = Infinity;
	for (let x = px - rXZ; x <= px + rXZ; x++)
		for (let z = pz - rXZ; z <= pz + rXZ; z++)
			for (let y = py - rDown; y <= py + rUp; y++) {
				const b = bot.blockAt(vec3(x, y, z));
				if (!b || !b.name.includes("coal_ore")) continue;
				if (!exposedNeighbor(bot, x, y, z)) continue;
				// Skip ore sitting right over lava (drop would burn).
				const under = bot.blockAt(vec3(x, y - 1, z));
				if (isLava(under)) continue;
				const d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
				if (d < bestD) {
					bestD = d;
					best = b;
				}
			}
	return best;
};

const dig = async (bot: Bot, b: Block | null): Promise<boolean> => {
	if (isAir(b) || isLiquid(b)) return false;
	const block = b as Block;
	if (digExposesLava(bot, block.position)) return false;
	if (digExposesWater(bot, block.position)) return false;
	try {
		await bot.lookAt(offset(block.position, 0.5, 0.5, 0.5));
		await safeDig(bot, block, 7000);
		return true;
	} catch {
		return false;
	}
};

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Dig a beeline (2-high, descending as needed) straight toward `target` until the
 * bot is adjacent. This is the key primitive: the pathfinder (goTo) can't reach ore
 * embedded in rock or across a cave, so we carve our own route. It descends
 * DIAGONALLY (digs the floor ahead) rather than straight down — mining the block
 * directly underfoot hangs the digger ~7s each. Refuses lava/flood cells.
 */
const digToward = async (bot: Bot, target: Vec3, deadline: number): Promise<boolean> => {
	const dv = () => !!process.env.DEBUG;
	let lastDx = 0;
	let lastDz = 0;
	for (let step = 0; step < 60 && Date.now() < deadline; step++) {
		if ((bot.health ?? 20) < 7 || bot.entity?.isInWater) { if (dv()) console.log(`  [dt] bail step=${step} hp/water`); return false; }
		if (distance(bot.entity.position, target) <= 2.6) return true;
		await ensurePick(bot);
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		let dx = sign(target.x - fx);
		let dz = sign(target.z - fz);
		// Move along the dominant horizontal axis one step at a time.
		if (dx !== 0 && dz !== 0) {
			if (Math.abs(target.x - fx) >= Math.abs(target.z - fz)) dz = 0;
			else dx = 0;
		}
		// Horizontally over/next-to the target but still need to go DOWN: keep the previous
		// heading instead of flipping back and forth across the column (which oscillates in
		// place and never descends). Seed a heading on the first such step.
		const hdist = Math.abs(target.x - fx) + Math.abs(target.z - fz);
		if (hdist <= 1) {
			if (lastDx === 0 && lastDz === 0) lastDx = 1;
			dx = lastDx;
			dz = lastDz;
		}
		lastDx = dx;
		lastDz = dz;
		const head = bot.blockAt(vec3(fx + dx, fy + 1, fz + dz));
		const feet = bot.blockAt(vec3(fx + dx, fy, fz + dz));
		const floor = bot.blockAt(vec3(fx + dx, fy - 1, fz + dz));
		if ([head, feet, floor].some(isLava) || [head, feet, floor].some(isWater)) { if (dv()) console.log(`  [dt] step=${step} liquid ahead`); return false; }
		// How far would we fall stepping into (dir)? Scan down for the first solid landing.
		let drop = 0;
		while (drop < 8 && isAir(bot.blockAt(vec3(fx + dx, fy - 1 - drop, fz + dz)))) drop++;
		const landingBlk = bot.blockAt(vec3(fx + dx, fy - 1 - drop, fz + dz));
		// A fall of ~6+ (or bottomless / onto lava/water) is unsafe — reroute. Fall damage
		// is (drop-3) hearts, so drops up to 5 (≤2 hearts, fine at full health) are allowed
		// and let us descend through pockets / off tree canopies instead of stalling level.
		if (drop >= 6 || isLava(landingBlk) || isWater(landingBlk)) { if (dv()) console.log(`  [dt] step=${step} deep drop (${drop})`); return false; }
		const wantDown = target.y <= fy - 1 && drop >= 1;
		const dh = await dig(bot, head);
		const df = await dig(bot, feet);
		const dfl = wantDown && !isAir(floor) ? await dig(bot, floor) : false; // step down diagonally
		await sleep(120); // let the server apply the block breaks before walking in
		await bot.lookAt(vec3(p.x + dx, p.y - (wantDown ? 0.5 : 0), p.z + dz));
		bot.setControlState("forward", true);
		await sleep(360);
		bot.setControlState("forward", false);
		await sleep(140);
		if (dv() && step < 8) console.log(`  [dt] step=${step} @${fx},${fy},${fz} dir=${dx},${dz} down=${wantDown} dug h=${dh}/f=${df}/fl=${dfl} head=${head?.name} feet=${feet?.name} → ${Math.floor(bot.entity.position.x)},${Math.floor(bot.entity.position.y)},${Math.floor(bot.entity.position.z)}`);
		if (Math.floor(bot.entity.position.x) === fx && Math.floor(bot.entity.position.z) === fz && Math.floor(bot.entity.position.y) === fy) {
			// Didn't move — re-dig the step cells (the first dig may not have settled) and
			// jump-nudge once; only then give up this beeline.
			await dig(bot, bot.blockAt(vec3(fx + dx, fy + 1, fz + dz)));
			await dig(bot, bot.blockAt(vec3(fx + dx, fy, fz + dz)));
			if (wantDown) await dig(bot, bot.blockAt(vec3(fx + dx, fy - 1, fz + dz)));
			await sleep(120);
			await bot.lookAt(vec3(p.x + dx, p.y, p.z + dz));
			bot.setControlState("forward", true);
			bot.setControlState("jump", true);
			await sleep(450);
			bot.setControlState("jump", false);
			bot.setControlState("forward", false);
			await sleep(140);
			if (Math.floor(bot.entity.position.x) === fx && Math.floor(bot.entity.position.z) === fz) { if (dv()) console.log(`  [dt] step=${step} STALL, giving up`); return false; }
		}
	}
	return distance(bot.entity.position, target) <= 3.2;
};

/**
 * Harvest coal EXPOSED close to the bot (tunnel walls / just-dug faces). For each
 * exposed coal within a short radius: if within reach, mine it directly; if a few
 * blocks off, dig a short beeline to it. Mining one vein block exposes its
 * neighbours, so this cascades through the whole ~8-17 block vein. Returns coal
 * actually collected. Only touches NEARBY coal — no long pathing to distant ore.
 */
const harvestVein = async (bot: Bot, deadline: number): Promise<number> => {
	const before = invCount(bot, "coal");
	for (let i = 0; i < 16 && Date.now() < deadline; i++) {
		const near = findExposedCoal(bot, 6, 6, 4);
		if (!near) break;
		if (distance(bot.entity.position, near.position) > 4.6) {
			await digToward(bot, near.position, Math.min(deadline, Date.now() + 6000));
		}
		if (distance(bot.entity.position, near.position) > 4.8) break;
		const above = bot.blockAt(offset(near.position, 0, 1, 0)) as Block | null;
		if (above && !isAir(above) && !isLiquid(above)) await dig(bot, above);
		if (!(await dig(bot, near))) break;
		await bot.collectDrops(4.5, 1500, async () => {}).catch(() => {});
	}
	return invCount(bot, "coal") - before;
};

/** Dig straight down a few blocks (safe: no lava/water/void). Returns feet-Y. */
const digDown = async (bot: Bot, n: number): Promise<number> => {
	for (let i = 0; i < n; i++) {
		const below = bot.blockAt(offset(bot.entity.position, 0, -1, 0)) as Block | null;
		if (isAir(below)) { await sleep(150); continue; }
		if (isLiquid(below) || digExposesLava(bot, below.position) || digExposesWater(bot, below.position)) break;
		await ensurePick(bot);
		if (!(await dig(bot, below))) break;
		await sleep(200);
	}
	return floorY(bot);
};

const BAND_Y = 50; // coal starts ~y56; y50 sits in the dense band, above most lava

export const run = async (bot: Bot, target = 4): Promise<StepResult> => {
	const deadline = Date.now() + 105_000;
	await ensurePick(bot);
	const have = () => invCount(bot, "coal");

	let dir = pickDigDir(bot);
	let boxed = 0;
	while (have() < target && Date.now() < deadline) {
		if ((bot.health ?? 20) < 7) break;
		if (bot.entity?.isInWater) break;
		await ensurePick(bot);

		// Always grab coal exposed right next to us first (shaft/tunnel walls). Mining a
		// vein block cascades to the rest of the vein — one hit often clears the bar.
		if ((await harvestVein(bot, deadline)) > 0) {
			if (dbg()) console.log(`  [scan] vein → total ${have()} y=${floorY(bot)}`);
			boxed = 0;
			continue;
		}

		// PHASE A — above the coal band: beeline straight DOWN (drop-protected staircase,
		// never mines underfoot). Coal is at y<=56, so we have to get down there. The
		// descending shaft's walls expose coal that harvestVein grabs on the way.
		if (floorY(bot) > BAND_Y + 2) {
			const y0 = floorY(bot);
			const p = bot.entity.position;
			// Aim far along `dir` and down, so digToward keeps a consistent descending
			// heading (a diagonal staircase) instead of oscillating over our own column.
			const moved = await digToward(bot, vec3(Math.floor(p.x) + dir[0] * 40, BAND_Y, Math.floor(p.z) + dir[1] * 40), Math.min(deadline, Date.now() + 12_000));
			if (dbg()) console.log(`  [scan] descend ${y0}->${floorY(bot)} moved=${moved}`);
			// Couldn't go straight down (chasm/obstacle) — cut sideways to a new column.
			if (floorY(bot) >= y0) {
				if ((await stripStep(bot, dir[0], dir[1])) !== "ok") {
					dir = rotate(dir);
					if (++boxed >= 4) { await digDown(bot, 2); dir = pickDigDir(bot); boxed = 0; }
				}
			}
			continue;
		}

		// PHASE B — at the band: strip a straight 1x2 tunnel to keep exposing fresh walls;
		// harvestVein (top of loop) collects the coal those walls reveal.
		if ((await stripStep(bot, dir[0], dir[1])) !== "ok") {
			dir = rotate(dir);
			if (++boxed >= 4) {
				await digDown(bot, 2);
				dir = pickDigDir(bot);
				boxed = 0;
			}
		}
	}
	const c = have();
	return { success: c >= 3, message: `scan: ${c} coal (y=${floorY(bot)})` };
};

export default run;
