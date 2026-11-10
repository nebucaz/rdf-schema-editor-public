/**
 * "Show a badge on classes without a vocabulary concept" preference (ontology-pipeline STORY-325). A
 * per-browser display preference, so it lives in `localStorage` like `description-visibility-store`. On by
 * default; the badge is still only drawn when a namespace is marked as the vocabulary namespace.
 */

import type { MinimalStorage } from './layout-store';

export interface ConceptBadgeVisibilityStore {
	getShowConceptBadge(): boolean;
	setShowConceptBadge(show: boolean): void;
}

const STORAGE_KEY = 'rdf-schema-editor:show-concept-badge';

export class LocalStorageConceptBadgeVisibilityStore implements ConceptBadgeVisibilityStore {
	private cache: boolean | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getShowConceptBadge(): boolean {
		if (this.cache !== null) return this.cache;
		this.cache = this.storage?.getItem(STORAGE_KEY) !== 'false';
		return this.cache;
	}

	setShowConceptBadge(show: boolean): void {
		this.cache = show;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, String(show));
		} catch {
			// Storage unavailable/full (e.g. private browsing): the choice just won't survive a reload.
		}
	}
}

const backingStore = new LocalStorageConceptBadgeVisibilityStore();

let showConceptBadge = $state(backingStore.getShowConceptBadge());

export const conceptBadgeVisibilityStore: ConceptBadgeVisibilityStore = {
	getShowConceptBadge(): boolean {
		return showConceptBadge;
	},
	setShowConceptBadge(show: boolean): void {
		showConceptBadge = show;
		backingStore.setShowConceptBadge(show);
	}
};
