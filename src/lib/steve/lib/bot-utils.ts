/**
 * Shared bot utilities for all tasks
 * Reduces code duplication across task implementations
 */

/** Block with position and hardness — enriched from typecraft's blockAt + registry */
import type {
	Bot,
	Entity,
	Item,
	Pathfinder,
	Block as TypecraftBlock,
} from "typecraft";
import {
	createGoalBlock,
	createGoalNear,
	createPathfinder,
	distance,
	offset,
	type Vec3,
	vec3,
	windowItems,
} from "typecraft";
import type { StepResult } from "../types.ts";
import { logEvent } from "./logger.ts";

type Block = TypecraftBlock & { hardness: number | null };

/** Get block at position with position and hardness attached */
export const getBlock = (bot: Bot, pos: Vec3): Block | null => {
	// Floor position — block coords must be integers
	pos = vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
	const info = bot.blockAt(pos);
	if (!info) return null;

	// Look up hardness from registry
	let hardness: number | null = null;
	if (bot.registry) {
		const blockName = info.name.startsWith("minecraft:")
			? info.name
			: `minecraft:${info.name}`;
		const def =
			bot.registry.blocksByName.get(blockName) ??
			bot.registry.blocksByName.get(info.name);
		if (def) hardness = def.hardness;
	}

	return {
		...info,
		position: pos,
		hardness,
	};
};

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** Options for goTo navigation */
export interface GoToOptions {
	/** How close to get to the target (default: 2) */
	range?: number;
	/** Max time before giving up in ms (default: 10000) */
	timeout?: number;
	/** Whether to allow digging (default: true) */
	canDig?: boolean;
	/** Whether to allow sprinting (default: true) */
	allowSprinting?: boolean;
}

/** Options for moveCloser */
export interface MoveCloserOptions {
	/** Maximum distance to start walking (default: 4) */
	maxDistance?: number;
	/** Speed multiplier for walking time (default: 150ms per block) */
	speedFactor?: number;
	/** Maximum walk time in ms (default: 3000) */
	maxWalkTime?: number;
	/** Whether to sprint (default: false) */
	sprint?: boolean;
}

/** Options for mineAndCollect */
export interface MineAndCollectOptions {
	/** Maximum mining distance (default: 4.5) */
	maxMineDistance?: number;
	/** Time to wait after dig before checking (default: 100ms) */
	postDigDelay?: number;
	/** Time to wait for item collection (default: 300ms) */
	/** Custom block validation function */
	isValidBlock?: (block: { name: string } | null) => boolean;
}

// =============================================================================
// PATHFINDER SETUP
// =============================================================================

const pathfinderCache = new WeakMap<Bot, Pathfinder>();

/**
 * Get or create a cached pathfinder instance for a bot
 */
export const getPathfinder = (bot: Bot): Pathfinder => {
	let pf = pathfinderCache.get(bot);
	if (!pf) {
		// BOUND the A* search. Defaults are searchRadius:-1 (UNBOUNDED) + thinkTimeout
		// 10s — so an unreachable/far target (stone across a mountain) makes the
		// synchronous A* churn the event loop, the bot misses server keep-alives, and
		// gets KICKED (~60s cadence: reconnect→Mine Cobblestone→explore→kick). ruststeve
		// hit the identical bug and bounded it. Cap the radius and the think budget so a
		// hard path fails fast (→ explore/dig-down logic) instead of hanging the socket.
		pf = createPathfinder(bot, {
			searchRadius: 64,
			thinkTimeout: 1500,
			tickTimeout: 15, // cap per-tick A* CPU so it can't starve keep-alives → kicks
		});
		try {
			logEvent("debug", "pf_config", "searchRadius=64 thinkTimeout=1500 tickTimeout=15");
		} catch {}
		// Blocks the bot pillars/scaffolds with to CLIMB — enabling getMoveUp so the
		// pathfinder can plan place-a-block-and-jump routes upward (the follower equips
		// + places one of these). Without this, the only "up" it can plan is digging
		// through the ceiling, which it executes poorly.
		const FILLER = [
			"cobblestone",
			"dirt",
			"stone",
			"cobbled_deepslate",
			"granite",
			"andesite",
			"diorite",
			"tuff",
		];
		const reg = (bot as Bot & { registry?: { blocksByName: Map<string, { id: number }> } }).registry;
		const scaffoldingBlocks = reg
			? FILLER.map((n) => reg.blocksByName.get(n)?.id).filter(
					(id): id is number => id != null,
				)
			: [];
		// liquidCost: avoid wading. maxDropDown 3 + no infinite liquid drops: never
		// path off a tall ledge or plunge down a water-bottomed shaft — both routes
		// strand the bot at the bottom of a ravine/cave with no way back up.
		// digCost: tunnelling through rock used to cost the SAME as walking the same
		// distance, so the bot drove straight through walls instead of walking around
		// the obvious clear route. Make a dug block cost ~6 so it only tunnels when
		// there is genuinely no walk-around (it still digs as a last resort).
		pf.setMovements({
			liquidCost: 100,
			maxDropDown: 3,
			infiniteLiquidDropdownDistance: false,
			digCost: 6,
			scaffoldingBlocks,
		});
		pathfinderCache.set(bot, pf);
	}
	return pf;
};

// =============================================================================
// NAVIGATION
// =============================================================================

/**
 * Navigate to a position using pathfinder with stuck detection
 *
 * @example
 * ```ts
 * const reached = await goTo(bot, vec3(100, 64, 200));
 * if (!reached) console.log("Could not reach destination");
 * ```
 */
export const goTo = async (
	bot: Bot,
	pos: Vec3,
	options: GoToOptions = {},
): Promise<boolean> => {
	const { range = 2, timeout = 10000 } = options;

	const dist = distance(bot.entity.position, pos);
	if (dist <= range) return true;

	const pf = getPathfinder(bot);
	const goal =
		range === 0
			? createGoalBlock(pos.x, pos.y, pos.z)
			: createGoalNear(pos.x, pos.y, pos.z, range);

	const startPos = vec3(
		bot.entity.position.x,
		bot.entity.position.y,
		bot.entity.position.z,
	);
	try {
		await Promise.race([
			pf.goto(goal),
			new Promise<never>((_, reject) =>
				setTimeout(() => {
					pf.stop();
					reject(new Error("goTo timeout"));
				}, timeout),
			),
		]);
		return true;
	} catch {
		const moved = distance(startPos, bot.entity.position);
		if (distance(bot.entity.position, pos) <= range + 1) return true;

		// Pathfinder failed — a horizontal raw-walk nudge if we didn't move much.
		// NO jump here: blindly holding jump is what made a shaft-trapped bot bounce
		// dozens of times. And skip the nudge entirely when the target is up a shaft
		// (≥3 blocks above) — walking into a wall does nothing; the pathfinder pillars
		// up instead (scaffoldingBlocks). Never blind-walk toward lava.
		if (
			moved < 2 &&
			!lavaAround(bot) &&
			pos.y - bot.entity.position.y < 3
		) {
			await bot.lookAt(pos);
			bot.setControlState("forward", true);
			bot.setControlState("sprint", true);
			const walkEnd = Date.now() + Math.min(dist * 200, timeout * 0.6, 5000);
			while (Date.now() < walkEnd) {
				await sleep(150);
				if (lavaAround(bot)) break;
			}
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
			await sleep(200);
		}
		return distance(bot.entity.position, pos) <= range + 1;
	}
};

/**
 * Move closer to a target by walking forward
 * Simpler than pathfinder, good for short distances
 *
 * @example
 * ```ts
 * await moveCloser(bot, block.position, { maxDistance: 4 });
 * ```
 */
export const moveCloser = async (
	bot: Bot,
	target: Vec3,
	options: MoveCloserOptions = {},
): Promise<void> => {
	const {
		maxDistance = 4,
		speedFactor = 150,
		maxWalkTime = 3000,
		sprint = false,
	} = options;

	const dist = distance(bot.entity.position, target);
	if (dist <= maxDistance) return;

	await bot.lookAt(target);
	bot.setControlState("forward", true);
	if (sprint) bot.setControlState("sprint", true);

	await sleep(Math.min(dist * speedFactor, maxWalkTime));

	bot.setControlState("forward", false);
	if (sprint) bot.setControlState("sprint", false);
};

/**
 * Walk in a direction until reaching a target XZ position
 * Useful for precise positioning (e.g., walking into a tree column)
 *
 * @example
 * ```ts
 * await walkToXZ(bot, treeX + 0.5, treeZ + 0.5, { targetDist: 0.5 });
 * ```
 */
export const walkToXZ = async (
	bot: Bot,
	targetX: number,
	targetZ: number,
	options: { targetDist?: number; maxTime?: number } = {},
): Promise<boolean> => {
	const { targetDist = 0.5, maxTime = 2000 } = options;

	const target = vec3(targetX, bot.entity.position.y + 0.5, targetZ);
	await bot.lookAt(target);
	await sleep(100);

	const startTime = Date.now();
	bot.setControlState("forward", true);

	while (Date.now() - startTime < maxTime) {
		const dx = targetX - bot.entity.position.x;
		const dz = targetZ - bot.entity.position.z;
		const distXZ = Math.sqrt(dx * dx + dz * dz);

		if (distXZ < targetDist) {
			bot.setControlState("forward", false);
			return true;
		}
		await sleep(50);
	}

	bot.setControlState("forward", false);
	return false;
};

// =============================================================================
// MINING
// =============================================================================

/**
 * Mine a block and collect the dropped item
 * Handles distance checking, looking, digging, and item collection
 *
 * @example
 * ```ts
 * const success = await mineAndCollect(bot, logPos, {
 *   isValidBlock: (b) => b?.name.includes("_log") ?? false,
 * });
 * ```
 */
export const mineAndCollect = async (
	bot: Bot,
	pos: Vec3,
	options: MineAndCollectOptions = {},
): Promise<boolean> => {
	const {
		maxMineDistance = 4.5,
		postDigDelay = 100,
		isValidBlock = () => true,
	} = options;

	// Re-fetch the block fresh
	const block = getBlock(bot, pos);
	if (!block || block.name === "air" || !isValidBlock(block)) {
		return true; // Block already gone or invalid
	}

	// Check distance
	const blockCenter = offset(pos, 0.5, 0.5, 0.5);
	const dist = distance(bot.entity.position, blockCenter);

	if (dist > maxMineDistance) {
		logEvent("mine", "too_far", `${dist.toFixed(2)} > ${maxMineDistance}`);
		return false;
	}

	// Look at the block center
	await bot.lookAt(blockCenter);
	await sleep(100);

	// Dig the block
	try {
		await bot.dig(block, true);
	} catch (e) {
		logEvent("mine", "dig_error", String(e));
		return false;
	}

	// Verify it's gone
	await sleep(postDigDelay);
	const after = getBlock(bot, pos);
	if (after && after.name !== "air" && isValidBlock(after)) {
		logEvent("mine", "block_still_there");
		return false;
	}

	// Walk to collect drop
	await bot.collectDrops(6, 3000, async (p) => {
		await goTo(bot, p, { range: 1.4, timeout: 3000 });
	});

	return true;
};

// =============================================================================
// INVENTORY UTILITIES
// =============================================================================

/**
 * Count items in inventory matching a name pattern
 *
 * @example
 * ```ts
 * const logCount = countItems(bot, "_log");
 * const ironIngots = countItems(bot, "iron_ingot");
 * ```
 */
export const countItems = (bot: Bot, namePattern: string): number => {
	return windowItems(bot.inventory)
		.filter((i) => i.name.includes(namePattern))
		.reduce((sum, i) => sum + i.count, 0);
};

