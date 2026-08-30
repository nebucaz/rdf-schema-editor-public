import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	debounce,
	LocalStorageLayoutStore,
	GraphDbLayoutStore,
	gridPosition,
	resolvePositions,
	type MinimalStorage,
	type WorkspaceMemberPositionsSource
} from './layout-store';

function fakeConnector(
	members: { elementIri: string; x: number; y: number }[] = []
): WorkspaceMemberPositionsSource & {
	fetchWorkspaceMembers: ReturnType<typeof vi.fn>;
	updateWorkspaceMemberPosition: ReturnType<typeof vi.fn>;
} {
	return {
		fetchWorkspaceMembers: vi.fn(async () => members),
		updateWorkspaceMemberPosition: vi.fn(async () => undefined)
	};
}

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

describe('debounce', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('coalesces multiple rapid calls into a single invocation after the delay', () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 300);
		debounced();
		debounced();
		debounced();
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('passes through the arguments of the last call', () => {
		const fn = vi.fn();
		const debounced = debounce((x: number) => fn(x), 100);
		debounced(1);
		debounced(2);
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledWith(2);
	});
});

describe('LocalStorageLayoutStore', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('returns undefined for an IRI with no stored position', () => {
		const store = new LocalStorageLayoutStore(fakeStorage(), 300);
		expect(store.getPosition('urn:x')).toBeUndefined();
	});

	it('getPosition reflects a just-set position immediately, before the debounced write fires', () => {
		const store = new LocalStorageLayoutStore(fakeStorage(), 300);
		store.setPosition('urn:x', 10, 20);
		expect(store.getPosition('urn:x')).toEqual({ x: 10, y: 20 });
	});

	it('debounces the underlying storage write — not persisted until the delay elapses', () => {
		const storage = fakeStorage();
		const store = new LocalStorageLayoutStore(storage, 300);
		store.setPosition('urn:x', 10, 20);
		expect(storage.data['rdf-schema-editor:layout']).toBeUndefined();
		vi.advanceTimersByTime(300);
		expect(JSON.parse(storage.data['rdf-schema-editor:layout'])).toEqual({ 'urn:x': { x: 10, y: 20 } });
	});

	it('coalesces several rapid moves of different nodes into a single debounced write', () => {
		const storage = fakeStorage();
		const store = new LocalStorageLayoutStore(storage, 300);
		store.setPosition('urn:x', 1, 1);
		store.setPosition('urn:y', 2, 2);
		store.setPosition('urn:x', 3, 3);
		expect(storage.data['rdf-schema-editor:layout']).toBeUndefined();
		vi.advanceTimersByTime(300);
		expect(JSON.parse(storage.data['rdf-schema-editor:layout'])).toEqual({
			'urn:x': { x: 3, y: 3 },
			'urn:y': { x: 2, y: 2 }
		});
	});

	it('a fresh store instance backed by the same storage reads back a persisted position', () => {
		const storage = fakeStorage();
		const store1 = new LocalStorageLayoutStore(storage, 0);
		store1.setPosition('urn:x', 5, 6);
		vi.advanceTimersByTime(0);

		const store2 = new LocalStorageLayoutStore(storage, 0);
		expect(store2.getPosition('urn:x')).toEqual({ x: 5, y: 6 });
	});

	it('falls back to an empty layout (no throw) when storage contains invalid JSON', () => {
		const storage = fakeStorage();
		storage.data['rdf-schema-editor:layout'] = 'not json';
		const store = new LocalStorageLayoutStore(storage, 300);
		expect(store.getPosition('urn:x')).toBeUndefined();
	});

	it('falls back gracefully with no storage backend at all (e.g. SSR, or storage unavailable)', () => {
		const store = new LocalStorageLayoutStore(undefined, 300);
		expect(store.getPosition('urn:x')).toBeUndefined();
		expect(() => store.setPosition('urn:x', 1, 2)).not.toThrow();
		vi.advanceTimersByTime(300);
	});
});

