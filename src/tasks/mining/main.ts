/**
 * Mining tasks - dig blocks underground
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3 } from "typecraft";
import {
	craftItem,
	digExposesLava,
	dropColumnLavaFree,
	equipItem,
	escapeWater,
	exploreRandom,
	findBlock,
	forgetResource,
	getCraftingTable,
	getMineEntry,
	getRememberedResource,
	goTo,
	moveCloser,
	rememberMineEntry,
	returnToSurface,
	sleep,
	success,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { Block, StepResult } from "../../types.ts";

/** Dig with timeout — bot.dig() can hang silently */
const safeDig = async (
	bot: Bot,
	block: Block,
	timeout = 8000,
): Promise<void> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			bot.dig(block),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("dig timeout")), timeout);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

// Ores that live deep underground — reached by staircasing down to their band
// and strip-mining, rather than wandering the surface.
const DEEP_ORE_LEVEL: Record<string, number> = {
	iron_ore: 14,
	deepslate_iron_ore: 14,
	coal_ore: 50,
	deepslate_coal_ore: 15,
	copper_ore: 48,
	gold_ore: -16,
	deepslate_gold_ore: -16,
	redstone_ore: -58,
	deepslate_redstone_ore: -58,
	lapis_ore: -1,
	deepslate_lapis_ore: -1,
	diamond_ore: -59,
	deepslate_diamond_ore: -59,
};

// What each ore block actually drops, so progress is measured by items COLLECTED
// in the pack (which the step's isComplete checks), not by blocks dug — a block
// dug whose drop fell in lava must not count toward the target.
const DROP_ITEM: Record<string, string> = {
	iron_ore: "raw_iron",
	deepslate_iron_ore: "raw_iron",
	coal_ore: "coal",
	deepslate_coal_ore: "coal",
	copper_ore: "raw_copper",
	gold_ore: "raw_gold",
	deepslate_gold_ore: "raw_gold",
	redstone_ore: "redstone",
	deepslate_redstone_ore: "redstone",
	lapis_ore: "lapis_lazuli",
	deepslate_lapis_ore: "lapis_lazuli",
	diamond_ore: "diamond",
	deepslate_diamond_ore: "diamond",
};

const isAir = (b: Block | null): boolean =>
	!b || b.name === "air" || b.name === "cave_air";
const isLava = (b: Block | null): boolean => !!b && b.name.includes("lava");
const isLiquid = (b: Block | null): boolean =>
	!!b && (b.name.includes("water") || b.name.includes("lava"));

const lookDig = async (bot: Bot, b: Block | null): Promise<boolean> => {
	if (isAir(b)) return false;
	if (isLiquid(b)) return false;
	// Refuse to break a block that would let lava flow onto us (lava behind/above).
	if (digExposesLava(bot, (b as Block).position)) return false;
	try {
		await bot.lookAt(offset((b as Block).position, 0.5, 0.5, 0.5));
		await safeDig(bot, b as Block);
		return true;
	} catch {
		return false;
	}
};

const STONE_PLUS_PICKS = new Set([
	"netherite_pickaxe",
	"diamond_pickaxe",
	"iron_pickaxe",
	"stone_pickaxe",
]);

const invCount = (bot: Bot, sub: string): number =>
	bot.inventory.slots
		.filter((s) => s?.name.includes(sub))
		.reduce((a, s) => a + (s as { count: number }).count, 0);

/**
 * Ensure a stone-or-better pickaxe is in hand — iron ore mined with a lesser
 * tool (or bare hand) drops NOTHING. If the bot has worn through all its
 * pickaxes, craft a fresh stone one from cobblestone + sticks, so a deep mine
 * stays self-sustaining.
 */
const ensurePickaxe = async (bot: Bot): Promise<boolean> => {
	const findPick = () =>
		bot.inventory.slots.find((s) => s && STONE_PLUS_PICKS.has(s.name));
	let pick = findPick();
	if (pick) {
		if (!bot.heldItem?.name.endsWith("_pickaxe")) {
			await equipItem(bot, pick.name, "hand");
		}
		return true;
	}
	// None left — craft a stone pickaxe (3 cobblestone + 2 sticks, needs a table)
	if (invCount(bot, "cobblestone") < 3) return false;
	if (invCount(bot, "stick") < 2 && invCount(bot, "planks") >= 2) {
		await craftItem(bot, "stick", 1);
	}
	if (invCount(bot, "stick") < 2) return false;
	const table = await getCraftingTable(bot);
	if (!table) return false;
	await craftItem(bot, "stone_pickaxe", 1, table);
	pick = findPick();
	if (pick) {
		await equipItem(bot, pick.name, "hand");
		return true;
	}
	return false;
};