/**
 * Check if inventory contains an item matching a pattern
 *
 * @example
 * ```ts
 * if (hasItem(bot, "diamond_pickaxe")) { ... }
 * ```
 */
export const hasItem = (bot: Bot, namePattern: string): boolean => {
	return windowItems(bot.inventory).some((i) => i.name.includes(namePattern));
};

/**
 * Find an item in inventory by name pattern
 *
 * @example
 * ```ts
 * const sword = findItem(bot, "sword");
 * if (sword) await bot.equip(sword, "hand");
 * ```
 */
export const findItem = (bot: Bot, namePattern: string): Item | undefined => {
	return windowItems(bot.inventory).find((i) => i.name.includes(namePattern));
};

/**
 * Equip an item by name pattern if available
 *
 * @example
 * ```ts
 * await equipItem(bot, "sword", "hand");
 * await equipItem(bot, "pickaxe", "hand");
 * ```
 */
export const equipItem = async (
	bot: Bot,
	namePattern: string,
	destination:
		| "hand"
		| "head"
		| "torso"
		| "legs"
		| "feet"
		| "off-hand" = "hand",
): Promise<boolean> => {
	const item = findItem(bot, namePattern);
	if (!item) return false;

	try {
		await bot.equip(item, destination);
		return true;
	} catch {
		return false;
	}
};

// =============================================================================
// ENTITY UTILITIES
// =============================================================================

/**
 * Find entities by name
 *
 * @example
 * ```ts
 * const pigs = findEntities(bot, "pig");
 * const endermen = findEntities(bot, "enderman");
 * ```
 */
export const findEntities = (bot: Bot, name: string): Entity[] => {
	return Object.values(bot.entities).filter((e) => e.name === name);
};

/**
 * Find entities by multiple names
 *
 * @example
 * ```ts
 * const animals = findEntitiesByNames(bot, ["pig", "cow", "sheep", "chicken"]);
 * ```
 */
export const findEntitiesByNames = (bot: Bot, names: string[]): Entity[] => {
	return Object.values(bot.entities).filter(
		(e) => e.name && names.includes(e.name),
	);
};

/**
 * Find the nearest entity matching criteria
 *
 * @example
 * ```ts
 * const nearestPig = findNearestEntity(bot, (e) => e.name === "pig");
 * ```
 */
export const findNearestEntity = (
	bot: Bot,
	filter: (entity: Entity) => boolean,
): Entity | null => {
	const entities = Object.values(bot.entities).filter(filter);
	if (entities.length === 0) return null;

	return (
		entities.sort(
			(a, b) =>
				distance(bot.entity.position, a.position) -
				distance(bot.entity.position, b.position),
		)[0] ?? null
	);
};

// =============================================================================
// BLOCK UTILITIES
// =============================================================================

/**
 * Find a block matching criteria
 * Wrapper around bot.findBlock with better typing
 *
 * @example
 * ```ts
 * const water = findBlock(bot, "water", 64);
 * const log = findBlock(bot, (name) => name.includes("_log"), 64);
 * ```
 */
export const findBlock = (
	bot: Bot,
	matcher: string | ((name: string, stateId: number) => boolean),
	maxDistance = 32,
): Block | null => {
	const matchFn =
		typeof matcher === "string" ? (name: string) => name === matcher : matcher;

	const positions = bot.findBlocks({
		matching: matchFn,
		maxDistance,
		count: 1,
	});

	const pos = positions[0];
	if (!pos) return null;
	return getBlock(bot, pos);
};

/**
 * Find multiple blocks matching criteria
 *
 * @example
 * ```ts
 * const waterBlocks = findBlocks(bot, "water", 64, 100);
 * ```
 */
export const findBlocks = (
	bot: Bot,
	matcher: string | ((name: string, stateId: number) => boolean),
	maxDistance = 32,
	count = 100,
): Vec3[] => {
	const matchFn =
		typeof matcher === "string" ? (name: string) => name === matcher : matcher;

	return bot.findBlocks({
		matching: matchFn,
		maxDistance,
		count,
	});
};

// =============================================================================
// CRAFTING UTILITIES
// =============================================================================

/**
 * Find or place a crafting table
 * Returns the crafting table block or null
 *
 * @example
 * ```ts
 * const table = await getCraftingTable(bot);
 * if (table) {
 *   const recipes = bot.recipesFor(itemId, null, 1, table);
 * }
 * ```
 */
// ── Bot memory: remember resource locations and placed infrastructure ──

interface BotMemory {
	craftingTablePos: { x: number; y: number; z: number } | null;
	furnacePos: { x: number; y: number; z: number } | null;
	resources: Map<string, { x: number; y: number; z: number }[]>;
	// Surface top of the mine staircase — the way back up for resupply.
	mineEntry: { x: number; y: number; z: number } | null;
	// Progress tracker for the water-escape override — last spot we made horizontal
	// progress from while in water, and when. Lets the override tell "wading/swimming
	// ACROSS toward a goal" (keep moving) from "pinned/drowning" (force escape).
	waterProgressPos: { x: number; y: number; z: number } | null;
	waterProgressAt: number;
	// When the bot first entered its current stretch of water — used to bound how far
	// it may wade before we force an escape back, so it never strands mid-lake.
	waterEnterAt: number;
}
const botMemory = new WeakMap<Bot, BotMemory>();

export const getMemory = (bot: Bot): BotMemory => {
	let mem = botMemory.get(bot);
	if (!mem) {
		mem = {
			craftingTablePos: null,
			furnacePos: null,
			resources: new Map(),
			mineEntry: null,
			waterProgressPos: null,
			waterProgressAt: 0,
			waterEnterAt: 0,
		};
		botMemory.set(bot, mem);
	}
	return mem;
};

/**
 * Record the mine's surface entry (the top of the staircase) so the bot can
 * climb back up to resupply. Keeps the highest point seen — i.e. the surface.
 */
export const rememberMineEntry = (
	bot: Bot,
	pos: { x: number; y: number; z: number },
) => {
	const mem = getMemory(bot);
	if (!mem.mineEntry || pos.y > mem.mineEntry.y) {
		mem.mineEntry = {
			x: Math.floor(pos.x),
			y: Math.floor(pos.y),
			z: Math.floor(pos.z),
		};
	}
};

export const getMineEntry = (
	bot: Bot,
): { x: number; y: number; z: number } | null => getMemory(bot).mineEntry;

/**
 * Climb back to the recorded mine entry (surface staircase top). For when the
 * bot needs a surface resource (wood) while deep underground — no point hunting
 * for trees in the dark. Resumable: returns false while still climbing so the
 * caller can retry on the next step tick.
 */
/** Topmost solid (non-air, non-water, non-leaves) block in a column → the y to
 *  stand on at the surface. Used to climb out when the mine-entry memory is gone. */
const surfaceYAt = (bot: Bot, x: number, z: number): number => {
	for (let y = 110; y > 40; y--) {
		const b = bot.blockAt({ x, y, z });
		if (
			b &&
			b.name !== "air" &&
			b.name !== "cave_air" &&
			!b.name.includes("water") &&
			!b.name.includes("leaves")
		)
			return y + 1;
	}
	return 64; // fallback to sea level
};

/**
 * Carve an ASCENDING 2-high staircase up toward targetY. The trick a flat tunnel
 * can't do: we climb by keeping the block ahead at FOOT level as a stair to hop
 * onto, clearing the two blocks above it (plus our own headroom), and jumping up.
 * If the block ahead is air (an open tunnel/cave — no stair to climb), we turn to
 * face solid rock so there's always something to step up onto. Resumable; returns
 * the Y actually reached.
 */
export const digStaircaseUp = async (
	bot: Bot,
	targetY: number,
	deadline: number,
): Promise<number> => {
	const B = (x: number, y: number, z: number) => getBlock(bot, vec3(x, y, z));
	const blocked = (b: ReturnType<typeof getBlock>): boolean =>
		!!b && (b.name.includes("lava") || b.name.includes("water"));
	const solid = (b: ReturnType<typeof getBlock>): boolean =>
		!!b &&
		b.name !== "air" &&
		b.name !== "cave_air" &&
		b.name !== "bedrock" &&
		!blocked(b);
	const digAt = async (b: ReturnType<typeof getBlock>): Promise<void> => {
		if (!solid(b)) return;
		const pos = (b as { position: Vec3 }).position;
		try {
			await bot.lookAt(vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5));
			await Promise.race([
				(bot.dig(b as never, true) as Promise<void>).catch(() => {}),
				sleep(4000),
			]);
			bot.stopDigging();
		} catch {
			/* ignore */
		}
	};
	// Equip any pickaxe so the dig isn't bare-handed-slow.
	const pickSlot = bot.inventory.slots.findIndex((s) =>
		s?.name.endsWith("_pickaxe"),
	);
	if (pickSlot >= 36 && pickSlot <= 44) bot.setQuickBarSlot(pickSlot - 36);
	else if (pickSlot >= 0) {
		try {
			await bot.clickWindow(pickSlot, 0, 0);
			await bot.clickWindow(36, 0, 0);
			bot.setQuickBarSlot(0);
		} catch {
			/* ignore */
		}
	}

	// A placeable block to pillar with (cobblestone is what a miner has plenty of).
	const isFiller = (s: { name: string } | null): boolean =>
		!!s &&
		(s.name.includes("cobblestone") ||
			s.name === "dirt" ||
			s.name === "stone" ||
			s.name.includes("deepslate") ||
			s.name.includes("granite") ||
			s.name.includes("andesite") ||
			s.name.includes("diorite") ||
			s.name.includes("tuff"));
	const equipFiller = (): boolean => {
		// Prefer a filler ALREADY in the hotbar and just SELECT it — reliable. The old
		// code grabbed the first filler anywhere but only equipped it if it happened to
		// be in the hotbar, so a main-inventory filler left the pickaxe held and the
		// place silently no-op'd (the bot "couldn't go up" with an empty-looking slot).
		const hot = bot.inventory.slots.findIndex(
			(s, i) => i >= 36 && i <= 44 && isFiller(s),
		);
		if (hot >= 0) {
			bot.setQuickBarSlot(hot - 36);
			return true;
		}
		const slot = bot.inventory.slots.findIndex(isFiller);
		if (slot < 0) return false;
		// Move one up from the main inventory (ready by the next pillar step).
		void (async () => {
			try {
				await bot.clickWindow(slot, 0, 0);
				await bot.clickWindow(36, 0, 0);
				bot.setQuickBarSlot(0);
			} catch {
				/* ignore */
			}
		})();
		return true;
	};
	const fallable = (b: ReturnType<typeof getBlock>): boolean =>
		!!b && (b.name.includes("sand") || b.name.includes("gravel"));

	let stuck = 0;
	while (Math.floor(bot.entity.position.y) < targetY && Date.now() < deadline) {
		if ((bot.health ?? 20) < 8) break;
		if (bot.entity?.isInWater) break;
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		// Dig the block above our head (fy+2) so we can rise into it. Bail on liquids
		// or falling blocks straight overhead rather than flood/bury ourselves.
		// Dig two blocks of headroom (fy+2, fy+3) so the jump isn't capped short and
		// there's a real apex window to place into. Bail on liquids/falling blocks.
		const ceil = B(fx, fy + 2, fz);
		const ceil2 = B(fx, fy + 3, fz);
		if ([ceil, ceil2].some((b) => blocked(b) || fallable(b))) break;
		await digAt(ceil);
		await digAt(ceil2);
		// Pillar up one: equip a block, look down, hold jump, and SPAM placeBlock under
		// our feet until we rise — in a tight shaft the apex is brief, so a single
		// timed place misses; spamming lands the block the instant the feet clear.
		if (!equipFiller()) break; // out of blocks — can't pillar further
		const floorRef = B(fx, fy - 1, fz);
		if (!floorRef) break;
		await bot.lookAt(vec3(fx + 0.5, fy - 0.5, fz + 0.5), true);
		bot.setControlState("jump", true);
		for (let k = 0; k < 14; k++) {
			await sleep(80);
			// Place ONLY once our feet have cleared the block we stand on (we've jumped
			// above fy) — placing while still at fy is rejected (we occupy the cell).
			if (Math.floor(bot.entity.position.y) > fy) {
				try {
					await Promise.race([
						bot.placeBlock(floorRef as never, vec3(0, 1, 0)) as Promise<void>,
						sleep(1200).then(() => {
							throw new Error("place timeout");
						}),
					]);
				} catch {
					/* missed/hung — retry next spin */
				}
			}
			if (solid(B(fx, fy, fz))) break; // a block landed under us — risen a level
		}
		bot.setControlState("jump", false);
		await sleep(350);

		if (Math.floor(bot.entity.position.y) > fy) stuck = 0;
		else if (++stuck > 5) break;
	}
	bot.clearControlStates();
	return Math.floor(bot.entity.position.y);
};

