/**
 * Movement generation for A* pathfinding.
 * Queries blocks via PhysicsWorld adapter, classifies them with a per-path
 * cache, and generates valid neighboring moves (walk, jump, drop, diagonal).
 */

import type { Bot } from "../bot/types.ts";
import { createPhysicsWorld } from "../physics/adapter.ts";
import type {
	BlockQuery,
	Move,
	Movements,
	MovementsConfig,
	PlaceAction,
} from "./types.ts";
import { defaultMovementsConfig, posHash } from "./types.ts";

// Cardinal directions (NESW)
const CARDINAL = [
	{ x: -1, z: 0 },
	{ x: 1, z: 0 },
	{ x: 0, z: -1 },
	{ x: 0, z: 1 },
] as const;

// Diagonal directions
const DIAGONAL = [
	{ x: -1, z: -1 },
	{ x: -1, z: 1 },
	{ x: 1, z: -1 },
	{ x: 1, z: 1 },
] as const;

/** Void/unloaded block query — treated as impassable. */
const VOID_BLOCK: BlockQuery = {
	safe: false,
	physical: false,
	liquid: false,
	lava: false,
	climbable: false,
	height: 0,
	name: "void",
	replaceable: false,
	canFall: false,
	openable: false,
	id: -1,
};

/** Create a movement generator bound to the bot's current world state. */
export const createMovements = (
	bot: Bot,
	config?: Partial<MovementsConfig>,
): Movements => {
	const cfg: MovementsConfig = { ...defaultMovementsConfig(), ...config };
	const registry = bot.registry!;
	const physicsWorld = createPhysicsWorld(bot.world!);

	// Pre-compute block classification sets
	const liquidIds = new Set<number>();
	const lavaIds = new Set<number>();
	const climbableIds = new Set<number>();
	const avoidIds = new Set<number>();
	const fenceIds = new Set<number>();

	const addId = (name: string, set: Set<number>) => {
		const def = registry.blocksByName.get(name);
		if (def) set.add(def.id);
	};

	addId("water", liquidIds);
	addId("flowing_water", liquidIds);
	addId("lava", liquidIds);
	addId("flowing_lava", liquidIds);
	addId("lava", lavaIds);
	addId("flowing_lava", lavaIds);
	addId("lava", avoidIds);
	addId("flowing_lava", avoidIds);
	addId("fire", avoidIds);
	addId("soul_fire", avoidIds);
	addId("cobweb", avoidIds);
	addId("web", avoidIds);
	addId("sweet_berry_bush", avoidIds);
	addId("wither_rose", avoidIds);
	addId("ladder", climbableIds);
	addId("vine", climbableIds);

	// Classify blocks with shapes taller than 1 as fences
	const collisionShapes = registry.blockCollisionShapes;
	for (const block of registry.blocksArray) {
		const shapeRef = collisionShapes.blocks[block.name];
		if (shapeRef === undefined) continue;
		const shapeId =
			typeof shapeRef === "number" ? shapeRef : (shapeRef[0] ?? 0);
		const shapes = collisionShapes.shapes[String(shapeId)] ?? [];
		for (const shape of shapes) {
			if ((shape[4] ?? 0) > 1.0) {
				fenceIds.add(block.id);
				break;
			}
		}
	}

	// Pre-compute gravity (falling) block IDs
	const gravityIds = new Set<number>();
	for (const name of ["sand", "gravel", "red_sand"]) {
		addId(name, gravityIds);
	}

	// Pre-compute gate IDs
	const gateIds = new Set<number>();
	for (const block of registry.blocksArray) {
		if (block.name.includes("fence_gate")) {
			gateIds.add(block.id);
		}
	}

	// Block query cache — avoids repeated world lookups for shared neighbors
	const blockCache = new Map<number, BlockQuery>();

	/** Query block properties at an absolute position (cached). */
	const queryBlock = (x: number, y: number, z: number): BlockQuery => {
		const key = posHash(x, y, z);
		const cached = blockCache.get(key);
		if (cached) return cached;

		const block = physicsWorld.getBlock({ x, y, z });
		if (!block) {
			blockCache.set(key, VOID_BLOCK);
			return VOID_BLOCK;
		}

		const isLiquid = liquidIds.has(block.id);
		const isLava = lavaIds.has(block.id);
		const isClimbable = climbableIds.has(block.id);
		const isAvoid = avoidIds.has(block.id);
		const isFence = fenceIds.has(block.id);
		const isEmpty = block.boundingBox === "empty";
		const isPhysical = block.boundingBox === "block" && !isFence;
		let height = 0;
		for (const shape of block.shapes) {
			const shapeTop = shape[4] ?? 0;
			if (shapeTop > height) height = shapeTop;
		}

		const isCarpet = isEmpty && height > 0 && height < 0.1;
		const isSafe = (isEmpty || isClimbable || isLiquid || isCarpet) && !isAvoid;

		const result: BlockQuery = {
			safe: isSafe,
			physical: isPhysical,
			liquid: isLiquid,
			lava: isLava,
			climbable: isClimbable,
			height,
			name: block.name,
			replaceable: isEmpty && !isClimbable && !isLiquid,
			canFall: gravityIds.has(block.id),
			openable: gateIds.has(block.id),
			id: block.id,
		};
		blockCache.set(key, result);
		return result;
	};

	// Pre-allocated neighbors buffer — reused per getNeighbors call
	const neighbors: Move[] = [];
	let neighborCount = 0;

	/** Push a move into the neighbors buffer. */
	const pushNeighbor = (
		x: number,
		y: number,
		z: number,
		cost: number,
		toBreak: readonly {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		}[] = [],
		toPlace: readonly PlaceAction[] = [],
		parkour = false,
	): void => {
		neighbors[neighborCount++] = {
			x,
			y,
			z,
			cost,
			hash: posHash(x, y, z),
			remainingBlocks: 0,
			toBreak,
			toPlace,
			parkour,
		};
	};

	/** Check if block is safe, or can be broken. Returns cost addition (0 if safe, digCost if breakable, -1 if impassable). */
	const safeOrBreak = (
		x: number,
		y: number,
		z: number,
		toBreak: { readonly x: number; readonly y: number; readonly z: number }[],
	): number => {
		const block = queryBlock(x, y, z);
		if (block.safe || block.liquid) return 0;
		if (!cfg.canDig) return -1;
		if (cfg.blocksCantBreak.has(block.id)) return -1;

		// Don't break blocks that would cause flow
		if (cfg.dontCreateFlow) {
			for (const [dx, dz] of [
				[0, 1],
				[0, -1],
				[1, 0],
				[-1, 0],
			]) {
				if (queryBlock(x + dx!, y, z + dz!).liquid) return -1;
			}
			if (queryBlock(x, y + 1, z).liquid) return -1;
		}

		// Don't mine under falling blocks
		if (cfg.dontMineUnderFallingBlock && queryBlock(x, y + 1, z).canFall)
			return -1;

		toBreak.push({ x, y, z });
		return cfg.digCost;
	};

	/** Forward walk: move into adjacent block at same Y level. */
	const getMoveForward = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		const floor = queryBlock(nx, node.y - 1, nz);
		if (!floor.physical && !floor.liquid) return;

		const toBreak: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		}[] = [];
		let cost = 1;

		// Penalise ending up wet — standing on a water surface (liquid floor) OR
		// wading into a pool whose floor is solid but body block is water.
		if (floor.liquid || queryBlock(nx, node.y, nz).liquid) cost *= cfg.liquidCost;

		// Check body and head — try breaking if not safe
		const bodyCost = safeOrBreak(nx, node.y, nz, toBreak);
		if (bodyCost < 0) return;
		cost += bodyCost;

		const headCost = safeOrBreak(nx, node.y + 1, nz, toBreak);
		if (headCost < 0) return;
		cost += headCost;

		pushNeighbor(nx, node.y, nz, cost, toBreak);
	};

	/** Jump up: move into adjacent block one Y higher. */
	const getMoveJumpUp = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;
		const ny = node.y + 1;

		const toBreak: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		}[] = [];
		let cost = 2;

		// Need clear head space above current position
		const aboveCost = safeOrBreak(node.x, node.y + 2, node.z, toBreak);
		if (aboveCost < 0) return;
		cost += aboveCost;

		// Need the block we're jumping onto to be physical (or liquid — swimming up onto land)
		const jumpBlock = queryBlock(nx, node.y, nz);
		if (!jumpBlock.physical && !jumpBlock.liquid) return;

		// Need body and head clear at destination
		const bodyCost = safeOrBreak(nx, ny, nz, toBreak);
		if (bodyCost < 0) return;
		cost += bodyCost;

		const headCost = safeOrBreak(nx, ny + 1, nz, toBreak);
		if (headCost < 0) return;
		cost += headCost;

		// Penalise hopping up into/onto water as heavily as wading in, so the bot
		// won't jump into a pool when a dry route exists.
		if (jumpBlock.liquid || queryBlock(nx, ny, nz).liquid) cost *= cfg.liquidCost;

		pushNeighbor(nx, ny, nz, cost, toBreak);
	};

	/** Drop down: walk forward and fall until hitting ground. */
	const getMoveDropDown = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		if (!queryBlock(nx, node.y + 1, nz).safe) return;
		if (!queryBlock(nx, node.y, nz).safe) return;
		if (queryBlock(nx, node.y - 1, nz).physical) return; // has floor = forward move

		const maxDrop = cfg.infiniteLiquidDropdownDistance
			? 256
			: cfg.maxDropDown + 1;
		for (let dy = -2; dy >= -maxDrop; dy--) {
			const landing = queryBlock(nx, node.y + dy, nz);
			if (landing.physical) {
				const landY = node.y + dy + 1;
				if (landY !== node.y && !queryBlock(nx, landY, nz).safe) return;
				pushNeighbor(nx, landY, nz, 1 + (node.y - landY) * 0.5);
				return;
			}
			if (landing.liquid) {
				if (landing.lava) return; // never fall into lava
				// Land in water — allowed, but penalised like any other water entry so
				// the bot won't drop into a pool it could have walked around.
				const dropCost = 1 + (node.y - (node.y + dy)) * 0.3;
				pushNeighbor(nx, node.y + dy, nz, dropCost * cfg.liquidCost);
				return;
			}
			if (!landing.safe) return;
			if (!cfg.infiniteLiquidDropdownDistance && dy < -(cfg.maxDropDown + 1))
				return;
		}
	};

	/** Diagonal: move diagonally if both intermediate cardinal paths are clear. */
	const getMoveDiagonal = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		const destFloor = queryBlock(nx, node.y - 1, nz);

		// Flat diagonal
		if (destFloor.physical) {
			if (!queryBlock(nx, node.y, nz).safe) return;
			if (!queryBlock(nx, node.y + 1, nz).safe) return;

			const p1 =
				queryBlock(node.x, node.y, node.z + dz).safe &&
				queryBlock(node.x, node.y + 1, node.z + dz).safe;
			const p2 =
				queryBlock(node.x + dx, node.y, node.z).safe &&
				queryBlock(node.x + dx, node.y + 1, node.z).safe;
			if (!p1 && !p2) return;

			pushNeighbor(
				nx,
				node.y,
				nz,
				queryBlock(nx, node.y, nz).liquid ? Math.SQRT2 * cfg.liquidCost : Math.SQRT2,
			);
			return;
		}

		// Diagonal jump up (+1Y) — destination block is physical (step onto it)
		if (
			queryBlock(nx, node.y, nz).physical &&
			queryBlock(nx, node.y + 1, nz).safe &&
			queryBlock(nx, node.y + 2, nz).safe &&
			queryBlock(node.x, node.y + 2, node.z).safe
		) {
			pushNeighbor(nx, node.y + 1, nz, Math.SQRT2 + 1);
		}

		// Diagonal drop down — find landing below
		if (queryBlock(nx, node.y, nz).safe) {
			for (let dy = -2; dy >= -(cfg.maxDropDown + 1); dy--) {
				const landing = queryBlock(nx, node.y + dy, nz);
				if (landing.physical) {
					const landY = node.y + dy + 1;
					pushNeighbor(nx, landY, nz, Math.SQRT2 + (node.y - landY) * 0.5);
					return;
				}
				if (landing.liquid) {
					pushNeighbor(
						nx,
						node.y + dy,
						nz,
						Math.SQRT2 + (node.y - (node.y + dy)) * 0.3,
					);
					return;
				}
				if (!landing.safe) return;
			}
		}
	};

	/** Parkour: sprint-jump across 1-4 block gaps. */
	const getMoveParkour = (node: Move, dx: number, dz: number): void => {
		if (!cfg.allowParkour) return;

		const nx1 = node.x + dx;
		const nz1 = node.z + dz;

		// Must have floor at current position
		if (!queryBlock(node.x, node.y - 1, node.z).physical) return;
		// Must have no floor at the first gap position (otherwise it's a forward move)
		if (queryBlock(nx1, node.y - 1, nz1).physical) return;
		// Must have head clearance for the jump
		if (!queryBlock(node.x, node.y + 2, node.z).safe) return;

		// Scan forward. A sprint-jump only clears ~3 cells in this engine (jump vel
		// 0.42 + sprint horizontal 0.2, air inertia 0.91); allowing 4 made the bot plan
		// jumps it falls short on. Was `allowSprinting ? 4 : 2`.
		const maxDist = cfg.allowSprinting ? 3 : 2;

		// The body+head must be clear along the WHOLE jump arc, not just the landing —
		// otherwise the bot clips a wall mid-air and drops into the gap. topDy=1 covers
		// the normal body/head span; topDy=2 for an upward landing where the body rises.
		// A blocked intermediate cell blocks every longer jump through it too.
		const arcClear = (dist: number, topDy: number): boolean => {
			for (let i = 1; i < dist; i++) {
				const ix = node.x + dx * i;
				const iz = node.z + dz * i;
				for (let yy = 0; yy <= topDy; yy++) {
					if (!queryBlock(ix, node.y + yy, iz).safe) return false;
				}
			}
			return true;
		};

		for (let dist = 2; dist <= maxDist; dist++) {
			const nx = node.x + dx * dist;
			const nz = node.z + dz * dist;

			// Check ceiling along the arc
			if (
				!queryBlock(
					node.x + dx * (dist - 1),
					node.y + 2,
					node.z + dz * (dist - 1),
				).safe
			)
				break;

			// Body+head must be clear the whole way — else we clip a wall and fall short.
			// A blocked intermediate also blocks every farther landing, so stop scanning.
			if (!arcClear(dist, 1)) break;

			// Same-level landing
			if (
				queryBlock(nx, node.y - 1, nz).physical &&
				queryBlock(nx, node.y, nz).safe &&
				queryBlock(nx, node.y + 1, nz).safe
			) {
				pushNeighbor(nx, node.y, nz, dist + 1, [], [], true);
			}

			// Landing one block up — the body climbs, so the raised span must be clear too
			if (
				dist <= 2 &&
				queryBlock(nx, node.y, nz).physical &&
				queryBlock(nx, node.y + 1, nz).safe &&
				queryBlock(nx, node.y + 2, nz).safe &&
				arcClear(dist, 2)
			) {
				pushNeighbor(nx, node.y + 1, nz, dist + 2, [], [], true);
			}

			// Landing one block down
			if (
				queryBlock(nx, node.y - 2, nz).physical &&
				queryBlock(nx, node.y - 1, nz).safe &&
				queryBlock(nx, node.y, nz).safe
			) {
				pushNeighbor(nx, node.y - 1, nz, dist + 0.5, [], [], true);
			}
		}
	};

	/** Move up: jump-place scaffold block to climb vertically. */
	const getMoveUp = (node: Move): void => {
		if (!cfg.allow1by1towers) return;
		if (cfg.scaffoldingBlocks.length === 0) return;

		// Need head room 2 blocks above
		if (!queryBlock(node.x, node.y + 2, node.z).safe) return;
		// Current block (where we'll place) must be replaceable or safe
		const current = queryBlock(node.x, node.y, node.z);
		if (!current.safe && !current.replaceable) return;

		pushNeighbor(
			node.x,
			node.y + 1,
			node.z,
			1 + cfg.placeCost,
			[],
			[{ x: node.x, y: node.y, z: node.z, dx: 0, dy: -1, dz: 0, jump: true }],
		);
	};

	/** Move down: drop vertically in place. */
	const getMoveDown = (node: Move): void => {
		// Already on solid ground — can't drop
		if (queryBlock(node.x, node.y - 1, node.z).physical) return;

		const maxDrop = cfg.infiniteLiquidDropdownDistance
			? 256
			: cfg.maxDropDown + 1;
		for (let dy = -1; dy >= -maxDrop; dy--) {
			const landing = queryBlock(node.x, node.y + dy, node.z);
			if (landing.physical) {
				const landY = node.y + dy + 1;
				pushNeighbor(node.x, landY, node.z, 1 + (node.y - landY) * 0.5);
				return;
			}
			if (landing.liquid) {
				if (landing.lava) return; // never drop into lava
				pushNeighbor(
					node.x,
					node.y + dy,
					node.z,
					1 + (node.y - (node.y + dy)) * 0.3,
				);
				return;
			}
			if (!landing.safe) return;
			if (!cfg.infiniteLiquidDropdownDistance && dy < -(cfg.maxDropDown + 1))
				return;
		}
	};

	/** Swim up: move up one block while in water. */
	const getMoveSwimUp = (node: Move): void => {
		const current = queryBlock(node.x, node.y, node.z);
		if (!current.liquid || current.lava) return; // only from water, never lava
		const above = queryBlock(node.x, node.y + 1, node.z);
		if ((above.safe || above.liquid) && !above.lava) {
			pushNeighbor(node.x, node.y + 1, node.z, 1);
		}
	};

	const getNeighbors = (node: Move): readonly Move[] => {
		neighborCount = 0;

		for (const dir of CARDINAL) {
			getMoveForward(node, dir.x, dir.z);
			getMoveJumpUp(node, dir.x, dir.z);
			getMoveDropDown(node, dir.x, dir.z);
			getMoveParkour(node, dir.x, dir.z);
		}

		for (const dir of DIAGONAL) {
			getMoveDiagonal(node, dir.x, dir.z);
		}

		getMoveUp(node);
		getMoveDown(node);
		getMoveSwimUp(node);

		// Return a slice so the caller gets an independent snapshot
		return neighbors.slice(0, neighborCount);
	};

	return { getNeighbors, config: cfg };
};
