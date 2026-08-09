/**
 * Bucket tasks - filling water buckets
 */

import type { Bot } from "typecraft";
import { distance, offset, type Vec3, vec3, windowItems } from "typecraft";
import {
	exploreRandom,
	forgetResource,
	getMineEntry,
	getRememberedResource,
	goTo,
	interactReliably,
	returnToSurface,
	sleep,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { StepResult } from "../../types.ts";

/**
 * Fill an empty bucket with water.
 */
// Water blocks whose scoop failed (flowing/unreachable cave water). Persisted
// per-bot so the bot skips them on retries and cycles to a scoopable source —
// otherwise it loops on one bad block until the consecutive-failure abort kills
// it (this is what killed the first bot to reach the water step).
const failedWater = new WeakMap<Bot, Set<string>>();
const waterKey = (p: Vec3) => `${p.x},${p.y},${p.z}`;

export const fillWaterBucket = async (bot: Bot): Promise<StepResult> => {
	const bad = (p: Vec3): boolean =>
		failedWater.get(bot)?.has(waterKey(p)) ?? false;
	// Only TRUE SOURCE water (fluid level 0) fills a bucket — typecraft names FLOWING
	// water "water" too, and scooping a flowing tongue silently fails every attempt,
	// then the block gets blacklisted. Two race leaders (745, 751) reached water with a
	// bucket but never filled it because pickWater handed the scoop a flowing block.
	// Mirror the proven source-filter from the portal lava cast (cast.ts isSource):
	// source blocks have properties.level missing or "0". Prefer source + air-above.
	const isSource = (p: Vec3): boolean => {
		const lv = (
			bot.blockAt(p) as { properties?: { level?: unknown } } | null
		)?.properties?.level;
		return lv == null || String(lv) === "0";
	};
	// Prefer SURFACE ponds, never deep cave/aquifer water. When the bot (resurfaced to
	// ~sea level) scans for water, findBlocks also returns cave water 20+ blocks DOWN;
	// diving in to scoop it drops the bot into a 1-wide flooded pocket where the scoop
	// fails AND escapeWater can't climb out (`water_escape_failed_final`) — a hard drown-
	// trap that ended the best-ever run (race81/192: dove to y41 cave water, trapped).
	// Signals of a safe surface pond: SOURCE (level 0), real `air` (open sky) directly
	// above — not `cave_air` — and within a few blocks of the bot's own Y. If only deep
	// cave water is in range, return null so the caller escalates to the long-range hunt
	// for a real surface pond elsewhere, rather than diving into the aquifer.
	const pickWater = (list: Vec3[]): Vec3 | null => {
		const botY = bot.entity.position.y;
		const src = list.filter((p) => !bad(p) && isSource(p));
		const aboveName = (p: Vec3): string =>
			bot.blockAt(offset(p, 0, 1, 0))?.name ?? "";
		// Tier 1: open-sky surface pond near our level — the only truly safe scoop.
		const surface = src.filter(
			(p) => aboveName(p) === "air" && p.y >= botY - 5,
		);
		if (surface.length) return surface[0] ?? null;
		// Tier 2: air/cave_air above but still near our level (a shallow pool we won't
		// get trapped diving into). Excludes anything well below us.
		const shallow = src.filter((p) => {
			const a = aboveName(p);
			return (a === "air" || a === "cave_air") && p.y >= botY - 8;
		});
		if (shallow.length) return shallow[0] ?? null;
		// Only deep cave water in range — refuse it (drown-trap) and let the search escalate.
		return null;
	};
	const search = (dist: number, count: number): Vec3 | null =>
		pickWater(
			bot.findBlocks({ matching: (n) => n === "water", maxDistance: dist, count }),
		);

	let waterPos: Vec3 | null = null;

	// 1. If deep underground, surface FIRST. The only water within reach down here
	//    is flowing cave water that won't scoop (bots looped + drowned cycling
	//    through it) — ponds/rivers up top are scoopable source water.
	const entry = getMineEntry(bot);
	const yNow = bot.entity.position.y;
	// Surface first when deep: below the recorded mine entry, OR — when that memory
	// was wiped by a reconnect — simply well below sea level, where there's no
	// scoopable source water. returnToSurface now climbs even with no entry.
	if ((entry && yNow < entry.y - 6) || yNow < 52) {
		logEvent(
			"bucket",
			"return_surface",
			`for water, from y=${Math.floor(yNow)}`,
		);
		await returnToSurface(bot);
		waterPos = search(128, 100);
		for (let i = 0; i < 4 && !waterPos; i++) {
			logEvent("bucket", "exploring", `surface water ${i + 1}/4`);
			await exploreRandom(bot, 80);
			waterPos = search(128, 30);
		}
	}

	// 2. Water the bot already saw (blockSeen memory), if not blacklisted.
	if (!waterPos) {
		const remembered = getRememberedResource(bot, "water", true);
		if (remembered && !bad(vec3(remembered.x, remembered.y, remembered.z))) {
			const rb = bot.blockAt(vec3(remembered.x, remembered.y, remembered.z));
			if (rb && rb.name === "water")
				waterPos = vec3(remembered.x, remembered.y, remembered.z);
			else forgetResource(bot, "water", remembered);
		}
	}

	// 3. Anything currently in line-of-sight.
	if (!waterPos) waterPos = search(128, 200);

	// 4. Explore around the current level for more water.
	if (!waterPos) {
		for (let i = 0; i < 5; i++) {
			logEvent("bucket", "exploring", `looking for water ${i + 1}/5`);
			await exploreRandom(bot, 60);
			waterPos = search(128, 30);
			if (waterPos) break;
		}
	}

	// 4b. Long-range DIRECTIONAL hunt. The explore rounds above are short RANDOM walks
	//     (~60-80 blocks) that stay in the same area, so a water-scarce spawn loops
	//     "No water found" forever even when a lake sits 150-300 blocks away — the
	//     confirmed #1 bottleneck for smelted bots (race69/76 at -3936,5504: a bot with
	//     iron + bucket stuck 10-20 min at the water link, never relocating far enough).
	//     Commit to each cardinal + diagonal direction and travel FAR into fresh chunks,
	//     searching a wide radius at each leg. Mirrors gather-wood's long-relocate: turns
	//     an unwinnable dry pocket into a solvable hunt. goTo may only get partway on
	//     rough terrain, but even partial progress relocates us into new ground to scan.
	if (!waterPos) {
		const origin = bot.entity.position;
		const dirs: ReadonlyArray<readonly [number, number]> = [
			[1, 0],
			[0, 1],
			[-1, 0],
			[0, -1],
			[1, 1],
			[-1, -1],
			[1, -1],
			[-1, 1],
		];
		for (const [dx, dz] of dirs) {
			if (waterPos) break;
			for (let leg = 1; leg <= 2 && !waterPos; leg++) {
				const here = bot.entity.position;
				const target = vec3(
					Math.floor(here.x + dx * 140),
					Math.floor(here.y),
					Math.floor(here.z + dz * 140),
				);
				logEvent(
					"bucket",
					"long_hunt",
					`dir ${dx},${dz} leg ${leg} → ${target.x},${target.z}`,
				);
				await goTo(bot, target, { range: 8, timeout: 30000 }).catch(() => {});
				await bot.waitForChunksToLoad();
				waterPos = search(160, 300);
			}
		}
	}

	// 5. Recovery: every reachable source got blacklisted (5 failed scoops each) and
	//    no fresh water turned up — in a water-sparse biome that's a permanent
	//    deadlock (the bot loops "no water" forever). Clear the blacklist and retry
	//    the nearest source: the misses are usually positioning/flow-luck, not a
	//    truly unscoopable block, so a fresh approach often lands it.
	if (!waterPos) {
		const set = failedWater.get(bot);
		if (set && set.size > 0) {
			logEvent("bucket", "blacklist_reset", `clearing ${set.size} sources`);
			set.clear();
			waterPos =
				search(128, 200) ??
				(await (async () => {
					for (let i = 0; i < 3; i++) {
						await exploreRandom(bot, 60);
						const w = search(128, 30);
						if (w) return w;
					}
					return null;
				})());
		}
	}

	if (!waterPos) {
		return { success: false, message: "No water found nearby" };
	}

	logEvent(
		"bucket",
		"found_water",
		`at ${waterPos.x},${waterPos.y},${waterPos.z}`,
	);

	const bucket = windowItems(bot.inventory).find((i) => i.name === "bucket");
	if (!bucket) {
		return { success: false, message: "No empty bucket in inventory" };
	}

	// Navigate to stand directly above/next to water
	// Need to be within 1-2 blocks for reliable raytrace
	const aboveWater = vec3(waterPos.x + 0.5, waterPos.y + 1, waterPos.z + 0.5);
	const dist = distance(bot.entity.position, aboveWater);
	if (dist > 2) {
		await goTo(bot, aboveWater, { range: 1, timeout: 15000 });
	}

	try {
		// Equip bucket to hotbar and select
		const bucketSlot = bot.inventory.slots.findIndex(
			(s) => s?.name === "bucket",
		);
		if (bucketSlot < 0) return { success: false, message: "Bucket lost" };
		if (bucketSlot >= 36 && bucketSlot <= 44) {
			bot.setQuickBarSlot(bucketSlot - 36);
		} else {
			try {
				await bot.clickWindow(bucketSlot, 0, 0);
				await bot.clickWindow(36, 0, 0);
				bot.setQuickBarSlot(0);
			} catch {}
		}
		await sleep(300);

		// Use bucket on water — get into reach + face it + retry (the scoop lands
		// only ~70-85% per attempt, and the bot often ends up above/beside the pool
		// rather than in raytrace range).
		const filled = await interactReliably(bot, {
			target: waterPos,
			reach: 2.5,
			attempts: 5,
			settleMs: 1000,
			action: async () => {
				bot.activateItem();
				await sleep(900);
				try {
					bot.deactivateItem();
				} catch {
					/* ignore */
				}
				(bot as unknown as { usingHeldItem: boolean }).usingHeldItem = false;
			},
			verify: () =>
				windowItems(bot.inventory).some((i) => i.name === "water_bucket"),
		});
		if (filled) {
			logEvent("bucket", "filled", "water_bucket");
			return { success: true, message: "Filled water bucket" };
		}
		// This block won't scoop (flowing/awkward) — blacklist it so the retry
		// picks a different one instead of looping here until the abort.
		const set = failedWater.get(bot) ?? new Set<string>();
		set.add(waterKey(waterPos));
		failedWater.set(bot, set);
		logEvent("bucket", "scoop_blacklist", waterKey(waterPos));
		return { success: false, message: "Failed to fill bucket (trying another)" };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Failed to fill bucket",
		};
	}
};
