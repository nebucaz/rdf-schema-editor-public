/**
 * Per-Workspace canvas pan/zoom persistence (Sprint 6 Story 023). Like `layout-store`'s positions
 * and `node-color-store`'s overrides, a view-frame is a purely visual browser/UI preference — not
 * semantic RDF — so it stays out of GraphDB and lives in `localStorage` instead, keyed by Workspace
 * IRI rather than element IRI.
 */

import type { MinimalStorage } from './layout-store';
import { debounce } from './layout-store';

export interface ViewFrame {
	x: number;
	y: number;
	zoom: number;
}

export interface ViewFrameStore {
	getViewFrame(workspaceIri: string): ViewFrame | undefined;
	setViewFrame(workspaceIri: string, frame: ViewFrame): void;
}

const STORAGE_KEY = 'rdf-schema-editor:view-frames';

export class LocalStorageViewFrameStore implements ViewFrameStore {
	private cache: Record<string, ViewFrame> | null = null;
	private persistDebounced: () => void;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined,
		delayMs = 300
	) {
		this.persistDebounced = debounce(() => this.persist(), delayMs);
	}

	getViewFrame(workspaceIri: string): ViewFrame | undefined {
		return this.load()[workspaceIri];
	}

	/** Updates the in-memory cache immediately (so a `getViewFrame` right after returns the new
	 *  value) but writes to storage debounced — `viewport` changes continuously during a pan/zoom
	 *  gesture, not just once at the end, so an undebounced write would thrash `localStorage`. */
	setViewFrame(workspaceIri: string, frame: ViewFrame): void {
		const data = this.load();
		data[workspaceIri] = frame;
		this.persistDebounced();
	}

	private load(): Record<string, ViewFrame> {
		if (this.cache) return this.cache;
		if (!this.storage) {
			this.cache = {};
			return this.cache;
		}
		try {
			const raw = this.storage.getItem(STORAGE_KEY);
			this.cache = raw ? JSON.parse(raw) : {};
		} catch {
			// Corrupted/foreign data under this key — fall back to no stored frames rather than throwing.
			this.cache = {};
		}
		return this.cache!;
	}

	private persist(): void {
		if (!this.storage || !this.cache) return;
		try {
			this.storage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
		} catch {
			// Storage unavailable/full — fail silently; view-frames just won't survive a reload.
		}
	}
}

export const viewFrameStore: ViewFrameStore = new LocalStorageViewFrameStore();
