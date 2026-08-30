/**
 * Active-Workspace selection (STORY-077). Which Workspace is currently open on the canvas is a
 * per-browser UI convenience — not the Workspace's own data (that lives in GraphDB, research
 * Decision 2/4) — so, like `active-namespace-store.ts`, it stays out of GraphDB and lives in
 * `localStorage` instead, following the same injectable-storage pattern.
 */

import type { MinimalStorage } from './layout-store';

export interface ActiveWorkspaceStore {
	/** The persisted Workspace IRI, or `undefined` if none has been explicitly selected yet. */
	getActive(): string | undefined;
	setActive(workspaceIri: string): void;
}

const STORAGE_KEY = 'rdf-schema-editor:active-workspace';

export class LocalStorageActiveWorkspaceStore implements ActiveWorkspaceStore {
	private cache: string | null | undefined = undefined;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getActive(): string | undefined {
		if (this.cache === undefined) {
			this.cache = this.storage?.getItem(STORAGE_KEY) ?? null;
		}
		return this.cache ?? undefined;
	}

	setActive(workspaceIri: string): void {
		this.cache = workspaceIri;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, workspaceIri);
		} catch {
			// Storage unavailable/full — fail silently; the selection just won't survive a reload.
		}
	}
}

export const activeWorkspaceStore: ActiveWorkspaceStore = new LocalStorageActiveWorkspaceStore();