export const returnToSurface = async (bot: Bot): Promise<boolean> => {
	// Memory is per-bot and a reconnect wipes it, so the recorded mine entry is
	// often gone. Don't give up then — climb straight to the local surface (just
	// above the topmost solid block in our column) and let the pathfinder carve a
	// staircase up. Ponds/rivers to scoop from live up there, not down here.
	const recorded = getMineEntry(bot);
	const p = bot.entity.position;
	const entry = recorded ?? {
		x: Math.floor(p.x),
		y: surfaceYAt(bot, Math.floor(p.x), Math.floor(p.z)),
		z: Math.floor(p.z),
	};
	const atEntry = () => bot.entity.position.y >= entry.y - 4;
	if (atEntry()) return true;
	logEvent(
		"nav",
		"return_to_surface",
		`climbing to y=${entry.y} from y=${Math.floor(bot.entity.position.y)}`,
		bot.entity.position,
	);
	// First let the pathfinder climb — with scaffolding enabled it pillars up open
	// shafts cleanly. If it falls short (rock-capped column where A* would need a huge
	// dig path), fall back to the explicit dig-ceiling + pillar climber.
	await goTo(bot, vec3(entry.x, entry.y, entry.z), {
		range: 2,
		timeout: 45000,
	});
	if (!atEntry()) {
		logEvent(
			"nav",
			"staircase_up",
			`goTo fell short at y=${Math.floor(bot.entity.position.y)} → digStaircaseUp`,
			bot.entity.position,
		);
		await digStaircaseUp(bot, entry.y, Date.now() + 50000);
	}
	const reached = atEntry();
	if (reached) logEvent("nav", "reached_surface", undefined, bot.entity.position);
	return reached;
};

export const rememberResource = (
	bot: Bot,
	name: string,
	pos: { x: number; y: number; z: number },
) => {
	const mem = getMemory(bot);
	const list = mem.resources.get(name) ?? [];
	if (
		!list.some(
			(p) =>
				Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y) + Math.abs(p.z - pos.z) <
				3,
		)
	) {
		list.push({
			x: Math.floor(pos.x),
			y: Math.floor(pos.y),
			z: Math.floor(pos.z),
		});
		mem.resources.set(name, list);
	}
};

// Ore/log names the bot passively remembers as chunks stream in (blockSeen fires for
// air-adjacent blocks — no X-ray, no scanning). NOT "water": it's so common that the
// blockSeen firehose blocks the event loop and the bot keepalive-times-out.
const WATCHED_BLOCKS = [
	"oak_log",
	"birch_log",
	"spruce_log",
	"jungle_log",
	"acacia_log",
	"dark_oak_log",
	"coal_ore",
	"deepslate_coal_ore",
	"iron_ore",
	"deepslate_iron_ore",
];

/**
 * Wire up the bot's passive block memory: watch the ore/log blocks and remember each
 * one the world exposes (blockSeen). Production (main.ts) AND the gym harness both need
 * this — without it a bot has no ore memory and ore-finding falls back to line-of-sight
 * findBlock only, which makes the gym strictly harder than a real run.
 */
export const registerBlockMemory = (bot: Bot): void => {
	for (const name of WATCHED_BLOCKS) bot.watchBlocks.add(name);
	bot.on("blockSeen", (name: string, pos: { x: number; y: number; z: number }) => {
		rememberResource(bot, name, pos);
	});
};

export const getRememberedResource = (
	bot: Bot,
	name: string,
	skipYFilter = false,
): { x: number; y: number; z: number } | null => {
	const mem = getMemory(bot);
	const list = mem.resources.get(name);
	if (!list || list.length === 0) return null;
	// Return nearest reachable — skip blocks >10 Y away (can't pathfind through solid rock)
	const botY = bot.entity.position.y;
	let nearest: { x: number; y: number; z: number } | null = null;
	let nearestDist = Infinity;
	for (const p of list) {
		if (!skipYFilter && Math.abs(p.y - botY) > 10) continue;
		const d = distance(bot.entity.position, vec3(p.x, p.y, p.z));
		if (d < nearestDist) {
			nearestDist = d;
			nearest = p;
		}
	}
	return nearest;
};

export const forgetResource = (
	bot: Bot,
	name: string,
	pos: { x: number; y: number; z: number },
) => {
	const mem = getMemory(bot);
	const list = mem.resources.get(name);
	if (!list) return;
	const idx = list.findIndex(
		(p) =>
			Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y) + Math.abs(p.z - pos.z) < 3,
	);
	if (idx >= 0) list.splice(idx, 1);
};

/**
 * Robustly perform a flaky block interaction. On 26.1.2, placeBlock /
 * activateItem / activateBlock / dig land only ~70-85% per attempt — a single
 * shot is the root of the "Need crafting table" / "Failed to fill bucket" style
 * failures. Each attempt: get within reach, face the target, run the action,
 * then verify — retrying until `verify()` passes. Returns true on success.
 */
export const interactReliably = async (
	bot: Bot,
	opts: {
		target: Vec3;
		action: () => Promise<void>;
		verify: () => boolean;
		reach?: number;
		attempts?: number;
		settleMs?: number;
	},
): Promise<boolean> => {
	const { target, action, verify } = opts;
	const reach = opts.reach ?? 3;
	const attempts = opts.attempts ?? 4;
	const settleMs = opts.settleMs ?? 600;
	const center = offset(target, 0.5, 0.5, 0.5);
	for (let i = 0; i < attempts; i++) {
		if (verify()) return true;
		try {
			if (distance(bot.entity.position, center) > reach) {
				await moveCloser(bot, target, { maxDistance: reach });
			}
			await bot.lookAt(center, true);
			await sleep(150);
			await action();
		} catch {
			/* retry */
		}
		await sleep(settleMs);
		if (verify()) return true;
	}
	return false;
};

// Blocks that are NOT solid ground / are passable, for station placement.
const STATION_NON_SOLID = new Set([
	"air",
	"cave_air",
	"water",
	"lava",
	"short_grass",
	"tall_grass",
	"fern",
	"large_fern",
	"dead_bush",
	"dandelion",
	"poppy",
	"blue_orchid",
	"allium",
	"azure_bluet",
	"red_tulip",
	"orange_tulip",
	"white_tulip",
	"pink_tulip",
	"oxeye_daisy",
	"cornflower",
	"lily_of_the_valley",
	"vine",
	"snow_layer",
	"torch",
	"wall_torch",
	"leaf_litter",
]);
const isStationGround = (name: string): boolean =>
	!STATION_NON_SOLID.has(name) &&
	!name.includes("leaves") &&
	!name.includes("sapling");
const isStationClear = (name: string): boolean =>
	name === "air" || name === "cave_air" || STATION_NON_SOLID.has(name);

/**
 * Get an item into the hand reliably. If it's already in the hotbar (slots
 * 36-44) just SELECT that slot — a plain setQuickBarSlot, which never fails;
 * bot.equip's window-move is flaky on 26.1.2 and routinely left a stray block
 * (cobblestone) held instead. Falls back to bot.equip for main-inventory slots.
 * Returns true once the item is actually held.
 */
const equipToHand = async (bot: Bot, itemName: string): Promise<boolean> => {
	for (let e = 0; e < 4 && bot.heldItem?.name !== itemName; e++) {
		const slot = bot.inventory.slots.findIndex(
			(s) => s != null && s.name === itemName,
		);
		if (slot < 0) return false;
		try {
			if (slot >= 36 && slot <= 44) {
				bot.setQuickBarSlot(slot - 36);
			} else {
				const item = bot.inventory.slots[slot];
				if (item) await bot.equip(item, "hand");
			}
		} catch {}
		await sleep(150);
	}
	return bot.heldItem?.name === itemName;
};

// Tool tiers, best → worst, for "always mine with the best tool".
const PICKAXES = [
	"netherite_pickaxe",
	"diamond_pickaxe",
	"iron_pickaxe",
	"stone_pickaxe",
	"golden_pickaxe",
	"wooden_pickaxe",
];
const AXES = [
	"netherite_axe",
	"diamond_axe",
	"iron_axe",
	"stone_axe",
	"golden_axe",
	"wooden_axe",
];
const SHOVELS = [
	"netherite_shovel",
	"diamond_shovel",
	"iron_shovel",
	"stone_shovel",
	"golden_shovel",
	"wooden_shovel",
];

const toolListForBlock = (name: string): string[] => {
	if (
		name.includes("log") ||
		name.includes("_wood") ||
		name.includes("planks") ||
		name.includes("_stem") ||
		name.includes("_hyphae") ||
		name === "crafting_table" ||
		name === "bookshelf" ||
		name === "chest" ||
		name === "barrel" ||
		name === "ladder"
	)
		return AXES;
	if (
		name.includes("dirt") ||
		name.includes("sand") ||
		name === "gravel" ||
		name === "clay" ||
		name === "grass_block" ||
		name === "podzol" ||
		name === "mycelium" ||
		name === "mud" ||
		name === "soul_sand" ||
		name === "soul_soil" ||
		name === "farmland" ||
		name.includes("snow")
	)
		return SHOVELS;
	return PICKAXES; // stone / ore / deepslate / obsidian / metal / default
};

/** Equip the best available pickaxe (tier-ordered). Returns true if one was held. */
export const equipBestPickaxe = async (bot: Bot): Promise<boolean> => {
	const has = (t: string) => bot.inventory.slots.some((s) => s?.name === t);
	const best = PICKAXES.find(has);
	if (!best) return false;
	return equipToHand(bot, best);
};

/**
 * Equip the best tool for `block` (pickaxe for stone/ore, axe for wood, shovel for
 * soil), falling back to the best pickaxe — a TOOL, never a held block. No-op when
 * the right tool is already in hand, so it's cheap to call before every dig.
 */
export const equipBestTool = async (
	bot: Bot,
	block: Block | null,
): Promise<void> => {
	const has = (t: string) => bot.inventory.slots.some((s) => s?.name === t);
	const list = toolListForBlock(block?.name ?? "");
	const best = list.find(has) ?? PICKAXES.find(has);
	if (best) await equipToHand(bot, best);
};

/**
 * Place a "station" block (crafting_table / furnace) on solid ground beside the
 * bot, CARVING a niche in place when wedged in a 1-wide tunnel that has no
 * naturally-valid spot. Verifies the block actually landed — placeBlock is
 * server-rejected ~15-30% of the time, consuming the item client-side without
 * placing anything, which was a root cause of the furnace/table churn (the lost
 * item flips hasFurnace false → re-craft loop). Returns the placed Block, or
 * null if even carving can't make room (caller then fails and the run-loop's
 * abort-and-relocate eventually moves the bot to fresh ground).
 */
