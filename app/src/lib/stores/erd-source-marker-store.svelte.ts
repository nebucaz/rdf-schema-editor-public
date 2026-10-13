/**
 * Global "Crow's Foot source-end marker" preference for the Export ERD feature — mirrors
 * `reverse-relations-visibility-store.svelte.ts`'s `LocalStorage*Store` pattern. When on, exported
 * Crow's Foot relations also carry the standard-but-noisy `0..*` symbol at their source end; off
 * (default) leaves the source end plain.
 */

import type { MinimalStorage } from './layout-store';

export interface ErdSourceMarkerStore {
	getSourceMarker(): boolean;
	setSourceMarker(show: boolean): void;
}

const STORAGE_KEY = 'rdf-schema-editor:erd-source-marker';

export class LocalStorageErdSourceMarkerStore implements ErdSourceMarkerStore {
	private cache: boolean | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getSourceMarker(): boolean {
		if (this.cache !== null) return this.cache;
		this.cache = this.storage?.getItem(STORAGE_KEY) === 'true';
		return this.cache;
	}

	setSourceMarker(show: boolean): void {
		this.cache = show;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, String(show));
		} catch {
			// Storage unavailable/full — the choice just won't survive a reload.
		}
	}
}

const backingStore = new LocalStorageErdSourceMarkerStore();

let sourceMarker = $state(backingStore.getSourceMarker());

export const erdSourceMarkerStore: ErdSourceMarkerStore = {
	getSourceMarker(): boolean {
		return sourceMarker;
	},
	setSourceMarker(show: boolean): void {
		sourceMarker = show;
		backingStore.setSourceMarker(show);
	}
};
