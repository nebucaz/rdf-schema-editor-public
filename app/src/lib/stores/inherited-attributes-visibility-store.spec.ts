import { describe, it, expect } from 'vitest';
import { LocalStorageInheritedAttributesVisibilityStore } from './inherited-attributes-visibility-store.svelte';
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

describe('LocalStorageInheritedAttributesVisibilityStore', () => {
	it('defaults to true when nothing has been selected yet', () => {
		const store = new LocalStorageInheritedAttributesVisibilityStore(fakeStorage());
		expect(store.getShowInheritedAttributes()).toBe(true);
	});

	it('getShowInheritedAttributes reflects a just-set value immediately', () => {
		const store = new LocalStorageInheritedAttributesVisibilityStore(fakeStorage());
		store.setShowInheritedAttributes(false);
		expect(store.getShowInheritedAttributes()).toBe(false);
	});

	it('persists the value to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageInheritedAttributesVisibilityStore(storage);
		store.setShowInheritedAttributes(false);
		expect(storage.data['rdf-schema-editor:show-inherited-attributes']).toBe('false');
	});

	it('a fresh store instance backed by the same storage reads back the persisted value', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageInheritedAttributesVisibilityStore(storage);
		store1.setShowInheritedAttributes(false);

		const store2 = new LocalStorageInheritedAttributesVisibilityStore(storage);
		expect(store2.getShowInheritedAttributes()).toBe(false);
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageInheritedAttributesVisibilityStore(undefined);
		expect(store.getShowInheritedAttributes()).toBe(true);
		expect(() => store.setShowInheritedAttributes(false)).not.toThrow();
	});
});
