import { describe, expect, it } from 'vitest';
import { LocalStorageConceptBadgeVisibilityStore } from './concept-badge-visibility-store.svelte';
import type { MinimalStorage } from './layout-store';

function fakeStorage(): MinimalStorage & { data: Record<string, string> } {
	const data: Record<string, string> = {};
	return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('LocalStorageConceptBadgeVisibilityStore (STORY-325)', () => {
	it('is on until the user turns it off', () => {
		expect(new LocalStorageConceptBadgeVisibilityStore(fakeStorage()).getShowConceptBadge()).toBe(true);
	});

	it('remembers the choice across instances', () => {
		const storage = fakeStorage();
		new LocalStorageConceptBadgeVisibilityStore(storage).setShowConceptBadge(false);
		expect(storage.data['rdf-schema-editor:show-concept-badge']).toBe('false');
		expect(new LocalStorageConceptBadgeVisibilityStore(storage).getShowConceptBadge()).toBe(false);
	});

	it('keeps working without storage', () => {
		const store = new LocalStorageConceptBadgeVisibilityStore(undefined);
		store.setShowConceptBadge(false);
		expect(store.getShowConceptBadge()).toBe(false);
	});
});
