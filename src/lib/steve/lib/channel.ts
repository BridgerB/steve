/**
 * A minimal CSP-style async channel — the parking primitive the decision loop is
 * built on. Think core.async: producers `put` values, a single consumer `take`s
 * them, and `take` PARKS (returns a promise that resolves only when a value
 * arrives) rather than polling. Unbounded FIFO buffer, exactly one consumer.
 *
 * Built on `createTask` (a deferred promise) — when the consumer parks on an empty
 * channel we hand it a Task whose `finish` the next `put` calls directly.
 *
 * (Fork B — pure discrete events + an `alts!`-style timeout backstop — would add a
 *  `takeOrTimeout`; the heartbeat model A never needs it, so it's intentionally
 *  omitted to keep the primitive small and the single-consumer invariant simple.)
 */

import { createTask } from "../../typecraft/bot/utils.ts";
import type { Task } from "../../typecraft/bot/types.ts";

export const CLOSED = Symbol("channel-closed");
export type Closed = typeof CLOSED;

export type Channel<T> = {
	/** Non-blocking enqueue — hands directly to a parked consumer, else buffers.
	 *  Returns false (no-op) if the channel is closed. */
	put: (v: T) => boolean;
	/** Park until a value is available. After close() drains the buffer it resolves
	 *  CLOSED forever. */
	take: () => Promise<T | Closed>;
	/** Stop the channel — wakes a parked consumer with CLOSED. */
	close: () => void;
	readonly closed: boolean;
};

export const createChannel = <T>(): Channel<T> => {
	const queue: T[] = [];
	// Single consumer ⇒ at most one parked taker at a time.
	let waiter: Task<T | Closed> | null = null;
	let isClosed = false;

	const put = (v: T): boolean => {
		if (isClosed) return false;
		if (waiter) {
			const w = waiter;
			waiter = null;
			w.finish(v); // hand straight to the parked consumer
		} else {
			queue.push(v); // buffer for the next take()
		}
		return true;
	};

	const take = (): Promise<T | Closed> => {
		if (queue.length > 0) return Promise.resolve(queue.shift() as T);
		if (isClosed) return Promise.resolve(CLOSED);
		// Surfaces a wiring bug rather than silently dropping a value.
		if (waiter) {
			throw new Error("channel: concurrent take() — single consumer only");
		}
		waiter = createTask<T | Closed>();
		return waiter.promise;
	};

	const close = (): void => {
		if (isClosed) return;
		isClosed = true;
		if (waiter) {
			const w = waiter;
			waiter = null;
			w.finish(CLOSED);
		}
	};

	return {
		put,
		take,
		close,
		get closed() {
			return isClosed;
		},
	};
};
