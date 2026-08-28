import { describe, it, expect } from 'vitest';
import { LocalStorageViewModeStore } from './view-mode-store';
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

describe('LocalStorageViewModeStore', () => {
	it('defaults to "schema" when nothing has been selected yet', () => {
		const store = new LocalStorageViewModeStore(fakeStorage());
		expect(store.getViewMode()).toBe('schema');
	});

	it('getViewMode reflects a just-set selection immediately', () => {
		const store = new LocalStorageViewModeStore(fakeStorage());
		store.setViewMode('instances');
		expect(store.getViewMode()).toBe('instances');
	});

	it('persists the selection to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageViewModeStore(storage);
		store.setViewMode('instances');
		expect(storage.data['rdf-schema-editor:view-mode']).toBe('instances');
	});

	it('a fresh store instance backed by the same storage reads back the persisted selection', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageViewModeStore(storage);
		store1.setViewMode('instances');

		const store2 = new LocalStorageViewModeStore(storage);
		expect(store2.getViewMode()).toBe('instances');
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageViewModeStore(undefined);
		expect(store.getViewMode()).toBe('schema');
		expect(() => store.setViewMode('instances')).not.toThrow();
	});
});
