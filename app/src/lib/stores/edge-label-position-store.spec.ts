import { describe, it, expect } from 'vitest';
import { LocalStorageEdgeLabelPositionStore, type EdgeLabelPositionStore } from './edge-label-position-store';
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

describe('LocalStorageEdgeLabelPositionStore (Sprint 6 Story 021)', () => {
	it('returns undefined for an edge with no stored override', () => {
		const store: EdgeLabelPositionStore = new LocalStorageEdgeLabelPositionStore(fakeStorage());
		expect(store.getPercent('edge-1')).toBeUndefined();
	});

	it('setPercent then getPercent round-trips the value', () => {
		const store = new LocalStorageEdgeLabelPositionStore(fakeStorage());
		store.setPercent('edge-1', 0.35);
		expect(store.getPercent('edge-1')).toBe(0.35);
	});

	it('persists to storage under the dedicated key', () => {
		const storage = fakeStorage();
		const store = new LocalStorageEdgeLabelPositionStore(storage);
		store.setPercent('edge-1', 0.35);
		expect(JSON.parse(storage.data['rdf-schema-editor:edge-label-positions'])).toEqual({ 'edge-1': 0.35 });
	});

	it('setPercent(undefined) clears a previously-set override', () => {
		const storage = fakeStorage();
		const store = new LocalStorageEdgeLabelPositionStore(storage);
		store.setPercent('edge-1', 0.35);
		store.setPercent('edge-1', undefined);
		expect(store.getPercent('edge-1')).toBeUndefined();
		expect(JSON.parse(storage.data['rdf-schema-editor:edge-label-positions'])).toEqual({});
	});

	it('keeps separate edges independent', () => {
		const store = new LocalStorageEdgeLabelPositionStore(fakeStorage());
		store.setPercent('edge-1', 0.1);
		store.setPercent('edge-2', 0.9);
		expect(store.getPercent('edge-1')).toBe(0.1);
		expect(store.getPercent('edge-2')).toBe(0.9);
	});

	it('a fresh store instance backed by the same storage reads back a persisted override', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageEdgeLabelPositionStore(storage);
		store1.setPercent('edge-1', 0.6);

		const store2 = new LocalStorageEdgeLabelPositionStore(storage);
		expect(store2.getPercent('edge-1')).toBe(0.6);
	});

	it('falls back to no overrides (no throw) when storage contains invalid JSON', () => {
		const storage = fakeStorage();
		storage.data['rdf-schema-editor:edge-label-positions'] = 'not json';
		const store = new LocalStorageEdgeLabelPositionStore(storage);
		expect(store.getPercent('edge-1')).toBeUndefined();
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageEdgeLabelPositionStore(undefined);
		expect(store.getPercent('edge-1')).toBeUndefined();
		expect(() => store.setPercent('edge-1', 0.5)).not.toThrow();
	});
});
