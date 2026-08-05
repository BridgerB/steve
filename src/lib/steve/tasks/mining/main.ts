/**
 * Mining tasks - dig blocks underground
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3 } from "typecraft";
import {
	craftItem,
	digExposesLava,
	digExposesWater,
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
	isInWaterTrap,
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
	// Iron at y40, NOT y14: iron is plentiful from y-24..y56 in 1.18+, so y40 still has
	// good density but sits ABOVE the lava lakes (mostly y<16) — so the raw_iron drops
	// land on solid stone and get collected instead of burning. y14 made the bot break
	// 100 ore and collect ~0, timing out forever in the lava zone.
	// Iron at y24: iron peaks ~y15 and is dense through y0–56 in 1.18+, so y24 has far
	// better vein density than y40 while staying above the lava lakes (mostly y<16) so
	// raw_iron drops land on stone and are collected, not burned. Head-to-head across
	// random spawns, y24 mining out-yielded y40 and y16.
	iron_ore: 24,
	deepslate_iron_ore: 24,
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
	stone: "cobblestone",
	deepslate: "cobbled_deepslate",
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
const isWater = (b: Block | null): boolean => !!b && b.name.includes("water");
const isLiquid = (b: Block | null): boolean =>
	!!b && (b.name.includes("water") || b.name.includes("lava"));

// Per-target event category (e.g. "mine:stone", "mine:coal_ore") so each mine
// step's sub-tasks get their own timeline in the dashboard instead of sharing one.
const mineCat = (blockType: string): string => `mine:${blockType}`;

const lookDig = async (bot: Bot, b: Block | null): Promise<boolean> => {
	if (isAir(b)) return false;
	if (isLiquid(b)) return false;
	// Refuse to break a block that would let lava flow onto us (lava behind/above).
	if (digExposesLava(bot, (b as Block).position)) return false;
	// Refuse to break the last block holding back water (any of the 6 neighbors,
	// incl. below) — that's the dig-into-a-pond that floods + traps the bot.
	if (digExposesWater(bot, (b as Block).position)) return false;
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
		// Already submerged: stop digging down and hand off to the drowning guard.
		// Continuing here would issue forward/down controls + digs that fight
		// escapeWater's upward climb, leaving the bot bobbing in the flooded shaft.
		if (bot.entity?.isInWater) return { y: floorY(bot), stopped: "in water" };
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
		// Hazard: water in the step floods the 1-wide shaft and drowns us. Reroute
		// around it like we do for lava — digging in here is what traps the bot
		// bobbing against the drowning guard. If boxed in by water on all sides,
		// stop descending rather than opening the flood.
		if ([newHeadUp, newHead, newFeet, newFloor, newFloor2].some(isWater)) {
			dir = rotate(dir);
			if (++stuck > 4) return { y: floorY(bot), stopped: "boxed in by water" };
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
			// Never drop into a column with WATER pooled at the bottom — the bot would
			// fall straight in and drown (the reported bug). Scan the drop column to its
			// floor; if that floor is water, reroute like lava.
			let wy = fy - 2;
			while (wy > fy - 10 && isAir(B(nx, wy, nz))) wy--;
			if (isWater(B(nx, wy, nz)) || isWater(B(nx, wy + 1, nz))) {
				dir = rotate(dir);
				if (++stuck > 5) return { y: floorY(bot), stopped: "water below drop" };
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
): Promise<{ mined: number; dug: number; lostDrops: boolean }> => {
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
		if (ore.position.y < floorY(bot) - 3) {
			if (fromMem) forgetResource(bot, blockType, ore.position);
			return false;
		}
		// Skip ore whose drop would fall into lava — scan down to where the raw_iron
		// would land; if that's lava, it burns before we can collect it (this is what
		// made y14 mining break 100 ore and net ~0). Belt to the y40 level change.
		{
			let dy = 1;
			while (dy <= 8 && isAir(bot.blockAt(offset(ore.position, 0, -dy, 0)))) dy++;
			if (isLava(bot.blockAt(offset(ore.position, 0, -dy, 0)))) {
				if (fromMem) forgetResource(bot, blockType, ore.position);
				return false;
			}
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
				logEvent(mineCat(blockType),"ore", `${blockType} ${mined}/${targetCount}`);
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
	): Promise<"ok" | "lava" | "water" | "stuck" | "drop"> => {
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
		// Stay LEVEL — refuse to step into a cell with no floor (a cave opening), or we
		// drift down out of the ore band over time. mineNearbyOre still harvests any ore
		// the opening exposes; we just don't walk off the edge into the depths.
		if (isAir(floor)) return "drop";
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

	// Drop one level (dig straight down), refusing to breach lava/water and never below
	// the ore band's floor. Lets a BOXED strip keep mining DOWN through the whole band
	// (many more wall-slices exposed → finds ore) instead of bailing to the costly
	// climb-out+relocate after only ~4 blocks (the mine-iron dug=4, 0-iron stall).
	const bandFloor = Math.max(8, level - 16);
	const digDownOne = async (): Promise<boolean> => {
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		if (fy <= bandFloor) return false;
		const below = bot.blockAt(vec3(fx, fy - 1, fz));
		if (!below || isAir(below) || isLava(below) || isWater(below)) return false;
		for (let d = 1; d <= 3; d++)
			if (isLava(bot.blockAt(vec3(fx, fy - d, fz)))) return false;
		if (digExposesWater(bot, vec3(fx, fy - 1, fz))) return false;
		if (!(await lookDig(bot, below))) return false;
		for (let w = 0; w < 8 && Math.floor(bot.entity.position.y) >= fy; w++)
			await sleep(50);
		dug++;
		return Math.floor(bot.entity.position.y) < fy;
	};

	let turns = 0;
	let forward = 0;
	// Detect ore whose drops we can't collect (broken over lava — the count rises but
	// raw_iron never lands in the pack). Without this the loop chases scattered cavern
	// ore for the full deadline, collecting nothing, and the bot never relocates.
	let collected = have();
	let lastCollectAt = Date.now();
	while (have() < targetCount && Date.now() < deadline) {
		// In the water trap → BAIL immediately so the priority-0 escape_water step can
		// take over cleanly instead of this dig loop fighting it underwater.
		if (isInWaterTrap(bot)) return { mined, dug, lostDrops: false };
		if ((bot.health ?? 20) < 7) return { mined, dug, lostDrops: false };
		if (have() > collected) {
			collected = have();
			lastCollectAt = Date.now();
		}
		// No iron actually collected for 50s — the ore here is unreachable across a
		// cavern (goTo keeps failing) or its drops fall into lava. Bail so mineDeepOre
		// relocates to fresh solid rock. Time-based so it survives the ~2min process
		// reconnects that reset the per-bot stuck counter.
		if (Date.now() - lastCollectAt > 50000) {
			logEvent(mineCat(blockType), "drops_lost", `50s no collection at y=${floorY(bot)} — relocating`);
			return { mined, dug, lostDrops: true };
		}
		await ensurePickaxe(bot);
		// Grab any ore the tunnel has already exposed in its walls/floor/ceiling.
		if (await mineNearbyOre()) {
			turns = 0;
			continue;
		}
		// Advance the 1x2 main tunnel one cell (digStep stays level, returning non-"ok"
		// at caves/lava/water), then every BRANCH_SPACING cells cut perpendicular ribs
		// off BOTH sides of the spine. A lone 1-wide tunnel uncovers almost nothing, so
		// with sparse ore it exposes no vein at all (mined=0 dug=18); the ribs multiply
		// the exposed wall area — the no-X-ray way to actually surface a vein — and
		// digBranch harvests + retreats each one. (digBranch was previously dead code.)
		const r = await digStep(dir[0], dir[1]);
		if (r === "ok") {
			turns = 0;
			forward++;
			if (forward % BRANCH_SPACING === 0) {
				const perp: [number, number] = [dir[1], -dir[0]];
				await digBranch(perp);
				if (have() < targetCount && Date.now() < deadline)
					await digBranch([-perp[0], -perp[1]]);
			}
		} else {
			dir = rotate(dir);
			// Boxed at this level (water/lava/caves in all 4 dirs — common at the ore
			// band). Instead of bailing to the costly climb-out+relocate after ~4 blocks,
			// drop ONE level and keep strip-mining down through the band. Only give up if
			// we can't descend either.
			if (++turns >= 4) {
				if (await digDownOne()) {
					turns = 0;
				} else {
					return { mined, dug, lostDrops: false };
				}
			}
		}
	}
	return { mined, dug, lostDrops: false };
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
// Last x/z the bot strip-mined from + consecutive calls frozen there. Digging a
// big cavern's walls counts dug>0 (so the "boxed in" climb-out never fires) and
// grabbing the odd reachable ore resets any dry counter — but if the bot isn't
// MOVING it's wedged at a cavern mouth and should relocate to fresh rock.
const mineStuckState = new WeakMap<
	Bot,
	{ x: number; z: number; n: number; iron: number }
>();
// Relocate horizontally `cells` blocks onto fresh SOLID rock, digging the 1x2 opening
// as it goes, to route the vertical dig-down around a hazard directly below (lava,
// water/aquifer, deep drop). Picks the direction whose near cells are driest+solidest
// and walks that way; a water table near y60 is often several blocks wide, so a single
// sidestep isn't enough — moving a few cells finds a dry column to resume descending.
const sidestepToSolid = async (bot: Bot, cells = 2): Promise<boolean> => {
	const step = async (dx: number, dz: number): Promise<boolean> => {
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const foot = bot.blockAt(vec3(fx + dx, fy - 1, fz + dz));
		const feet = bot.blockAt(vec3(fx + dx, fy, fz + dz));
		const head = bot.blockAt(vec3(fx + dx, fy + 1, fz + dz));
		// Need solid, dry footing and a non-liquid 1x2 opening to step into.
		if (!foot || isAir(foot) || isLava(foot) || isWater(foot)) return false;
		if ([feet, head].some((b) => isLava(b) || isWater(b))) return false;
		if (digExposesWater(bot, vec3(fx + dx, fy, fz + dz))) return false;
		await lookDig(bot, feet);
		await lookDig(bot, head);
		await bot.lookAt(vec3(p.x + dx, p.y, p.z + dz));
		bot.setControlState("forward", true);
		await sleep(380);
		bot.setControlState("forward", false);
		await sleep(160);
		return Math.floor(bot.entity.position.x) !== fx || Math.floor(bot.entity.position.z) !== fz;
	};
	// Rank the 4 directions by dry-solid footing over the next few cells.
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	const scored = HORIZ_DIRS.map(([dx, dz]) => {
		let s = 0;
		for (let i = 1; i <= 4; i++) {
			const b = bot.blockAt(vec3(fx + dx * i, fy - 1, fz + dz * i));
			if (b && !isAir(b) && !isLiquid(b)) s++;
			if (isLiquid(bot.blockAt(vec3(fx + dx * i, fy, fz + dz * i)))) s -= 2;
		}
		return { dx, dz, s };
	}).sort((a, b) => b.s - a.s);
	for (const { dx, dz } of scored) {
		let moved = 0;
		for (let i = 0; i < cells; i++) {
			if (!(await step(dx, dz))) break;
			moved++;
		}
		if (moved > 0) return true;
	}
	return false;
};

// Neighbour offsets used to walk a vein (6-connected).
const VEIN_DIRS: [number, number, number][] = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 0, 1],
	[0, 0, -1],
	[0, 1, 0],
	[0, -1, 0],
];

/**
 * Mine any target ore EXPOSED in the walls/ceiling/floor around the bot's current
 * shaft position, flood-filling a short way into the connected vein so a single
 * exposed face yields the whole blob. Drops land at the bot's feet and are vacuumed.
 * Only ore reachable from where the shaft already opened is touched — no X-ray, and
 * ore whose drop would fall into lava is skipped (it would just burn).
 */