const HORIZ_DIRS: [number, number][] = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

/**
 * Dig a safe 2-high descending staircase toward targetY. Never digs the block
 * directly under the bot's feet (avoids blind drops); checks for lava and big
 * drops before each step, and re-routes if it walls into lava or gets stuck.
 * Resumable: makes progress and returns; the caller can call again next tick.
 */
export const descendStaircase = async (
	bot: Bot,
	targetY: number,
	deadline: number,
): Promise<{ y: number; stopped: string | null }> => {
	const B = (x: number, y: number, z: number) => bot.blockAt(vec3(x, y, z));
	let dir = pickDigDir(bot);
	let stuck = 0;

	while (
		Math.floor(bot.entity.position.y) > targetY &&
		Date.now() < deadline
	) {
		if ((bot.health ?? 20) < 8) return { y: floorY(bot), stopped: "low health" };
		if (!bot.heldItem?.name.endsWith("_pickaxe")) await ensurePickaxe(bot);
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const [dx, dz] = dir;
		const nx = fx + dx;
		const nz = fz + dz;

		const newHeadUp = B(nx, fy + 1, nz);
		const newHead = B(nx, fy, nz);
		const newFeet = B(nx, fy - 1, nz);
		const newFloor = B(nx, fy - 2, nz);
		const newFloor2 = B(nx, fy - 3, nz);

		// Hazard: lava anywhere in the step we're about to open
		if ([newHeadUp, newHead, newFeet, newFloor, newFloor2].some(isLava)) {
			dir = rotate(dir);
			if (++stuck > 4) return { y: floorY(bot), stopped: "boxed in by lava" };
			continue;
		}
		// Drop ahead: small drops are fine — step/fall down through caves. But
		// never drop into a column with lava below it, and reroute around a deep
		// drop (fall damage).
		if (isAir(newFloor)) {
			if (!dropColumnLavaFree(bot, nx, fy - 2, nz)) {
				dir = rotate(dir);
				if (++stuck > 5) return { y: floorY(bot), stopped: "lava below drop" };
				continue;
			}
			let depth = 1;
			while (depth < 5 && isAir(B(nx, fy - 2 - depth, nz))) depth++;
			if (depth >= 4) {
				dir = rotate(dir);
				if (++stuck > 5) return { y: floorY(bot), stopped: "boxed by drops" };
				continue;
			}
		}

		// Clear the diagonal step (head-up for clearance, head, feet)
		await lookDig(bot, newHeadUp);
		await lookDig(bot, newHead);
		await lookDig(bot, newFeet);

		// Walk forward + down into the cleared step
		await bot.lookAt(vec3(p.x + dx, p.y - 0.5, p.z + dz));
		bot.setControlState("forward", true);
		await sleep(450);
		bot.setControlState("forward", false);
		await sleep(350);

		const np = bot.entity.position;
		const moved = Math.floor(np.x) !== fx || Math.floor(np.z) !== fz;
		const descended = Math.floor(np.y) < fy;
		if (moved || descended) {
			stuck = 0;
		} else {
			// Re-dig and nudge; rotate direction after repeated failure
			await lookDig(bot, B(nx, fy - 1, nz));
			await lookDig(bot, B(nx, fy, nz));
			bot.setControlState("forward", true);
			await sleep(500);
			bot.setControlState("forward", false);
			await sleep(250);
			if (
				Math.floor(bot.entity.position.x) === fx &&
				Math.floor(bot.entity.position.z) === fz
			) {
				dir = rotate(dir);
				if (++stuck > 6) return { y: floorY(bot), stopped: "stuck" };
			}
		}
	}
	return { y: floorY(bot), stopped: null };
};

const floorY = (bot: Bot): number => Math.floor(bot.entity.position.y);
const rotate = (d: [number, number]): [number, number] => [d[1], -d[0]];

