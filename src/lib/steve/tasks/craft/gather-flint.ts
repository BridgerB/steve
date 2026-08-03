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
	findBlocks,
	findItem,
	getBlock,
	goTo,
	moveCloser,
} from "../../lib/bot-utils.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
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
			if (getBlock(bot, np)?.name === "gravel") queue.push(np);
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
	const base = Math.random() * Math.PI * 2;
	const high = bot.entity.position.y > 80;
	for (let leg = 0; leg < 3; leg++) {
		const p = bot.entity.position;
		const a = base + (Math.random() - 0.5);
		const dy = high ? -18 : 0;
		const t = vec3(p.x + Math.cos(a) * 22, p.y + dy, p.z + Math.sin(a) * 22);
		try {
			await goTo(bot, t, { range: 4, timeout: 7000 });
		} catch {}
		const s = findBlocks(bot, "gravel", 110, 40)
			.filter((q) => !seen.has(key(q)))
			.map((q) => ({ q, d: distance(bot.entity.position, q) }))
			.sort((x, y) => x.d - y.d)[0]?.q;
		if (s) return s;
	}
	return null;
};

/**
 * Mine gravel until a flint is in inventory or `deadlineMs` passes. Returns true
 * if a flint was obtained.
 */
export const gatherFlint = async (
	bot: Bot,
	deadlineMs: number,
): Promise<boolean> => {
	const doneSeeds = new Set<string>();
	while (!findItem(bot, "flint") && Date.now() < deadlineMs) {
		if ((bot.health ?? 20) < 6) break; // don't die for a flint
		let seed = findBlocks(bot, "gravel", 110, 40)
			.filter((p) => !doneSeeds.has(key(p)))
			.map((p) => ({ p, d: distance(bot.entity.position, p) }))
			.sort((a, b) => a.d - b.d)[0]?.p;

		// Nothing visible → keep roaming to fresh terrain until the deadline; never
		// give up early while budget remains (a second pocket is usually reachable).
		if (!seed) {
			seed = (await roam(bot, doneSeeds)) ?? undefined;
			if (!seed) continue;
		}
		if (!(await approach(bot, seed))) {
			doneSeeds.add(key(seed));
			continue;
		}
		await harvestPocket(bot, seed, deadlineMs);
		doneSeeds.add(key(seed));
	}
	return !!findItem(bot, "flint");
};
