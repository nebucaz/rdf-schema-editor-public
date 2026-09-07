/**
 * Global "show inherited attributes" preference (STORY-108) — mirrors
 * `description-visibility-store.svelte.ts` exactly (same `LocalStorage*Store` pattern, its own
 * `localStorage` key), kept as its own store rather than reusing the description one so "hide
 * descriptions" and "hide inherited attributes" stay independent axes of canvas detail.
 */

import type { MinimalStorage } from './layout-store';

export interface InheritedAttributesVisibilityStore {
	getShowInheritedAttributes(): boolean;
	setShowInheritedAttributes(show: boolean): void;
}

const STORAGE_KEY = 'rdf-schema-editor:show-inherited-attributes';

export class LocalStorageInheritedAttributesVisibilityStore implements InheritedAttributesVisibilityStore {
	private cache: boolean | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getShowInheritedAttributes(): boolean {
		if (this.cache !== null) return this.cache;
		this.cache = this.storage?.getItem(STORAGE_KEY) !== 'false';
		return this.cache;
	}

	setShowInheritedAttributes(show: boolean): void {
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

const backingStore = new LocalStorageInheritedAttributesVisibilityStore();

let showInheritedAttributes = $state(backingStore.getShowInheritedAttributes());

export const inheritedAttributesVisibilityStore: InheritedAttributesVisibilityStore = {
	getShowInheritedAttributes(): boolean {
		return showInheritedAttributes;
	},
	setShowInheritedAttributes(show: boolean): void {
		showInheritedAttributes = show;
		backingStore.setShowInheritedAttributes(show);
	}
};
