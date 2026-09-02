import { describe, it, expect } from 'vitest';
import { LocalStorageActiveNamespaceStore, resolveWorkspaceDefaultNamespace } from './active-namespace-store';
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

describe('LocalStorageActiveNamespaceStore', () => {
	it('returns undefined when nothing has been selected yet', () => {
		const store = new LocalStorageActiveNamespaceStore(fakeStorage());
		expect(store.getActive()).toBeUndefined();
	});

	it('getActive reflects a just-set selection immediately', () => {
		const store = new LocalStorageActiveNamespaceStore(fakeStorage());
		store.setActive('http://example.org/ns');
		expect(store.getActive()).toBe('http://example.org/ns');
	});

	it('persists the selection to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageActiveNamespaceStore(storage);
		store.setActive('http://example.org/ns');
		expect(storage.data['rdf-schema-editor:active-namespace']).toBe('http://example.org/ns');
	});

	it('a fresh store instance backed by the same storage reads back the persisted selection', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageActiveNamespaceStore(storage);
		store1.setActive('http://example.org/ns');

		const store2 = new LocalStorageActiveNamespaceStore(storage);
		expect(store2.getActive()).toBe('http://example.org/ns');
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageActiveNamespaceStore(undefined);
		expect(store.getActive()).toBeUndefined();
		expect(() => store.setActive('http://example.org/ns')).not.toThrow();
	});
});

describe('resolveWorkspaceDefaultNamespace (Sprint 6 Story 016)', () => {
	it('switches to the Workspace’s configured default namespace when set', () => {
		const workspace = { defaultNamespaceBaseIri: 'http://example.org/ns-b' };
		expect(resolveWorkspaceDefaultNamespace(workspace, 'http://example.org/ns-a')).toBe(
			'http://example.org/ns-b'
		);
	});

	it('leaves the current namespace untouched when the Workspace has no default configured', () => {
		const workspace = { defaultNamespaceBaseIri: null };
		expect(resolveWorkspaceDefaultNamespace(workspace, 'http://example.org/ns-a')).toBe(
			'http://example.org/ns-a'
		);
	});

	it('leaves the current namespace untouched when the Workspace itself is unresolved', () => {
		expect(resolveWorkspaceDefaultNamespace(undefined, 'http://example.org/ns-a')).toBe(
			'http://example.org/ns-a'
		);
	});
});