export const placeStationBlock = async (
	bot: Bot,
	itemName: string,
): Promise<Block | null> => {
	await bot.waitForChunksToLoad();

	const R = 0.31; // player half-width + epsilon
	// True if a block placed on top of ground `g` would intersect our hitbox
	// (placing into our own body silently no-ops — common wedged in a 1-wide shaft).
	const clipsBot = (g: Vec3): boolean => {
		const p = bot.entity.position;
		return (
			p.x + R > g.x &&
			p.x - R < g.x + 1 &&
			p.z + R > g.z &&
			p.z - R < g.z + 1 &&
			p.y + 1.8 > g.y + 1 &&
			p.y < g.y + 2
		);
	};

	// Never [0,0] — that's the block under our own feet (inside our hitbox).
	const positions: [number, number][] = [
		[1, 0],
		[0, 1],
		[-1, 0],
		[0, -1],
		[1, 1],
		[-1, 1],
		[1, -1],
		[-1, -1],
	];
	for (let i = positions.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const a = positions[i];
		const b = positions[j];
		if (a && b) {
			positions[i] = b;
			positions[j] = a;
		}
	}

	// 1. A naturally valid spot: solid floor beside us with clear air above it.
	const scan = (): Block | null => {
		for (const [dx, dz] of positions) {
			const cand = getBlock(bot, offset(bot.entity.position, dx, -1, dz));
			if (!cand || !isStationGround(cand.name)) continue;
			if (clipsBot(cand.position)) continue;
			const above = getBlock(bot, offset(cand.position, 0, 1, 0));
			if (!above || !isStationClear(above.name)) continue;
			return cand;
		}
		return null;
	};

	let ground = scan();

	// 2. Carve in place: dig the side-wall block at foot level to expose the solid
	//    floor below it — guarantees a non-clipping spot in any 1-wide tunnel,
	//    instead of looping forever on "no place". Never breach a fluid.
	if (!ground) {
		for (const [dx, dz] of positions) {
			const cand = getBlock(bot, offset(bot.entity.position, dx, -1, dz));
			if (!cand || !isStationGround(cand.name)) continue;
			if (clipsBot(cand.position)) continue;
			const wall = getBlock(bot, offset(cand.position, 0, 1, 0)); // side cell
			if (!wall || isStationClear(wall.name)) continue; // already clear / unloaded
			if (wall.name === "water" || wall.name === "lava") continue;
			try {
				await bot.lookAt(offset(wall.position, 0.5, 0.5, 0.5), true);
				await bot.dig(wall);
				await sleep(250);
			} catch {
				continue;
			}
			if (isStationClear(getBlock(bot, wall.position)?.name ?? "")) {
				ground = cand;
				break;
			}
		}
	}

	// 2b. Still no adjacent spot — commonly the bot is perched on tree LEAVES after
	//     chopping wood (block_below=oak_leaves), where nothing around is valid station
	//     ground, so it looped "Need crafting table" forever while HOLDING the table.
	//     Walk to the nearest real solid ground within a few blocks and re-scan.
	if (!ground) {
		const bp = bot.entity.position;
		let best: Vec3 | null = null;
		let bestD = Infinity;
		for (let dx = -4; dx <= 4; dx++) {
			for (let dz = -4; dz <= 4; dz++) {
				if (Math.abs(dx) + Math.abs(dz) < 2) continue;
				const floor = getBlock(bot, offset(bp, dx, -1, dz));
				if (!floor || !isStationGround(floor.name)) continue;
				const air = getBlock(bot, offset(bp, dx, 0, dz));
				if (!air || !isStationClear(air.name)) continue;
				const d = dx * dx + dz * dz;
				if (d < bestD) {
					bestD = d;
					best = offset(floor.position, 0, 1, 0);
				}
			}
		}
		if (best) {
			try {
				await goTo(bot, best, { range: 1, timeout: 6000 });
			} catch {}
			ground = scan();
		}
	}

	if (!ground) {
		logEvent("craft", "station_no_ground", JSON.stringify({ item: itemName }));
		return null;
	}
	const g: Block = ground;
	const dest = offset(g.position, 0, 1, 0);

	// 3. Equip the item to hand (hotbar-select is reliable; bot.equip for main inv).
	if (!findItem(bot, itemName)) {
		logEvent("craft", "station_no_item", JSON.stringify({ item: itemName }));
		return null;
	}
	await equipToHand(bot, itemName);

	// 3b. Clear a replaceable ground-cover plant occupying the dest cell (26.x
	//     `leaf_litter`, `short_grass`, flowers, `tall_grass`, …). The scan counts
	//     these as "clear", but placing a station block INTO one is CONSUMED yet lands
	//     NO block — so the table is lost and the bot loops "Craft Crafting Table"
	//     forever (the live "destNow: leaf_litter" failure). Break it first.
	const destPlant = getBlock(bot, dest);
	if (
		destPlant &&
		destPlant.name !== "air" &&
		destPlant.name !== "cave_air" &&
		!destPlant.name.includes("water") &&
		!destPlant.name.includes("lava")
	) {
		try {
			await bot.lookAt(offset(dest, 0.5, 0.5, 0.5), true);
			await bot.dig(destPlant as never);
			await sleep(200);
		} catch {
			/* fall through — interactReliably retries the place regardless */
		}
		await equipToHand(bot, itemName); // re-select the table if the dig swapped tools
	}

	// 4. Place + verify via interactReliably — it only returns true once the block
	//    is confirmed at dest, re-equipping each attempt so a server-rejected
	//    (item-consumed-but-no-block) try self-heals once the inventory re-syncs.
	logEvent(
		"craft",
		"station_placing",
		JSON.stringify({ item: itemName, dest, ground: g.name }),
	);
	const landed = await interactReliably(bot, {
		target: g.position,
		action: async () => {
			// Never place a stray held block (e.g. cobblestone from mining) — only
			// place when the station itself is in hand. If it won't equip, throw so
			// interactReliably retries/fails cleanly instead of dropping the wrong block.
			if (
				bot.heldItem?.name !== itemName &&
				!(await equipToHand(bot, itemName))
			) {
				throw new Error(`not holding ${itemName}`);
			}
			await bot.placeBlock(g, vec3(0, 1, 0));
		},
		verify: () => getBlock(bot, dest)?.name === itemName,
		reach: 4,
		attempts: 4,
		settleMs: 300,
	});

	if (landed) {
		const placed = getBlock(bot, dest);
		if (placed && placed.name === itemName) {
			logEvent(
				"craft",
				"station_placed",
				JSON.stringify({ at: dest, item: itemName }),
			);
			return placed;
		}
	}
	const nearby = findBlock(bot, itemName, 4);
	if (nearby) {
		logEvent(
			"craft",
			"station_placed",
			JSON.stringify({ at: nearby.position, item: itemName, viaSearch: true }),
		);
		return nearby;
	}
	logEvent(
		"craft",
		"station_place_failed",
		JSON.stringify({
			item: itemName,
			destNow: getBlock(bot, dest)?.name ?? "unloaded",
			heldAfter: bot.heldItem?.name ?? null,
			inInv: !!findItem(bot, itemName),
		}),
	);
	return null;
};

export const getCraftingTable = async (bot: Bot): Promise<Block | null> => {
	const mem = getMemory(bot);

	// Check remembered position — walk back to it rather than abandoning it. The old
	// 50-block gate stranded far-ranging bots: a bot that mined iron 50+ blocks from its
	// table would FORGET the table, then (out of planks) deadlock re-gathering wood in a
	// worked-out area — right at the portal's doorstep. Walking back even 150 blocks to a
	// known-good table beats an impossible wood-gather.
	if (mem.craftingTablePos) {
		const d = distance(
			bot.entity.position,
			vec3(
				mem.craftingTablePos.x,
				mem.craftingTablePos.y,
				mem.craftingTablePos.z,
			),
		);
		if (d < 150) {
			const remembered = getBlock(
				bot,
				vec3(
					mem.craftingTablePos.x,
					mem.craftingTablePos.y,
					mem.craftingTablePos.z,
				),
			);
			if (remembered && remembered.name === "crafting_table") {
				try {
					if (d > 4) {
						await goTo(bot, remembered.position, { range: 2, timeout: 30000 });
					} else {
						await moveCloser(bot, remembered.position, { maxDistance: 3 });
					}
				} catch {}
				const actualDist = distance(bot.entity.position, remembered.position);
				logEvent(
					"craft",
					"table_remembered",
					JSON.stringify({
						dist: Math.floor(d),
						actualDist: Math.floor(actualDist),
					}),
				);
				if (actualDist <= 6) {
					return remembered;
				}
				// Still too far — forget and place a new one
				logEvent(
					"craft",
					"table_too_far",
					JSON.stringify({ actualDist: Math.floor(actualDist) }),
				);
				mem.craftingTablePos = null;
			}
		}
		// Table gone or too far — forget it
		mem.craftingTablePos = null;
	}

	// Check if one is already nearby
	const table = findBlock(bot, "crafting_table", 16);
	if (table) {
		mem.craftingTablePos = {
			x: table.position.x,
			y: table.position.y,
			z: table.position.z,
		};
		logEvent("craft", "table_found");
		return table;
	}

	// Recover a table that crafting may have stranded in the grid before deciding
	// we need a fresh one (otherwise we waste planks re-crafting one we already have).
	await reclaimCraftingGrid(bot);
	// Try to place one from inventory — craft one from planks if needed
	let tableItem = findItem(bot, "crafting_table");
	if (!tableItem) {
		// Try crafting a new table from planks (need 4)
		let planks = countItems(bot, "planks");
		// Deep in a mine we often have logs but fewer than 4 spare planks (3 is
		// enough to attempt a pickaxe but not a table) — top up from a log first.
		if (planks < 4) {
			const log = windowItems(bot.inventory).find((i) =>
				i.name.includes("_log"),
			);
			const plankId =
				log && bot.registry
					? (bot.registry.itemsByName.get(log.name.replace("_log", "_planks"))
							?.id ?? bot.registry.itemsByName.get("oak_planks")?.id)
					: undefined;
			if (plankId) {
				try {
					const recipe = bot.recipesFor(plankId, null, 1, null)[0];
					if (recipe) await bot.craft(recipe, 1); // 1 log → 4 planks
				} catch {
					/* fall through to the planks check */
				}
				planks = countItems(bot, "planks");
			}
		}
		if (planks >= 4) {
			logEvent("craft", "table_crafting", "crafting new table from planks");
			const result = await craftItem(bot, "crafting_table", 1);
			if (result.success) {
				tableItem = findItem(bot, "crafting_table");
			}
		}
		if (!tableItem) {
			logEvent("craft", "table_missing", "not in inventory");
			return null;
		}
	}

	let placed = await placeStationBlock(bot, "crafting_table");
	// Placement can fail on the FIRST spot — a cramped mined tunnel where bot.placeBlock
	// never registers (destNow:air) or a transient interaction desync under load. The bot
	// then loops "Need crafting table" while HOLDING the table forever (seen at y38). Step
	// a couple blocks to a fresh spot and retry instead of hammering the same dead cell.
	for (let tries = 0; !placed && tries < 3; tries++) {
		const bp = bot.entity.position;
		const dirs: [number, number][] = [
			[2, 0],
			[0, 2],
			[-2, 0],
			[0, -2],
		];
		const [dx, dz] = dirs[tries % dirs.length] ?? [2, 0];
		try {
			await goTo(
				bot,
				vec3(Math.floor(bp.x) + dx, Math.floor(bp.y), Math.floor(bp.z) + dz),
				{ range: 0, timeout: 5000 },
			);
		} catch {}
		placed = await placeStationBlock(bot, "crafting_table");
	}
	if (placed) {
		mem.craftingTablePos = {
			x: placed.position.x,
			y: placed.position.y,
			z: placed.position.z,
		};
	}
	return placed;
};