/** Pick a horizontal dig direction with solid ground ahead and no lava. */
const pickDigDir = (bot: Bot): [number, number] => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	let best: [number, number] = HORIZ_DIRS[0] ?? [1, 0];
	let bestScore = -1;
	for (const [dx, dz] of HORIZ_DIRS) {
		let solid = 0;
		let bad = false;
		for (let i = 1; i <= 4; i++) {
			const b = bot.blockAt(vec3(fx + dx * i, fy - 1, fz + dz * i));
			if (isLava(b)) bad = true;
			if (b && !isAir(b)) solid++;
		}
		if (!bad && solid > bestScore) {
			bestScore = solid;
			best = [dx, dz];
		}
	}
	return best;
};

const BRANCH_SPACING = 2; // dig side branches every N blocks of main tunnel
const BRANCH_LEN = 6; // length of each side branch

/**
 * Branch-mine at the current Y to find ore the no-X-ray way: dig a 1x2 main
 * tunnel and, every few blocks, perpendicular side branches — exposing a dense
 * grid of walls. Digging each cell makes its neighbours exposed, so typecraft
 * fires `blockSeen` for watched ores → memory → `mineNearbyOre` harvests them
 * while the bot is adjacent. Nothing is found through walls; ore is only mined
 * once physically uncovered. Returns blocks of ore mined and tunnel cells dug
 * (the latter so a productive-but-oreless call still counts as progress).
 */
