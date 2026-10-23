/**
 * Per-browser "show the orientation grid" preference (canvas-navigation Story 002) — mirrors
 * `erd-source-marker-store.svelte.ts`'s `LocalStorage*Store` pattern. A display preference, not
 * semantic RDF, so it lives in `localStorage` rather than GraphDB. On by default.
 */

import type { MinimalStorage } from './layout-store';

export interface GridVisibilityStore {
	getShowGrid(): boolean;
	setShowGrid(show: boolean): void;
}

const STORAGE_KEY = 'rdf-schema-editor:show-grid';

export class LocalStorageGridVisibilityStore implements GridVisibilityStore {
	private cache: boolean | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getShowGrid(): boolean {
		if (this.cache !== null) return this.cache;
		try {
			this.cache = this.storage?.getItem(STORAGE_KEY) !== 'false';
		} catch {
			this.cache = true;
		}
		return this.cache;
	}

	setShowGrid(show: boolean): void {
		this.cache = show;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, String(show));
		} catch {
			// Storage unavailable/full — the choice just won't survive a reload.
		}
	}
}

const backingStore = new LocalStorageGridVisibilityStore();

let showGrid = $state(backingStore.getShowGrid());

export const gridVisibilityStore: GridVisibilityStore = {
	getShowGrid(): boolean {
		return showGrid;
	},
	setShowGrid(show: boolean): void {
		showGrid = show;
		backingStore.setShowGrid(show);
	}
};
