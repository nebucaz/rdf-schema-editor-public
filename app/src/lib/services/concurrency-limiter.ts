/**
 * A first-in-first-out concurrency limiter (reduce-requests STORY-299). `run(task)` starts the task when fewer
 * than `limit` are running, otherwise queues it; a finishing task (resolved, rejected or thrown) hands its slot
 * to the oldest waiting one, so a failure never leaks a slot. Used by `SparqlConnector` so the app cannot send a
 * burst of requests at a throttled GraphDB, however many a screen queues.
 */
export interface ConcurrencyLimiter {
	run<T>(task: () => Promise<T> | T): Promise<T>;
	/** Tasks running right now. */
	readonly active: number;
	/** Tasks waiting for a slot. */
	readonly queued: number;
}

export function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
	const max = Math.max(1, Math.floor(limit));
	let active = 0;
	const waiting: (() => void)[] = [];

	function release() {
		const next = waiting.shift();
		// Hand the slot straight to the next waiter (`active` stays as it is) or give it back.
		if (next) next();
		else active--;
	}

	return {
		async run<T>(task: () => Promise<T> | T): Promise<T> {
			if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
			else active++;
			try {
				return await task();
			} finally {
				release();
			}
		},
		get active() {
			return active;
		},
		get queued() {
			return waiting.length;
		}
	};
}
