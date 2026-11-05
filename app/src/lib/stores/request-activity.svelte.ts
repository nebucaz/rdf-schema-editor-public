import { untrack } from 'svelte';

/**
 * Counts SPARQL requests in flight (loading-spinner STORY-265) so the UI can show a busy indicator.
 * `SparqlConnector` wraps its two fetch sites in `track`, which decrements in `finally`, so a failed or
 * aborted request never leaves the count stuck. Non-SPARQL fetches are deliberately not counted.
 * In-memory reactive singleton, not persisted.
 */
function createRequestActivity() {
	let pending = $state(0);
	/** Total requests begun since page load (or `reset`); feeds the dev load-timing log. */
	let started = 0;

	return {
		get pending() {
			return pending;
		},
		get started() {
			return started;
		},
		get busy() {
			return pending > 0;
		},
		/** Runs `fn`, counting it as pending until its promise settles; passes the result or error through.
		 *  The count updates are untracked: `pending++` reads before it writes, and `track` starts
		 *  synchronously, so called from an `$effect` it would subscribe that effect to `pending` and
		 *  re-run it on every request start and finish (`effect_update_depth_exceeded`). */
		async track<T>(fn: () => Promise<T>): Promise<T> {
			untrack(() => pending++);
			started++;
			try {
				return await fn();
			} finally {
				untrack(() => pending--);
			}
		},
		/** Test hook: forget every pending request. */
		reset() {
			pending = 0;
			started = 0;
		}
	};
}

export const requestActivity = createRequestActivity();
