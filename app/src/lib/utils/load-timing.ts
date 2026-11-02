/**
 * Dev-only timing of the steps in `loadSchemaFromGraphDB` (loading-spinner STORY-267). `timed` wraps one
 * awaited step; `report` logs one table (a row per step, then the wall-clock total and the number of
 * requests started) and starts a fresh report. When `enabled` is false both are pass-throughs, so
 * production builds neither log nor measure.
 */
export interface LoadTimingOptions {
	enabled: boolean;
	now?: () => number;
	/** Monotonic count of requests started so far (`requestActivity.started`). */
	requestCount?: () => number;
	table?: (rows: { step: string; ms: number }[]) => void;
}

export function createLoadTiming(options: LoadTimingOptions) {
	const { enabled } = options;
	const now = options.now ?? (() => performance.now());
	const requestCount = options.requestCount ?? (() => 0);
	const table = options.table ?? ((rows) => console.table(rows));

	let rows: { step: string; ms: number }[] = [];
	let startedAt = now();
	let requestsAtStart = requestCount();

	return {
		async timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
			if (!enabled) return fn();
			const t0 = now();
			try {
				const result = await fn();
				rows.push({ step, ms: Math.round(now() - t0) });
				return result;
			} catch (err) {
				rows.push({ step: `${step} (failed)`, ms: Math.round(now() - t0) });
				throw err;
			}
		},
		report(): void {
			if (!enabled) return;
			const requests = requestCount() - requestsAtStart;
			table([...rows, { step: `TOTAL (${requests} requests)`, ms: Math.round(now() - startedAt) }]);
			rows = [];
			startedAt = now();
			requestsAtStart = requestCount();
		}
	};
}
