/**
 * Promise utilities and math helpers for the bot module.
 */

import type { EventEmitter } from "node:events";
import type { Task } from "./types.ts";

/** Promise-based delay. */
export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** Create a controllable promise with finish/cancel methods. */
export const createTask = <T = void>(): Task<T> => {
	let finish!: (value: T) => void;
	let cancel!: (err: Error) => void;
	let done = false;

	const promise = new Promise<T>((resolve, reject) => {
		finish = (value: T) => {
			if (!done) {
				done = true;
				resolve(value);
			}
		};
		cancel = (err: Error) => {
			if (!done) {
				done = true;
				reject(err);
			}
		};
	});

	return { promise, finish, cancel };
};

/** Create an already-resolved task. */
export const createDoneTask = <T = void>(value?: T): Task<T> => ({
	promise: Promise.resolve(value as T),
	finish: () => {},
	cancel: () => {},
});

/**
 * Listen for an event with optional timeout and condition check.
 * Returns promise resolving to the event arguments array.
 * Automatically cleans up the listener on resolve, reject, or timeout.
 */
export const onceWithCleanup = <T extends unknown[] = unknown[]>(
	emitter: EventEmitter,
	event: string,
	options: {
		timeout?: number;
		checkCondition?: (...args: unknown[]) => boolean;
	} = {},
): Promise<T> => {
	const { timeout = 0, checkCondition } = options;
	const task = createTask<T>();

	const onEvent = (...data: unknown[]) => {
		if (typeof checkCondition === "function" && !checkCondition(...data)) {
			return;
		}
		task.finish(data as T);
	};

	emitter.addListener(event, onEvent);

	if (typeof timeout === "number" && timeout > 0) {
		const timeoutError = new Error(
			`Event ${event} did not fire within timeout of ${timeout}ms`,
		);
		sleep(timeout).then(() => task.cancel(timeoutError));
	}

	task.promise
		.catch(() => {})
		.finally(() => emitter.removeListener(event, onEvent));

	return task.promise;
};

/** Listen for a single event with default 20s timeout. */
export const once = <T extends unknown[] = unknown[]>(
	emitter: EventEmitter,
	event: string,
	timeout = 20000,
): Promise<T> => onceWithCleanup<T>(emitter, event, { timeout });

/** Race a promise against a timeout. */
export const withTimeout = <T>(
	promise: Promise<T>,
	timeout: number,
): Promise<T> =>
	Promise.race([
		promise,
		sleep(timeout).then(() => {
			throw new Error("Promise timed out.");
		}),
	]);

/** Monotonically increasing sequence number for block interactions (1.19+). */
let _sequenceNumber = 0;
export const nextSequence = (): number => ++_sequenceNumber;

/** Clamp a value between min and max. */
export const clamp = (min: number, x: number, max: number): number =>
	Math.min(Math.max(x, min), max);
