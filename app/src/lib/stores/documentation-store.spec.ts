import { describe, it, expect } from 'vitest';
import { LocalStorageDocumentationStore } from './documentation-store';
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

describe('LocalStorageDocumentationStore', () => {
	it('returns undefined when nothing has been viewed yet', () => {
		const store = new LocalStorageDocumentationStore(fakeStorage());
		expect(store.getLastSectionId()).toBeUndefined();
	});

	it('getLastSectionId reflects a just-set section immediately', () => {
		const store = new LocalStorageDocumentationStore(fakeStorage());
		store.setLastSectionId('entity-node');
		expect(store.getLastSectionId()).toBe('entity-node');
	});

	it('persists the section id to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageDocumentationStore(storage);
		store.setLastSectionId('entity-node');
		expect(storage.data['rdf-schema-editor:last-documentation-section']).toBe('entity-node');
	});

	it('a fresh store instance backed by the same storage reads back the persisted section id', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageDocumentationStore(storage);
		store1.setLastSectionId('entity-node');

		const store2 = new LocalStorageDocumentationStore(storage);
		expect(store2.getLastSectionId()).toBe('entity-node');
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageDocumentationStore(undefined);
		expect(store.getLastSectionId()).toBeUndefined();
		expect(() => store.setLastSectionId('entity-node')).not.toThrow();
	});

	it('returns undefined for panel width when nothing has been set yet', () => {
		const store = new LocalStorageDocumentationStore(fakeStorage());
		expect(store.getPanelWidth()).toBeUndefined();
	});

	it('getPanelWidth reflects a just-set width immediately', () => {
		const store = new LocalStorageDocumentationStore(fakeStorage());
		store.setPanelWidth(640);
		expect(store.getPanelWidth()).toBe(640);
	});

	it('persists the panel width to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageDocumentationStore(storage);
		store.setPanelWidth(640);
		expect(storage.data['rdf-schema-editor:documentation-panel-width']).toBe('640');
	});

	it('a fresh store instance backed by the same storage reads back the persisted panel width', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageDocumentationStore(storage);
		store1.setPanelWidth(640);

		const store2 = new LocalStorageDocumentationStore(storage);
		expect(store2.getPanelWidth()).toBe(640);
	});

	it('falls back gracefully for panel width with no storage backend at all', () => {
		const store = new LocalStorageDocumentationStore(undefined);
		expect(store.getPanelWidth()).toBeUndefined();
		expect(() => store.setPanelWidth(640)).not.toThrow();
	});

	it('treats a corrupt/non-numeric persisted width as unset', () => {
		const storage = fakeStorage();
		storage.data['rdf-schema-editor:documentation-panel-width'] = 'not-a-number';
		const store = new LocalStorageDocumentationStore(storage);
		expect(store.getPanelWidth()).toBeUndefined();
	});
});