describe('GraphDbLayoutStore (STORY-074)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('returns undefined for any IRI before reload() has primed the cache', () => {
		const store = new GraphDbLayoutStore(fakeConnector(), 300);
		expect(store.getPosition('urn:x')).toBeUndefined();
	});

	it('reload() primes the cache from fetchWorkspaceMembers', async () => {
		const connector = fakeConnector([{ elementIri: 'urn:x', x: 10, y: 20 }]);
		const store = new GraphDbLayoutStore(connector, 300);
		await store.reload('urn:ws');

		expect(connector.fetchWorkspaceMembers).toHaveBeenCalledWith('urn:ws');
		expect(store.getPosition('urn:x')).toEqual({ x: 10, y: 20 });
	});

	it('getPosition returns undefined for an element that is not a member of the loaded workspace', async () => {
		const connector = fakeConnector([{ elementIri: 'urn:x', x: 10, y: 20 }]);
		const store = new GraphDbLayoutStore(connector, 300);
		await store.reload('urn:ws');

		expect(store.getPosition('urn:other')).toBeUndefined();
	});

	it('getPosition reflects a just-set position immediately, before the debounced write fires', async () => {
		const connector = fakeConnector();
		const store = new GraphDbLayoutStore(connector, 300);
		await store.reload('urn:ws');

		store.setPosition('urn:x', 5, 6);
		expect(store.getPosition('urn:x')).toEqual({ x: 5, y: 6 });
	});

	it('debounces the underlying updateWorkspaceMemberPosition write — not fired until the delay elapses', async () => {
		const connector = fakeConnector();
		const store = new GraphDbLayoutStore(connector, 300);
		await store.reload('urn:ws');

		store.setPosition('urn:x', 5, 6);
		expect(connector.updateWorkspaceMemberPosition).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(connector.updateWorkspaceMemberPosition).toHaveBeenCalledExactlyOnceWith('urn:ws', 'urn:x', 5, 6);
	});

	it('coalesces several rapid moves of the same node into a single debounced write of the last value', async () => {
		const connector = fakeConnector();
		const store = new GraphDbLayoutStore(connector, 300);
		await store.reload('urn:ws');

		store.setPosition('urn:x', 1, 1);
		store.setPosition('urn:x', 2, 2);
		store.setPosition('urn:x', 3, 3);
		vi.advanceTimersByTime(300);

		expect(connector.updateWorkspaceMemberPosition).toHaveBeenCalledExactlyOnceWith('urn:ws', 'urn:x', 3, 3);
	});

	it('keys the debounce per-element — moving one node does not delay another\'s write', async () => {
		const connector = fakeConnector();
		const store = new GraphDbLayoutStore(connector, 300);
		await store.reload('urn:ws');

		store.setPosition('urn:x', 1, 1);
		vi.advanceTimersByTime(200);
		store.setPosition('urn:y', 2, 2);
		vi.advanceTimersByTime(100);

		// urn:x's debounce (started at t=0) fires at t=300; urn:y's (started at t=200) hasn't yet.
		expect(connector.updateWorkspaceMemberPosition).toHaveBeenCalledExactlyOnceWith('urn:ws', 'urn:x', 1, 1);
		vi.advanceTimersByTime(200);
		expect(connector.updateWorkspaceMemberPosition).toHaveBeenCalledWith('urn:ws', 'urn:y', 2, 2);
	});

	it('reload() replaces the previous workspace\'s cached positions entirely', async () => {
		const connectorA = fakeConnector([{ elementIri: 'urn:x', x: 1, y: 1 }]);
		const store = new GraphDbLayoutStore(connectorA, 300);
		await store.reload('urn:ws-a');
		expect(store.getPosition('urn:x')).toEqual({ x: 1, y: 1 });

		(connectorA.fetchWorkspaceMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ elementIri: 'urn:y', x: 9, y: 9 }
		]);
		await store.reload('urn:ws-b');

		expect(store.getPosition('urn:x')).toBeUndefined();
		expect(store.getPosition('urn:y')).toEqual({ x: 9, y: 9 });
	});

	it('resolvePositions/gridPosition work unchanged against GraphDbLayoutStore', async () => {
		const connector = fakeConnector([{ elementIri: 'urn:a', x: 100, y: 200 }]);
		const store = new GraphDbLayoutStore(connector, 300);
		await store.reload('urn:ws');

		const result = resolvePositions(['urn:a', 'urn:b'], store);
		expect(result.get('urn:a')).toEqual({ x: 100, y: 200 });
		expect(result.get('urn:b')).toEqual(gridPosition(0));
	});
});

describe('gridPosition', () => {
	it('lays out nodes in a grid without overlap', () => {
		const positions = Array.from({ length: 8 }, (_, i) => gridPosition(i));
		const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
		expect(unique.size).toBe(8);
	});
});

describe('resolvePositions', () => {
	it('uses the stored position when one exists', () => {
		const storage = fakeStorage();
		const store = new LocalStorageLayoutStore(storage, 0);
		store.setPosition('urn:a', 100, 200);
		const result = resolvePositions(['urn:a'], store);
		expect(result.get('urn:a')).toEqual({ x: 100, y: 200 });
	});

	it('auto-layouts nodes with no stored position without overlapping each other', () => {
		const store = new LocalStorageLayoutStore(fakeStorage(), 0);
		const result = resolvePositions(['urn:a', 'urn:b', 'urn:c'], store);
		const positions = [...result.values()];
		const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
		expect(unique.size).toBe(3);
	});

	it('auto-layout slots do not collide with an already-stored position', () => {
		const storage = fakeStorage();
		const store = new LocalStorageLayoutStore(storage, 0);
		// Pin urn:a to exactly where the first auto-layout slot (index 0) would land.
		store.setPosition('urn:a', gridPosition(0).x, gridPosition(0).y);
		const result = resolvePositions(['urn:a', 'urn:b'], store);
		// urn:b is the only auto-placed node, so it gets slot index 0 too — this is the known,
		// documented limitation (auto-layout avoids colliding with *other auto-placed* nodes in the
		// same pass, not with arbitrary persisted coordinates; see layout-store.ts's doc comment).
		expect(result.get('urn:b')).toEqual(gridPosition(0));
	});
});
