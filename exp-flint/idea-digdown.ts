/**
 * IDEA "digdown" — the human way to get flint with no gravel in sight.
 *
 * ROOT CAUSE the baseline can't beat: gravel is almost never EXPOSED within scan
 * range at a random surface spawn, and typecraft's findBlocks (correctly, no-X-ray)
 * only returns exposed + line-of-sight blocks. But a diagnostic probe shows nearly
 * every column has gravel somewhere in the ~40 blocks below the surface. So instead
 * of scanning, we DIG a shaft straight down and mine whatever gravel we tunnel
 * through — exactly what a human does. When we break into a gravel pocket we flood
 * out the connected gravel (a pocket is usually 6–20 blocks → plenty for the ~10%
 * flint roll). Digging straight down also means the drop lands in the hole we fall
 * into → auto-pickup, no chasing scattered drops.
 *
 * Non-X-ray: we only ever inspect blocks immediately around the shaft we are digging
 * (a human sees the exposed faces of the tunnel), never a global exposed:false scan.
 */
import type { Bot } from "typecraft";
import { distance, offset, vec3, type Vec3 } from "typecraft";
import {
	countItems,
	craftItem,
	failure,
	findItem,
	getBlock,
	getCraftingTable,
	goTo,
	moveCloser,
} from "../src/lib/steve/lib/bot-utils.ts";
import type { StepResult } from "../src/lib/steve/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HAZARD = new Set(["lava", "flowing_lava", "water", "flowing_water"]);
const isHazard = (n?: string) => !!n && HAZARD.has(n);
const isGravel = (n?: string) => n === "gravel";

/** Dig a block and try to collect its drop (auto-pickup handles most of it). */
const mineAt = async (bot: Bot, pos: Vec3): Promise<boolean> => {
	const blk = getBlock(bot, pos);
	if (!blk || blk.name === "air" || blk.name === "cave_air") return false;
	if (isHazard(blk.name)) return false;
	try {
		await bot.lookAt(offset(pos, 0.5, 0.5, 0.5), true);
		await bot.dig(blk as never);
	} catch {
		return false;
	}
	// Give falling gravel a moment to settle, then sweep nearby drops.
	await sleep(120);
	try {
		await (
			bot as never as {
				collectDrops: (n: number, ms: number, cb: (p: Vec3) => Promise<void>) => Promise<void>;
			}
		).collectDrops(4, 1800, async (p) => {
			await goTo(bot, p, { range: 1.3, timeout: 1800 });
		});
	} catch {}
	return true;
};

/** Flood-fill mine the gravel pocket connected to `seed` (bounded radius). */
const harvestPocket = async (bot: Bot, seed: Vec3): Promise<void> => {
	const seen = new Set<string>();
	const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
	const queue: Vec3[] = [seed];
	seen.add(key(seed));
	const R = 5; // only the local pocket around where we broke in
	while (queue.length && !findItem(bot, "flint")) {
		const pos = queue.shift();
		if (!pos) break;
		const blk = getBlock(bot, pos);
		if (!blk || !isGravel(blk.name)) continue;
		// Get in reach, then mine.
		if (distance(bot.entity.position, pos) > 3.2) {
			try {
				await moveCloser(bot, pos, { maxDistance: 3 });
			} catch {}
			if (distance(bot.entity.position, pos) > 4.5) {
				try {
					await goTo(bot, pos, { range: 2.5, timeout: 6000 });
				} catch {}
			}
		}
		await mineAt(bot, pos);
		// Enqueue gravel neighbors within the pocket bound.
		for (const [dx, dy, dz] of [
			[1, 0, 0],
			[-1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			[0, 0, 1],
			[0, 0, -1],
		] as const) {
			const np = vec3(pos.x + dx, pos.y + dy, pos.z + dz);
			if (seen.has(key(np))) continue;
			if (Math.abs(np.x - seed.x) > R || Math.abs(np.z - seed.z) > R || Math.abs(np.y - seed.y) > R)
				continue;
			seen.add(key(np));
			if (isGravel(getBlock(bot, np)?.name)) queue.push(np);
		}
	}
};

/** Scan the immediate tunnel walls (radius 2) for an exposed gravel face. */
const gravelNearby = (bot: Bot): Vec3 | null => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	let best: Vec3 | null = null;
	let bestD = Infinity;
	for (let dx = -2; dx <= 2; dx++)
		for (let dy = -2; dy <= 2; dy++)
			for (let dz = -2; dz <= 2; dz++) {
				const pos = vec3(fx + dx, fy + dy, fz + dz);
				if (!isGravel(getBlock(bot, pos)?.name)) continue;
				const d = dx * dx + dy * dy + dz * dz;
				if (d < bestD) {
					bestD = d;
					best = pos;
				}
			}
	return best;
};

export const gatherFlint = async (bot: Bot, deadlineMs: number): Promise<void> => {
	while (!findItem(bot, "flint") && Date.now() < deadlineMs) {
		// If gravel is exposed in the tunnel around us, harvest that pocket.
		const near = gravelNearby(bot);
		if (near) {
			await harvestPocket(bot, near);
			continue;
		}
		// Otherwise dig one step straight down — but never into lava/water.
		if ((bot.health ?? 20) < 8) break;
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		if (fy < 0) break; // deep enough; bail rather than risk the deeps
		const below = vec3(fx, fy - 1, fz);
		const below2 = vec3(fx, fy - 2, fz);
		const belowName = getBlock(bot, below)?.name;
		const below2Name = getBlock(bot, below2)?.name;
		if (isHazard(belowName) || isHazard(below2Name)) break; // lava/water under us
		if (belowName === "bedrock") break;
		if (belowName === "air" || belowName === "cave_air") {
			// Open cave under us — hop down carefully instead of hanging.
			try {
				await goTo(bot, below, { range: 1, timeout: 4000 });
			} catch {
				break;
			}
			continue;
		}
		const dug = await mineAt(bot, below);
		if (!dug) break;
		// Fall/step into the hole.
		await sleep(200);
	}
};

export const run = async (bot: Bot): Promise<StepResult> => {
	await bot.waitForChunksToLoad?.();
	const deadline = Date.now() + 100_000;
	await gatherFlint(bot, deadline);

	if (!findItem(bot, "flint")) {
		return failure(
			`Need flint (dug, gravel=${countItems(bot, "gravel")}, no flint)`,
		);
	}
	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "flint_and_steel", 1, table);
};
