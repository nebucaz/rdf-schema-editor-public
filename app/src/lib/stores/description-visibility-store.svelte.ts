/**
 * Global "show inline entity descriptions" preference (data-catalog Story 022). Like
 * `view-mode-store`'s Schema/Instances selection, this is a per-browser display preference, not
 * semantic RDF, so it stays out of GraphDB and lives in `localStorage` instead.
 *
 * Unlike `view-mode-store` — which is read via `workbenchActions`'s reactive wrapper — `EntityNode`
 * reads this store directly (the same way `ThemeToggle` reads `mode.current` from `mode-watcher`
 * directly), so the reactive singleton below is exposed straight from this module rather than
 * threaded through node data or a separate `.svelte.ts` wrapper.
 */

import type { MinimalStorage } from './layout-store';

export interface DescriptionVisibilityStore {
	getShowDescriptions(): boolean;
	setShowDescriptions(show: boolean): void;
}

const STORAGE_KEY = 'rdf-schema-editor:show-descriptions';

export class LocalStorageDescriptionVisibilityStore implements DescriptionVisibilityStore {
	private cache: boolean | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getShowDescriptions(): boolean {
		if (this.cache !== null) return this.cache;
		this.cache = this.storage?.getItem(STORAGE_KEY) !== 'false';
		return this.cache;
	}

	setShowDescriptions(show: boolean): void {
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

const backingStore = new LocalStorageDescriptionVisibilityStore();

let showDescriptions = $state(backingStore.getShowDescriptions());

export const descriptionVisibilityStore: DescriptionVisibilityStore = {
	getShowDescriptions(): boolean {
		return showDescriptions;
	},
	setShowDescriptions(show: boolean): void {
		showDescriptions = show;
		backingStore.setShowDescriptions(show);
	}
};
