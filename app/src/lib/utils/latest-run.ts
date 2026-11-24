/**
 * "Latest wins" bookkeeping for async option reloads (spec/instance-mgmt-issue STORY-614): overlapping
 * runs all complete, and without a token the slowest one overwrites the newest result. `begin(key)`
 * returns `null` when the inputs (`key`) are unchanged since the last run, so a canvas rebuild that
 * changed nothing does not refetch.
 */
export interface LatestRunToken {
	/** True while no later run has begun (and `reset` was not called). */
	isCurrent(): boolean;
	/** Forget this run's key so the same inputs are fetched again next time (call on failure). */
	fail(): void;
}

export function createLatestRun() {
	let counter = 0;
	let lastKey: string | null = null;

	return {
		begin(key: string): LatestRunToken | null {
			if (key === lastKey) return null;
			lastKey = key;
			const id = ++counter;
			return {
				isCurrent: () => id === counter,
				fail: () => {
					if (id === counter) lastKey = null;
				}
			};
		},
		reset(): void {
			counter++;
			lastKey = null;
		}
	};
}

/** Inputs that decide a relation-option refetch: the fields' identity and target, plus the connector's
 *  write count (a write may have added or removed a target class's individuals). */
export function relationOptionsKey(
	fields: { iri: string; targetClassIri?: string; valueSchemeIri?: string }[],
	writeCount: number
): string {
	const parts = fields.map((f) => `${f.iri}|${f.targetClassIri ?? ''}|${f.valueSchemeIri ?? ''}`).sort();
	return `${writeCount}#${parts.join(',')}`;
}
