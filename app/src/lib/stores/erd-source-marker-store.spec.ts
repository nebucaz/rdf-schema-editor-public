import { describe, expect, it } from 'vitest';
import { LocalStorageErdSourceMarkerStore } from './erd-source-marker-store.svelte';

function memory() {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('LocalStorageErdSourceMarkerStore', () => {
	it('defaults to off', () => {
		expect(new LocalStorageErdSourceMarkerStore(memory()).getSourceMarker()).toBe(false);
	});

	it('persists the choice across instances', () => {
		const storage = memory();
		new LocalStorageErdSourceMarkerStore(storage).setSourceMarker(true);
		expect(new LocalStorageErdSourceMarkerStore(storage).getSourceMarker()).toBe(true);
	});
});