/**
 * Craft an item by name
 * Handles recipe lookup and crafting
 *
 * @example
 * ```ts
 * const result = await craftItem(bot, "wooden_pickaxe", 1, table);
 * const result = await craftItem(bot, "stick", 8); // No table needed
 * ```
 */
/**
 * Shift-click any items stranded in the player's crafting grid (the 2x2 slots
 * before the inventory section) back into the main inventory. A crafted result
 * left in the grid is INVISIBLE to windowItems() — which only reads the
 * inventory section — so the bot "loses" furnaces/tables it actually holds and
 * hot-spins ("No furnace in inventory"). Operates on bot.inventory (the player
 * window), so it's safe to call any time; skips the 4 armor slots.
 */
export const reclaimCraftingGrid = async (bot: Bot): Promise<void> => {
	const win = bot.inventory;
	// Slots 0..inventoryStart = output(0) + 2x2 craft grid + 4 armor slots. Sweep
	// the output + grid (everything except the 4 armor slots right before the
	// inventory) so we never accidentally unequip armor.
	const gridEnd = Math.max(0, win.inventoryStart - 4);
	// Sweep HIGH→LOW so the 2x2 grid ingredients (slots 1..gridEnd-1) are pulled out
	// BEFORE the output slot (0). Order is load-bearing: shift-clicking the output
	// *crafts* whatever recipe the grid currently forms, so if we hit slot 0 while a
	// stray plank still sits in the grid we mint a junk oak_button (and consume the
	// plank) instead of reclaiming it. Emptying the grid first breaks the recipe, so
	// by the time we reach slot 0 it holds only a genuinely-stranded crafted result.
	for (let slot = gridEnd - 1; slot >= 0; slot--) {
		const s = win.slots[slot];
		if (s && s.count > 0) {
			try {
				await bot.clickWindow(slot, 0, 1); // shift-click → main inventory
				await sleep(80);
			} catch {}
		}
	}
};

export const craftItem = async (
	bot: Bot,
	itemName: string,
	count = 1,
	craftingTable?: Block | null,
): Promise<StepResult> => {
	const itemId = bot.registry?.itemsByName.get(itemName)?.id;
	if (!itemId) {
		return { success: false, message: `Unknown item: ${itemName}` };
	}

	// Close stale windows to avoid inventory desync
	if (bot.currentWindow) {
		try {
			bot.closeWindow(bot.currentWindow);
		} catch {}
		await sleep(300);
	}

	const recipes = bot.recipesFor(itemId, null, 1, craftingTable ? true : null);

	if (recipes.length === 0) {
		logEvent("craft", "no_recipe", `${itemName} (id=${itemId})`);
		return { success: false, message: `No recipe for ${itemName}` };
	}

	// Build tag-equivalent groups: typecraft resolves tags (e.g. #minecraft:planks)
	// to only the first item (oak_planks). We need to accept ANY variant.
	const tagGroups = buildTagGroups(bot);

	// Pick a recipe whose ingredients we actually have (with tag substitution)
	const win = bot.inventory;
	const hasIngredient = (id: number): boolean => {
		const ids = tagGroups.get(id) ?? [id];
		return ids.some((altId) =>
			win.slots.some((s) => s && s.type === altId && s.count > 0),
		);
	};

	const countOf = (someId: number): number =>
		win.slots.reduce((n, s) => n + (s && s.type === someId ? s.count : 0), 0);
	const resolveId = (id: number): number => {
		// Pick the tag variant we hold the MOST of, not the first one we have ANY of.
		// A shaped recipe repeats one ingredient id across cells (a table = 4×#planks),
		// and bot.craft fills every cell from a SINGLE resolved item — so with 1 oak +
		// 14 birch, resolving to oak (held, but only 1) needs 4 oak and fails forever.
		// Birch (14) fulfils all four cells.
		const candidates = [id, ...(tagGroups.get(id) ?? [])];
		let best = id;
		let bestCount = -1;
		for (const c of candidates) {
			const n = countOf(c);
			if (n > bestCount) {
				bestCount = n;
				best = c;
			}
		}
		return best;
	};

	const recipe = recipes.find((r) => {
		if (r.inShape) {
			return r.inShape.every((row) =>
				row.every((item) => item.id === -1 || hasIngredient(item.id)),
			);
		}
		if (r.ingredients) {
			return r.ingredients.every((item) => hasIngredient(item.id));
		}
		return false;
	});

	if (!recipe) {
		return { success: false, message: `No matching recipe for ${itemName}` };
	}

	// Clone recipe with substituted ingredient IDs so bot.craft() finds the right items
	const fixedRecipe = {
		...recipe,
		inShape:
			recipe.inShape?.map((row) =>
				row.map((item) =>
					item.id === -1 ? item : { ...item, id: resolveId(item.id) },
				),
			) ?? null,
		ingredients:
			recipe.ingredients?.map((item) => ({
				...item,
				id: resolveId(item.id),
			})) ?? null,
	};

	// bot.craft opens a table via activateBlock + `once(windowOpen, 5000)` — if
	// we're out of reach or not facing it, the window never opens and it throws
	// "Promise timed out". So get in reach + face the table first, and retry once
	// (the activate occasionally misses even in range). This is the #1 cause of
	// the "Promise timed out" / "Need crafting table" failures that stall races.
	const attemptCraft = async () => {
		if (craftingTable) {
			try {
				// Get in interact range BEFORE crafting. moveCloser is only a short nudge;
				// when a preempting step (e.g. Mine Cobblestone, via failure-backoff) has
				// dragged the bot ~6+ blocks off the table between attempts, the nudge
				// can't close it and bot.craft dies "Too far to interact (dist=6.4,
				// max=6)" — the pickaxe never gets made and the run churns craft↔mine
				// forever. Pathfind in whenever we're beyond a nudge's reach.
				const d = distance(bot.entity.position, craftingTable.position);
				if (d > 3) {
					await goTo(bot, craftingTable.position, { range: 2, timeout: 12000 });
				} else {
					await moveCloser(bot, craftingTable.position, { maxDistance: 2.5 });
				}
				await bot.lookAt(offset(craftingTable.position, 0.5, 0.5, 0.5), true);
				await sleep(150);
			} catch {}
		}
		await bot.craft(fixedRecipe, count, craftingTable ?? undefined);
	};

	// Baseline so we can VERIFY the crafted item actually reached the inventory section
	// (not left stranded in the 2x2 grid by a window desync under load). Returning a
	// phantom success while the item is stranded leaves hasCraftingTable false, so
	// craft_table + getCraftingTable churn forever ("Crafted 1x crafting_table" →
	// "table_missing: not in inventory" → repeat), which stalled whole races.
	const beforeCount = countItems(bot, itemName);
	let lastErr: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await attemptCraft();
			await sleep(500);
			if (bot.currentWindow) {
				try {
					bot.closeWindow(bot.currentWindow);
				} catch {}
				await sleep(400);
			}
			// Recover anything left in the craft grid so the crafted result isn't
			// stranded there (invisible to windowItems → phantom "no furnace" loops).
			await reclaimCraftingGrid(bot);
			if (countItems(bot, itemName) > beforeCount) {
				return { success: true, message: `Crafted ${count}x ${itemName}` };
			}
			// Craft threw no error but the result isn't in the inventory — stranded in
			// the grid (window desync). Let it resync, reclaim once more, then re-check;
			// only re-craft (next loop) if it's genuinely still missing.
			logEvent("craft", "craft_unverified", `${itemName} not in inv (before=${beforeCount})`);
			await sleep(500);
			await reclaimCraftingGrid(bot);
			if (countItems(bot, itemName) > beforeCount) {
				return { success: true, message: `Crafted ${count}x ${itemName}` };
			}
		} catch (err) {
			lastErr = err;
			logEvent(
				"craft",
				"craft_retry",
				`${itemName} attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`,
			);
			if (bot.currentWindow) {
				try {
					bot.closeWindow(bot.currentWindow);
				} catch {}
				await sleep(400);
			}
			await sleep(300);
		}
	}
	// Recover ingredients/results left in the grid by a failed/partial craft.
	await reclaimCraftingGrid(bot);
	const msg =
		lastErr instanceof Error ? lastErr.message : `Failed to craft ${itemName}`;
	logEvent("craft", "error", `${itemName}: ${msg}`);
	return { success: false, message: msg };
};

/** Build map of tag-equivalent item IDs. Each member maps to the full group. */
const buildTagGroups = (bot: Bot): Map<number, number[]> => {
	const registry = bot.registry;
	if (!registry) return new Map();

	const groups = new Map<number, number[]>();

	const addGroup = (names: string[]) => {
		const ids = names
			.map((n) => registry.itemsByName.get(n)?.id)
			.filter((id): id is number => id !== undefined);
		if (ids.length <= 1) return;
		for (const id of ids) groups.set(id, ids);
	};

	addGroup([
		"oak_planks",
		"spruce_planks",
		"birch_planks",
		"jungle_planks",
		"acacia_planks",
		"dark_oak_planks",
		"pale_oak_planks",
		"crimson_planks",
		"warped_planks",
		"mangrove_planks",
		"bamboo_planks",
		"cherry_planks",
	]);

	addGroup([
		"oak_log",
		"spruce_log",
		"birch_log",
		"jungle_log",
		"acacia_log",
		"dark_oak_log",
		"pale_oak_log",
		"mangrove_log",
		"cherry_log",
	]);

	addGroup(["coal", "charcoal"]);

	return groups;
};

// =============================================================================
// COMBAT UTILITIES
// =============================================================================

/**
 * Attack an entity repeatedly until dead or escaped
 *
 * @example
 * ```ts
 * const killed = await attackUntilDead(bot, blaze, { maxHits: 15 });
 * ```
 */
