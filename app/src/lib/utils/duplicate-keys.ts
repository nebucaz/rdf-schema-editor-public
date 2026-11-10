/**
 * Dev-only diagnostics for keyed `{#each}` lists (spec/loop-issues STORY-312). Svelte's `each_key_duplicate`
 * names the key but not the list or the data source; `warnDuplicateKeys` logs both. It is a no-op in
 * production builds.
 */

/** Each key that occurs more than once in `items`, once, in first-repeat order. */
export function duplicateKeys<T>(items: readonly T[], key: (item: T) => string): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const item of items) {
		const k = key(item);
		if (seen.has(k)) repeated.add(k);
		else seen.add(k);
	}
	return [...repeated];
}

/** `console.warn`s the list name and its repeated keys. Dev builds only. */
export function warnDuplicateKeys<T>(listName: string, items: readonly T[], key: (item: T) => string): void {
	if (!import.meta.env.DEV) return;
	const repeated = duplicateKeys(items, key);
	if (repeated.length === 0) return;
	console.warn(`[duplicate keys] "${listName}" has repeated keys: ${repeated.join(', ')}`);
}
