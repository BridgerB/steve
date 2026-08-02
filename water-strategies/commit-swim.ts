/**
 * commit-swim — the anti-thrash ocean escape.
 *
 * The production escapeWater re-picks the nearest "dry target" every tick, so in an
 * open ocean it oscillates between equidistant false targets and never actually
 * reaches shore. commit-swim instead scans ONCE for the direction where real dry
 * shore rises nearest to at/above the water surface, COMMITS to that single heading,
 * and holds forward into it until the bot is on dry land — only re-evaluating if it
 * genuinely stalls.
 *
 * Physics (typecraft): NO buoyancy, jump ignored in water. The only lift is the
 * ~0.3 outOfLiquidImpulse you get by pressing FORWARD into a solid block with
 * headroom. So a shore is climbed by pressing into the bank (and carving a notch if
 * it's >1 tall), never by jumping. On a gentle ocean floor you simply walk up the
 * rising sand until you surface.
 */
import { type Vec3, vec3 } from "typecraft";
import {
	getBlock,
	isInWaterTrap,
	isOnDryLand,
} from "../src/lib/steve/lib/bot-utils.ts";
import { logEvent } from "../src/lib/steve/lib/logger.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type B = ReturnType<typeof getBlock>;

// Local copies of the (non-exported) bot-utils predicates.
const PASSABLE_NAMES = ["air", "cave_air"];
const isPassable = (b: B): boolean =>
	!b ||
	PASSABLE_NAMES.includes(b.name) ||
	b.name.includes("water") ||
	b.name.includes("grass") ||
	b.name.includes("seagrass") ||
	b.name.includes("kelp") ||
	b.name.includes("vine") ||
	b.name.includes("flower") ||
	b.name.includes("coral_fan");
const isSolidGround = (b: B): boolean =>
	!!b &&
	b.name !== "air" &&
	b.name !== "cave_air" &&
	b.name !== "bedrock" &&
	!b.name.includes("water") &&
	!b.name.includes("lily") &&
	!b.name.includes("vine") &&
	!b.name.includes("kelp") &&
	!b.name.includes("seagrass") &&
	!b.name.includes("leaves");
const diggable = (b: B): boolean =>
	!!b &&
	b.name !== "air" &&
	b.name !== "cave_air" &&
	b.name !== "bedrock" &&
	!b.name.includes("water") &&
	!b.name.includes("lava");

const DIRS: [number, number][] = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1],
];

/** The real water surface Y at the bot's column: the block just above the highest
 *  water in a small window (the bot sinks to the floor, so bot.y is NOT the surface). */
const waterSurfaceY = (bot: any): number => {
	const p = bot.entity.position;
	const x = Math.floor(p.x);
	const z = Math.floor(p.z);
	let topWater = Math.floor(p.y);
	for (let y = Math.floor(p.y); y <= Math.floor(p.y) + 6; y++) {
		if (getBlock(bot, vec3(x, y, z))?.name.includes("water")) topWater = y;
	}
	return topWater + 1;
};

/**
 * A "dry shore" column: solid ground whose TOP breaks the water surface (top >=
 * surfaceY) with air (not water) above — real land to stand on, backed by more solid
 * ground below (not a lone 1-block bump). Returns the feet-Y to stand on, or null.
 */
const shoreFeetY = (bot: any, x: number, z: number, surfaceY: number): number | null => {
	for (let y = surfaceY + 6; y >= surfaceY; y--) {
		const g = getBlock(bot, vec3(x, y, z));
		if (!isSolidGround(g)) continue;
		const above1 = getBlock(bot, vec3(x, y + 1, z));
		const above2 = getBlock(bot, vec3(x, y + 2, z));
		if (above1?.name.includes("water")) return null; // submerged floor, not shore
		if (!isPassable(above1) || !isPassable(above2)) return null; // no headroom
		if (!isSolidGround(getBlock(bot, vec3(x, y - 1, z)))) return null; // lone bump
		return y + 1;
	}
	return null;
};

/** Scan the 8 compass directions outward; return the one whose nearest dry shore is
 *  closest (tie-break: lowest climb). Logs every direction. null if none in range. */
