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
		/** Runs `fn`, counting it as pending until its promise settles; passes the result or error through. */
		async track<T>(fn: () => Promise<T>): Promise<T> {
			pending++;
			started++;
			try {
				return await fn();
			} finally {
				pending--;
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
