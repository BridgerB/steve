/**
 * Incremental A* pathfinding with tick-budgeted computation.
 * Runs for up to tickTimeout ms per call, pausing with "partial" status.
 */

import {
	createHeap,
	heapIsEmpty,
	heapPop,
	heapPush,
	heapUpdate,
} from "./heap.ts";
import type {
	AStarContext,
	Goal,
	Move,
	Movements,
	PathNode,
	PathResult,
} from "./types.ts";

/** Create a new A* context ready for incremental computation. */
export const createAStarContext = (
	start: Move,
	goal: Goal,
	searchRadius: number,
): AStarContext => {
	const openHeap = createHeap();
	const openMap = new Map<number, PathNode>();
	const h = goal.heuristic(start);
	const startNode: PathNode = {
		data: start,
		g: 0,
		h,
		f: h,
		parent: null,
		heapIndex: -1,
	};
	heapPush(openHeap, startNode);
	openMap.set(start.hash, startNode);
	return {
		goal,
		closedSet: new Set(),
		openMap,
		openHeap,
		bestNode: startNode,
		startTime: performance.now(),
		maxCost: searchRadius < 0 ? -1 : h + searchRadius,
	};
};

/** Reconstruct path from end node back to start. */
const reconstructPath = (node: PathNode): Move[] => {
	const path: Move[] = [];
	let current: PathNode | null = node;
	while (current?.parent) {
		path.push(current.data);
		current = current.parent;
	}
	return path.reverse();
};

/** Build a PathResult from the context. */
const makeResult = (
	ctx: AStarContext,
	status: PathResult["status"],
	node: PathNode,
): PathResult => ({
	status,
	cost: node.g,
	time: performance.now() - ctx.startTime,
	visitedNodes: ctx.closedSet.size,
	generatedNodes: ctx.closedSet.size + ctx.openMap.size,
	path: reconstructPath(node),
});

/** Run one tick of A* computation. Returns PathResult with status. */
export const computeAStar = (
	ctx: AStarContext,
	movements: Movements,
	tickTimeout: number,
	totalTimeout: number,
): PathResult => {
	const tickStart = performance.now();

	while (!heapIsEmpty(ctx.openHeap)) {
		if (performance.now() - tickStart > tickTimeout)
			return makeResult(ctx, "partial", ctx.bestNode);
		if (performance.now() - ctx.startTime > totalTimeout)
			return makeResult(ctx, "timeout", ctx.bestNode);

		const node = heapPop(ctx.openHeap);
		if (ctx.goal.isEnd(node.data)) return makeResult(ctx, "success", node);

		ctx.openMap.delete(node.data.hash);
		ctx.closedSet.add(node.data.hash);

		for (const neighborData of movements.getNeighbors(node.data)) {
			if (ctx.closedSet.has(neighborData.hash)) continue;

			const g = node.g + neighborData.cost;
			const h = ctx.goal.heuristic(neighborData);

			if (ctx.maxCost > 0 && g + h > ctx.maxCost) continue;

			let neighborNode = ctx.openMap.get(neighborData.hash);
			let update = false;

			if (neighborNode === undefined) {
				neighborNode = {
					data: neighborData,
					g,
					h,
					f: g + h,
					parent: node,
					heapIndex: -1,
				};
				ctx.openMap.set(neighborData.hash, neighborNode);
			} else {
				if (neighborNode.g <= g) continue;
				update = true;
				neighborNode.data = neighborData;
				neighborNode.g = g;
				neighborNode.h = h;
				neighborNode.f = g + h;
				neighborNode.parent = node;
			}

			if (neighborNode.h < ctx.bestNode.h) ctx.bestNode = neighborNode;

			if (update) heapUpdate(ctx.openHeap, neighborNode);
			else heapPush(ctx.openHeap, neighborNode);
		}
	}

	return makeResult(ctx, "noPath", ctx.bestNode);
};
