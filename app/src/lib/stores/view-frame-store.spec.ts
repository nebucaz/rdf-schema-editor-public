import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalStorageViewFrameStore, type ViewFrameStore } from './view-frame-store';
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

describe('LocalStorageViewFrameStore (Sprint 6 Story 023)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('returns undefined for a Workspace with no stored view-frame', () => {
		const store: ViewFrameStore = new LocalStorageViewFrameStore(fakeStorage(), 300);
		expect(store.getViewFrame('urn:ws-a')).toBeUndefined();
	});

	it('getViewFrame reflects a just-set frame immediately, before the debounced write fires', () => {
		const store = new LocalStorageViewFrameStore(fakeStorage(), 300);
		store.setViewFrame('urn:ws-a', { x: 10, y: 20, zoom: 1.5 });
		expect(store.getViewFrame('urn:ws-a')).toEqual({ x: 10, y: 20, zoom: 1.5 });
	});

	it('debounces the underlying storage write — not persisted until the delay elapses', () => {
		const storage = fakeStorage();
		const store = new LocalStorageViewFrameStore(storage, 300);
		store.setViewFrame('urn:ws-a', { x: 10, y: 20, zoom: 1 });
		expect(storage.data['rdf-schema-editor:view-frames']).toBeUndefined();
		vi.advanceTimersByTime(300);
		expect(JSON.parse(storage.data['rdf-schema-editor:view-frames'])).toEqual({
			'urn:ws-a': { x: 10, y: 20, zoom: 1 }
		});
	});

	it('coalesces several rapid updates (a continuous pan/zoom gesture) for the same Workspace into a single write', () => {
		const storage = fakeStorage();
		const store = new LocalStorageViewFrameStore(storage, 300);
		store.setViewFrame('urn:ws-a', { x: 1, y: 1, zoom: 1 });
		store.setViewFrame('urn:ws-a', { x: 2, y: 2, zoom: 1.2 });
		store.setViewFrame('urn:ws-a', { x: 3, y: 3, zoom: 1.4 });
		expect(storage.data['rdf-schema-editor:view-frames']).toBeUndefined();
		vi.advanceTimersByTime(300);
		expect(JSON.parse(storage.data['rdf-schema-editor:view-frames'])).toEqual({
			'urn:ws-a': { x: 3, y: 3, zoom: 1.4 }
		});
	});

	it('keeps separate Workspaces independent', () => {
		const storage = fakeStorage();
		const store = new LocalStorageViewFrameStore(storage, 0);
		store.setViewFrame('urn:ws-a', { x: 1, y: 1, zoom: 1 });
		store.setViewFrame('urn:ws-b', { x: 2, y: 2, zoom: 2 });
		vi.advanceTimersByTime(0);
		expect(store.getViewFrame('urn:ws-a')).toEqual({ x: 1, y: 1, zoom: 1 });
		expect(store.getViewFrame('urn:ws-b')).toEqual({ x: 2, y: 2, zoom: 2 });
	});

	it('a fresh store instance backed by the same storage reads back a persisted view-frame', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageViewFrameStore(storage, 0);
		store1.setViewFrame('urn:ws-a', { x: 5, y: 6, zoom: 0.8 });
		vi.advanceTimersByTime(0);

		const store2 = new LocalStorageViewFrameStore(storage, 0);
		expect(store2.getViewFrame('urn:ws-a')).toEqual({ x: 5, y: 6, zoom: 0.8 });
	});

	it('falls back to no stored frames (no throw) when storage contains invalid JSON', () => {
		const storage = fakeStorage();
		storage.data['rdf-schema-editor:view-frames'] = 'not json';
		const store = new LocalStorageViewFrameStore(storage, 300);
		expect(store.getViewFrame('urn:ws-a')).toBeUndefined();
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageViewFrameStore(undefined, 300);
		expect(store.getViewFrame('urn:ws-a')).toBeUndefined();
		expect(() => store.setViewFrame('urn:ws-a', { x: 1, y: 2, zoom: 1 })).not.toThrow();
		vi.advanceTimersByTime(300);
	});
});