const branchMineOre = async (
	bot: Bot,
	blockType: string,
	isTarget: (name: string) => boolean,
	targetCount: number,
	level: number,
	dropItem: string,
	deadline: number,
): Promise<{ mined: number; dug: number }> => {
	let mined = 0;
	let dug = 0;
	let dir = pickDigDir(bot);
	// Progress is the drop item actually in the pack, not blocks dug.
	const have = () => invCount(bot, dropItem);

	const mineNearbyOre = async (): Promise<boolean> => {
		// Prefer remembered ore (blockSeen), then a wider scan
		let ore: Block | null = null;
		let fromMem = false;
		const rem = getRememberedResource(bot, blockType);
		if (rem) {
			const rb = bot.blockAt(vec3(rem.x, rem.y, rem.z));
			if (rb && isTarget(rb.name)) {
				ore = rb;
				fromMem = true;
			} else forgetResource(bot, blockType, rem);
		}
		if (!ore) ore = findBlock(bot, isTarget, 20);
		if (!ore) return false;
		// Stay at the ore band — never chase ore down into deep caves/lava where the
		// drop falls in lava and is lost. Skip (and forget) anything well below it.
		if (level > 0 && ore.position.y < level - 2) {
			if (fromMem) forgetResource(bot, blockType, ore.position);
			return false;
		}
		try {
			if (distance(bot.entity.position, ore.position) > 3.5) {
				await goTo(bot, ore.position, { range: 2, timeout: 12000 });
			} else {
				await moveCloser(bot, ore.position, { maxDistance: 2 });
			}
			// Only mine ore we actually reached — digging from afar (goTo failed to
			// path through tunnel walls) spawns the drop out of pickup range, so the
			// counter rises but nothing is collected.
			if (distance(bot.entity.position, ore.position) > 4.5) return false;
			const above = bot.blockAt(offset(ore.position, 0, 1, 0)) as Block | null;
			if (above && !isAir(above) && !isLiquid(above)) await lookDig(bot, above);
			if (await lookDig(bot, ore)) {
				mined++;
				logEvent("mine", "ore", `${blockType} ${mined}/${targetCount}`);
				await bot.collectDrops(8, 4000, async (pp) => {
					await goTo(bot, pp, { range: 1, timeout: 3000 });
				});
				// Fallback: stand on the mined spot to vacuum a drop collectDrops missed.
				await goTo(bot, ore.position, { range: 1, timeout: 3000 }).catch(() => {});
				return true;
			}
		} catch {}
		return false;
	};

	// Dig one 1x2 step in (dx,dz) and walk into it. Refuses to open a cell that
	// touches lava (or would let lava flow in). Returns the outcome.
	const digStep = async (
		dx: number,
		dz: number,
	): Promise<"ok" | "lava" | "water" | "stuck"> => {
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const head = bot.blockAt(vec3(fx + dx, fy + 1, fz + dz));
		const feet = bot.blockAt(vec3(fx + dx, fy, fz + dz));
		const floor = bot.blockAt(vec3(fx + dx, fy - 1, fz + dz));
		if ([head, feet, floor].some(isLava)) return "lava";
		if (digExposesLava(bot, vec3(fx + dx, fy, fz + dz))) return "lava";
		// Avoid water too: digging into or beside it floods the 1-wide tunnel and
		// drowns the bot. Check the target cells + their 6 neighbors for water.
		const touchesWater = (cx: number, cy: number, cz: number): boolean =>
			(
				[
					[1, 0, 0],
					[-1, 0, 0],
					[0, 1, 0],
					[0, -1, 0],
					[0, 0, 1],
					[0, 0, -1],
				] as const
			).some((o) => {
				const b = bot.blockAt(vec3(cx + o[0], cy + o[1], cz + o[2]));
				return !!b && b.name.includes("water");
			});
		if (
			[head, feet, floor].some((b) => !!b && b.name.includes("water")) ||
			touchesWater(fx + dx, fy, fz + dz) ||
			touchesWater(fx + dx, fy + 1, fz + dz)
		)
			return "water";
		await lookDig(bot, head);
		await lookDig(bot, feet);
		await bot.lookAt(vec3(p.x + dx, p.y, p.z + dz));
		bot.setControlState("forward", true);
		await sleep(400);
		bot.setControlState("forward", false);
		await sleep(200);
		if (
			Math.floor(bot.entity.position.x) === fx &&
			Math.floor(bot.entity.position.z) === fz
		)
			return "stuck";
		dug++;
		return "ok";
	};

	// Dig a side branch (harvesting ore each cell), then walk back out through the
	// cleared branch to the main spine. A branch that meets lava simply stops.
	const digBranch = async (perp: [number, number]): Promise<void> => {
		let depth = 0;
		for (
			let i = 0;
			i < BRANCH_LEN && have() < targetCount && Date.now() < deadline;
			i++
		) {
			if (await mineNearbyOre()) continue;
			const r = await digStep(perp[0], perp[1]);
			if (r !== "ok") break;
			depth++;
			await mineNearbyOre();
		}
		// Retreat through the now-clear branch back toward the spine (no digging —
		// just walk, far more reliable than pathfinding a fresh 1-wide tunnel).
		for (let i = 0; i < depth; i++) {
			const p = bot.entity.position;
			await bot.lookAt(vec3(p.x - perp[0], p.y, p.z - perp[1]));
			bot.setControlState("forward", true);
			await sleep(350);
			bot.setControlState("forward", false);
			await sleep(150);
		}
	};

	let sinceBranch = 0;
	while (have() < targetCount && Date.now() < deadline) {
		if ((bot.health ?? 20) < 7) return { mined, dug };
		await ensurePickaxe(bot);
		// First, grab any exposed ore around us
		if (await mineNearbyOre()) continue;

		// Every BRANCH_SPACING blocks of main tunnel, branch out both sides to
		// expose the walls between branches.
		if (sinceBranch >= BRANCH_SPACING) {
			const perp: [number, number] = [dir[1], -dir[0]];
			await digBranch(perp);
			await digBranch([-perp[0], -perp[1]]);
			sinceBranch = 0;
			continue;
		}

		// Advance the main 1x2 tunnel one block to push into fresh ground.
		const r = await digStep(dir[0], dir[1]);
		if (r === "ok") sinceBranch++;
		else dir = rotate(dir); // lava or stuck — turn and try another heading
	}
	return { mined, dug };
};

/**
 * Branch-mine purely to expose walls (no ore target) until the deadline — used
 * to legitimately uncover cave lava for line-of-sight finding without X-ray.
 */
export const branchMineExplore = async (
	bot: Bot,
	deadline: number,
): Promise<void> => {
	await branchMineOre(bot, "__explore__", () => false, Number.MAX_SAFE_INTEGER, 0, "__none__", deadline);
};

/**
 * Full deep-ore collection: descend to the ore's band, then strip-mine until we
 * have enough. Designed to be called repeatedly (resumable) — each call digs
 * for up to `deadline`, then returns progress.
 */
