import { describe, it, expect } from 'vitest';
import { LocalStorageDescriptionVisibilityStore } from './description-visibility-store.svelte';
import type { MinimalStorage } from './layout-store';

function fakeStorage(): MinimalStorage & { data: Record<string, string> } {
	const data: Record<string, string> = {};
	return {
		data,
		getItem: (key) => data[key] ?? null,
		setItem: (key, value) => {
			data[key] = value;
		}
	};
}

describe('LocalStorageDescriptionVisibilityStore', () => {
	it('defaults to true when nothing has been selected yet', () => {
		const store = new LocalStorageDescriptionVisibilityStore(fakeStorage());
		expect(store.getShowDescriptions()).toBe(true);
	});

	it('getShowDescriptions reflects a just-set value immediately', () => {
		const store = new LocalStorageDescriptionVisibilityStore(fakeStorage());
		store.setShowDescriptions(false);
		expect(store.getShowDescriptions()).toBe(false);
	});

	it('persists the value to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageDescriptionVisibilityStore(storage);
		store.setShowDescriptions(false);
		expect(storage.data['rdf-schema-editor:show-descriptions']).toBe('false');
	});

	it('a fresh store instance backed by the same storage reads back the persisted value', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageDescriptionVisibilityStore(storage);
		store1.setShowDescriptions(false);

		const store2 = new LocalStorageDescriptionVisibilityStore(storage);
		expect(store2.getShowDescriptions()).toBe(false);
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageDescriptionVisibilityStore(undefined);
		expect(store.getShowDescriptions()).toBe(true);
		expect(() => store.setShowDescriptions(false)).not.toThrow();
	});
});
