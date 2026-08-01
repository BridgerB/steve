/**
 * Main pathfinder controller.
 * Attaches to bot.on("physicsTick"), manages A* lifecycle, drives bot controls.
 */

import type { Bot } from "../bot/types.ts";
import { vec3 } from "../vec3/index.ts";
import { computeAStar, createAStarContext } from "./astar.ts";
import { createMovements } from "./movements.ts";
import type {
	AStarContext,
	Goal,
	Move,
	Movements,
	MovementsConfig,
	Pathfinder,
	PathfinderConfig,
	PathResult,
} from "./types.ts";
import { posHash } from "./types.ts";

const DEFAULT_CONFIG: PathfinderConfig = {
	thinkTimeout: 10000,
	tickTimeout: 40,
	searchRadius: -1,
	maxDropDown: 4,
	reachDistance: 0.5,
	stuckTimeout: 3500,
};

/** Create a pathfinder and attach it to the bot's physics tick. */
export const createPathfinder = (
	bot: Bot,
	config: Partial<PathfinderConfig> = {},
): Pathfinder => {
	const cfg: PathfinderConfig = { ...DEFAULT_CONFIG, ...config };

	// Mutable state
	let currentGoal: Goal | null = null;
	let dynamic = false;
	let path: Move[] = [];
	let pathIndex = 0;
	let astarCtx: AStarContext | null = null;
	let astarPartial = false;
	let pathComputed = false;
	let lastNodeTime = performance.now();
	let movements: Movements | null = null;
	// Persisted movement config so a resetPath()/recompute doesn't silently drop the
	// caller's setMovements() (digCost, liquidCost, scaffoldingBlocks, …) and rebuild
	// a default movements — which disabled climbing and re-enabled wall-tunnelling.
	let movementConfig: Partial<MovementsConfig> = {
		maxDropDown: cfg.maxDropDown,
	};
	let digging = false;
	let placing = false;
	let placeFailures = 0;
	let digProgress = 0;
	let retries = 0;
	let gotoResolve: (() => void) | null = null;
	let gotoReject: ((err: Error) => void) | null = null;

	/** Create a Move from the bot's current position. */
	const startMoveFromBot = (): Move => {
		const p = bot.entity.position;
		const x = Math.floor(p.x);
		const y = Math.floor(p.y);
		const z = Math.floor(p.z);
		return {
			x,
			y,
			z,
			cost: 0,
			hash: posHash(x, y, z),
			remainingBlocks: 0,
			toBreak: [],
			toPlace: [],
			parkour: false,
		};
	};

	/** Stop all bot controls. */
	const fullStop = (): void => {
		bot.clearControlStates();
	};

	/** Reset path computation state. */
	const resetPath = (): void => {
		path = [];
		pathIndex = 0;
		astarCtx = null;
		astarPartial = false;
		pathComputed = false;
		movements = null;
		lastNodeTime = performance.now();
		fullStop();
	};

	/** Resolve the goto promise if active. */
	const resolveGoto = (): void => {
		const resolve = gotoResolve;
		gotoResolve = null;
		gotoReject = null;
		resolve?.();
	};

	/** Reject the goto promise if active. */
	const rejectGoto = (reason: string): void => {
		const reject = gotoReject;
		gotoResolve = null;
		gotoReject = null;
		reject?.(new Error(reason));
	};

	/** Trim path to bot's current position (skip already-passed waypoints). */
	const trimPathToPlayer = (): void => {
		const p = bot.entity.position;
		let bestIdx = 0;
		let bestDist = Infinity;
		for (let i = 0; i < path.length; i++) {
			const dx = path[i]!.x + 0.5 - p.x;
			const dz = path[i]!.z + 0.5 - p.z;
			const d = dx * dx + dz * dz;
			if (d < bestDist) {
				bestDist = d;
				bestIdx = i;
			}
		}
		pathIndex = bestIdx;
	};

	/** Equip a scaffolding block (one of movements.config.scaffoldingBlocks) into the
	 *  hand so the place-to-climb move actually places a block instead of whatever
	 *  happens to be held (often a pickaxe → silent no-op). Matches by block NAME
	 *  since inventory items and block ids live in different id spaces. */
	const equipScaffold = async (): Promise<boolean> => {
		const ids = movements?.config.scaffoldingBlocks ?? [];
		if (!ids.length) return false;
		const reg = (
			bot as unknown as {
				registry?: { blocksById?: Map<number, { name: string }> };
				inventory: { slots: ({ name: string } | null)[] };
				heldItem?: { name: string } | null;
			}
		).registry;
		const names = new Set<string>();
		for (const id of ids) {
			const n = reg?.blocksById?.get(id)?.name;
			if (n) names.add(n);
		}
		const inv = (bot as unknown as { inventory: { slots: ({ name: string } | null)[] }; heldItem?: { name: string } | null });
		if (inv.heldItem && names.has(inv.heldItem.name)) return true;
		const b = bot as unknown as {
			setQuickBarSlot: (n: number) => void;
			clickWindow: (s: number, b: number, m: number) => Promise<void>;
		};
		// PREFER a filler already in the hotbar (36-44) — just select it, which is
		// reliable. The bot usually has cobblestone stacks in the hotbar; the old code
		// grabbed the FIRST filler (often in the main inventory) and did a flaky
		// click-move, leaving the pickaxe held so the place silently no-op'd.
		const hotSlot = inv.inventory.slots.findIndex(
			(s, i) => i >= 36 && i <= 44 && !!s && names.has(s.name),
		);
		if (hotSlot >= 0) {
			b.setQuickBarSlot(hotSlot - 36);
			return true;
		}
		// Otherwise move one up from the main inventory into the hotbar.
		const slot = inv.inventory.slots.findIndex((s) => !!s && names.has(s.name));
		if (slot < 0) return false;
		try {
			await b.clickWindow(slot, 0, 0);
			await b.clickWindow(36, 0, 0);
			b.setQuickBarSlot(0);
			return true;
		} catch {
			return false;
		}
	};

	/** Follow the current path by driving bot controls. */
	const followPath = (): void => {
		if (pathIndex >= path.length) return;

		const p = bot.entity.position;
		const next = path[pathIndex]!;

		const dx = next.x + 0.5 - p.x;
		const dz = next.z + 0.5 - p.z;

		// Vertical arrival gate. A loose `|dy| < 1.5` let a CLIMBING path advance past
		// waypoints stacked above the bot before it had actually climbed (so it "reached
		// the top" while still at the bottom). Require the feet to actually be at/above a
		// waypoint that is above us; keep the loose tolerance for drops/flat/step-ups.
		const climbed =
			next.y <= Math.floor(p.y)
				? p.y - next.y < 1.5
				: p.y >= next.y - 0.5;

		if (
			dx * dx + dz * dz <= cfg.reachDistance * cfg.reachDistance &&
			climbed
		) {
			lastNodeTime = performance.now();
			pathIndex++;
			digProgress = 0;

			if (pathIndex >= path.length) {
				fullStop();
				if (currentGoal) {
					const m = startMoveFromBot();
					if (currentGoal.isEnd(m)) {
						bot.emit("goal_reached", currentGoal);
						resolveGoto();
						if (!dynamic) currentGoal = null;
						pathComputed = true;
						return;
					}
				}
				// Path exhausted but goal not reached — will recompute next tick
				return;
			}
		}

		const nextMove = path[pathIndex]!;

		// Handle block breaking before moving to waypoint
		if (nextMove.toBreak.length > digProgress && !digging) {
			digging = true;
			const blockPos = nextMove.toBreak[digProgress]!;
			const block = bot.blockAt(vec3(blockPos.x, blockPos.y, blockPos.z));
			if (block && block.name !== "air") {
				bot
					.dig(block, true)
					.then(() => {
						digging = false;
						digProgress++;
					})
					.catch(() => {
						digging = false;
						digProgress++; // skip this block
					});
			} else {
				digging = false;
			}
			return; // Don't move while digging
		}

		// Handle block placing before moving to waypoint
		if (nextMove.toPlace.length > 0 && !placing) {
			placing = true;
			const action = nextMove.toPlace[0]!;
			const refPos = {
				x: action.x + action.dx,
				y: action.y + action.dy,
				z: action.z + action.dz,
			};
			const faceVec = { x: -action.dx, y: -action.dy, z: -action.dz };
			void (async () => {
				// Equip a filler first — placing with a pickaxe in hand silently no-ops.
				if (!(await equipScaffold())) {
					// No blocks to place with: abandon this place-route, A* finds another.
					placing = false;
					path = [];
					pathIndex = 0;
					astarCtx = null;
					pathComputed = false;
					bot.emit("path_reset", "no_scaffold");
					return;
				}
					if (action.jump) bot.setControlState("jump", true);
					// Place-while-jumping is timing-sensitive: the spot only clears for a moment
					// at the jump apex, so a single timed place misses and the bot bobs. Hold jump
					// and SPAM placeBlock until the block actually lands (the digStaircaseUp trick).
					const landed = () => {
						const b = bot.blockAt(vec3(action.x, action.y, action.z));
						return !!b && b.name !== "air" && b.name !== "cave_air";
					};
					let ok = landed();
					for (let k = 0; k < 9 && !ok; k++) {
						try {
							await bot.placeBlock(
								{ position: refPos, name: "", stateId: 0, properties: {} },
								vec3(faceVec.x, faceVec.y, faceVec.z),
							);
						} catch {
							/* feet not clear yet — retry */
						}
						if (landed()) {
							ok = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 80));
						if (landed()) ok = true;
					}
					if (action.jump) bot.setControlState("jump", false);
					placing = false;
					if (ok) {
						placeFailures = 0;
					} else if (++placeFailures >= 4) {
						placeFailures = 0;
						path = [];
						pathIndex = 0;
						astarCtx = null;
						pathComputed = false;
						bot.emit("path_reset", "place_error");
					}
			})();
			return; // Don't move while placing
		}

		// Don't move while digging or placing
		if (digging || placing) return;

		const wp = nextMove;
		const moveX = wp.x + 0.5 - p.x;
		const moveZ = wp.z + 0.5 - p.z;

		bot.look(Math.atan2(-moveX, -moveZ), 0, true);
		bot.setControlState("forward", true);
		// Sprint is held continuously and forward never releases between waypoints, so
		// the bot reaches a parkour takeoff already at full sprint; jump fires on the
		// parkour cell (and on step-ups). Combined with the move-gen distance/arc fix,
		// it only attempts gaps it can actually clear.
		if (nextMove.parkour) {
			bot.setControlState("sprint", true);
			bot.setControlState("jump", true);
		} else {
			bot.setControlState("sprint", true);
			bot.setControlState("jump", wp.y > p.y + 0.5);
		}

		if (performance.now() - lastNodeTime > cfg.stuckTimeout) {
			retries++;
			if (retries > 5) {
				fullStop();
				rejectGoto("Stuck after retries");
				if (!dynamic) currentGoal = null;
				return;
			}
			resetPath();
		}
	};

	/** Called every physicsTick (~50ms). */
	const onPhysicsTick = (): void => {
		if (!currentGoal || !bot.world || !bot.registry) return;

		// Check goal validity
		if (currentGoal.isValid && !currentGoal.isValid()) {
			currentGoal = null;
			resetPath();
			bot.emit("path_stop");
			rejectGoto("Goal invalid (target despawned)");
			return;
		}

		// Check dynamic goal changes
		if (currentGoal.hasChanged?.()) resetPath();

		// Continue incremental A* every tick while partial — walk + compute simultaneously
		if (astarCtx && astarPartial && movements) {
			const result = computeAStar(
				astarCtx,
				movements,
				cfg.tickTimeout,
				cfg.thinkTimeout,
			);
			path = [...result.path];
			trimPathToPlayer();
			astarPartial = result.status === "partial";
			if (result.status !== "partial") {
				astarCtx = null;
				pathComputed = true;
			}
			bot.emit("path_update", result);
			if (result.status === "noPath") rejectGoto("No path found");
			// "timeout" sets pathComputed=true via the check above — stuck detection handles retries
			// Fall through to followPath — walk while computing
		}

		// Start new A* if needed (but not while a partial computation is in progress)
		if (pathIndex >= path.length && !pathComputed && !astarPartial) {
			const currentMove = startMoveFromBot();

			if (currentGoal.isEnd(currentMove)) {
				fullStop();
				bot.emit("goal_reached", currentGoal);
				resolveGoto();
				if (!dynamic) currentGoal = null;
				pathComputed = true;
				return;
			}

			// Create movements once per path computation (preserve if set via setMovements)
			if (!movements) movements = createMovements(bot, movementConfig);
			astarCtx = createAStarContext(currentMove, currentGoal, cfg.searchRadius);
			const result = computeAStar(
				astarCtx,
				movements,
				cfg.tickTimeout,
				cfg.thinkTimeout,
			);
			path = [...result.path];
			trimPathToPlayer();
			pathComputed = result.status !== "partial";
			astarPartial = result.status === "partial";
			if (result.status !== "partial") astarCtx = null;
			bot.emit("path_update", result);
			if (result.status === "noPath" && !astarPartial)
				rejectGoto("No path found");
			// Don't fall through on initial tick — let partial continuation handle next ticks
			if (astarPartial) return;
		}

		if (pathIndex < path.length) {
			followPath();
		} else if (currentGoal) {
			// Path exhausted but goal not reached — recompute after stuck timeout
			if (performance.now() - lastNodeTime > cfg.stuckTimeout) {
				retries++;
				lastNodeTime = performance.now();
				if (retries > 3) {
					fullStop();
					rejectGoto("Path incomplete after retries");
					if (!dynamic) currentGoal = null;
					return;
				}
				pathComputed = false;
			}
		}
	};

	bot.on("physicsTick", onPhysicsTick);

	const setGoal = (goal: Goal | null, isDynamic = false): void => {
		currentGoal = goal;
		dynamic = isDynamic;
		retries = 0;
		resetPath();
		bot.emit("goal_updated", goal, isDynamic);
		bot.emit("path_reset", "goal_updated");
		if (!goal) {
			bot.emit("path_stop");
			rejectGoto("Goal cleared");
		}
	};

	const stop = (): void => {
		currentGoal = null;
		resetPath();
		bot.emit("path_stop");
		rejectGoto("Pathfinder stopped");
	};

	const gotoGoal = (goal: Goal): Promise<void> =>
		new Promise((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(gotoTimer);
				bot.removeListener("goal_reached", onReached);
				bot.removeListener("path_stop", onStop);
				bot.removeListener("path_reset", onReset);
				bot.removeListener("path_update", onPathUpdate);
			};
			const onReached = () => {
				cleanup();
				resolve();
			};
			const onStop = () => {
				cleanup();
				reject(new Error("Pathfinder stopped"));
			};
			const onReset = (reason: string) => {
				if (reason === "goal_updated") {
					cleanup();
					reject(new Error("Goal changed"));
				}
			};
			const onPathUpdate = (result: { status: string }) => {
				if (result.status === "noPath") {
					cleanup();
					reject(new Error("No path found"));
				}
			};

			gotoResolve = resolve;
			gotoReject = reject;
			setGoal(goal);

			// Overall timeout — never hang forever
			const gotoTimer = setTimeout(() => {
				cleanup();
				stop();
				reject(new Error("Pathfinder timeout"));
			}, 60000);

			// Listen AFTER setGoal so we don't catch the initial path_reset
			bot.on("goal_reached", onReached);
			bot.on("path_stop", onStop);
			bot.on("path_reset", onReset);
			bot.on("path_update", onPathUpdate);
		});

	const isMining = (): boolean => digging;
	const isBuilding = (): boolean => placing;

	const setMovements = (config: Partial<MovementsConfig>): void => {
		movementConfig = { ...movementConfig, ...config };
		movements = createMovements(bot, movementConfig);
		// Reset current path since movements changed
		path = [];
		pathIndex = 0;
		astarCtx = null;
		pathComputed = false;
		bot.emit("path_reset", "movements_updated");
	};

	const bestHarvestTool = (block: unknown): unknown | null => {
		if (!bot.registry || !bot.inventory) return null;
		const blockObj = block as { name?: string };
		if (!blockObj.name) return null;

		let bestTool: unknown | null = null;

		// Check each inventory item
		for (let i = 0; i < bot.inventory.slots.length; i++) {
			const item = bot.inventory.slots[i];
			if (!item) continue;

			// Use the block's material to check if this tool is effective
			const blockDef = bot.registry.blocksByName.get(blockObj.name);
			if (!blockDef?.material) continue;

			const materialSpeeds = bot.registry.materials[blockDef.material];
			if (materialSpeeds?.[item.type]) {
				// This tool has a speed for this material
				const toolSpeed = materialSpeeds[item.type]!;
				// Rough estimate: faster tool = lower time
				if (toolSpeed > 1) {
					bestTool = item;
					break; // Take first matching tool
				}
			}
		}

		return bestTool;
	};

	const getPathTo = (goal: Goal, timeout?: number): PathResult => {
		if (!movements) movements = createMovements(bot, movementConfig);
		const ctx = createAStarContext(startMoveFromBot(), goal, cfg.searchRadius);
		return computeAStar(
			ctx,
			movements,
			timeout ?? cfg.thinkTimeout,
			timeout ?? cfg.thinkTimeout,
		);
	};

	// Reset path when nearby block changes
	bot.on("blockUpdate", (_old: unknown, newBlock: unknown) => {
		if (!path || path.length === 0) return;
		const nb = newBlock as {
			position?: { x: number; y: number; z: number };
		} | null;
		if (!nb?.position) return;

		// Check if the changed block is near any point on our current path
		for (const waypoint of path) {
			const dx = Math.abs(waypoint.x - nb.position.x);
			const dy = Math.abs(waypoint.y - nb.position.y);
			const dz = Math.abs(waypoint.z - nb.position.z);
			if (dx <= 1 && dy <= 2 && dz <= 1) {
				path = [];
				pathIndex = 0;
				astarCtx = null;
				pathComputed = false;
				bot.emit("path_reset", "block_updated");
				break;
			}
		}
	});

	return {
		setGoal,
		setMovements,
		stop,
		isMoving: () => pathIndex < path.length || astarPartial,
		isMining,
		isBuilding,
		goto: gotoGoal,
		getPathTo,
		bestHarvestTool,
		config: cfg,
	};
};