const harvestShaftWalls = async (
	bot: Bot,
	isTarget: (name: string) => boolean,
	dropItem: string,
	maxBlocks = 10,
): Promise<number> => {
	const start = bot.entity.position;
	const fx = Math.floor(start.x);
	const fy = Math.floor(start.y);
	const fz = Math.floor(start.z);
	// Seed from ore directly touching the bot's feet/head cells.
	const seeds: Block[] = [];
	for (const [dx, dy, dz] of VEIN_DIRS) {
		for (const by of [fy, fy + 1]) {
			const b = bot.blockAt(vec3(fx + dx, by + dy, fz + dz));
			if (b && isTarget(b.name)) seeds.push(b as Block);
		}
	}
	if (seeds.length === 0) return 0;
	let mined = 0;
	const seen = new Set<string>();
	const queue = [...seeds];
	while (queue.length > 0 && mined < maxBlocks) {
		const ore = queue.shift();
		if (!ore) break;
		const key = `${ore.position.x},${ore.position.y},${ore.position.z}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const cur = bot.blockAt(ore.position);
		if (!cur || !isTarget(cur.name)) continue;
		// Never mine an ore whose drop would fall into lava — scan down to the landing.
		let dy = 1;
		while (dy <= 6 && isAir(bot.blockAt(offset(cur.position, 0, -dy, 0)))) dy++;
		if (isLava(bot.blockAt(offset(cur.position, 0, -dy, 0)))) continue;
		if (distance(bot.entity.position, cur.position) > 4.5) continue;
		if (await lookDig(bot, cur as Block)) {
			mined++;
			await bot.collectDrops(6, 2500, async (pp) => {
				await goTo(bot, pp, { range: 1, timeout: 2500 });
			});
			// Expand into connected ore (the rest of the vein).
			for (const [ax, ay, az] of VEIN_DIRS) {
				const nb = bot.blockAt(offset(cur.position, ax, ay, az));
				if (nb && isTarget(nb.name)) queue.push(nb as Block);
			}
		}
	}
	if (mined > 0) logEvent("mine:shaft", "vein", `${dropItem} +${mined}`);
	return mined;
};

/**
 * Fast, safe VERTICAL descent to (or near) targetY — one dig per level (the block
 * under the bot's feet) instead of the 3-dig diagonal staircase, so reaching the ore
 * band costs ~40s instead of the whole budget. CRUCIAL: it lands (waits for onGround)
 * before each dig, because typecraft applies a 5× "not on ground" mining penalty
 * (bot/digging.ts) — mining mid-fall made a naive straight-down dig ~3s/block. Scans
 * the column below and refuses to open onto lava (within 4), a deep air shaft, or
 * water; on a hazard it sidesteps onto solid rock and keeps descending, or stops and
 * lets the caller strip-mine where it reached. Optionally harvests veins the shaft
 * exposes on the way down. Resumable.
 */
// When the vertical dig is boxed by a WIDE water table (adjacent sidesteps all wet, so
// sidestepToSolid can't escape), PATHFIND to the nearest genuinely-dry surface column
// (solid ground + 2 air above + no water just below) within R and resume the descent
// there. The pathfinder walks around/across the water that a 2-cell sidestep can't — this
// is the fix for the "descended y=63 stopped=blocked (liquid)" stall that tanked mine-coal
// and capped mine-iron on watery spawns.
const relocateToDryGround = async (bot: Bot): Promise<boolean> => {
	const p = bot.entity.position;
	const cx = Math.floor(p.x);
	const cy = Math.floor(p.y);
	const cz = Math.floor(p.z);
	let best: Vec3 | null = null;
	let bestD = Infinity;
	const R = 24;
	for (let dx = -R; dx <= R; dx += 2) {
		for (let dz = -R; dz <= R; dz += 2) {
			if (Math.abs(dx) + Math.abs(dz) < 6) continue; // must move meaningfully away
			for (let y = cy + 4; y >= cy - 4; y--) {
				const g = bot.blockAt(vec3(cx + dx, y - 1, cz + dz)); // ground
				const f = bot.blockAt(vec3(cx + dx, y, cz + dz)); // feet
				const h = bot.blockAt(vec3(cx + dx, y + 1, cz + dz)); // head
				if (!g || isAir(g) || isLava(g) || isWater(g)) continue;
				if (!isAir(f) || !isAir(h)) continue;
				if (isWater(bot.blockAt(vec3(cx + dx, y - 2, cz + dz)))) continue; // not a water table
				const d = dx * dx + dz * dz;
				if (d < bestD) {
					bestD = d;
					best = vec3(cx + dx, y, cz + dz);
				}
				break;
			}
		}
	}
	if (!best) return false;
	try {
		await goTo(bot, best, { range: 0, timeout: 8000 });
	} catch {}
	return distance(bot.entity.position, best) <= 2.5;
};

export const digDownVertical = async (
	bot: Bot,
	targetY: number,
	deadline: number,
	harvest?: { isTarget: (name: string) => boolean; dropItem: string },
): Promise<{ y: number; stopped: string | null }> => {
	await ensurePickaxe(bot);
	let sideTries = 0;
	while (floorY(bot) > targetY && Date.now() < deadline) {
		if ((bot.health ?? 20) < 8) return { y: floorY(bot), stopped: "low health" };
		if (bot.entity?.isInWater) return { y: floorY(bot), stopped: "in water" };
		if (!bot.heldItem?.name.endsWith("_pickaxe")) await ensurePickaxe(bot);
		// Harvest ore the shaft has EXPOSED in its walls as we pass through the band —
		// the 1-wide shaft slices veins, and mining those faces (drops land at our feet)
		// collects much of the target on the way down. No X-ray: only uncovered walls.
		if (harvest) await harvestShaftWalls(bot, harvest.isTarget, harvest.dropItem);
		// Dig only while standing on solid ground (see 5× airborne penalty above).
		for (let w = 0; w < 12 && !bot.entity.onGround; w++) await sleep(50);

		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const below = bot.blockAt(vec3(fx, fy - 1, fz));

		let lavaClose = false;
		for (let d = 1; d <= 4; d++)
			if (isLava(bot.blockAt(vec3(fx, fy - d, fz)))) lavaClose = true;
		const waterBelow = isWater(below);
		// Air below = cave/void: gauge the drop. A short step down is fine; a deep one
		// (fall damage) or lava/water at the bottom is a hazard to route around.
		let deepDrop = false;
		if (isAir(below)) {
			let d = 1;
			while (d < 10 && isAir(bot.blockAt(vec3(fx, fy - d, fz)))) d++;
			const landing = bot.blockAt(vec3(fx, fy - d, fz));
			if (d > 4 || isLava(landing) || isWater(landing)) deepDrop = true;
		}

		if (lavaClose || waterBelow || deepDrop) {
			if (await sidestepToSolid(bot, 2)) continue;
			// Sidestep couldn't escape (wide water table) — pathfind to dry ground.
			if (await relocateToDryGround(bot)) {
				sideTries = 0;
				continue;
			}
			if (++sideTries > 7)
				return {
					y: floorY(bot),
					stopped: lavaClose
						? "lava below"
						: waterBelow
							? "water below"
							: "deep drop",
				};
			continue;
		}
		// Break the block underfoot and drop into it. lookDig refuses (returns false) if
		// breaking would expose lava/water on ANY neighbour — e.g. an aquifer beside the
		// shaft. When that blocks straight-down progress, route around it rather than
		// spinning in place retrying the same forbidden block forever.
		if (below && !isAir(below)) {
			const broke = await lookDig(bot, below);
			if (!broke) {
				if (await sidestepToSolid(bot, 2)) continue;
				if (await relocateToDryGround(bot)) {
					sideTries = 0;
					continue;
				}
				if (++sideTries > 7)
					return { y: floorY(bot), stopped: "blocked (liquid)" };
				continue;
			}
		}
		sideTries = 0;
		// Let gravity drop us onto the next floor before looping.
		for (let w = 0; w < 8 && Math.floor(bot.entity.position.y) >= fy; w++)
			await sleep(50);
	}
	return { y: floorY(bot), stopped: null };
};

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

	// While well above the ore band, descend FAST (vertical dig-down, ~one dig per
	// level) and then FALL THROUGH to strip-mine in the SAME call. The old diagonal
	// staircase ate the entire budget just getting down and early-returned before
	// mining a single block — so one gym run (a single call) never collected any ore.
	if (floorY(bot) > level + 2) {
		const startY = floorY(bot);
		// Cap how far down one call digs: most spawns (y60-90) reach the band at `level`;
		// only an extreme mountain (y100+) is capped so descent can't eat the whole call.
		const target = Math.max(level, startY - 80);
		// Cap the descent PHASE too, so hazard detours can't starve the mining phase —
		// mining always gets >=~50s of the 110s budget.
		const descentDeadline = Math.min(deadline, Date.now() + 60000);
		const res = await digDownVertical(bot, target, descentDeadline, { isTarget, dropItem });
		logEvent(mineCat(blockType), "descended", `y=${res.y} from=${startY} stopped=${res.stopped}`);
		// Only hard-fail if stranded high in the near-oreless zone with essentially no
		// progress (instantly boxed by a surface aquifer). Otherwise branch-mine right
		// where we are — the descent already swept iron's band (and harvested through it).
		if (res.y > 75 && startY - res.y < 3)
			return {
				success: false,
				message: `Stuck descending at y=${res.y} (${res.stopped ?? "?"})`,
			};
		logEvent(mineCat(blockType), "mine_in_place", `at y=${res.y}, branch-mining`);
	}

	// At the band — branch-mine until enough of the DROP is actually in the pack.
	const before = invCount(bot, dropItem);
	const { dug, lostDrops } = await branchMineOre(
		bot,
		blockType,
		isTarget,
		targetCount,
		level,
		dropItem,
		deadline,
	);
	const have = invCount(bot, dropItem);
	if (have >= targetCount) {
		mineStuckState.delete(bot);
		return success(`Collected ${have} ${dropItem}`);
	}
	// Fully boxed in (no new drops AND no tunnel cut) and stuck well below the mine
	// entry → climb back up by placing blocks, rather than jittering at the bottom
	// of a dead-end shaft. returnToSurface now pillars via the pathfinder; pillarUp
	// is the proven manual fallback (same sequence gather-wood uses).
	if (have <= before && dug === 0) {
		const entry = getMineEntry(bot);
		if (entry && floorY(bot) < entry.y - 6) {
			logEvent(mineCat(blockType),"climb_out", `boxed at y=${floorY(bot)} → entry y=${entry.y}`);
			if (!(await returnToSurface(bot))) {
				const { pillarUp } = await import("../portal/cast.ts");
				await pillarUp(bot, entry.y);
				bot.setControlState("sneak", false); // pillarUp leaves it on
			}
		}
	}
	// Stuck detection by displacement AND ore gain from a fixed anchor. Wedged at a
	// cavern mouth the bot still breaks ore (dug>0) but its raw_iron drops fall into
	// lava (collected stays 0) while branch-mining only jitters it a few blocks. Count
	// calls spent within 5 blocks of an anchor WITHOUT the iron count rising; moving
	// >5 away OR gaining iron re-anchors (real progress — don't abandon a rich seam),
	// loitering for 3 calls = wedged → relocate ~16 blocks toward the MOST-SOLID
	// direction and strip fresh rock where drops land on the floor, not in lava.
	const cur = bot.entity.position;
	const anc = mineStuckState.get(bot);
	const near = !!anc && Math.hypot(cur.x - anc.x, cur.z - anc.z) <= 5;
	const gained = !!anc && have > anc.iron;
	const stuckN = near && !gained && anc ? anc.n + 1 : 0;
	mineStuckState.set(
		bot,
		stuckN > 0 && anc
			? { x: anc.x, z: anc.z, n: stuckN, iron: anc.iron }
			: { x: cur.x, z: cur.z, n: 0, iron: have },
	);
	if ((stuckN >= 3 || lostDrops) && have < targetCount) {
		mineStuckState.set(bot, { x: cur.x, z: cur.z, n: 0, iron: have });
		const fx = Math.floor(cur.x);
		const fz = Math.floor(cur.z);
		const dirs: [number, number][] = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		];
		let best = dirs[0];
		let bestSolid = -1;
		for (const d of dirs) {
			let solid = 0;
			for (let i = 2; i <= 8; i++) {
				const b = bot.blockAt(vec3(fx + d[0] * i, level, fz + d[1] * i));
				if (!!b && !isAir(b) && !isLava(b) && !b.name.includes("water")) solid++;
			}
			if (solid > bestSolid) {
				bestSolid = solid;
				best = d;
			}
		}
		// Climbing out (pillaring up) is ONLY right when genuinely trapped DEEP — a lava
		// cavern below the surface where horizontal A* can't path through the lava. Near
		// the surface (e.g. shallow coal), pillaring up just stacks into the open sky
		// AWAY from the ore band, so there we relocate HORIZONTALLY at the current level
		// instead. Pillar target is capped underground so it never reaches daylight.
		const feetY = floorY(bot);
		const deep = feetY < 45;
		logEvent(mineCat(blockType), "relocate", `lost=${lostDrops} stuck=${stuckN} at ${fx},${fz},y${feetY} deep=${deep} solid=${bestSolid}`);
		if (deep) {
			const climbTo = Math.min(level + 14, 50); // stay underground, never the sky
			if (climbTo > feetY) {
				const { pillarUp } = await import("../portal/cast.ts");
				await pillarUp(bot, climbTo);
				bot.setControlState("sneak", false); // pillarUp leaves it on
			}
		}
		const baseY = Math.floor(bot.entity.position.y);
		const tx = Math.floor(bot.entity.position.x) + best[0] * 12;
		const tz = Math.floor(bot.entity.position.z) + best[1] * 12;
		await goTo(bot, vec3(tx, baseY, tz), { range: 3, timeout: 25000 });
		return { success: true, message: `Relocated toward ${tx},${tz}` };
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
				mineCat(blockType),
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
			logEvent(mineCat(blockType),"exploring", `${blockType} attempt ${attempt + 1}/3`);
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
						mineCat(blockType),
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
	logEvent(mineCat(blockType),"direction", `dx=${dirX} dz=${dirZ} ahead=${bestCount}`);

	// Track the DROP collected (stone→cobblestone), not blocks dug — the pass check
	// is on the drop item. Digging 16 stone whose cobble rolled away uncollected used
	// to falsely "succeed" (mine-cobblestone 0%: "Mined 16 stone" but 0 cobblestone).
	// Cap total digs at 3x so an unreachable-drop spot can't spin forever.
	const dropItem = DROP_ITEM[blockType] ?? blockType;
	const collected = () => invCount(bot, dropItem);
	while (
		collected() < targetCount &&
		mined < targetCount * 3 &&
		Date.now() < deadline
	) {
		// In the water trap → bail so escape_water (priority 0) takes over cleanly.
		if (isInWaterTrap(bot))
			return { success: false, message: "in water — yielding to escape_water" };
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

		// Prefer mining DOWNWARD (a descending staircase) over ahead-at-feet. On a
		// mountain/slope, breaking the block ahead-at-feet drops cobble that rolls DOWN
		// the slope out of pickup range — `mined` rises but 0 is collected and
		// collectDrops freezes chasing an unreachable drop (the exact 0-cobble stall).
		// Digging ahead-and-below descends into the hill so the drop lands at our feet
		// where collectDrops reaches it; the loop then steps down into the stair.
		const candidates = [
			bot.blockAt(offset(bot.entity.position, dirX, -1, dirZ)), // ahead + below → staircase down
			bot.blockAt(offset(bot.entity.position, 0, -1, 0)), // straight below
			bot.blockAt(offset(bot.entity.position, dirX, 0, dirZ)), // ahead at feet
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
						mineCat(blockType),
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
				logEvent(mineCat(blockType),"nav_fail", "couldn't reach block");
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
			logEvent(mineCat(blockType),"mined", `${blockType} ${mined}/${targetCount}`);
			await sleep(100);

			// Navigate to dropped item for pickup
			await bot.collectDrops(6, 3000, async (p) => {
				await goTo(bot, p, { range: 1.4, timeout: 3000 });
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown";
			logEvent(mineCat(blockType),"fail", msg);
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
	logEvent(mineCat(blockType),"staircase", `digging for ${blockType}`);

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
	logEvent(mineCat(blockType),"staircase_dir", `dx=${sdx} dz=${sdz}`);

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
					mineCat(blockType),
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
