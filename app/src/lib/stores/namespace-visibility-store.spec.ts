import { describe, it, expect } from 'vitest';
import { LocalStorageNamespaceVisibilityStore } from './namespace-visibility-store';
import { DEFAULT_NAMESPACE_BASE_IRI } from '$lib/config';
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
	it('defaults to the built-in default namespace hidden when nothing is stored yet', () => {
		const store = new LocalStorageNamespaceVisibilityStore(fakeStorage());
		expect(store.getHidden()).toEqual(new Set([DEFAULT_NAMESPACE_BASE_IRI]));
	});

	it('setHidden(true) adds a namespace to the hidden set', () => {
		const store = new LocalStorageNamespaceVisibilityStore(fakeStorage());
		store.setHidden('http://example.org/ns', true);
		expect(store.getHidden()).toEqual(new Set([DEFAULT_NAMESPACE_BASE_IRI, 'http://example.org/ns']));
	});

	it('setHidden(false) removes a namespace from the hidden set, including the default one', () => {
		const store = new LocalStorageNamespaceVisibilityStore(fakeStorage());
		store.setHidden(DEFAULT_NAMESPACE_BASE_IRI, false);
		expect(store.getHidden()).toEqual(new Set());
	});

	it('persists toggles to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageNamespaceVisibilityStore(storage);
		store.setHidden(DEFAULT_NAMESPACE_BASE_IRI, false);
		store.setHidden('http://example.org/ns', true);
		const persisted = JSON.parse(storage.data['rdf-schema-editor:namespace-visibility']);
		expect(persisted).toEqual({ 'http://example.org/ns': true });
	});

	it('a fresh store instance backed by the same storage reads back persisted choices, not the default', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageNamespaceVisibilityStore(storage);
		store1.setHidden(DEFAULT_NAMESPACE_BASE_IRI, false);

		const store2 = new LocalStorageNamespaceVisibilityStore(storage);
		expect(store2.getHidden()).toEqual(new Set());
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageNamespaceVisibilityStore(undefined);
		expect(store.getHidden()).toEqual(new Set([DEFAULT_NAMESPACE_BASE_IRI]));
		expect(() => store.setHidden('http://example.org/ns', true)).not.toThrow();
	});
});
