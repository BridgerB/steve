/**
 * Gather flint by mining EXPOSED gravel and flood-filling the whole pocket.
 *
 * Flint only drops from gravel (~10%/block). Two hard constraints:
 *  - No-X-ray: findBlocks only returns exposed + line-of-sight gravel, so we can
 *    only seed from gravel we can actually see (surface patches, beaches, ravine
 *    and cave walls) — never buried gravel.
 *  - No pickaxe at this step: we can't tunnel stone (~7.5s/block by hand), so we
 *    only ever break gravel (fast by hand) and walk to it over the surface.
 *
 * Strategy: seed on the nearest visible gravel, flood-fill-mine the connected
 * pocket (a disk is ~10-40 blocks → usually enough for the 10% roll), and roam
 * downhill to fresh terrain (rescanning between legs) when nothing is in view.
 */
import type { Bot, Vec3 } from "typecraft";
import { distance, offset, vec3 } from "typecraft";
import {
	digStaircaseUp,
	findBlocks,
	findItem,
	getBlock,
	goTo,
	moveCloser,
	throwIfPreempted,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";

// Seeds that failed, PER BOT and across calls: the step is re-dispatched after every
// water preempt, and a fresh call re-picked the exact seed whose approach had just
// walked the bot into the pond (race33 691: 4 preempts in 30s right after filling
// its bucket). Also the seed being worked on when a call is cut short.
const failedSeeds = new WeakMap<Bot, Set<string>>();
const lastSeed = new WeakMap<Bot, string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
// Gravel touching water is a POND FLOOR / bank: walking up to it puts the bot in
// the pond, escape_water preempts, and the next attempt picks the same gravel —
// race32 686 (first bot ever with a filled water bucket) looped Get Flint and
// Steel → Get Out Of Water 6× in 90s on a pond whose whole floor was gravel.
const wet = (bot: Bot, p: Vec3): boolean =>
	(
		[
			[0, 1, 0],
			[1, 0, 0],
			[-1, 0, 0],
			[0, 0, 1],
			[0, 0, -1],
			[0, -1, 0],
		] as const
	).some((o) => (getBlock(bot, vec3(p.x + o[0], p.y + o[1], p.z + o[2]))?.name ?? "").includes("water"));
// Gravel on a pond FLOOR under 2+ blocks of water passes the 6-neighbour `wet`
// test when it sits under more gravel; the approach then walks the bot into the
// pond (race42 725: 8 seed_unreachable + Get Out Of Water cycles in 60s at
// seeds 6-8 blocks below it). Reject anything with water in the 4 blocks above.
// Scan the whole column up to the surface: race51 762 picked gravel on a lake
// bed 13 blocks under the water (y49 under a y62 lake), walked in, drowned,
// escaped to the same shore and picked the next lake seed — four times.
const underWater = (bot: Bot, p: Vec3): boolean => {
	for (let dy = 1; dy <= 20; dy++) {
		const n = getBlock(bot, vec3(p.x, p.y + dy, p.z))?.name ?? "";
		if (n.includes("water")) return true;
		if (n !== "air" && n !== "cave_air" && !n.includes("water")) return false; // a roof: cave gravel
	}
	return false;
};
const NEIGHBORS = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1],
] as const;

/** Break one gravel block and vacuum up its drop (gravel or flint). */
const mineGravel = async (bot: Bot, pos: Vec3): Promise<boolean> => {
	const blk = getBlock(bot, pos);
	if (!blk || blk.name !== "gravel") return false;
	try {
		await bot.lookAt(offset(pos, 0.5, 0.5, 0.5), true);
		await bot.dig(blk);
	} catch {
		return false;
	}
	await sleep(140); // let a falling-gravel drop settle to the floor
	try {
		await bot.collectDrops(5, 2000, async (p) => {
			await goTo(bot, p, { range: 1.3, timeout: 2000 });
		});
	} catch {}
	return true;
};

/** Bounded walk toward a block; true if we ended within hand reach (~4). */
const approach = async (bot: Bot, pos: Vec3): Promise<boolean> => {
	if (distance(bot.entity.position, pos) <= 3.2) return true;
	try {
		await goTo(bot, pos, { range: 2.2, timeout: 9000 });
	} catch {}
	if (distance(bot.entity.position, pos) > 3.4) {
		try {
			await moveCloser(bot, pos, { maxDistance: 3, maxWalkTime: 2500 });
		} catch {}
	}
	return distance(bot.entity.position, pos) <= 4.6;
};

