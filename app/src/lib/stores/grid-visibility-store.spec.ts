import { describe, expect, it } from 'vitest';
import { LocalStorageGridVisibilityStore } from './grid-visibility-store.svelte';

function memory() {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('LocalStorageGridVisibilityStore', () => {
	it('defaults to on', () => {
		expect(new LocalStorageGridVisibilityStore(memory()).getShowGrid()).toBe(true);
	});

	it('persists turning the grid off across instances', () => {
		const storage = memory();
		new LocalStorageGridVisibilityStore(storage).setShowGrid(false);
		expect(new LocalStorageGridVisibilityStore(storage).getShowGrid()).toBe(false);
	});

	it('persists turning it back on', () => {
		const storage = memory();
		const store = new LocalStorageGridVisibilityStore(storage);
		store.setShowGrid(false);
		store.setShowGrid(true);
		expect(new LocalStorageGridVisibilityStore(storage).getShowGrid()).toBe(true);
	});

	it('does not throw when storage fails, and keeps the in-memory choice', () => {
		const failing = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('full');
			}
		};
		const store = new LocalStorageGridVisibilityStore(failing);
		expect(() => store.setShowGrid(false)).not.toThrow();
		expect(store.getShowGrid()).toBe(false);
	});
});
