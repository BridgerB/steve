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
	collectDelay?: number;
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

		// Pathfinder failed — fallback to raw walk if we didn't move much
		if (moved < 2) {
			await bot.lookAt(pos);
			bot.setControlState("forward", true);
			bot.setControlState("sprint", true);
			bot.setControlState("jump", true);
			const walkTime = Math.min(dist * 200, timeout * 0.6, 5000);
			await sleep(walkTime);
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
			bot.setControlState("jump", false);
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
		collectDelay = 300,
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
	const dropPos = offset(pos, 0.5, 0, 0.5);
	await bot.lookAt(dropPos);

	bot.setControlState("forward", true);
	await sleep(500);
	bot.setControlState("forward", false);
	await sleep(collectDelay);

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
}
const botMemory = new WeakMap<Bot, BotMemory>();

export const getMemory = (bot: Bot): BotMemory => {
	let mem = botMemory.get(bot);
	if (!mem) {
		mem = { craftingTablePos: null, resources: new Map() };
		botMemory.set(bot, mem);
	}
	return mem;
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
		const planks = countItems(bot, "planks");
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

	// Randomize placement positions so retries try different blocks
	const positions: [number, number][] = [
		[1, 0],
		[0, 1],
		[-1, 0],
		[0, -1],
		[0, 0],
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
		await sleep(200);
		try {
			await bot.placeBlock(ground, vec3(0, 1, 0));
		} catch {
			// placeBlock may timeout but block could still be placed
		}
		// Wait for the crafting window to open (placing a table opens it)
		for (let i = 0; i < 10; i++) {
			await sleep(500);
			if (bot.currentWindow) break;
		}
		const placed = findBlock(bot, "crafting_table", 4);
		const destBlock = getBlock(bot, offset(ground.position, 0, 1, 0));
		// findBlock may miss the table due to exposed filter — fall back to direct check
		const result =
			placed ?? (destBlock?.name === "crafting_table" ? destBlock : null);
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

	try {
		await bot.craft(fixedRecipe, count, craftingTable ?? undefined);
		await sleep(500);
		if (bot.currentWindow) {
			bot.closeWindow(bot.currentWindow);
			await sleep(500);
		}
		return { success: true, message: `Crafted ${count}x ${itemName}` };
	} catch (err) {
		const msg =
			err instanceof Error ? err.message : `Failed to craft ${itemName}`;
		logEvent("craft", "error", `${itemName}: ${msg}`);
		if (bot.currentWindow) {
			try {
				bot.closeWindow(bot.currentWindow);
			} catch {}
		}
		return { success: false, message: msg };
	}
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
export const escapeWater = async (bot: Bot): Promise<boolean> => {
	if (!bot.entity?.isInWater) return true; // not in water

	logEvent("nav", "swimming_out");

	// Hold jump to swim up
	bot.setControlState("jump", true);
	bot.setControlState("forward", true);
	bot.setControlState("sprint", true);

	const start = Date.now();
	const timeout = 10000;

	while (Date.now() - start < timeout) {
		await sleep(200);
		if (!bot.entity?.isInWater) {
			// Out of water, keep moving forward briefly to get on land
			await sleep(500);
			bot.setControlState("jump", false);
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
			logEvent("nav", "escaped_water");
			return true;
		}
		// Rotate randomly to find shore
		if ((Date.now() - start) % 2000 < 200) {
			const angle = Math.random() * Math.PI * 2;
			await bot.look(angle, 0);
		}
	}

	bot.setControlState("jump", false);
	bot.setControlState("forward", false);
	bot.setControlState("sprint", false);
	logEvent("nav", "water_escape_failed");
	return false;
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