const mineDeepOre = async (
	bot: Bot,
	blockType: string,
	isTarget: (name: string) => boolean,
	targetCount: number,
	deadline: number,
): Promise<StepResult> => {
	const level = DEEP_ORE_LEVEL[blockType] ?? 15;
	const dropItem = DROP_ITEM[blockType] ?? blockType;
	await ensurePickaxe(bot);

	// Remember where we entered (the highest point = the surface staircase top),
	// so we can climb back up to resupply wood/tools instead of starving below.
	rememberMineEntry(bot, bot.entity.position);

	// While well above the ore band, spend the call descending the staircase
	// (resumable across ticks). Don't mine at intermediate levels.
	if (floorY(bot) > level + 2) {
		const startY = floorY(bot);
		const res = await descendStaircase(bot, level, deadline);
		logEvent("mine", "descended", `y=${res.y} stopped=${res.stopped}`);
		// Made downward progress — keep descending next call (counts as progress so
		// the consecutive-failure abort doesn't trip during a long dig down).
		if (res.y < startY)
			return {
				success: true,
				message: `Descending toward y${level}: at y=${res.y}`,
			};
		// Boxed in by drops/caves/lava and can't get lower. If we're already near
		// the iron band, branch-mine right here (y16 finds iron fine) instead of
		// looping the descent forever and aborting. Only give up if stuck well
		// above the band.
		if (res.y > level + 6)
			return {
				success: false,
				message: `Stuck descending at y=${res.y} (${res.stopped ?? "?"})`,
			};
		logEvent("mine", "mine_in_place", `boxed at y=${res.y}, branch-mining here`);
	}

	// At the band — branch-mine until enough of the DROP is actually in the pack.
	const before = invCount(bot, dropItem);
	const { dug } = await branchMineOre(
		bot,
		blockType,
		isTarget,
		targetCount,
		level,
		dropItem,
		deadline,
	);
	const have = invCount(bot, dropItem);
	if (have >= targetCount) return success(`Collected ${have} ${dropItem}`);
	// Fully boxed in (no new drops AND no tunnel cut) and stuck well below the mine
	// entry → climb back up by placing blocks, rather than jittering at the bottom
	// of a dead-end shaft. returnToSurface now pillars via the pathfinder; pillarUp
	// is the proven manual fallback (same sequence gather-wood uses).
	if (have <= before && dug === 0) {
		const entry = getMineEntry(bot);
		if (entry && floorY(bot) < entry.y - 6) {
			logEvent("mine", "climb_out", `boxed at y=${floorY(bot)} → entry y=${entry.y}`);
			if (!(await returnToSurface(bot))) {
				const { pillarUp } = await import("../portal/cast.ts");
				await pillarUp(bot, entry.y);
				bot.setControlState("sneak", false); // pillarUp leaves it on
			}
		}
	}
	// Collecting ore OR cutting fresh tunnel both count as progress, so a
	// multi-hour mine never trips the abort; only a fully boxed-in bot returns
	// failure as the safety valve.
	return {
		success: have > before || dug > 0,
		message: `Collected ${have}/${targetCount} ${dropItem} (y=${floorY(bot)}, dug=${dug})`,
	};
};

