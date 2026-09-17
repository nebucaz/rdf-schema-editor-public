/**
 * Documentation panel UI preferences (last-viewed section from STORY-142, and panel width) — a
 * per-browser UI preference, not semantic RDF, so it stays out of GraphDB and lives in
 * `localStorage` instead, following the same `LocalStorage*Store` pattern as
 * `layout-store.ts`/`node-color-store.ts`/`view-mode-store.ts`.
 * Whether a persisted id still resolves to a real manifest section is the caller's concern (the
 * manifest is `DocumentationPanel.svelte`'s domain, not this store's) — this store just persists
 * and returns whatever id/width was last set, or `undefined` if nothing has been set yet. Width
 * clamping to a sane min/max is likewise the caller's concern, not this store's.
 */

import type { MinimalStorage } from './layout-store';

export interface DocumentationStore {
	getLastSectionId(): string | undefined;
	setLastSectionId(id: string): void;
	getPanelWidth(): number | undefined;
	setPanelWidth(width: number): void;
}

const STORAGE_KEY = 'rdf-schema-editor:last-documentation-section';
const WIDTH_STORAGE_KEY = 'rdf-schema-editor:documentation-panel-width';

export class LocalStorageDocumentationStore implements DocumentationStore {
	private cache: string | undefined;
	private loaded = false;
	private widthCache: number | undefined;
	private widthLoaded = false;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getLastSectionId(): string | undefined {
		if (!this.loaded) {
			this.cache = this.storage?.getItem(STORAGE_KEY) ?? undefined;
			this.loaded = true;
		}
		return this.cache;
	}

	setLastSectionId(id: string): void {
		this.cache = id;
		this.loaded = true;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, id);
		} catch {
			// Storage unavailable/full (e.g. private browsing) — fail silently; the choice just won't
			// survive a reload.
		}
	}

	getPanelWidth(): number | undefined {
		if (!this.widthLoaded) {
			const raw = this.storage?.getItem(WIDTH_STORAGE_KEY);
			const parsed = raw ? Number(raw) : NaN;
			this.widthCache = Number.isFinite(parsed) ? parsed : undefined;
			this.widthLoaded = true;
		}
		return this.widthCache;
	}

	setPanelWidth(width: number): void {
		this.widthCache = width;
		this.widthLoaded = true;
		if (!this.storage) return;
		try {
			this.storage.setItem(WIDTH_STORAGE_KEY, String(width));
		} catch {
			// Storage unavailable/full (e.g. private browsing) — fail silently; the choice just won't
			// survive a reload.
		}
	}
}

export const documentationStore: DocumentationStore = new LocalStorageDocumentationStore();
