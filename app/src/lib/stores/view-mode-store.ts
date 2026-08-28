/**
 * Canvas view-mode selection (data-catalog Story 007): Schema vs. Instances is a per-browser UI
 * preference, not semantic RDF, so — like `active-namespace-store`'s selection — it stays out of
 * GraphDB and lives in `localStorage` instead, following the same injectable-storage pattern.
 */

import type { MinimalStorage } from './layout-store';

export type ViewMode = 'schema' | 'instances';

export interface ViewModeStore {
	getViewMode(): ViewMode;
	setViewMode(mode: ViewMode): void;
}

const STORAGE_KEY = 'rdf-schema-editor:view-mode';

export class LocalStorageViewModeStore implements ViewModeStore {
	private cache: ViewMode | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getViewMode(): ViewMode {
		if (this.cache) return this.cache;
		this.cache = this.storage?.getItem(STORAGE_KEY) === 'instances' ? 'instances' : 'schema';
		return this.cache;
	}

	setViewMode(mode: ViewMode): void {
		this.cache = mode;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, mode);
		} catch {
			// Storage unavailable/full (e.g. private browsing) — fail silently; the choice just won't
			// survive a reload.
		}
	}
}

export const viewModeStore: ViewModeStore = new LocalStorageViewModeStore();