export const attackUntilDead = async (
	bot: Bot,
	entity: Entity,
	options: { maxHits?: number; hitDelay?: number; lookHeight?: number } = {},
): Promise<boolean> => {
	const { maxHits = 10, hitDelay = 400, lookHeight = 1 } = options;

	for (let i = 0; i < maxHits; i++) {
		// Check if entity still exists
		if (!bot.entities[entity.id]) {
			return true; // Dead
		}

		try {
			await bot.lookAt(offset(entity.position, 0, lookHeight, 0));
			await bot.attack(entity);
		} catch {
			return false; // Lost target
		}

		await sleep(hitDelay);
	}

	return !bot.entities[entity.id];
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Sleep for a specified duration
 *
 * @example
 * ```ts
 * await sleep(1000); // Wait 1 second
 * ```
 */
export const sleep = (ms: number): Promise<void> => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Create a success result
 */
export const success = (message: string): StepResult => ({
	success: true,
	message,
});

/**
 * Create a failure result
 */
export const failure = (message: string): StepResult => ({
	success: false,
	message,
});

/**
 * Wrap an error into a failure result
 */
export const errorResult = (err: unknown, fallback: string): StepResult => ({
	success: false,
	message: err instanceof Error ? err.message : fallback,
});

// =============================================================================
// WATER HANDLING
// =============================================================================

/**
 * If bot is in water, swim up and try to get to land.
 * Holds jump to swim up, then walks forward to find shore.
 */
// ── Water-state predicates (shared by escapeWater, the safety guard, and the
//    dashboard override) ──────────────────────────────────────────────────
//
// Passable plants/blocks the bot floats or walks straight through — they're
// never solid footing and never an ascendable ceiling.
const PASSABLE_BLOCKS = new Set([
	"ladder",
	"scaffolding",
	"short_grass",
	"tall_grass",
	"fern",
	"large_fern",
	"seagrass",
	"tall_seagrass",
	"kelp",
	"kelp_plant",
	"lily_pad",
	"sugar_cane",
	"snow",
	"snow_layer",
]);
const isPassableBlock = (b: ReturnType<typeof getBlock>): boolean =>
	!b ||
	b.name === "air" ||
	b.name === "cave_air" ||
	b.name.includes("water") ||
	b.name.includes("vine") ||
	b.name.includes("grass") ||
	PASSABLE_BLOCKS.has(b.name);
const isStandableGround = (
	b: ReturnType<typeof getBlock>,
): b is NonNullable<ReturnType<typeof getBlock>> =>
	!!b &&
	b.name !== "air" &&
	b.name !== "cave_air" &&
	!b.name.includes("water") &&
	!b.name.includes("lily") &&
	!b.name.includes("vine") &&
	!b.name.includes("leaves") &&
	b.name !== "bedrock" &&
	!PASSABLE_BLOCKS.has(b.name);

/** Truly out of water: standing (onGround) on real solid ground — NOT in water,
 *  NOT on a lily pad floating on water, NOT mid-bob with a momentarily dry head. */
export const isOnDryLand = (bot: Bot): boolean => {
	const e = bot.entity;
	if (!e?.position || e.isInWater || !e.onGround) return false;
	const fx = Math.floor(e.position.x);
	const fy = Math.floor(e.position.y);
	const fz = Math.floor(e.position.z);
	if (getBlock(bot, vec3(fx, fy + 1, fz))?.name.includes("water")) return false;
	if (getBlock(bot, vec3(fx, fy, fz))?.name.includes("lily")) return false;
	const support = getBlock(bot, vec3(fx, fy - 1, fz));
	if (!support || support.name.includes("water") || support.name.includes("lily"))
		return false;
	return true;
};

/** In a water trap: actually in water, OR bobbing just above deep water (not on
 *  ground, water within 2 below), OR perched on a lily pad. This is the stable
 *  signal — a momentary bob above the surface still reads as trapped, so the
 *  override doesn't flicker off and the escape keeps working. */
export const isInWaterTrap = (bot: Bot): boolean => {
	const e = bot.entity;
	if (!e?.position) return false;
	if (e.isInWater) return true;
	const fx = Math.floor(e.position.x);
	const fy = Math.floor(e.position.y);
	const fz = Math.floor(e.position.z);
	if (!e.onGround) {
		for (let dy = 0; dy >= -2; dy--) {
			if (getBlock(bot, vec3(fx, fy + dy, fz))?.name.includes("water")) return true;
		}
		return false;
	}
	for (const dy of [0, -1]) {
		const b = getBlock(bot, vec3(fx, fy + dy, fz));
		if (b && (b.name.includes("lily") || b.name.includes("water"))) return true;
	}
	return false;
};

/** Progress-aware trigger for the escape_water OVERRIDE (priority-0 step). Pure
 *  isInWaterTrap trips on ANY water-at-feet, so it drags the bot back to shore every
 *  time it tries to WADE/SWIM ACROSS water toward a goal (e.g. the only trees are on
 *  the far side of a lake) — an endless enter→escape→enter loop that never crosses.
 *  So only demand an escape when the bot is genuinely drowning or pinned, NOT while
 *  it's crossing:
 *    - head underwater (isInWater) → escape now: typecraft has NO buoyancy, so it
 *      sinks and drowns in deep water; the only water it can traverse is shallow
 *      (head-up) anyway, so a submerged head means real trouble.
 *    - in a water trap but head-up AND no horizontal progress for ~4s → pinned at a
 *      bank → escape (the carve-a-stair logic takes over).
 *  A genuine crossing keeps moving, so it never trips — the bot is free to reach the
 *  far side, and only once it's actually stuck does the override kick in. */
export const needsWaterEscape = (bot: Bot): boolean => {
	const mem = getMemory(bot);
	if (!isInWaterTrap(bot)) {
		mem.waterProgressPos = null;
		mem.waterEnterAt = 0;
		return false;
	}
	if (bot.entity?.isInWater) return true; // submerged → drowning risk, escape now
	const now = Date.now();
	if (!mem.waterEnterAt) mem.waterEnterAt = now;
	// BOUND the crossing. Wading across a stream/puddle is fine, but without a limit
	// the bot swims deep into a lake/ocean chasing a goal on the far side and strands
	// 100+ blocks from any shore, unable to escape (seen: 14 min, 7k swims mid-lake).
	// After ~8s continuously in water it's no longer a quick wade — escape NOW, while
	// the entry shore is still inside dryTargets' ~16-block scan, and go back.
	if (now - mem.waterEnterAt > 8000) return true;
	const p = bot.entity?.position;
	if (!p) return true;
	const prev = mem.waterProgressPos;
	if (!prev || Math.hypot(p.x - prev.x, p.z - prev.z) > 1.5) {
		mem.waterProgressPos = { x: p.x, y: p.y, z: p.z };
		mem.waterProgressAt = Date.now();
		return false; // still moving across — let it keep crossing
	}
	return Date.now() - mem.waterProgressAt > 4000; // stuck in water ~4s → escape
};

// LAND plants a bot can stand inside in open air — explicitly NOT seagrass/kelp/lily
// (those grow only on/under water, so they never mark dry ground).
const DRY_PLANTS = new Set([
	"short_grass",
	"tall_grass",
	"fern",
	"large_fern",
	"sugar_cane",
	"snow",
	"snow_layer",
	"vine",
]);

/**
 * PRIMARY water escape — winner of the /debug/swim strategy bake-off
 * ("pathfind-scaffold": 3/3 PASS, ~4.5s). Route to REAL shore with the general
 * pathfinder. Two fixes over the old carve-a-stair-only escape:
 *   1. A WIDE dry-target scan (R=40) whose targets need genuinely-DRY (non-water)
 *      headroom. The old signal counted water as passable, so it aimed the bot at
 *      submerged SEAFLOOR and it stood there underwater; requiring non-water air
 *      above means the target is land above the waterline = real shore.
 *   2. Temporarily drop liquidCost (production 100 → 1.5) so A* is WILLING to wade
 *      the water it's already floating in and swim to the nearest shore, then walk /
 *      step / scaffold up the bank. liquidCost is RESTORED afterward so normal nav
 *      still avoids wading into lakes.
 * Returns true only once STABLY on dry land; returns false (→ fall through to the
 * committed stair-dig) when no real shore is reachable (a fully boxed pocket).
 */
const escapeViaPathfinder = async (bot: Bot): Promise<boolean> => {
	const p = bot.entity?.position;
	if (!p) return false;
	const cx = Math.floor(p.x);
	const cy = Math.floor(p.y);
	const cz = Math.floor(p.z);
	const dryAir = (b: ReturnType<typeof getBlock>): boolean =>
		!b || b.name === "air" || b.name === "cave_air" || DRY_PLANTS.has(b.name);
	const targets: { v: Vec3; d: number }[] = [];
	const R = 40;
	for (let dx = -R; dx <= R; dx++) {
		for (let dz = -R; dz <= R; dz++) {
			if (dx === 0 && dz === 0) continue;
			const x = cx + dx;
			const z = cz + dz;
			for (let y = cy + 8; y >= cy - 6; y--) {
				const g = getBlock(bot, vec3(x, y, z));
				if (!isStandableGround(g) || g?.name.includes("water")) continue;
				if (!dryAir(getBlock(bot, vec3(x, y + 1, z)))) break;
				if (!dryAir(getBlock(bot, vec3(x, y + 2, z)))) break;
				if (getBlock(bot, vec3(x, y - 1, z))?.name.includes("water")) break;
				targets.push({
					v: vec3(x, y + 1, z),
					d: Math.abs(dx) + Math.abs(dz) + Math.abs(y + 1 - cy) * 2,
				});
				break;
			}
		}
	}
	if (targets.length === 0) return false;
	targets.sort((a, b) => a.d - b.d);

	const pf = getPathfinder(bot);
	pf.setMovements({ liquidCost: 1.5 }); // willing to wade the water we're in
	try {
		// Keep this SHORT: on a reachable shore the walk-out finishes in a few
		// seconds, so a small budget still wins the common case — while a boxed pocket
		// (no walkable route) fails fast and falls through to the stair-dig instead of
		// burning the whole escape budget here.
		for (let i = 0; i < Math.min(2, targets.length); i++) {
			if (isOnDryLand(bot)) break;
			await goTo(bot, targets[i].v, { range: 0, timeout: 8000 });
			bot.clearControlStates();
			await sleep(300);
			if (isOnDryLand(bot) && !isInWaterTrap(bot)) {
				logEvent(
					"nav",
					"escaped_water_pf",
					`to ${targets[i].v.x},${targets[i].v.z}`,
				);
				return true;
			}
		}
		return isOnDryLand(bot) && !isInWaterTrap(bot);
	} finally {
		pf.setMovements({ liquidCost: 100 }); // restore wade-avoidance for normal nav
	}
};

export const escapeWater = async (
	bot: Bot,
	lastSafe?: Vec3,
	opts: { final?: boolean } = {},
): Promise<boolean> => {
	if (isOnDryLand(bot)) return true;

	// PRIMARY: route out to real shore with the pathfinder (fast + no bank-climbing
	// flakiness). Only fall through to the manual carve-a-stair logic below when no
	// reachable shore exists (a fully boxed pocket).
	if (await escapeViaPathfinder(bot)) return true;

	// The first solid, diggable block straight up within reach — for a SEALED
	// flooded cave (buoyancy presses our head to the cap), where pathfinding can't
	// help. Skips passable plants (vine/lily) the bot just floats through.
	const reachableCeiling = (): ReturnType<typeof getBlock> => {
		const p = bot.entity?.position;
		if (!p) return null;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		for (let dy = 1; dy <= 4; dy++) {
			const b = getBlock(bot, vec3(fx, fy + dy, fz));
			if (isStandableGround(b)) return b;
		}
		return null;
	};

	// Real dry-land standing spots around us, nearest first — solid block with 2
	// clear blocks above and NOT a single block floating on water. These are the
	// targets we pathfind to (the pathfinder climbs the cliff / walks around).
	const dryTargets = (): Vec3[] => {
		const p = bot.entity?.position;
		if (!p) return [];
		const cx = Math.floor(p.x);
		const cy = Math.floor(p.y);
		const cz = Math.floor(p.z);
		const found: { v: Vec3; d: number }[] = [];
		const R = 16;
		for (let dx = -R; dx <= R; dx++) {
			for (let dz = -R; dz <= R; dz++) {
				// Only skip our own column — NOT the directly-adjacent ones. Excluding
				// dist<2 meant the bot ignored a dry ledge one block in front of it (the
				// obvious step-out) and chased farther, unreachable land instead.
				if (dx === 0 && dz === 0) continue;
				const x = cx + dx;
				const z = cz + dz;
				// Scan a bit above us too — an ocean shore is often a cliff a few blocks
				// higher than the water we float in; the old ±5 window missed it, so we
				// had no target to swim to. (Don't go too high or we chase distant cliffs
				// out to sea.)
				for (let y = cy + 8; y >= cy - 6; y--) {
					const g = getBlock(bot, vec3(x, y, z));
					if (!isStandableGround(g)) continue;
					if (!isPassableBlock(getBlock(bot, vec3(x, y + 1, z)))) break;
					if (!isPassableBlock(getBlock(bot, vec3(x, y + 2, z)))) break;
					if (getBlock(bot, vec3(x, y - 1, z))?.name.includes("water")) break;
					// Rank by horizontal distance PLUS how far we'd have to climb —
					// otherwise an equidistant 2-block-high ledge can beat the 1-block
					// step right next to us purely by scan order, and we try (and fail)
					// to climb the harder one.
					found.push({
						v: vec3(x, y + 1, z),
						d: Math.abs(dx) + Math.abs(dz) + Math.abs(y + 1 - cy) * 2,
					});
					break;
				}
			}
		}
		found.sort((a, b) => a.d - b.d);
		return found.map((f) => f.v);
	};

	// Carve-a-staircase helpers. typecraft water physics (physics.ts) IGNORE `jump`
	// and give NO buoyancy — the bot sinks; the ONLY lift in water is the
	// `outOfLiquidImpulse`, applied when we press FORWARD into a wall with room to
	// rise. So deep water is escaped by carving a stair toward the nearest shore —
	// leave the foot block ahead as a step, clear the head + headroom — and holding
	// forward so that impulse hops us up it. (Holding jump alone just sinks, which is
	// exactly why the old swim-at-a-point code looped forever in a deep pit.)
	const B = (x: number, y: number, z: number) => getBlock(bot, vec3(x, y, z));
	const diggable = (b: ReturnType<typeof getBlock>): boolean =>
		!!b &&
		b.name !== "air" &&
		b.name !== "cave_air" &&
		b.name !== "bedrock" &&
		!b.name.includes("water") &&
		!b.name.includes("lava");
	const digAt = async (b: ReturnType<typeof getBlock>): Promise<void> => {
		if (!diggable(b)) return;
		const pos = (b as { position: Vec3 }).position;
		try {
			await bot.lookAt(vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5), true);
			await Promise.race([
				(bot.dig(b as never, true) as Promise<void>).catch(() => {}),
				sleep(5000), // grounded-underwater dirt is ~3.75s (5× penalty); give it room
			]);
			bot.stopDigging();
		} catch {
			/* ignore */
		}
	};

	logEvent("nav", opts.final ? "water_escape_final" : "swimming_out");
	const start = Date.now();
	const timeout = opts.final ? 90000 : 35000;
	const DIRS: [number, number][] = [
		[1, 0],
		[0, 1],
		[-1, 0],
		[0, -1],
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1],
	];
	// The horizontal step (of 8) onto firm DRY ground, preferring one that also has
	// dry ground 2 blocks on — so when we top the bank we walk INLAND, not back over
	// the water lip (which re-arms the trap and lets the next mining step dig back in).
	const inlandDir = (): [number, number] | null => {
		const e = bot.entity?.position;
		if (!e) return null;
		const ex = Math.floor(e.x);
		const ey = Math.floor(e.y);
		const ez = Math.floor(e.z);
		let best: [number, number] | null = null;
		let bestScore = -1;
		for (const [dx, dz] of DIRS) {
			if (!isStandableGround(B(ex + dx, ey - 1, ez + dz))) continue;
			if (B(ex + dx, ey, ez + dz)?.name.includes("water")) continue;
			if (!isPassableBlock(B(ex + dx, ey, ez + dz))) continue;
			if (!isPassableBlock(B(ex + dx, ey + 1, ez + dz))) continue;
			const far = B(ex + 2 * dx, ey - 1, ez + 2 * dz);
			const score = isStandableGround(far) && !far?.name.includes("water") ? 2 : 1;
			if (score > bestScore) {
				bestScore = score;
				best = [dx, dz];
			}
		}
		return best;
	};

	let dirIdx = 0;
	let locked: Vec3 | null = null;
	let lockUntil = 0;
	// "Stuck" is tracked on a WALL CLOCK against an ABSOLUTE anchor, NOT per-target.
	// In a tight pocket the target re-locks every second or two; resetting the
	// progress signal on each re-lock meant the stall never built and the carve-out
	// never fired. Here we only count REAL progress — rising a whole block, or
	// traveling >3.5 blocks (a genuine swim toward a far shore) — and if neither
	// happens for a few seconds the bot is pinned and we dig the wall open.
	const pStart = bot.entity?.position;
	let anchorX = pStart?.x ?? 0;
	let anchorY = pStart?.y ?? 0;
	let anchorZ = pStart?.z ?? 0;
	let stuckSince = Date.now();
	// Once pinned in a boxed pit we COMMIT to one horizontal dig direction and carve
	// a staircase up it — re-deriving the direction each dig (from the constantly
	// re-locking target) made the bot chip one block here, one there, never an exit.
	let escapeDir: [number, number] | null = null;

	while (Date.now() - start < timeout) {
		const p = bot.entity?.position;
		if (!p) break;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		if (isOnDryLand(bot)) {
			if (!isInWaterTrap(bot)) {
				// Don't declare victory on a momentary bob to the surface. In a 1-wide
				// water pocket boxed by dirt the bot pops to a dry Y for a single tick,
				// isOnDryLand+!trap flickers true, we return "escaped" — then the next
				// step shoves it straight back in and it oscillates forever
				// (escape→mine→preempt→escape). Worse, this false-complete fires BEFORE
				// the stall counter below can reach 3 and dig the wall open. Settle a
				// beat and re-confirm we're STILL out; if we sank back, fall through to
				// the swimming/notch-dig so stall builds and actually carves the pocket.
				bot.clearControlStates();
				await sleep(300);
				if (!isInWaterTrap(bot) && isOnDryLand(bot)) {
					logEvent("nav", "escaped_water");
					return true;
				}
			} else {
				// On a shore lip but still bobbing over the water edge — step inland onto
				// firmer ground (away from the water) to clear the flickering trap signal.
				const inland = inlandDir() ?? [0, 0];
				await bot.lookAt(vec3(fx + inland[0] + 0.5, fy, fz + inland[1] + 0.5), true);
				bot.setControlState("forward", true);
				// Jump ONLY while submerged. On land, holding jump bunny-hops the bot
				// straight across the beach so onGround never latches and it sails past
				// the shore into the next pond (found in the strategy bake-off).
				bot.setControlState("jump", bot.entity?.isInWater ?? false);
				await sleep(350);
				continue;
			}
		}

		// Sealed flooded cap on our SUBMERGED head → dig straight up toward the surface,
		// but ONLY when there's no horizontal way out. A flooded tunnel/passage HAS a dry
		// end; chewing through a thick stone ceiling instead burns the whole escape budget
		// at ~5s/dig, so when a dry target or retreat exists we swim to it rather than up.
		if (
			B(fx, fy + 1, fz)?.name.includes("water") &&
			!dryTargets()[0] &&
			!lastSafe
		) {
			const ceil = reachableCeiling();
			if (ceil) {
				await digAt(ceil);
				logEvent("nav", "drown_dig_up", ceil.name, ceil.position);
			}
		}

		// Lock onto ONE bank and press into it for a sustained burst. Re-picking the
		// nearest target every tick made the bot spin between banks and never build the
		// climb. Keep a target until we reach its column, stall (~3s, no rise), or it's
		// gone. With no dry land in range, probe a direction a few blocks out.
		if (
			!locked ||
			Date.now() > lockUntil ||
			(Math.floor(locked.x) === fx && Math.floor(locked.z) === fz)
		) {
			const t = dryTargets()[0] ?? lastSafe;
			if (t) {
				locked = vec3(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z));
			} else {
				const [dx, dz] = DIRS[dirIdx++ % DIRS.length];
				locked = vec3(fx + dx * 3, fy, fz + dz * 3);
			}
			lockUntil = Date.now() + 3000;
		}

		// Clear our OWN headroom (head + above) so the impulse has room to lift us — but
		// NEVER the bank ahead: the out-of-liquid impulse only fires when we COLLIDE
		// with it, so digging it away just lets us drift in at the same depth.
		await digAt(B(fx, fy + 1, fz));
		await digAt(B(fx, fy + 2, fz));

		// Press INTO the locked bank: forward + that collision give the upward impulse
		// while submerged (outOfLiquidImpulse=0.3 ≫ waterGravity=0.02); jump (ignored in
		// water) makes the final hop onto land the instant we surface. Sustained — we
		// don't turn away mid-climb.
		await bot.lookAt(vec3(locked.x + 0.5, locked.y + 1, locked.z + 0.5), true);
		bot.setControlState("forward", true);
		// Jump only while submerged (see inland step above) — avoids bunny-hopping
		// past the shore the instant the head surfaces.
		bot.setControlState("jump", bot.entity?.isInWater ?? false);
		await sleep(350);

		const np2 = bot.entity?.position;
		const ny = np2?.y ?? fy;
		const rose = Math.floor(ny) > Math.floor(anchorY);
		const traveled =
			!!np2 && Math.hypot(np2.x - anchorX, np2.z - anchorZ) > 3.5;
		if (rose || traveled) {
			// Real progress — re-anchor here and reset the stuck clock.
			if (np2) {
				anchorX = np2.x;
				anchorZ = np2.z;
			}
			anchorY = Math.max(anchorY, ny);
			stuckSince = Date.now();
			if (traveled) escapeDir = null; // left the pit entirely → re-evaluate
			lockUntil = Date.now() + 3000; // making progress — keep pressing this bank
		} else if (Date.now() - stuckSince > 2500) {
			// Not progressing. WHICH way is out — and is that way actually walled, or is
			// it just slow open water? Commit toward the exit (nearest dry target, else
			// the retreat); in a flooded tunnel that's the dead-end-free direction.
			const exit = dryTargets()[0] ?? lastSafe;
			const ux = exit ? Math.sign(exit.x - fx) : (escapeDir?.[0] ?? 0);
			const uz = exit ? Math.sign(exit.z - fz) : (escapeDir?.[1] ?? 0);
			const walled =
				diggable(B(fx + ux, fy, fz + uz)) ||
				diggable(B(fx + ux, fy + 1, fz + uz));
			if (!walled && (ux !== 0 || uz !== 0)) {
				// Open water ahead — we're not pinned, just swimming slowly toward the
				// exit. Keep pressing that way and reset the clock; digging here would
				// only chew a pointless hole (e.g. a flooded tunnel's stone ceiling).
				locked = vec3(fx + ux * 3, fy, fz + uz * 3);
				lockUntil = Date.now() + 3000;
				stuckSince = Date.now();
			} else {
				// Genuinely walled (a boxed pit): carve a COMMITTED staircase up-and-out.
				// Pick ONE direction the first time and keep carving it until we surface —
				// prefer the exit direction, else the first diggable-wall cardinal.
				if (!escapeDir) {
					const cardinals: [number, number][] = [
						[1, 0],
						[-1, 0],
						[0, 1],
						[0, -1],
					];
					escapeDir =
						ux !== 0 || uz !== 0
							? [ux, uz]
							: (cardinals.find(([dx, dz]) =>
									diggable(B(fx + dx, fy + 1, fz + dz)),
								) ?? [1, 0]);
				}
				const [ex, ez] = escapeDir;
				// GROUND FIRST. You can't dig while floating — mining is 5×(underwater) ×
				// 5×(off-ground) = 25× slower, so a dig never finishes and the bot bobs
				// forever. Stop pressing and let the (buoyancy-free) bot sink onto the
				// floor so on_ground=true; then dirt breaks in ~3.75s (5×) instead of never.
				bot.clearControlStates();
				await sleep(600);
				const gy = Math.floor(bot.entity?.position?.y ?? fy);
				// Carve ONE ascending staircase step: clear the wall ahead at head + above
				// (leaving the block ahead-below as the stair to step onto) + our own head.
				await digAt(B(fx, gy + 1, fz));
				await digAt(B(fx + ex, gy + 1, fz + ez));
				await digAt(B(fx + ex, gy + 2, fz + ez));
				logEvent(
					"nav",
					"pocket_dig",
					`at ${fx},${gy},${fz} dir ${ex},${ez} og=${bot.entity?.onGround}`,
				);
				// Step up-and-forward onto the freshly-cut stair.
				locked = vec3(fx + ex * 2, gy + 2, fz + ez * 2);
				lockUntil = Date.now() + 4000;
				stuckSince = Date.now(); // give the climb a beat
			}
		}
		logEvent(
			"nav",
			"swimming_out",
			`toward ${locked.x},${locked.z} @y${Math.floor(ny)}`,
		);
	}

	bot.clearControlStates();
	logEvent("nav", opts.final ? "water_escape_failed_final" : "water_escape_failed");
	return false;
};

