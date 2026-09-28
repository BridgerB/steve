/**
 * Wood gathering task - find closest log, walk to it, mine it, pick it up, repeat.
 */

import type { Bot } from "typecraft";
import { createGoalNear, distance, offset, type Vec3, vec3 } from "typecraft";
import {
	digStaircaseUp,
	escapeWater,
	exploreRandom,
	getBlock,
	getMineEntry,
	getPathfinder,
	goTo,
	returnToSurface,
	sleep,
	surfaceYAt,
	throwIfPreempted,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { StepResult } from "../../types.ts";

const LOG_TYPES = [
	"oak_log",
	"birch_log",
	"spruce_log",
	"jungle_log",
	"acacia_log",
	"dark_oak_log",
	"mangrove_log",
	"cherry_log",
];

const isLogName = (name: string) => LOG_TYPES.includes(name);

const LEAF_TYPES = [
	"oak_leaves",
	"birch_leaves",
	"spruce_leaves",
	"jungle_leaves",
	"acacia_leaves",
	"dark_oak_leaves",
	"mangrove_leaves",
	"cherry_leaves",
	"azalea_leaves",
	"flowering_azalea_leaves",
];

const isLeafName = (name: string) => LEAF_TYPES.includes(name);

export const gatherWood = async (
	bot: Bot,
	targetCount: number,
): Promise<StepResult> => {
	// Wait for bot to be ready
	if (!bot.entity?.position) {
		await new Promise<void>((resolve) => {
			const check = () => {
				if (bot.entity?.position) resolve();
				else setTimeout(check, 100);
			};
			check();
		});
	}
	await bot.waitForChunksToLoad();
	await escapeWater(bot);

	const pf = getPathfinder(bot);

	// Build set of log item type IDs from registry
	const logItemIds = new Set<number>();
	if (bot.registry) {
		for (const logName of LOG_TYPES) {
			const def = bot.registry.itemsByName.get(logName);
			if (def) logItemIds.add(def.id);
		}
	}
	logEvent("wood", "log_ids", `ids=${[...logItemIds].join(",")}`);

	const countLogs = () => {
		let total = 0;
		for (const item of bot.inventory.slots) {
			if (item && item.count > 0) {
				// Check by name OR by type ID (name can be "unknown" due to registry timing)
				if (item.name.includes("_log") || logItemIds.has(item.type)) {
					total += item.count;
				}
			}
		}
		return total;
	};

	const botPos = () => bot.entity?.position ?? vec3(0, 64, 0);

	// True only if there's solid footing a couple blocks ahead in `yaw` — used to
	// stop the explore "long walk" from sprinting off a cliff or into a ravine,
	// which strands the bot deep underground with no trees and no way back up.
	const groundAhead = (yaw: number): boolean => {
		const p = bot.entity?.position;
		if (!p) return false;
		const fx = -Math.sin(yaw);
		const fz = Math.cos(yaw);
		const fy = Math.floor(p.y);
		const solid = (b: ReturnType<typeof getBlock>): boolean =>
			!!b &&
			b.name !== "air" &&
			b.name !== "cave_air" &&
			!b.name.includes("water") &&
			!b.name.includes("lava");
		// Check a couple steps out; each must have ground within 3 blocks below it.
		for (const ahead of [2, 3.5]) {
			const ax = Math.floor(p.x + fx * ahead);
			const az = Math.floor(p.z + fz * ahead);
			let footing = false;
			for (let dy = -1; dy >= -3; dy--) {
				if (solid(getBlock(bot, vec3(ax, fy + dy, az)))) {
					footing = true;
					break;
				}
			}
			if (!footing) return false; // 3+ block drop ahead = cliff/ravine edge
		}
		return true;
	};

	// Skip positions we already failed to reach
	const unreachable = new Set<string>();
	// Key by X,Z only — blacklist entire tree column, not individual blocks
	const posKey = (p: Vec3) => `${Math.floor(p.x)},${Math.floor(p.z)}`;

	// A tree whose trunk stands IN water (base block or its 4 neighbours are water)
	// can only be chopped from the pond — the bot walks in, the drown guard preempts,
	// it escapes, walks back in (race 582: 5 preempts on one shoreline oak). Skip it.
	const trunkInWater = (p: Vec3): boolean => {
		let y = Math.floor(p.y);
		const x = Math.floor(p.x);
		const z = Math.floor(p.z);
		// Walk down the log column to the trunk base.
		while (y > 0 && isLogName(getBlock(bot, vec3(x, y - 1, z))?.name ?? "")) y--;
		const cells: [number, number, number][] = [
			[x, y - 1, z],
			[x + 1, y, z],
			[x - 1, y, z],
			[x, y, z + 1],
			[x, y, z - 1],
			[x + 1, y - 1, z],
			[x - 1, y - 1, z],
			[x, y - 1, z + 1],
			[x, y - 1, z - 1],
		];
		return cells.some(([cx, cy, cz]) =>
			getBlock(bot, vec3(cx, cy, cz))?.name.includes("water"),
		);
	};

	// How far a log sits above the ground under it (logs and leaves don't count as
	// ground). Standing on that ground the bot can dig up to ~6 blocks up its own
	// column; anything higher needs pillaring, which the wood stage can't do.
	const logHeightAboveGround = (p: Vec3): number => {
		const x = Math.floor(p.x);
		const z = Math.floor(p.z);
		const top = Math.floor(p.y);
		for (let y = top - 1; y >= top - 12; y--) {
			const b = getBlock(bot, vec3(x, y, z));
			if (!b) return 99;
			const n = b.name;
			if (n === "air" || n === "cave_air" || isLogName(n) || isLeafName(n)) continue;
			return top - y;
		}
		return 99;
	};

	// Find the closest reachable log block
	const findClosestLog = (): { pos: Vec3; name: string } | null => {
		for (const radius of [16, 32, 48, 64]) {
			const positions = bot.findBlocks({
				matching: (name: string) => isLogName(name),
				maxDistance: radius,
				// exposed:false — the DEFAULT findBlocks applies a canSeeBlock() eye
				// line-of-sight filter that hills/canopy block, so a bot in a treeless
				// POCKET reports "no trees nearby" when trees are reachable just out of
				// LOS (the live cause of the treeless Gather-Wood timeout loop). Trees are
				// surface features (not X-ray-sensitive ore); reachability is still checked
				// by navigateTo + the unreachable blacklist below.
				exposed: false,
				count: 50,
			} as never);
			if (positions.length === 0) continue;

			const reachable = positions
				.filter((p) => !unreachable.has(posKey(p)))
				.filter((p) => !trunkInWater(p))
				.filter((p) => logHeightAboveGround(p) <= 6)
				// Nearest first, but a log high in a canopy costs extra: acacia/jungle
				// branch logs 5+ blocks up were picked by raw 3D distance, the walk-to
				// failed (nothing to stand on), and the bot burned 11s + a blacklist per
				// log before hopping away (race 586: 3 min on one savanna tree).
				.sort(
					(a, b) =>
						distance(botPos(), a) + logHeightAboveGround(a) * 2 -
						(distance(botPos(), b) + logHeightAboveGround(b) * 2),
				);

			for (const pos of reachable) {
				const block = getBlock(bot, pos);
				if (block) {
					logEvent(
						"wood",
						"found_tree",
						`${block.name} dist=${distance(botPos(), pos).toFixed(1)}`,
						pos,
					);
					return { pos, name: block.name };
				}
			}
		}
		return null;
	};

	// In a dense forest, findClosestLog's raycast can't pierce the canopy to reach
	// trunks — but the leaf blocks themselves are exposed and in line-of-sight, so
	// the bot CAN see them honestly. Walking to a visible leaf column puts a trunk
	// within point-blank range, where findClosestLog's raycast then succeeds.
	const findVisibleFoliage = (): Vec3 | null => {
		const positions = bot.findBlocks({
			matching: (name: string) => isLeafName(name),
			maxDistance: 48,
			count: 40,
		});
		const reachable = positions
			.filter((p) => !unreachable.has(posKey(p)))
			.sort((a, b) => distance(botPos(), a) - distance(botPos(), b));
		return reachable[0] ?? null;
	};

	// Navigate to a position
	const navigateTo = async (target: Vec3): Promise<boolean> => {
		if (!bot.entity?.position) return false;
		const dist = distance(botPos(), target);
		if (dist <= 5) return true;

		const goal = createGoalNear(target.x, target.y, target.z, 3);
		pf.setGoal(goal);
		logEvent("wood", "nav_start", `dist=${dist.toFixed(1)}`, botPos());

		// Scale with distance — a fixed 15s can't reach a tree 100+ blocks away,
		// so the bot blacklists reachable trees and starves next to a forest.
		const timeout = Math.min(45000, 10000 + dist * 250);
		const start = Date.now();
		let lastDist = dist;
		let stuckTicks = 0;

		while (Date.now() - start < timeout) {
			await sleep(250);
			if (!bot.entity?.position) {
				pf.stop();
				return false;
			}

			const currentDist = distance(botPos(), target);
			if (currentDist <= 5) {
				pf.stop();
				return true;
			}

			// Water escape
			if (bot.entity.isInWater) {
				pf.stop();
				await escapeWater(bot);
				pf.setGoal(goal);
				stuckTicks = 0;
				lastDist = distance(botPos(), target);
				continue;
			}

			// Stuck detection
			if (Math.abs(currentDist - lastDist) < 0.2) {
				stuckTicks++;
			} else {
				stuckTicks = 0;
			}
			lastDist = currentDist;

			if (stuckTicks >= 10) {
				logEvent(
					"wood",
					"nav_stuck",
					`dist=${currentDist.toFixed(1)} after ${stuckTicks} ticks`,
				);
				pf.stop();
				// Raw walk fallback
				await bot.lookAt(target);
				bot.setControlState("forward", true);
				bot.setControlState("jump", true);
				await sleep(3000);
				bot.setControlState("forward", false);
				bot.setControlState("jump", false);
				return distance(botPos(), target) <= 5;
			}

			if (!pf.isMoving() && stuckTicks >= 3) {
				pf.setGoal(goal);
				stuckTicks = 0;
			}
		}

		pf.stop();
		return distance(botPos(), target) <= 5;
	};

	// Mine a single block
	const mineBlock = async (pos: Vec3, _blockName: string): Promise<boolean> => {
		const blockCenter = offset(pos, 0.5, 0.5, 0.5);
		let dist = distance(botPos(), blockCenter);

		// Walk closer if needed
		if (dist > 4.5) {
			await bot.lookAt(blockCenter);
			bot.setControlState("forward", true);
			bot.setControlState("jump", true);
			await sleep(Math.min(dist * 300, 3000));
			bot.setControlState("forward", false);
			bot.setControlState("jump", false);
			await sleep(200);
			dist = distance(botPos(), blockCenter);
			if (dist > 4.5) return false;
		}

		const block = getBlock(bot, pos);
		if (!block || !isLogName(block.name)) return true; // already gone

		await bot.lookAt(blockCenter);

		logEvent("wood", "dig_start", `${block.name} dist=${dist.toFixed(1)}`, pos);
		const logsBefore = countLogs();
		throwIfPreempted();

		try {
			await Promise.race([
				bot.dig(block, true),
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error("dig timeout")), 5000),
				),
			]);
			logEvent("wood", "dig_done", block.name, pos);
		} catch (e) {
			const msg = String(e instanceof Error ? e.message : e);
			logEvent("wood", "dig_error", msg, pos);
			bot.stopDigging();
			return msg === "dig timeout"; // timeout = block probably broke, continue
		}

		// Navigate to dropped item for pickup, then stand on the stump to vacuum
		// logs that fell to the ground (upper-trunk drops often land below).
		await bot.collectDrops(6, 3000, async (p) => {
			await goTo(bot, p, { range: 1.4, timeout: 3000 });
		});
		await goTo(bot, pos, { range: 1, timeout: 3000 }).catch(() => {});
		await bot.collectDrops(8, 2500, async (p) => {
			await goTo(bot, p, { range: 1.2, timeout: 2500 });
		});

		const logsNow = countLogs();
		if (logsNow > logsBefore) {
			logEvent("wood", "pickup_ok", `${logsBefore} → ${logsNow}`, pos);
		} else {
			logEvent(
				"wood",
				"pickup_miss",
				`dug but didn't collect (${logsNow} logs)`,
				pos,
			);
		}

		return true;
	};

	// If we're down in a mine with no trees in sight, climb back up the staircase
	// to the surface first — there are no trees underground. Resumable: if we
	// haven't reached the top yet, return and let the step retry.
	// Climb to the surface for wood when we're underground with no tree in sight —
	// there are none down here. Trigger even with NO recorded mine entry: a reconnect
	// wipes the entry, and without this the bot explores HORIZONTALLY at mining depth
	// forever ("no trees nearby") and never gets wood (the live deep-mine deadlock).
	// returnToSurface climbs to the LOCAL surface when the entry is gone; pillarUp
	// falls back to a sea-level-ish target.
	const entry = getMineEntry(bot);
	const p0 = botPos();
	const localSurface = surfaceYAt(bot, Math.floor(p0.x), Math.floor(p0.z));
	const surfaceY = entry ? entry.y : Math.max(localSurface, 64);
	// Trigger on being UNDERGROUND, full stop. The old gate also required "no tree
	// in sight" — but findClosestLog sees logs through rock (exposed:false), so a
	// bot in its own 5-deep stone hole (y58, trees at y63) or a mine at y28 "found"
	// a tree 40 blocks away, tried to walk to it, nav_stuck → blacklist → relocate
	// for the whole step (race 616/617/619: 3 of 4 bots parked on Gather Wood).
	// "Underground" is geometric, not "below the column-scan surface": a jungle
	// canopy put that surface 8 blocks over a bot standing on grass (race 620/621
	// looped "Returning to surface (y=76 → 84)"). Either boxed in rock on all four
	// sides at feet+head (a 1-wide hole / shaft), or well below the surface with a
	// rock ceiling overhead (a mine).
	const earth = /stone|dirt|grass_block|gravel|sand|deepslate|andesite|diorite|granite|tuff|clay|terracotta|_ore|obsidian|podzol|mycelium|calcite|dripstone|moss_block|mud|packed_mud/;
	const isEarth = (dx: number, dy: number, dz: number): boolean =>
		earth.test(getBlock(bot, vec3(Math.floor(p0.x) + dx, Math.floor(p0.y) + dy, Math.floor(p0.z) + dz))?.name ?? "");
	const boxed = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => isEarth(dx!, 0, dz!) && isEarth(dx!, 1, dz!));
	const ceiling = [2, 3, 4, 5, 6, 7, 8].some((dy) => isEarth(0, dy, 0));
	const deep = localSurface - p0.y >= 6 && ceiling;
	if (boxed || deep) {
		// The pit's own column tops out at our feet, so its "surface" IS our y; the
		// rim is the neighbours' surface. And never hand a sealed pit to the
		// pathfinder: A* from a boxed cell is an exhaustive synchronous search that
		// froze the process ~20s and got the bot kicked (race 635, 3× in a row).
		const rim = Math.max(
			localSurface,
			...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) =>
				surfaceYAt(bot, Math.floor(p0.x) + dx!, Math.floor(p0.z) + dz!),
			),
		);
		logEvent("wood", "underground", `boxed=${boxed} deep=${deep} y=${Math.floor(p0.y)} surface=${localSurface} rim=${rim}`);
		let reached = false;
		if (boxed) {
			const { pillarUp } = await import("../portal/cast.ts");
			reached = await pillarUp(bot, rim);
			bot.setControlState("sneak", false);
		} else {
			reached = await returnToSurface(bot);
		}
		if (!reached) {
			// The pathfinder can't climb the staircase back up (deep mines defeat
			// it) — so dig/pillar straight up to the surface instead. Digging the
			// ceiling yields the cobble it re-places, so it's self-sustaining.
			const { pillarUp } = await import("../portal/cast.ts");
			reached = await pillarUp(bot, rim); // straight up THIS column to the rim
			bot.setControlState("sneak", false); // pillarUp leaves it on for the cast
		}
		if (!reached) {
			return {
				success: false,
				message: `Returning to surface for wood (y=${Math.floor(botPos().y)} → ${surfaceY})`,
			};
		}
	}

	// ── MAIN LOOP ──

	logEvent("wood", "start", `gathering ${targetCount} logs`);
	const startLogs = countLogs();
	const huntStart = botPos();
	let attempts = 0;
	let blocksDug = 0;
	// Consecutive trees blacklisted as unreachable without reaching one. findClosestLog
	// keeps returning fresh (farther, also-unreachable) trees in a forest across a
	// water/ravine barrier, so the "no trees → relocate + clear blacklist" branch never
	// fires and the bot blacklists trees in place forever (race59/775: 20 min looping on
	// trees at dist 23→27, furnace in hand, never getting wood for fuel). Force a physical
	// relocation once we've failed to reach several in a row so blacklist-recovery kicks in.
	let consecutiveFails = 0;
	// Successive relocations must reach FARTHER each time. A single fixed 30-block hop
	// leaves the same scattered/barrier-locked trees (dist 26-34) as the nearest, still
	// unreachable, so the bot re-blacklists them and spins (race105/106/110: relocate_stuck
	// fires but 30 blocks isn't enough to clear the pocket). Escalate 60→90→120→…→150.
	let relocateCount = 0;
	let climbOuts = 0; // pillar-out-of-a-pit attempts this step
	let exploreAngle = Math.random() * Math.PI * 2;

	while (
		countLogs() < targetCount &&
		attempts < 50 &&
		blocksDug < targetCount * 3
	) {
		attempts++;
		throwIfPreempted(); // displaced by a preempt/timeout/death → unwind

		const target = findClosestLog();
		if (!target) {
			// Check memory for remembered log positions
			const { getRememberedResource, forgetResource } = await import(
				"../../lib/bot-utils.ts"
			);
			let memTarget: { pos: Vec3; name: string } | null = null;
			for (const logType of LOG_TYPES) {
				const remembered = getRememberedResource(bot, logType);
				if (remembered && !unreachable.has(posKey(remembered))) {
					memTarget = { pos: remembered, name: logType };
					break;
				}
			}

			if (memTarget) {
				logEvent(
					"wood",
					"explore_memory",
					`remembered ${memTarget.name} dist=${distance(botPos(), memTarget.pos).toFixed(0)}`,
				);
				const reached = await navigateTo(memTarget.pos);
				if (reached && findClosestLog()) continue; // at a real log — mine it next loop
				// Couldn't reach it (nav_stuck across a ravine/water barrier) or the memory
				// was stale. Blacklist + forget, then FALL THROUGH to exploration so we
				// physically relocate. Retrying MORE remembered logs at the same distance
				// behind the SAME barrier just blacklists one tree column at a time forever
				// (observed: 30 min stuck re-picking logs at dist 29 that never get closer).
				unreachable.add(posKey(memTarget.pos));
				forgetResource(bot, memTarget.name, memTarget.pos);
				if (reached)
					logEvent(
						"wood",
						"stale_memory",
						`${memTarget.name} no longer at remembered position`,
					);
			}

			// Head toward visible leaf canopy — trees are under it. This turns a
			// blind random walk into a directed approach, so a bot standing in a
			// forest reaches a trunk in seconds instead of timing out.
			const foliage = findVisibleFoliage();
			if (foliage) {
				logEvent(
					"wood",
					"explore_foliage",
					`leaves dist=${distance(botPos(), foliage).toFixed(0)}`,
					foliage,
				);
				// Target the canopy's column at ground level, not the elevated leaf.
				await navigateTo(vec3(foliage.x, botPos().y, foliage.z));
				if (findClosestLog()) continue;
				// Reached the canopy but still no trunk in raycast — blacklist this
				// column so we don't oscillate back, then fall through to a walk.
				unreachable.add(posKey(foliage));
			}

			// Walk in a consistent direction for longer to load new chunks — but check
			// the ground ahead every step so we DON'T sprint off a cliff or into a
			// ravine. If it drops away ahead, veer instead of walking off the edge.
			logEvent("wood", "explore", "no trees nearby — long walk");
			await bot.look(exploreAngle, 0);
			for (let i = 0; i < 32; i++) {
				if (!groundAhead(exploreAngle)) {
					bot.setControlState("forward", false);
					bot.setControlState("sprint", false);
					exploreAngle += Math.PI * 0.5; // turn away from the edge
					await bot.look(exploreAngle, 0);
					await sleep(150);
					continue;
				}
				bot.setControlState("forward", true);
				bot.setControlState("sprint", true);
				await sleep(250);
				if (findClosestLog()) break;
				if (i % 8 === 0) {
					bot.setControlState("jump", true);
					await sleep(100);
					bot.setControlState("jump", false);
				}
			}
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
			await bot.waitForChunksToLoad();
			exploreAngle += Math.PI * 0.3;
			// We just physically relocated (~30 blocks). Trees blacklisted as
			// "unreachable" were unreachable FROM THE OLD SPOT — across a ravine/water
			// barrier. From here they may be reachable, so clear the blacklist and let
			// the next iteration re-try them. Without this a bot with 8 ingots but no
			// wood for the buckets' table blacklists every tree in a forest at dist ~52
			// and starves at the record frontier (race39/322). Mirrors the water-scoop
			// blacklist-recovery.
			unreachable.clear();
			continue;
		}

		const reached = await navigateTo(target.pos);
		if (!reached) {
			// Can't reach a tree AND we're below the local surface → we're in a pit
			// (the dig-down hole opening into a side tunnel defeats the geometric
			// "boxed" test: race 624 blacklisted tree after tree from y62 with the
			// surface at y66). Pillar straight up before blaming the tree.
			const here = botPos();
			const hx = Math.floor(here.x);
			const hz = Math.floor(here.z);
			// Rim = highest surface of this column and its 4 neighbours (in a pit the
			// own column tops out at our feet, which would read as "on the surface").
			const surf = Math.max(
				...[[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => surfaceYAt(bot, hx + dx!, hz + dz!)),
			);
			if (here.y < surf - 1 && climbOuts < 3) {
				climbOuts++;
				logEvent("wood", "climb_out", `nav_stuck at y=${Math.floor(here.y)}, surface y=${surf}`, here);
				const { pillarUp } = await import("../portal/cast.ts");
				let up = await pillarUp(bot, surf);
				bot.setControlState("sneak", false);
				// No blocks to pillar with (race 643 came out of its mine with 8 ingots
				// and no cobble, into a valley 10 below the trees): dig a staircase up
				// the slope instead — it yields the cobble as it goes.
				if (!up) {
					const got = await digStaircaseUp(bot, surf, Date.now() + 40000);
					up = got >= surf - 1;
					logEvent("wood", "climb_out_stairs", `reached y=${got} (target ${surf})`, botPos());
				}
				if (up) continue; // try the same tree from the surface
			}
			unreachable.add(posKey(target.pos));
			consecutiveFails++;
			logEvent(
				"wood",
				"blacklist",
				`${target.name} at ${posKey(target.pos)}`,
				target.pos,
			);
			// Every nearby tree is behind the same barrier — stop blacklisting them one
			// by one from the same spot and physically relocate, then clear the blacklist
			// so the trees (unreachable from HERE) get re-tried from the new position.
			if (consecutiveFails >= 4) {
				relocateCount++;
				const hop = Math.min(30 + relocateCount * 30, 150);
				logEvent(
					"wood",
					"relocate_stuck",
					`${consecutiveFails} unreachable in a row → hop ${hop}`,
				);
				await exploreRandom(bot, hop);
				await bot.waitForChunksToLoad();
				unreachable.clear();
				consecutiveFails = 0;
			}
			continue;
		}
		consecutiveFails = 0;
		relocateCount = 0; // reached a tree — reset the escalating-hop distance

		const dug = await mineBlock(target.pos, target.name);
		if (dug) blocksDug++;
		else unreachable.add(posKey(target.pos)); // couldn't reach/mine — don't loop on it
	}

	const logs = countLogs();
	logEvent("wood", "done", `${logs}/${targetCount} logs`);
	// Count "collected at least one more log" or "relocated while hunting" as
	// progress, so a bot slowly working toward a distant forest doesn't trip the
	// consecutive-failure abort before it gets there.
	const progressed = logs > startLogs || distance(huntStart, botPos()) > 25;
	return {
		success: logs >= targetCount || progressed,
		message: `Gathered ${logs}/${targetCount} logs`,
	};
};