export const mineBlock = async (
	bot: Bot,
	blockType: string,
	targetCount: number,
): Promise<StepResult> => {
	let mined = 0;
	const deadline = Date.now() + 110_000; // Return cleanly before 120s step timeout

	// Equip best pickaxe before mining — prioritize higher tier
	const pickTier = [
		"diamond_pickaxe",
		"iron_pickaxe",
		"stone_pickaxe",
		"wooden_pickaxe",
	];
	let pickSlot = -1;
	for (const tier of pickTier) {
		const idx = bot.inventory.slots.findIndex((s) => s?.name === tier);
		if (idx >= 0) {
			pickSlot = idx;
			break;
		}
	}
	if (pickSlot >= 36 && pickSlot <= 44) {
		bot.setQuickBarSlot(pickSlot - 36);
	} else if (pickSlot >= 0) {
		// Move to hotbar first via window click, then select
		try {
			await bot.clickWindow(pickSlot, 0, 0); // pick up
			await bot.clickWindow(36, 0, 0); // place in hotbar slot 0
			bot.setQuickBarSlot(0);
		} catch {}
	}

	// For stone, we get cobblestone drops
	const isStone = blockType === "stone";
	const searchTypes = isStone ? ["stone"] : [blockType];
	const isTarget = (name: string) => searchTypes.some((t) => name.includes(t));

	// Deep ores (iron, diamond, …): descend to the ore band and strip-mine
	// instead of wandering the surface. Resumable across step ticks.
	if (blockType in DEEP_ORE_LEVEL) {
		return await mineDeepOre(bot, blockType, isTarget, targetCount, deadline);
	}

	// Find initial block — check memory first, then scan
	const remembered = getRememberedResource(bot, blockType);
	let startBlock: Block | null = null;
	if (remembered) {
		const remBlock = bot.blockAt(
			vec3(remembered.x, remembered.y, remembered.z),
		);
		if (remBlock && isTarget(remBlock.name)) {
			startBlock = remBlock;
			logEvent(
				"mine",
				"from_memory",
				`${blockType} at ${remembered.x},${remembered.y},${remembered.z}`,
			);
		} else {
			forgetResource(bot, blockType, remembered);
		}
	}
	if (!startBlock) {
		startBlock = findBlock(bot, isTarget, 64);
	}
	// Explore before giving up — walk around and search wider
	if (!startBlock) {
		for (let attempt = 0; attempt < 3; attempt++) {
			logEvent("mine", "exploring", `${blockType} attempt ${attempt + 1}/3`);
			await exploreRandom(bot, 40);
			// Check memory again — blockSeen may have fired during exploration
			const newRemembered = getRememberedResource(bot, blockType);
			if (newRemembered) {
				const remBlock = bot.blockAt(
					vec3(newRemembered.x, newRemembered.y, newRemembered.z),
				);
				if (remBlock && isTarget(remBlock.name)) {
					startBlock = remBlock;
					logEvent(
						"mine",
						"found_exploring_memory",
						`${blockType} at ${newRemembered.x},${newRemembered.y},${newRemembered.z}`,
					);
					break;
				} else {
					forgetResource(bot, blockType, newRemembered);
				}
			}
			startBlock = findBlock(bot, isTarget, 64);
			if (startBlock) break;
		}
	}
	// For ore: staircase mine if nothing found on surface
	if (!startBlock && !isStone) {
		startBlock = await staircaseMine(bot, blockType, isTarget, deadline);
	}
	if (!startBlock) {
		return { success: false, message: `Could not find ${blockType}` };
	}
	try {
		const startDist = distance(bot.entity.position, startBlock.position);
		if (startDist > 4) {
			await goTo(bot, startBlock.position, { range: 2, timeout: 15000 });
		} else {
			await moveCloser(bot, startBlock.position, { maxDistance: 2 });
		}
	} catch {}

	// Pick a direction and mine in a straight line at the same Y level
	const p = bot.entity.position;
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];
	// Pick the direction with the most target blocks ahead
	let bestDir: [number, number] = dirs[0] ?? [1, 0];
	let bestCount = 0;
	for (const [dx, dz] of dirs) {
		let count = 0;
		for (let i = 1; i <= 8; i++) {
			const b = bot.blockAt(offset(p, dx * i, 0, dz * i)) as Block | null;
			const bBelow = bot.blockAt(offset(p, dx * i, -1, dz * i)) as Block | null;
			if ((b && isTarget(b.name)) || (bBelow && isTarget(bBelow.name))) count++;
		}
		if (count > bestCount) {
			bestCount = count;
			bestDir = [dx, dz];
		}
	}
	const [dirX, dirZ] = bestDir;
	logEvent("mine", "direction", `dx=${dirX} dz=${dirZ} ahead=${bestCount}`);

	while (mined < targetCount && Date.now() < deadline) {
		// Re-equip pickaxe if it got unset (crafting, window ops can clear held item)
		if (!bot.heldItem?.name.includes("pickaxe")) {
			for (const tier of pickTier) {
				const idx = bot.inventory.slots.findIndex((s) => s?.name === tier);
				if (idx >= 36 && idx <= 44) {
					bot.setQuickBarSlot(idx - 36);
					break;
				}
				if (idx >= 0) {
					try {
						await bot.clickWindow(idx, 0, 0);
						await bot.clickWindow(36, 0, 0);
						bot.setQuickBarSlot(0);
					} catch {}
					break;
				}
			}
		}

		// Health check — abort if drowning or low, forget current target
		if ((bot.health ?? 20) < 6) {
			const rem = getRememberedResource(bot, blockType);
			if (rem) forgetResource(bot, blockType, rem);
			if (bot.entity?.isInWater) await escapeWater(bot);
			return {
				success: false,
				message: `Aborted mining — low health (${bot.health})`,
			};
		}

		// Mine the block at feet level in our direction, or below feet
		const py = Math.floor(bot.entity.position.y);

		// Check: ahead at feet, ahead below, directly below
		const candidates = [
			bot.blockAt(offset(bot.entity.position, dirX, 0, dirZ)), // ahead at feet
			bot.blockAt(offset(bot.entity.position, dirX, -1, dirZ)), // ahead below
			bot.blockAt(offset(bot.entity.position, 0, -1, 0)), // below feet
			bot.blockAt(offset(bot.entity.position, -dirX, 0, -dirZ)), // behind (if stuck)
		] as (Block | null)[];

		let block: Block | null = null;
		for (const b of candidates) {
			if (b && isTarget(b.name)) {
				block = b;
				break;
			}
		}

		if (!block) {
			// Check memory first — did we see this resource earlier?
			const remembered = getRememberedResource(bot, blockType);
			if (remembered) {
				const remBlock = bot.blockAt(
					vec3(remembered.x, remembered.y, remembered.z),
				);
				if (remBlock && isTarget(remBlock.name)) {
					const remDist = distance(bot.entity.position, remBlock.position);
					logEvent(
						"mine",
						"from_memory",
						`${blockType} at ${remembered.x},${remembered.y},${remembered.z} dist=${remDist.toFixed(
							0,
						)}`,
					);
					try {
						if (remDist > 4) {
							await goTo(bot, remBlock.position, { range: 2, timeout: 15000 });
						} else {
							await moveCloser(bot, remBlock.position, { maxDistance: 2 });
						}
						block = remBlock;
					} catch {
						forgetResource(bot, blockType, remembered);
						continue;
					}
				} else {
					// Resource gone — forget it
					forgetResource(bot, blockType, remembered);
				}
			}

			// Search if memory didn't help
			if (!block) {
				block = findBlock(bot, isTarget, 32);
			}
			if (!block) {
				return {
					success: false,
					message: `Could not find ${blockType} (mined ${mined}/${targetCount})`,
				};
			}
			const dist = distance(bot.entity.position, block.position);
			try {
				if (dist > 4) {
					await goTo(bot, block.position, { range: 2, timeout: 8000 });
				} else {
					await moveCloser(bot, block.position, { maxDistance: 2 });
				}
			} catch {
				logEvent("mine", "nav_fail", "couldn't reach block");
				continue;
			}
		}

		// Also dig the block above if it's not air (clear headroom for walking)
		const above = bot.blockAt(offset(block.position, 0, 1, 0)) as Block | null;
		if (
			above &&
			above.name !== "air" &&
			above.name !== "water" &&
			block.position.y >= py
		) {
			try {
				await bot.lookAt(offset(above.position, 0.5, 0.5, 0.5));
				await safeDig(bot, above);
				await sleep(100);
			} catch {}
		}

		try {
			await bot.lookAt(offset(block.position, 0.5, 0.5, 0.5));
			await safeDig(bot, block);
			mined++;
			logEvent("mine", "mined", `${blockType} ${mined}/${targetCount}`);
			await sleep(100);

			// Navigate to dropped item for pickup
			await bot.collectDrops(6, 3000, async (p) => {
				await goTo(bot, p, { range: 1.4, timeout: 3000 });
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown";
			logEvent("mine", "fail", msg);
		}
	}

	return success(`Mined ${mined} ${blockType}`);
};

/** Staircase mine — dig 2-high tunnel at 45° angle to find ore */
const staircaseMine = async (
	bot: Bot,
	blockType: string,
	isTarget: (name: string) => boolean,
	deadline: number,
): Promise<Block | null> => {
	logEvent("mine", "staircase", `digging for ${blockType}`);

	const startPos = { ...bot.entity.position };
	const pos = bot.entity.position;

	// Pick direction with most solid blocks ahead
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];
	const isSolid = (name: string) =>
		name !== "air" &&
		name !== "cave_air" &&
		name !== "water" &&
		name !== "lava";
	let bestDir: [number, number] = dirs[0] ?? [1, 0];
	let bestSolid = 0;
	for (const [dx, dz] of dirs) {
		let solid = 0;
		for (let i = 1; i <= 5; i++) {
			const b = bot.blockAt(offset(pos, dx * i, 0, dz * i));
			if (b && isSolid(b.name)) solid++;
			const b2 = bot.blockAt(offset(pos, dx * i, -1, dz * i));
			if (b2 && isSolid(b2.name)) solid++;
		}
		if (solid > bestSolid) {
			bestSolid = solid;
			bestDir = [dx, dz];
		}
	}

	const [sdx, sdz] = bestDir;
	logEvent("mine", "staircase_dir", `dx=${sdx} dz=${sdz}`);

	const isHazard = (name: string) =>
		name === "water" || name === "lava" || name === "flowing_lava";

	for (let step = 0; step < 60 && Date.now() < deadline; step++) {
		if ((bot.health ?? 20) < 10) break;
		if (bot.entity?.isInWater) break;

		const p = bot.entity.position;

		// Dig head clearance
		const headAhead = bot.blockAt(offset(p, sdx, 1, sdz)) as Block | null;
		if (
			headAhead &&
			headAhead.name !== "air" &&
			headAhead.name !== "cave_air"
		) {
			if (isHazard(headAhead.name)) break;
			if (isTarget(headAhead.name)) return headAhead;
			try {
				await bot.lookAt(offset(headAhead.position, 0.5, 0.5, 0.5));
				await safeDig(bot, headAhead);
			} catch {}
		}

		// Dig wall ahead
		const ahead = bot.blockAt(offset(p, sdx, 0, sdz)) as Block | null;
		if (ahead && ahead.name !== "air" && ahead.name !== "cave_air") {
			if (isHazard(ahead.name)) break;
			if (isTarget(ahead.name)) return ahead;
			try {
				await bot.lookAt(offset(ahead.position, 0.5, 0.5, 0.5));
				await safeDig(bot, ahead);
			} catch {}
		}

		// Dig floor ahead (step down)
		const floorAhead = bot.blockAt(offset(p, sdx, -1, sdz)) as Block | null;
		if (floorAhead && isHazard(floorAhead.name)) break;
		if (floorAhead?.name === "bedrock") break;
		if (
			floorAhead &&
			floorAhead.name !== "air" &&
			floorAhead.name !== "cave_air"
		) {
			if (isTarget(floorAhead.name)) return floorAhead;
			try {
				await bot.lookAt(offset(floorAhead.position, 0.5, 0.5, 0.5));
				await safeDig(bot, floorAhead);
			} catch {}
		}

		// Walk forward + drop down
		bot.setControlState("forward", true);
		await sleep(250);
		bot.setControlState("forward", false);
		await sleep(150);

		// Check adjacent blocks for ore
		for (const [dx, dy, dz] of [
			[1, 0, 0],
			[-1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			[0, 0, 1],
			[0, 0, -1],
		] as const) {
			const adj = bot.blockAt(
				vec3(
					Math.floor(bot.entity.position.x) + dx,
					Math.floor(bot.entity.position.y) + dy,
					Math.floor(bot.entity.position.z) + dz,
				),
			) as Block | null;
			if (adj && isTarget(adj.name)) return adj;
		}

		// Check memory — blockSeen fires as new chunks load
		const newRem = getRememberedResource(bot, blockType);
		if (newRem) {
			const remBlock = bot.blockAt(vec3(newRem.x, newRem.y, newRem.z));
			if (remBlock && isTarget(remBlock.name)) {
				logEvent(
					"mine",
					"found_staircase",
					`${blockType} at ${newRem.x},${newRem.y},${newRem.z}`,
				);
				return remBlock;
			}
			forgetResource(bot, blockType, newRem);
		}
	}

	// Climb back to start
	if (bot.entity?.isInWater) await escapeWater(bot);
	try {
		await goTo(bot, startPos, { range: 3, timeout: 15000 });
	} catch {}

	return null;
};