// ── Lava safety ──────────────────────────────────────────────────────
// Goal: never die to lava. Pre-checks (below) refuse to walk/dig into it, and
// attachSafety runs a continuous guard that yanks the bot out the instant it
// ends up in lava — catching anything the pathfinder/pre-checks miss.

const isLavaBlock = (b: { name: string } | null): boolean =>
	!!b && b.name.includes("lava");

/** True if the bot's feet or head cell is lava (already in it). */
export const inLava = (bot: Bot): boolean => {
	const p = bot.entity?.position;
	if (!p) return false;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	return (
		isLavaBlock(getBlock(bot, vec3(fx, fy, fz))) ||
		isLavaBlock(getBlock(bot, vec3(fx, fy + 1, fz)))
	);
};

/** True if any lava is in/adjacent to the bot's feet/head/below within radius. */
export const lavaAround = (bot: Bot, radius = 1): boolean => {
	const p = bot.entity?.position;
	if (!p) return false;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	for (let dx = -radius; dx <= radius; dx++) {
		for (let dz = -radius; dz <= radius; dz++) {
			for (const dy of [0, 1, -1]) {
				if (isLavaBlock(getBlock(bot, vec3(fx + dx, fy + dy, fz + dz)))) {
					return true;
				}
			}
		}
	}
	return false;
};