/** Flood-fill mine every gravel connected to `seed`, collecting drops. */
const harvestPocket = async (
	bot: Bot,
	seed: Vec3,
	deadlineMs: number,
): Promise<void> => {
	const seen = new Set<string>([key(seed)]);
	const queue: Vec3[] = [seed];
	while (queue.length && !findItem(bot, "flint") && Date.now() < deadlineMs) {
		throwIfPreempted();
		// Mine the nearest gravel next so we work our way through the pocket.
		queue.sort(
			(a, b) =>
				distance(bot.entity.position, a) - distance(bot.entity.position, b),
		);
		const pos = queue.shift();
		if (!pos) break;
		if (getBlock(bot, pos)?.name !== "gravel") continue;
		if (!(await approach(bot, pos))) continue;
		await mineGravel(bot, pos);
		for (const [dx, dy, dz] of NEIGHBORS) {
			const np = vec3(pos.x + dx, pos.y + dy, pos.z + dz);
			if (seen.has(key(np))) continue;
			seen.add(key(np));
			if (getBlock(bot, np)?.name === "gravel" && !wet(bot, np)) queue.push(np);
		}
	}
};

/**
 * Bounded roam to fresh terrain, rescanning between short legs so a patch is
 * caught the moment its chunk streams in. Biases downhill from peaks (mountains
 * have little surface gravel; it concentrates on lower ground and shores).
 * Returns a gravel seed if one comes into view.
 */
const roam = async (bot: Bot, seen: Set<string>): Promise<Vec3 | null> => {
	let base = Math.random() * Math.PI * 2;
	const high = bot.entity.position.y > 80;
	for (let leg = 0; leg < 3; leg++) {
		throwIfPreempted();
		const p = bot.entity.position;
		let a = base + (Math.random() - 0.5);
		const dy = high ? -18 : 0;
		let t = vec3(p.x + Math.cos(a) * 22, p.y + dy, p.z + Math.sin(a) * 22);
		// Don't roam INTO the pond we just scooped from: rotate the leg until neither
		// its far end nor its midpoint sits over water (up to 6 tries).
		for (let k = 0; k < 6; k++) {
			const wetAt = (x: number, z: number): boolean =>
				[60, 61, 62, 63, 64, 65].some((yy) =>
					(getBlock(bot, vec3(Math.floor(x), yy, Math.floor(z)))?.name ?? "").includes("water"),
				);
			if (!wetAt(t.x, t.z) && !wetAt((p.x + t.x) / 2, (p.z + t.z) / 2)) break;
			a += Math.PI / 3;
			t = vec3(p.x + Math.cos(a) * 22, p.y + dy, p.z + Math.sin(a) * 22);
		}
		logEvent("flint", "roam", `leg ${leg + 1} → ${Math.floor(t.x)},${Math.floor(t.z)}`, p);
		try {
			await goTo(bot, t, { range: 4, timeout: 7000 });
		} catch {}
		if (bot.entity.isInWater) return null; // let escape_water take over
		// A leg that didn't move us (pathfinder found nothing and the nudge hit a
		// trunk / ledge): race40 716 logged 7 legs from the same block. Turn hard,
		// then jump-walk the new bearing so a 1-high obstacle can't pin us.
		if (distance(bot.entity.position, p) < 2) {
			base += Math.PI / 2 + Math.random() * (Math.PI / 2);
			const q = bot.entity.position;
			const t2 = vec3(q.x + Math.cos(base) * 8, q.y, q.z + Math.sin(base) * 8);
			logEvent("flint", "roam_stuck", `leg ${leg + 1} moved <2 — jump-walk → ${Math.floor(t2.x)},${Math.floor(t2.z)}`, q);
			await bot.lookAt(t2);
			bot.setControlState("forward", true);
			bot.setControlState("jump", true);
			await sleep(2500);
			bot.setControlState("forward", false);
			bot.setControlState("jump", false);
			if (bot.entity.isInWater) return null;
			// Still pinned (a 2-deep pit — e.g. the notch the water escape dug): carve
			// a staircase 2 up out of it.
			if (distance(bot.entity.position, q) < 2) {
				const y0 = Math.floor(bot.entity.position.y);
				logEvent("flint", "roam_pit", `jump-walk moved <2 at y=${y0} — staircase up`, bot.entity.position);
				try {
					await digStaircaseUp(bot, y0 + 2, Date.now() + 15000);
				} catch {}
			}
		}
		const s = findBlocks(bot, "gravel", 64, 40)
			.filter((q) => !seen.has(key(q)) && !wet(bot, q) && !underWater(bot, q))
			.map((q) => ({ q, d: distance(bot.entity.position, q) }))
			.sort((x, y) => x.d - y.d)[0]?.q;
		if (s) return s;
	}
	return null;
};

const REPLACEABLE = new Set(["air", "cave_air", "short_grass", "tall_grass", "fern", "large_fern", "snow_layer", "dead_bush", "leaf_litter"]);
const BAD_FLOOR = (n: string): boolean =>
	n === "air" || n === "cave_air" || n.includes("water") || n.includes("lava") || n.includes("leaves") || n.includes("gravel") || n.includes("sand");

