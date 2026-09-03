import { describe, it, expect } from 'vitest';
import { LocalStorageNamespaceVisibilityStore } from './namespace-visibility-store';
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

describe('LocalStorageNamespaceVisibilityStore', () => {
	it('starts with nothing hidden when nothing is stored yet (STORY-096: seeding moved to the caller)', () => {
		const store = new LocalStorageNamespaceVisibilityStore(fakeStorage());
		expect(store.getHidden()).toEqual(new Set());
	});

	it('setHidden(true) adds a namespace to the hidden set', () => {
		const store = new LocalStorageNamespaceVisibilityStore(fakeStorage());
		store.setHidden('http://example.org/ns', true);
		expect(store.getHidden()).toEqual(new Set(['http://example.org/ns']));
	});

	it('setHidden(false) removes a namespace from the hidden set but still records the preference', () => {
		const store = new LocalStorageNamespaceVisibilityStore(fakeStorage());
		store.setHidden('http://example.org/ns', true);
		store.setHidden('http://example.org/ns', false);
		expect(store.getHidden()).toEqual(new Set());
		expect(store.hasStoredPreference('http://example.org/ns')).toBe(true);
	});

	it('persists toggles to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageNamespaceVisibilityStore(storage);
		store.setHidden('http://example.org/shown', false);
		store.setHidden('http://example.org/hidden', true);
		const persisted = JSON.parse(storage.data['rdf-schema-editor:namespace-visibility']);
		expect(persisted).toEqual({ 'http://example.org/shown': false, 'http://example.org/hidden': true });
	});

	it('a fresh store instance backed by the same storage reads back persisted choices', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageNamespaceVisibilityStore(storage);
		store1.setHidden('http://example.org/ns', true);

		const store2 = new LocalStorageNamespaceVisibilityStore(storage);
		expect(store2.getHidden()).toEqual(new Set(['http://example.org/ns']));
	});

	it('hasStoredPreference distinguishes a never-touched namespace from an explicitly shown one', () => {
		const store = new LocalStorageNamespaceVisibilityStore(fakeStorage());
		expect(store.hasStoredPreference('http://example.org/ns')).toBe(false);
		store.setHidden('http://example.org/ns', false);
		expect(store.hasStoredPreference('http://example.org/ns')).toBe(true);
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageNamespaceVisibilityStore(undefined);
		expect(store.getHidden()).toEqual(new Set());
		expect(() => store.setHidden('http://example.org/ns', true)).not.toThrow();
	});
});
