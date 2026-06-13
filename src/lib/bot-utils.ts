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
		pf = createPathfinder(bot);
		pf.setMovements({ liquidCost: 100 });
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
	resources: Map<string, { x: number; y: number; z: number }[]>;
	// Surface top of the mine staircase — the way back up for resupply.
	mineEntry: { x: number; y: number; z: number } | null;
}
const botMemory = new WeakMap<Bot, BotMemory>();

export const getMemory = (bot: Bot): BotMemory => {
	let mem = botMemory.get(bot);
	if (!mem) {
		mem = { craftingTablePos: null, resources: new Map(), mineEntry: null };
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
export const returnToSurface = async (bot: Bot): Promise<boolean> => {
	const entry = getMineEntry(bot);
	if (!entry) return false;
	const atEntry = () => bot.entity.position.y >= entry.y - 4;
	if (atEntry()) return true;
	logEvent(
		"nav",
		"return_to_surface",
		`climbing to y=${entry.y} from y=${Math.floor(bot.entity.position.y)}`,
		bot.entity.position,
	);
	await goTo(bot, vec3(entry.x, entry.y, entry.z), {
		range: 2,
		timeout: 90000,
	});
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

export const getRememberedResource = (
	bot: Bot,
	name: string,
): { x: number; y: number; z: number } | null => {
	const mem = getMemory(bot);
	const list = mem.resources.get(name);
	if (!list || list.length === 0) return null;
	// Return nearest reachable — skip blocks >10 Y away (can't pathfind through solid rock)
	const botY = bot.entity.position.y;
	let nearest: { x: number; y: number; z: number } | null = null;
	let nearestDist = Infinity;
	for (const p of list) {
		if (Math.abs(p.y - botY) > 10) continue;
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

export const getCraftingTable = async (bot: Bot): Promise<Block | null> => {
	const mem = getMemory(bot);

	// Check remembered position — if <50 blocks away, walk back to it
	if (mem.craftingTablePos) {
		const d = distance(
			bot.entity.position,
			vec3(
				mem.craftingTablePos.x,
				mem.craftingTablePos.y,
				mem.craftingTablePos.z,
			),
		);
		if (d < 50) {
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
						await goTo(bot, remembered.position, { range: 2, timeout: 15000 });
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

	// Find a solid block to place on — try several positions
	// Blocks that are NOT solid ground for table placement
	const NON_SOLID = new Set([
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
	const isSolidGround = (name: string) =>
		!NON_SOLID.has(name) &&
		!name.includes("leaves") &&
		!name.includes("sapling");
	const isSpaceClear = (name: string) =>
		name === "air" || name === "cave_air" || NON_SOLID.has(name);

	// Randomize placement positions so retries try different blocks. Never use
	// [0,0] — that places the table on the block under our own feet, i.e. inside
	// our hitbox, which silently no-ops. In a 1-wide mining tunnel that was often
	// the only "valid" ground found, so the bot looped forever and aborted.
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
		const a = positions[i],
			b = positions[j];
		if (a && b) {
			positions[i] = b;
			positions[j] = a;
		}
	}
	// Wait for chunks so we don't try to place in unloaded areas
	await bot.waitForChunksToLoad();

	let ground: Block | null = null;
	for (const [dx, dz] of positions) {
		const candidate = getBlock(bot, offset(bot.entity.position, dx, -1, dz));
		if (!candidate || !isSolidGround(candidate.name)) continue;
		const above = getBlock(bot, offset(candidate.position, 0, 1, 0));
		// Skip unloaded positions — placing in unloaded chunks always fails
		if (!above) continue;
		if (!isSpaceClear(above.name)) continue;
		ground = candidate;
		break;
	}
	// Fallback: try to clear space above a solid block
	if (!ground) {
		for (const [dx, dz] of positions) {
			const candidate = getBlock(bot, offset(bot.entity.position, dx, -1, dz));
			if (!candidate || !isSolidGround(candidate.name)) continue;
			const above = getBlock(bot, offset(candidate.position, 0, 1, 0));
			if (above && above.name !== "air") {
				try {
					await bot.lookAt(offset(above.position, 0.5, 0.5, 0.5));
					await bot.dig(above);
					await sleep(200);
					ground = candidate;
					break;
				} catch {}
			}
		}
	}
	// Stuck on leaves/non-solid with nothing to place on (e.g. slow-fell into a
	// tree, or perched on a canopy) — dig straight down until we drop onto solid
	// ground, then re-scan the adjacent positions.
	if (!ground) {
		for (let i = 0; i < 8; i++) {
			const below = getBlock(bot, offset(bot.entity.position, 0, -1, 0));
			if (!below || isSolidGround(below.name)) break;
			try {
				await bot.lookAt(offset(below.position, 0.5, 0.5, 0.5));
				await bot.dig(below);
				await sleep(400);
			} catch {
				break;
			}
		}
		for (const [dx, dz] of positions) {
			const candidate = getBlock(bot, offset(bot.entity.position, dx, -1, dz));
			if (!candidate || !isSolidGround(candidate.name)) continue;
			const above = getBlock(bot, offset(candidate.position, 0, 1, 0));
			if (above && isSpaceClear(above.name)) {
				ground = candidate;
				break;
			}
		}
	}
	if (!ground) {
		logEvent("craft", "table_no_ground", "no solid block nearby");
		return null;
	}

	const aboveBlock = getBlock(bot, offset(ground.position, 0, 1, 0));
	const above2 = getBlock(bot, offset(ground.position, 0, 2, 0));
	const botFeet = getBlock(bot, offset(bot.entity.position, 0, -1, 0));
	const dx = bot.entity.position.x - (ground.position.x + 0.5);
	const dz = bot.entity.position.z - (ground.position.z + 0.5);
	const distXZ = Math.sqrt(dx * dx + dz * dz);
	const dist3D = Math.sqrt(
		dx * dx + (bot.entity.position.y - ground.position.y) ** 2 + dz * dz,
	);
	logEvent(
		"craft",
		"table_placing",
		JSON.stringify({
			ground: ground.name,
			groundPos: {
				x: ground.position.x,
				y: ground.position.y,
				z: ground.position.z,
			},
			destPos: {
				x: ground.position.x,
				y: ground.position.y + 1,
				z: ground.position.z,
			},
			above: aboveBlock?.name ?? "unloaded",
			above2: above2?.name ?? "unloaded",
			botPos: {
				x: +bot.entity.position.x.toFixed(1),
				y: +bot.entity.position.y.toFixed(1),
				z: +bot.entity.position.z.toFixed(1),
			},
			botFeet: botFeet?.name ?? "unloaded",
			held: bot.heldItem?.name ?? null,
			heldSlot: bot.quickBarSlot,
			distXZ: +distXZ.toFixed(1),
			dist3D: +dist3D.toFixed(1),
			yaw: +((bot.entity.yaw * 180) / Math.PI).toFixed(0),
			pitch: +((bot.entity.pitch * 180) / Math.PI).toFixed(0),
			onGround: bot.entity.onGround,
			hasWindow: !!bot.currentWindow,
		}),
	);

	try {
		// Move table to hand — use clickWindow to move to hotbar, then select
		const tableSlot = bot.inventory.slots.findIndex(
			(s) => s && s.name === "crafting_table",
		);
		if (tableSlot >= 36 && tableSlot <= 44) {
			bot.setQuickBarSlot(tableSlot - 36);
		} else if (tableSlot >= 0) {
			try {
				await bot.clickWindow(tableSlot, 0, 0);
				await bot.clickWindow(36, 0, 0);
				bot.setQuickBarSlot(0);
			} catch {}
		}
		const destPos = offset(ground.position, 0, 1, 0);
		// Retry the place — placeBlock silently misses often (a single miss is the
		// "Need crafting table" failure). Verify by reading the dest block directly;
		// placing a table does NOT open a window, so don't waste 5s waiting for one.
		let result: Block | null = null;
		for (let attempt = 0; attempt < 3 && !result; attempt++) {
			await sleep(200);
			try {
				// Force-look at the ground's top face — without this, placement fails
				// when the bot is looking horizontally.
				await bot.lookAt(offset(ground.position, 0.5, 1, 0.5), true);
				await sleep(150);
				await bot.placeBlock(ground, vec3(0, 1, 0));
			} catch {
				// placeBlock may throw but the block could still land — verify below.
			}
			for (let i = 0; i < 6; i++) {
				await sleep(250);
				if (getBlock(bot, destPos)?.name === "crafting_table") break;
			}
			const destBlock = getBlock(bot, destPos);
			result =
				destBlock?.name === "crafting_table"
					? destBlock
					: findBlock(bot, "crafting_table", 4);
		}
		const destBlock = getBlock(bot, destPos);
		if (result) {
			mem.craftingTablePos = {
				x: result.position.x,
				y: result.position.y,
				z: result.position.z,
			};
			logEvent(
				"craft",
				"table_placed",
				JSON.stringify({
					at: mem.craftingTablePos,
					windowOpened: !!bot.currentWindow,
				}),
			);
		} else {
			logEvent(
				"craft",
				"table_place_failed",
				JSON.stringify({
					destNow: destBlock?.name ?? "unloaded",
					windowOpened: !!bot.currentWindow,
					heldAfter: bot.heldItem?.name ?? null,
					tableInInv: bot.inventory.slots.some(
						(s) => s && s.name === "crafting_table",
					),
				}),
			);
		}
		return result;
	} catch (e) {
		logEvent("craft", "table_place_error", String(e));
		return null;
	}
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

	const resolveId = (id: number): number => {
		if (win.slots.some((s) => s && s.type === id && s.count > 0)) return id;
		const group = tagGroups.get(id);
		if (group) {
			for (const altId of group) {
				if (win.slots.some((s) => s && s.type === altId && s.count > 0))
					return altId;
			}
		}
		return id;
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
				await moveCloser(bot, craftingTable.position, { maxDistance: 2.5 });
				await bot.lookAt(
					offset(craftingTable.position, 0.5, 0.5, 0.5),
					true,
				);
				await sleep(150);
			} catch {}
		}
		await bot.craft(fixedRecipe, count, craftingTable ?? undefined);
	};

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
			return { success: true, message: `Crafted ${count}x ${itemName}` };
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
export const escapeWater = async (
	bot: Bot,
	lastSafe?: Vec3,
): Promise<boolean> => {
	// Drowning detection: the block at head height is water. (Don't trust
	// bot.entity.isInWater for the *decision to act* — though with the physics
	// sync it's now accurate, head-block is the precise "am I drowning" signal.)
	const headWet = (): boolean => {
		const p = bot.entity?.position;
		if (!p) return false;
		const b = getBlock(
			bot,
			vec3(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z)),
		);
		return !!b && b.name.includes("water");
	};
	if (!headWet()) return true; // head not submerged

	logEvent("nav", "swimming_out");

	// Phase 1: hold jump to float up. Buoyancy (now working since the isInWater
	// sync fix) surfaces the bot fast in open water — most river/lake cases end
	// here within a second.
	bot.setControlState("jump", true);

	const start = Date.now();
	const timeout = 14000;

	while (Date.now() - start < timeout) {
		await sleep(200);
		if (!bot.entity?.position) break;
		if (!headWet()) {
			// Head's clear — nudge forward briefly to climb fully onto land.
			bot.setControlState("forward", true);
			await sleep(500);
			bot.clearControlStates();
			logEvent("nav", "escaped_water");
			return true;
		}

		// Still submerged after floating for ~1.2s → we're trapped under a ceiling
		// (a flooded tunnel) or bobbing mid-pool. Buoyancy alone won't free us.
		if (Date.now() - start < 1200) continue;

		const p = bot.entity.position;
		if (lastSafe) {
			// Best escape from a flooded tunnel: swim back toward the last DRY
			// footing — the way we came in, which has air. Digging up just hits more
			// stone (and is 5× slower underwater).
			await bot.lookAt(vec3(lastSafe.x + 0.5, p.y, lastSafe.z + 0.5));
			bot.setControlState("forward", true);
			bot.setControlState("sprint", true);
		} else {
			// No retreat point: dig straight up through a solid ceiling toward air.
			const above = getBlock(
				bot,
				vec3(Math.floor(p.x), Math.floor(p.y) + 2, Math.floor(p.z)),
			);
			const solidCeiling =
				!!above &&
				above.name !== "air" &&
				above.name !== "cave_air" &&
				!above.name.includes("water") &&
				above.name !== "bedrock";
			if (solidCeiling) {
				// Bound the dig — bot.dig blocks until the block breaks, and stone
				// underwater takes far longer than the escape timeout (5× penalty),
				// which would freeze escapeWater past its own deadline.
				await Promise.race([
					bot.dig(above, true).catch(() => {}),
					sleep(3000),
				]);
				bot.stopDigging();
				logEvent("nav", "drown_dig_up", above.name, above.position);
			} else {
				bot.setControlState("forward", true);
				await bot.look(Math.random() * Math.PI * 2, 0.2);
			}
		}
	}

	bot.clearControlStates();
	logEvent("nav", "water_escape_failed");
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
		// water — and time it. MC starts drowning damage after ~15s underwater, so
		// after 4s submerged we take over and surface (swim up, or dig up through a
		// flooded-cave ceiling). Fire after 2.5s, and treat brief surfacing
		// (head out <1.2s) as still-submerged — bobbing at a pond surface kept
		// resetting the timer so the guard never fired and the bot slowly drowned.
		if (headUnderwater) {
			lastWetTime = Date.now();
			if (!submergedSince) submergedSince = Date.now();
		} else if (Date.now() - lastWetTime > 1200) {
			submergedSince = 0;
		}
		if (
			!escaping &&
			!drowning &&
			submergedSince > 0 &&
			Date.now() - submergedSince > 2500
		) {
			drowning = true;
			logEvent(
				"safety",
				"drown_guard_trigger",
				`submerged=${Date.now() - submergedSince}ms`,
				bot.entity.position,
			);
			bot.clearControlStates();
			try {
				getPathfinder(bot).stop();
			} catch {
				/* pathfinder may be idle */
			}
			escapeWater(bot, lastSafe).finally(() => {
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
