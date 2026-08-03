/**
 * IDEA "hybrid" — WINNER. Locate an exposed gravel block, then flood-fill-mine the
 * ENTIRE connected pocket, not just the one face.
 *
 * Why: gravel generates in disks/blobs (surface patches ~2-3 deep and several wide,
 * cave/ravine walls in big veins) — typically 10-40 connected blocks. At the ~10%
 * flint drop that's an 65-99% chance of at least one flint from a single pocket, so
 * fully harvesting ONE pocket usually wins, and we hop to another if not.
 *
 * Constraints honoured:
 *  - No-X-ray: we seed only from findBlocks' exposed+line-of-sight results, then walk
 *    the gravel graph we've physically broken into (a human mining out a deposit).
 *  - No pickaxe: we only ever break gravel (fast by hand); we never tunnel stone.
 *  - Every movement is time-bounded so the task always returns before the timeout.
 */
import type { Bot } from "typecraft";
import { distance, offset, vec3, type Vec3 } from "typecraft";
import {
	countItems,
	craftItem,
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
const NEI = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1],
] as const;

const mineGravel = async (bot: Bot, pos: Vec3): Promise<boolean> => {
	const blk = getBlock(bot, pos);
	if (!blk || blk.name !== "gravel") return false;
	try {
		await bot.lookAt(offset(pos, 0.5, 0.5, 0.5), true);
		await bot.dig(blk as never);
	} catch {
		return false;
	}
	await sleep(140);
	try {
		await (
			bot as never as {
				collectDrops: (n: number, ms: number, cb: (p: Vec3) => Promise<void>) => Promise<void>;
			}
		).collectDrops(5, 2000, async (p) => {
			await goTo(bot, p, { range: 1.3, timeout: 2000 });
		});
	} catch {}
	return true;
};

/** Bounded walk toward a block; returns true if we ended within reach (~4). */
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
const harvestPocket = async (bot: Bot, seed: Vec3, deadlineMs: number): Promise<void> => {
	const seen = new Set<string>([key(seed)]);
	const queue: Vec3[] = [seed];
	while (queue.length && !findItem(bot, "flint") && Date.now() < deadlineMs) {
		// Always take the gravel closest to us so we mine our way through the pocket.
		queue.sort(
			(a, b) => distance(bot.entity.position, a) - distance(bot.entity.position, b),
		);
		const pos = queue.shift();
		if (!pos) break;
		if (getBlock(bot, pos)?.name !== "gravel") continue;
		if (!(await approach(bot, pos))) continue;
		await mineGravel(bot, pos);
		for (const [dx, dy, dz] of NEI) {
			const np = vec3(pos.x + dx, pos.y + dy, pos.z + dz);
			if (seen.has(key(np))) continue;
			seen.add(key(np));
			if (getBlock(bot, np)?.name === "gravel") queue.push(np);
		}
	}
};

/**
 * Bounded roam to fresh terrain, rescanning for gravel between short legs so we
 * catch a patch the moment its chunk streams in. When we're high up (mountains,
 * where surface gravel is sparse) bias downhill — gravel concentrates on lower
 * ground, shores and slopes. Returns a gravel seed if one comes into view.
 */
const roam = async (bot: Bot, seen: Set<string>): Promise<Vec3 | null> => {
	const base = Math.random() * Math.PI * 2;
	const high = bot.entity.position.y > 80;
	for (let leg = 0; leg < 3; leg++) {
		const p = bot.entity.position;
		const a = base + (Math.random() - 0.5);
		const dy = high ? -18 : 0; // aim downhill from peaks
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

export const gatherFlint = async (bot: Bot, deadlineMs: number): Promise<void> => {
	const doneSeeds = new Set<string>();
	while (!findItem(bot, "flint") && Date.now() < deadlineMs) {
		if ((bot.health ?? 20) < 6) return;
		let seed = findBlocks(bot, "gravel", 110, 40)
			.filter((p) => !doneSeeds.has(key(p)))
			.map((p) => ({ p, d: distance(bot.entity.position, p) }))
			.sort((a, b) => a.d - b.d)[0]?.p;

		// Nothing visible → keep roaming to fresh terrain until the deadline (never
		// give up early while budget remains; a second pocket is usually reachable).
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
};

export const run = async (bot: Bot): Promise<StepResult> => {
	await bot.waitForChunksToLoad?.();
	const deadline = Date.now() + 92_000; // leave ~28s for table place + craft
	await gatherFlint(bot, deadline);

	if (!findItem(bot, "flint")) {
		return failure(`Need flint (gravel mined=${countItems(bot, "gravel")})`);
	}
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "flint_and_steel", 1, table);
};
