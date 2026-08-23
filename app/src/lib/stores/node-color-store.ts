/**
 * Per-node custom canvas color, keyed by class IRI. Like `layout-store`'s positions, a node's
 * color is a purely visual canvas preference — not semantic RDF — so it stays out of GraphDB and
 * lives in `localStorage` instead, following the same pattern.
 */

import type { MinimalStorage } from './layout-store';

export interface NodeColorStore {
	getColor(iri: string): string | undefined;
	setColor(iri: string, color: string | undefined): void;
}

const STORAGE_KEY = 'rdf-schema-editor:node-colors';

export class LocalStorageNodeColorStore implements NodeColorStore {
	private cache: Record<string, string> | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getColor(iri: string): string | undefined {
		return this.load()[iri];
	}

	/** `color: undefined` clears the override, reverting the node to the default theme color. */
	setColor(iri: string, color: string | undefined): void {
		const data = this.load();
		if (color) {
			data[iri] = color;
		} else {
			delete data[iri];
		}
		this.persist();
	}

	private load(): Record<string, string> {
		if (this.cache) return this.cache;
		if (!this.storage) {
			this.cache = {};
			return this.cache;
		}
		try {
			const raw = this.storage.getItem(STORAGE_KEY);
			this.cache = raw ? JSON.parse(raw) : {};
		} catch {
			// Corrupted/foreign data under this key — fall back to no overrides rather than throwing.
			this.cache = {};
		}
		return this.cache!;
	}

	private persist(): void {
		if (!this.storage || !this.cache) return;
		try {
			this.storage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
		} catch {
			// Storage unavailable/full — fail silently; colors just won't survive a reload.
		}
	}
}

export const nodeColorStore: NodeColorStore = new LocalStorageNodeColorStore();
