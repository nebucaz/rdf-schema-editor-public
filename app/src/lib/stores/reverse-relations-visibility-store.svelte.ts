/**
 * Global "show reverse relations" preference (STORY-XXX) — mirrors
 * `inherited-attributes-visibility-store.svelte.ts`'s own `LocalStorage*Store` pattern, its own
 * `localStorage` key, kept as its own store so it stays an independent axis of canvas detail rather
 * than being folded into an unrelated existing toggle. Unlike that store, this one defaults to
 * **hidden** (`false`) — an auto-generated reverse relation is meant to declutter the canvas by not
 * appearing until explicitly asked for, not the other way around.
 */

import type { MinimalStorage } from './layout-store';

export interface ReverseRelationsVisibilityStore {
	getShowReverseRelations(): boolean;
	setShowReverseRelations(show: boolean): void;
}

const STORAGE_KEY = 'rdf-schema-editor:show-reverse-relations';

export class LocalStorageReverseRelationsVisibilityStore implements ReverseRelationsVisibilityStore {
	private cache: boolean | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getShowReverseRelations(): boolean {
		if (this.cache !== null) return this.cache;
		this.cache = this.storage?.getItem(STORAGE_KEY) === 'true';
		return this.cache;
	}

	setShowReverseRelations(show: boolean): void {
		this.cache = show;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, String(show));
		} catch {
			// Storage unavailable/full (e.g. private browsing) — fail silently; the choice just won't
			// survive a reload.
		}
	}
}

const backingStore = new LocalStorageReverseRelationsVisibilityStore();

let showReverseRelations = $state(backingStore.getShowReverseRelations());

export const reverseRelationsVisibilityStore: ReverseRelationsVisibilityStore = {
	getShowReverseRelations(): boolean {
		return showReverseRelations;
	},
	setShowReverseRelations(show: boolean): void {
		showReverseRelations = show;
		backingStore.setShowReverseRelations(show);
	}
};
