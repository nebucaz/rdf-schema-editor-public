/**
 * Persisted namespace visibility (STORY-040). Like `active-namespace-store`'s selection and
 * `node-color-store`'s overrides, which namespaces are hidden from the canvas is a per-browser UI
 * preference, not semantic RDF, so it stays out of GraphDB and lives in `localStorage` instead,
 * following the same injectable-storage pattern. On first use (no prior stored preference), the
 * app's own built-in default namespace (`DEFAULT_NAMESPACE_BASE_IRI`) starts hidden so it doesn't
 * clutter a first-time canvas; from then on every toggle (including of the default namespace)
 * persists across reload.
 */

import type { MinimalStorage } from './layout-store';
import { DEFAULT_NAMESPACE_BASE_IRI } from '$lib/config';

export interface NamespaceVisibilityStore {
	getHidden(): Set<string>;
	setHidden(baseIri: string, hidden: boolean): void;
}

const STORAGE_KEY = 'rdf-schema-editor:namespace-visibility';

export class LocalStorageNamespaceVisibilityStore implements NamespaceVisibilityStore {
	private cache: Record<string, boolean> | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getHidden(): Set<string> {
		const data = this.load();
		return new Set(Object.keys(data).filter((iri) => data[iri]));
	}

	setHidden(baseIri: string, hidden: boolean): void {
		const data = this.load();
		if (hidden) {
			data[baseIri] = true;
		} else {
			delete data[baseIri];
		}
		this.persist();
	}

	private load(): Record<string, boolean> {
		if (this.cache) return this.cache;
		if (!this.storage) {
			this.cache = { [DEFAULT_NAMESPACE_BASE_IRI]: true };
			return this.cache;
		}
		try {
			const raw = this.storage.getItem(STORAGE_KEY);
			this.cache = raw ? JSON.parse(raw) : { [DEFAULT_NAMESPACE_BASE_IRI]: true };
		} catch {
			// Corrupted/foreign data under this key — fall back to the first-use default rather than
			// throwing.
			this.cache = { [DEFAULT_NAMESPACE_BASE_IRI]: true };
		}
		return this.cache!;
	}

	private persist(): void {
		if (!this.storage || !this.cache) return;
		try {
			this.storage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
		} catch {
			// Storage unavailable/full — fail silently; the choice just won't survive a reload.
		}
	}
}

export const namespaceVisibilityStore: NamespaceVisibilityStore = new LocalStorageNamespaceVisibilityStore();
