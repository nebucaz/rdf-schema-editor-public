import { describe, it, expect } from 'vitest';
import { LocalStorageReverseRelationsVisibilityStore } from './reverse-relations-visibility-store.svelte';
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

describe('LocalStorageReverseRelationsVisibilityStore', () => {
	it('defaults to false when nothing has been selected yet', () => {
		const store = new LocalStorageReverseRelationsVisibilityStore(fakeStorage());
		expect(store.getShowReverseRelations()).toBe(false);
	});

	it('getShowReverseRelations reflects a just-set value immediately', () => {
		const store = new LocalStorageReverseRelationsVisibilityStore(fakeStorage());
		store.setShowReverseRelations(true);
		expect(store.getShowReverseRelations()).toBe(true);
	});

	it('persists the value to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageReverseRelationsVisibilityStore(storage);
		store.setShowReverseRelations(true);
		expect(storage.data['rdf-schema-editor:show-reverse-relations']).toBe('true');
	});

	it('a fresh store instance backed by the same storage reads back the persisted value', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageReverseRelationsVisibilityStore(storage);
		store1.setShowReverseRelations(true);

		const store2 = new LocalStorageReverseRelationsVisibilityStore(storage);
		expect(store2.getShowReverseRelations()).toBe(true);
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageReverseRelationsVisibilityStore(undefined);
		expect(store.getShowReverseRelations()).toBe(false);
		expect(() => store.setShowReverseRelations(true)).not.toThrow();
	});
});
