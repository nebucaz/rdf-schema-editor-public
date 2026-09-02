/**
 * Active-namespace selection (STORY-031). Which namespace new entries default to is a per-browser
 * UI preference, not semantic RDF, so — like `layout-store`'s positions and `node-color-store`'s
 * overrides — it stays out of GraphDB and lives in `localStorage` instead, following the same
 * injectable-storage pattern.
 */

import type { MinimalStorage } from './layout-store';

export interface ActiveNamespaceStore {
	/** The persisted base IRI, or `undefined` if none has been explicitly selected yet. */
	getActive(): string | undefined;
	setActive(baseIri: string): void;
}

const STORAGE_KEY = 'rdf-schema-editor:active-namespace';

export class LocalStorageActiveNamespaceStore implements ActiveNamespaceStore {
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

	setActive(baseIri: string): void {
		this.cache = baseIri;
		if (!this.storage) return;
		try {
			this.storage.setItem(STORAGE_KEY, baseIri);
		} catch {
			// Storage unavailable/full — fail silently; the selection just won't survive a reload.
		}
	}
}

export const activeNamespaceStore: ActiveNamespaceStore = new LocalStorageActiveNamespaceStore();

/**
 * Resolves the namespace that should become active as a side effect of switching to `workspace`
 * (Sprint 6 Story 016). When the newly-active Workspace has a configured `defaultNamespaceBaseIri`,
 * that becomes the new active namespace; otherwise the current active namespace is left exactly as
 * it was — this field is documented as "a convenience, not authoritative", so unset means no
 * fallback/guess. Extracted as a pure function (rather than inline in `+page.svelte`, which has no
 * component-testing project yet) so `resolveActiveWorkspaceIri`'s namespace-switch side effect stays
 * unit-testable.
 */
export function resolveWorkspaceDefaultNamespace(
	workspace: { defaultNamespaceBaseIri: string | null } | undefined,
	currentNamespaceBaseIri: string
): string {
	return workspace?.defaultNamespaceBaseIri ?? currentNamespaceBaseIri;
}