/** Landing column at (x,y,z) and its 4 neighbours are lava-free down `depth`. */
export const dropColumnLavaFree = (
	bot: Bot,
	x: number,
	y: number,
	z: number,
	depth = 6,
): boolean => {
	const cols: [number, number][] = [
		[x, z],
		[x + 1, z],
		[x - 1, z],
		[x, z + 1],
		[x, z - 1],
	];
	for (const [cx, cz] of cols) {
		for (let dy = 0; dy <= depth; dy++) {
			if (isLavaBlock(getBlock(bot, vec3(cx, y - dy, cz)))) return false;
		}
	}
	return true;
};

/** Would breaking the block at `pos` let lava flow onto the bot? (sides + above) */
export const digExposesLava = (bot: Bot, pos: Vec3): boolean => {
	const dirs: [number, number, number][] = [
		[1, 0, 0],
		[-1, 0, 0],
		[0, 0, 1],
		[0, 0, -1],
		[0, 1, 0], // above: lava falls down onto us; the block below is safe
	];
	return dirs.some(([dx, dy, dz]) =>
		isLavaBlock(getBlock(bot, vec3(pos.x + dx, pos.y + dy, pos.z + dz))),
	);
};

/** Would breaking the block at `pos` flood our space with water? Unlike lava
 *  (only falls from above), water also creeps up from a cavity BELOW and in from
 *  the sides, so we guard all six neighbors. Used to refuse digging the last block
 *  holding back a pond/aquifer — the descent-into-water that drowns/traps the bot. */
export const digExposesWater = (bot: Bot, pos: Vec3): boolean => {
	const dirs: [number, number, number][] = [
		[1, 0, 0],
		[-1, 0, 0],
		[0, 0, 1],
		[0, 0, -1],
		[0, 1, 0],
		[0, -1, 0],
	];
	return dirs.some(([dx, dy, dz]) =>
		Boolean(
			getBlock(bot, vec3(pos.x + dx, pos.y + dy, pos.z + dz))?.name.includes(
				"water",
			),
		),
	);
};

/** Nearest cell (ring scan) with non-lava solid footing + clear head, to flee to. */
const nearestSafeFooting = (bot: Bot): Vec3 | null => {
	const p = bot.entity?.position;
	if (!p) return null;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	for (let r = 1; r <= 3; r++) {
		for (let dx = -r; dx <= r; dx++) {
			for (let dz = -r; dz <= r; dz++) {
				if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
				const cell = getBlock(bot, vec3(fx + dx, fy, fz + dz));
				const below = getBlock(bot, vec3(fx + dx, fy - 1, fz + dz));
				const head = getBlock(bot, vec3(fx + dx, fy + 1, fz + dz));
				const solidBelow =
					!!below && below.name !== "air" && below.name !== "cave_air";
				const clear = !cell || cell.name === "air" || cell.name === "cave_air";
				if (
					solidBelow &&
					clear &&
					!isLavaBlock(cell) &&
					!isLavaBlock(below) &&
					!isLavaBlock(head)
				) {
					return vec3(fx + dx, fy, fz + dz);
				}
			}
		}
	}
	return null;
};

/** Get the bot out of lava: stop, jump (buoyancy), steer to safe footing. */
export const escapeLava = async (
	bot: Bot,
	lastSafe?: Vec3,
): Promise<boolean> => {
	if (!inLava(bot)) return true;
	logEvent("safety", "lava_escape_start", undefined, bot.entity?.position);
	bot.clearControlStates();
	bot.setControlState("jump", true);

	const start = Date.now();
	const TIMEOUT = 6000;
	while (Date.now() - start < TIMEOUT) {
		// Prefer the NEAREST safe rim (1-2 blocks) — minimizes time in lava and
		// avoids walking far (and on fire) toward a stale cached position.
		const target = nearestSafeFooting(bot) ?? lastSafe;
		if (target && bot.entity?.position) {
			await bot.lookAt(
				vec3(target.x + 0.5, bot.entity.position.y, target.z + 0.5),
			);
		}
		bot.setControlState("forward", true);
		await sleep(150);
		if (!inLava(bot) && bot.entity?.onGround) {
			await sleep(300);
			bot.clearControlStates();
			logEvent("safety", "lava_escaped", undefined, bot.entity?.position);
			return true;
		}
	}
	bot.clearControlStates();
	logEvent("safety", "lava_escape_failed", undefined, bot.entity?.position);
	return false;
};

/**
 * Continuous lava backstop. Every 100ms: if the bot is in/standing on lava,
 * synchronously cancel all motion + stop the pathfinder, then escape. Catches
 * anything the pathfinder/pre-checks miss (~4s lava-death window = dozens of
 * recovery ticks). Attach once per bot, alongside attachDiagnostics.
 */
export const attachSafety = (bot: Bot): void => {
	let lastSafe: Vec3 | undefined;
	let escaping = false;
	let drowning = false;
	let submergedSince = 0;
	let lastWetTime = 0;
	let inWaterSince = 0;

	const guard = setInterval(() => {
		if (!bot.entity?.position) return;
		const hp = bot.entity.position;
		const headBlock = getBlock(
			bot,
			vec3(Math.floor(hp.x), Math.floor(hp.y) + 1, Math.floor(hp.z)),
		);
		const headUnderwater = !!headBlock && headBlock.name.includes("water");
		// Remember the last known-safe DRY footing to retreat toward — used by both
		// the lava and drowning escapes. Must exclude water, or the drowning retreat
		// target is itself underwater.
		if (
			!escaping &&
			!drowning &&
			bot.entity.onGround &&
			!lavaAround(bot) &&
			!headUnderwater
		) {
			lastSafe = vec3(Math.floor(hp.x), Math.floor(hp.y), Math.floor(hp.z));
		}
		if (escaping) return;
		// Trigger ONLY when feet/head are actually lava — not when merely standing
		// on a solid floor above lava (safe), which would stall legitimate mining.
		if (inLava(bot)) {
			escaping = true;
			logEvent("safety", "lava_guard_trigger", undefined, bot.entity.position);
			// Hard-cancel motion immediately, don't wait on the async escape.
			bot.clearControlStates();
			bot.setControlState("jump", true);
			try {
				getPathfinder(bot).stop();
			} catch {
				/* pathfinder may be idle */
			}
			escapeLava(bot, lastSafe).finally(() => {
				escaping = false;
			});
		}
		// Drowning guard: typecraft has NO air meter (bot.oxygenLevel doesn't
		// exist), so detect submersion directly — the block at head height being
		// water — and time it. Treat brief surfacing (head out <1.2s) as
		// still-submerged — bobbing at a pond surface kept resetting the timer.
		if (headUnderwater) {
			lastWetTime = Date.now();
			if (!submergedSince) submergedSince = Date.now();
		} else if (Date.now() - lastWetTime > 1200) {
			submergedSince = 0;
		}
		// Continuous time the body has been in water — even with a DRY head. A bot
		// floating at the surface of a sealed flooded cave never trips the drown
		// timer, yet it's just as stuck (no footing, can't progress). Resets the
		// instant we're back on dry land.
		// Use the trap predicate, not raw isInWater, so a bob above the surface or a
		// lily-pad perch still counts as "in water" and keeps the escape engaged.
		if (isInWaterTrap(bot)) {
			if (!inWaterSince) inWaterSince = Date.now();
		} else {
			inWaterSince = 0;
		}

		// Engage the water escape almost immediately: any time the bot has been in
		// water >1.5s (surface-trapped) or its head is wet >1.5s (drowning). The
		// runTick override has already paused every normal step, so there's nothing
		// to fight — escape early and aggressively. Escalate to the committed
		// dig-to-surface final backup at 15s; it relocates + tunnels up and never
		// gives up (kept well under the ~30s thrash-kick window).
		const drownStuck = submergedSince > 0 && Date.now() - submergedSince > 1500;
		const inWaterMs = inWaterSince ? Date.now() - inWaterSince : 0;
		const surfaceStuck = inWaterMs > 1500;
		const finalBackup = inWaterMs > 15000;
		if (!escaping && !drowning && (drownStuck || surfaceStuck || finalBackup)) {
			drowning = true;
			logEvent(
				"safety",
				finalBackup ? "water_stuck_final" : "drown_guard_trigger",
				`inWater=${inWaterMs}ms submerged=${submergedSince ? Date.now() - submergedSince : 0}ms`,
				bot.entity.position,
			);
			bot.clearControlStates();
			try {
				getPathfinder(bot).stop();
			} catch {
				/* pathfinder may be idle */
			}
			escapeWater(bot, lastSafe, { final: finalBackup }).finally(() => {
				drowning = false;
			});
		}
	}, 100);
	bot.on("end", () => clearInterval(guard));
};

// =============================================================================
// EXPLORATION
// =============================================================================

/**
 * Explore in a random direction
 * Useful when searching for resources
 *
 * @example
 * ```ts
 * await exploreRandom(bot, 30);
 * ```
 */
export const exploreRandom = async (bot: Bot, dist = 30): Promise<void> => {
	if (!bot.entity?.position) return;
	const angle = Math.random() * Math.PI * 2;
	const target = vec3(
		bot.entity.position.x + Math.cos(angle) * dist,
		bot.entity.position.y,
		bot.entity.position.z + Math.sin(angle) * dist,
	);
	await goTo(bot, target, { range: 5 });
};

/**
 * Move around to search for entities
 *
 * @example
 * ```ts
 * await searchForEntities(bot, 2000);
 * ```
 */
export const searchForEntities = async (
	bot: Bot,
	duration = 2000,
): Promise<void> => {
	bot.setControlState("forward", true);
	await sleep(duration);
	bot.setControlState("forward", false);
};
