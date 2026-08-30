import { describe, it, expect } from 'vitest';
import { LocalStorageActiveWorkspaceStore } from './active-workspace-store';
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

describe('LocalStorageActiveWorkspaceStore', () => {
	it('returns undefined when nothing has been selected yet', () => {
		const store = new LocalStorageActiveWorkspaceStore(fakeStorage());
		expect(store.getActive()).toBeUndefined();
	});

	it('getActive reflects a just-set selection immediately', () => {
		const store = new LocalStorageActiveWorkspaceStore(fakeStorage());
		store.setActive('http://example.org/schema#Workspace-Project-Overview');
		expect(store.getActive()).toBe('http://example.org/schema#Workspace-Project-Overview');
	});

	it('persists the selection to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageActiveWorkspaceStore(storage);
		store.setActive('http://example.org/schema#Workspace-Project-Overview');
		expect(storage.data['rdf-schema-editor:active-workspace']).toBe(
			'http://example.org/schema#Workspace-Project-Overview'
		);
	});

	it('a fresh store instance backed by the same storage reads back the persisted selection', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageActiveWorkspaceStore(storage);
		store1.setActive('http://example.org/schema#Workspace-Project-Overview');

		const store2 = new LocalStorageActiveWorkspaceStore(storage);
		expect(store2.getActive()).toBe('http://example.org/schema#Workspace-Project-Overview');
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageActiveWorkspaceStore(undefined);
		expect(store.getActive()).toBeUndefined();
		expect(() => store.setActive('http://example.org/schema#Workspace-Default')).not.toThrow();
	});
});
