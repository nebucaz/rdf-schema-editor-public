/**
 * Per-edge draggable label position (Sprint 6 Story 021). Like `node-color-store.ts`'s overrides, a
 * label's position along its edge is a purely visual canvas preference — not semantic RDF — so it
 * stays out of GraphDB and lives in `localStorage` instead, keyed by the edge's own stable `id`
 * (unique and stable per edge across re-renders — see `relationEdgeId`/`individualRelationEdgeId`'s
 * doc comments in `+page.svelte`). Stores a `0..1` fraction of the edge's path total length;
 * `percent: undefined` clears the override, reverting to the path's natural computed bend/center
 * point — so an edge that gets deleted/recreated (a new relation between the same pair, hence a new
 * id) simply starts fresh at the default position, matching this app's existing "IRI-keyed, no
 * orphan cleanup needed" pattern for per-element canvas preferences.
 */

import type { MinimalStorage } from './layout-store';

export interface EdgeLabelPositionStore {
	getPercent(edgeId: string): number | undefined;
	setPercent(edgeId: string, percent: number | undefined): void;
}

const STORAGE_KEY = 'rdf-schema-editor:edge-label-positions';

export class LocalStorageEdgeLabelPositionStore implements EdgeLabelPositionStore {
	private cache: Record<string, number> | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getPercent(edgeId: string): number | undefined {
		return this.load()[edgeId];
	}

	/** `percent: undefined` clears the override, reverting the label to its default computed
	 *  position. No debounce needed — a drag gesture commits once on `pointerup`, not continuously. */
	setPercent(edgeId: string, percent: number | undefined): void {
		const data = this.load();
		if (percent === undefined) {
			delete data[edgeId];
		} else {
			data[edgeId] = percent;
		}
		this.persist();
	}

	private load(): Record<string, number> {
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
			// Storage unavailable/full — fail silently; the override just won't survive a reload.
		}
	}
}

export const edgeLabelPositionStore: EdgeLabelPositionStore = new LocalStorageEdgeLabelPositionStore();