const scanShoreDir = (bot: any): { dir: [number, number]; dist: number } | null => {
	const p = bot.entity.position;
	const cx = Math.floor(p.x);
	const cz = Math.floor(p.z);
	const surfaceY = waterSurfaceY(bot);
	const R = 32;
	let best: { dir: [number, number]; dist: number; feetY: number } | null = null;
	const report: string[] = [];
	for (const [dx, dz] of DIRS) {
		const stepLen = dx !== 0 && dz !== 0 ? 1.414 : 1;
		let hit: { d: number; feetY: number } | null = null;
		for (let d = 1; d <= R; d++) {
			const feetY = shoreFeetY(bot, cx + dx * d, cz + dz * d, surfaceY);
			if (feetY == null) continue;
			hit = { d, feetY };
			break;
		}
		report.push(`${dx},${dz}:${hit ? `${hit.d}@${hit.feetY}` : "-"}`);
		if (!hit) continue;
		const dist = hit.d * stepLen;
		if (!best || dist < best.dist || (dist === best.dist && hit.feetY < best.feetY)) {
			best = { dir: [dx, dz], dist, feetY: hit.feetY };
		}
	}
	logEvent("nav", "scan", `sfc${surfaceY} ${report.join(" ")}`);
	return best ? { dir: best.dir, dist: best.dist } : null;
};

