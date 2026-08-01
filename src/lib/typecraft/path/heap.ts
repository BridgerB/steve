/**
 * Binary min-heap ordered by PathNode.f cost.
 * 1-indexed array (index 0 unused) for simpler parent/child math.
 * Stores heapIndex on each node for O(log n) updates (no indexOf scan).
 */

import type { PathNode } from "./types.ts";

/** Create an empty min-heap (sentinel at index 0). */
export const createHeap = (): PathNode[] => [];

/** Whether the heap has no elements. */
export const heapIsEmpty = (heap: PathNode[]): boolean => heap.length <= 1;

/** Swap two heap entries and update their stored indices. */
const swap = (heap: PathNode[], i: number, j: number): void => {
	const tmp = heap[i]!;
	heap[i] = heap[j]!;
	heap[j] = tmp;
	heap[i]!.heapIndex = i;
	heap[j]!.heapIndex = j;
};

/** Bubble a node up toward the root. */
const bubbleUp = (heap: PathNode[], i: number): void => {
	let parent = i >>> 1;
	while (i > 1 && heap[parent]!.f > heap[i]!.f) {
		swap(heap, i, parent);
		i = parent;
		parent = i >>> 1;
	}
};

/** Sift a node down toward the leaves. */
const siftDown = (heap: PathNode[], i: number): void => {
	const size = heap.length;
	for (;;) {
		const left = i * 2;
		const right = left + 1;
		let smallest = i;
		if (left < size && heap[left]!.f < heap[smallest]!.f) smallest = left;
		if (right < size && heap[right]!.f < heap[smallest]!.f) smallest = right;
		if (smallest === i) break;
		swap(heap, i, smallest);
		i = smallest;
	}
};

/** Insert a node into the heap. O(log n). */
export const heapPush = (heap: PathNode[], node: PathNode): void => {
	if (heap.length === 0) heap.push(node); // sentinel at index 0
	node.heapIndex = heap.length;
	heap.push(node);
	bubbleUp(heap, heap.length - 1);
};

/** Remove and return the minimum-f node. O(log n). */
export const heapPop = (heap: PathNode[]): PathNode => {
	const min = heap[1]!;
	min.heapIndex = -1;
	const last = heap.pop()!;
	if (heap.length > 1) {
		heap[1] = last;
		last.heapIndex = 1;
		siftDown(heap, 1);
	}
	return min;
};

/** Re-bubble a node after its f-cost decreased. O(log n). */
export const heapUpdate = (heap: PathNode[], node: PathNode): void => {
	if (node.heapIndex > 0) bubbleUp(heap, node.heapIndex);
};