/**
 * The speedrunner's flint trick: place a gravel block from the pack on the ground
 * beside us, break it, pick the drop up. 10% flint per break; otherwise the gravel
 * comes straight back, so a couple of gravel blocks are enough to farm a flint in
 * ~20s instead of roaming a gravel-free forest for minutes (race45 737: 5+ min
 * with 2 gravel in the pack; 738 the same with 3). Returns true once flint is held.
 */
const cycleGravel = async (bot: Bot, deadlineMs: number): Promise<boolean> => {
	for (let i = 0; i < 40 && !findItem(bot, "flint") && Date.now() < deadlineMs; i++) {
		throwIfPreempted();
		const g = findItem(bot, "gravel");
		if (!g) return false;
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		let placed: Vec3 | null = null;
		for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
			const cell = vec3(fx + dx, fy, fz + dz);
			const cb = getBlock(bot, cell);
			const below = getBlock(bot, vec3(fx + dx, fy - 1, fz + dz));
			if (!cb || !REPLACEABLE.has(cb.name)) continue;
			if (!below || BAD_FLOOR(below.name)) continue;
			try {
				await bot.equip(g as never, "hand");
				await bot.placeBlockWithOptions(below as never, vec3(0, 1, 0), { forceLook: true });
			} catch {
				continue;
			}
			await sleep(250);
			if (getBlock(bot, cell)?.name === "gravel") {
				placed = cell;
				break;
			}
		}
		if (!placed) {
			logEvent("flint", "gravel_cycle", `no spot to place beside ${fx},${fy},${fz}`, p);
			return false;
		}
		if (i === 0) logEvent("flint", "gravel_cycle", `start with ${(g as { count?: number }).count ?? 1} gravel`, p);
		await mineGravel(bot, placed);
	}
	const ok = !!findItem(bot, "flint");
	logEvent("flint", "gravel_cycle", ok ? "flint!" : "no flint yet", bot.entity.position);
	return ok;
};

/**
 * Mine gravel until a flint is in inventory or `deadlineMs` passes. Returns true
 * if a flint was obtained.
 */
export const gatherFlint = async (
	bot: Bot,
	deadlineMs: number,
): Promise<boolean> => {
	const doneSeeds = failedSeeds.get(bot) ?? new Set<string>();
	failedSeeds.set(bot, doneSeeds);
	// The seed a previous (cut-short) call was working on is suspect — skip it.
	const prev = lastSeed.get(bot);
	if (prev) {
		doneSeeds.add(prev);
		lastSeed.delete(bot);
	}
	logEvent("flint", "start", `${doneSeeds.size} seeds blacklisted, ${Math.round((deadlineMs - Date.now()) / 1000)}s`);
	while (!findItem(bot, "flint") && Date.now() < deadlineMs) {
		// Preempted (water escape took over)? Stop NOW. `approach` swallows goTo's
		// preempt throw, so without this the loop spun a radius-64 gravel scan
		// every iteration and starved the keepalive: race30 679 was kicked twice
		// at the river bank, 90s frozen each time, right after filling its bucket.
		throwIfPreempted();
		if ((bot.health ?? 20) < 6) break; // don't die for a flint
		// Gravel already in the pack (picked up while mining, or from a pocket that
		// yielded none): farm it in place before roaming anywhere.
		if (findItem(bot, "gravel") && !bot.entity.isInWater && (await cycleGravel(bot, deadlineMs))) break;
		let seed = findBlocks(bot, "gravel", 64, 40)
			.filter((p) => !doneSeeds.has(key(p)) && !wet(bot, p) && !underWater(bot, p))
			.map((p) => ({ p, d: distance(bot.entity.position, p) }))
			.sort((a, b) => a.d - b.d)[0]?.p;

		// Nothing visible → keep roaming to fresh terrain until the deadline; never
		// give up early while budget remains (a second pocket is usually reachable).
		if (!seed) {
			seed = (await roam(bot, doneSeeds)) ?? undefined;
			if (!seed) continue;
		}
		lastSeed.set(bot, key(seed));
		logEvent("flint", "seed", `${key(seed)} dist=${distance(bot.entity.position, seed).toFixed(1)}`, seed);
		if (!(await approach(bot, seed)) || bot.entity.isInWater) {
			doneSeeds.add(key(seed));
			logEvent("flint", "seed_unreachable", key(seed), seed);
			if (bot.entity.isInWater) return false; // escape_water takes over
			continue;
		}
		await harvestPocket(bot, seed, deadlineMs);
		doneSeeds.add(key(seed));
		lastSeed.delete(bot);
		logEvent("flint", "pocket_done", `${key(seed)} flint=${findItem(bot, "flint") ? "yes" : "no"}`, seed);
	}
	return !!findItem(bot, "flint");
};