export const escape = async (bot: any): Promise<void> => {
	const surfaceY = Math.floor(bot.entity.position.y);

	// 1) COMMIT to one heading, chosen once from the initial (stationary) scan.
	const scan = scanShoreDir(bot);
	const travelHist: { t: number; x: number; z: number }[] = [];
	let dir: [number, number] = scan?.dir ?? [1, 0];
	logEvent(
		"nav",
		"commit_dir",
		scan ? `shore dir ${dir[0]},${dir[1]} dist ${Math.round(scan.dist)}` : "no shore; guess +x",
	);

	// Progress tracking against an absolute anchor (like escapeWater) — only real
	// progress (rose a block, or travelled >3 blocks) resets the stall clock.
	const p0 = bot.entity.position;
	let anchorX = p0.x;
	let anchorY = p0.y;
	let anchorZ = p0.z;
	let stuckSince = Date.now();
	let rescans = 0;

	const digAt = async (b: B): Promise<void> => {
		if (!diggable(b)) return;
		const pos = (b as any).position;
		try {
			await bot.lookAt(vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5), true);
			await Promise.race([
				(bot.dig(b as never, true) as Promise<void>).catch(() => {}),
				// Generous cap: a FLOATING dig is 25× (5× underwater × 5× off-ground), so
				// even soft canopy leaves overhead take ~7.5s. Too short a cap leaves the
				// block intact and the climb impulse stays blocked forever.
				sleep(9000),
			]);
			bot.stopDigging();
		} catch {
			/* ignore */
		}
	};

	const start = Date.now();
	while (Date.now() - start < 70000) {
		if (isOnDryLand(bot) && !isInWaterTrap(bot)) {
			bot.clearControlStates();
			await sleep(250);
			if (isOnDryLand(bot) && !isInWaterTrap(bot)) {
				logEvent("nav", "commit_escaped");
				return;
			}
		}

		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);

		travelHist.push({ t: Date.now(), x: p.x, z: p.z });
		while (travelHist.length > 40) travelHist.shift();

		// Clear our OWN headroom (fy+2 = the block just above the head; fy+1 is inside
		// our body). The climb impulse only fires when ~0.6 above the head is CLEAR, so
		// without this a 2-tall bank pins us forever. Never dig the bank ahead itself —
		// the impulse only fires when we COLLIDE with it.
		await digAt(getBlock(bot, vec3(fx, fy + 2, fz)));

		// Press INTO the committed heading, sustained. forward gives the swim impulse
		// into the bank; jump makes the final hop the instant we surface onto land.
		const [dx, dz] = dir;
		await bot.lookAt(vec3(fx + dx * 4 + 0.5, fy + 1, fz + dz * 4 + 0.5), true);
		bot.setControlState("forward", true);
		bot.setControlState("jump", true);
		bot.setControlState("sprint", true);
		await sleep(300);

		const np = bot.entity.position;
		const rose = Math.floor(np.y) > Math.floor(anchorY);
		const travelled = Math.hypot(np.x - anchorX, np.z - anchorZ) > 3;
		if (rose || travelled) {
			anchorX = np.x;
			anchorZ = np.z;
			anchorY = Math.max(anchorY, np.y);
			stuckSince = Date.now();
			continue;
		}

		if (Date.now() - stuckSince > 2200) {
			// One-shot geometry dump: names of the stack in our column + both cardinal
			// walls of the heading, so the true bank shape is visible in the log.
			const nm = (yy: number, xx: number, zz: number) =>
				(getBlock(bot, vec3(xx, yy, zz))?.name ?? "?").replace("minecraft:", "").slice(0, 6);
			logEvent(
				"nav",
				"geom",
				`p=${fx},${Math.round(p.y * 10) / 10},${fz} self[${fy}..${fy + 2}]=${nm(fy, fx, fz)}/${nm(fy + 1, fx, fz)}/${nm(fy + 2, fx, fz)} ` +
					`+x[${fy}..${fy + 2}]=${nm(fy, fx + 1, fz)}/${nm(fy + 1, fx + 1, fz)}/${nm(fy + 2, fx + 1, fz)} ` +
					`+z=${nm(fy, fx, fz + 1)}/${nm(fy + 1, fx, fz + 1)}/${nm(fy + 2, fx, fz + 1)} og=${bot.entity.onGround} iw=${bot.entity.isInWater}`,
			);
			// Pinned. Cardinal faces give a strong horizontal collision (a diagonal press
			// just slides along one face and never triggers the impulse), so carve/climb
			// on the CARDINAL component(s) of the committed heading. A block-tall bank is
			// beaten by: clear own head-above + clear the wall ahead at head & head-above,
			// leaving the foot block ahead as the stair, then press straight into it.
			const cards: [number, number][] = [];
			if (dx !== 0) cards.push([dx, 0]);
			if (dz !== 0) cards.push([0, dz]);
			const walledCard = cards.find(
				([cx, cz]) =>
					diggable(getBlock(bot, vec3(fx + cx, fy, fz + cz))) ||
					diggable(getBlock(bot, vec3(fx + cx, fy + 1, fz + cz))),
			);
			if (walledCard) {
				const [cx, cz] = walledCard;
				// Sink to the floor first — you can't dig while floating (25× slower).
				bot.clearControlStates();
				await sleep(500);
				const gy = Math.floor(bot.entity.position.y);
				await digAt(getBlock(bot, vec3(fx, gy + 2, fz))); // own head-above
				await digAt(getBlock(bot, vec3(fx + cx, gy + 1, fz + cz))); // wall @head
				await digAt(getBlock(bot, vec3(fx + cx, gy + 2, fz + cz))); // wall @head-above
				logEvent("nav", "commit_notch", `at ${fx},${gy},${fz} card ${cx},${cz}`);
				// Immediately press straight into the freshly-cut step to climb it.
				await bot.lookAt(vec3(fx + cx + 0.5, gy + 1, fz + cz + 0.5), true);
				bot.setControlState("forward", true);
				bot.setControlState("jump", true);
				await sleep(700);
				stuckSince = Date.now();
			} else {
				// Not walled — the heading just isn't reaching shore. Re-scan; if still
				// nothing, steer toward the steadiest historical travel (keep swimming).
				const rescan = scanShoreDir(bot);
				if (rescan && rescans < 6) {
					dir = rescan.dir;
					rescans++;
					logEvent("nav", "commit_rescan", `dir ${dir[0]},${dir[1]}`);
				} else if (travelHist.length > 5) {
					const old = travelHist[0];
					const vx = p.x - old.x;
					const vz = p.z - old.z;
					if (Math.hypot(vx, vz) > 0.5) {
						dir = [Math.sign(vx) || dir[0], Math.sign(vz) || dir[1]];
						logEvent("nav", "commit_drift", `dir ${dir[0]},${dir[1]}`);
					}
				}
				stuckSince = Date.now();
			}
		}
	}

	bot.clearControlStates();
	logEvent("nav", "commit_failed");
};

export default escape;
