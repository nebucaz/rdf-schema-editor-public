/**
 * Persisted namespace visibility (STORY-040). Like `active-namespace-store`'s selection and
 * `node-color-store`'s overrides, which namespaces are hidden from the canvas is a per-browser UI
 * preference, not semantic RDF, so it stays out of GraphDB and lives in `localStorage` instead,
 * following the same injectable-storage pattern.
 *
 * STORY-096 generalized first-encounter seeding (previously a single hardcoded "the app's own
 * built-in default namespace starts hidden" case) to any namespace, driven by each namespace's own
 * author-set `defaultHidden` flag (`FetchedNamespace.defaultHidden`, defaulting `true` only for
 * `DEFAULT_NAMESPACE_BASE_IRI` — see `sparql-connector.ts`'s `fetchNamespaces`). Seeding itself now
 * happens at the call site (`+page.svelte`'s `loadSchemaFromGraphDB`, once namespaces are fetched
 * from GraphDB) rather than inside this store, since the store alone has no way to know a
 * namespace's `defaultHidden` value. This store's own job is only to record, per namespace, an
 * explicit `true`/`false` once either a modeler's toggle or that seeding logic has set one —
 * `hasStoredPreference` lets the caller tell "never touched" apart from "explicitly shown", so a
 * later `defaultHidden` change or app reload never re-seeds a namespace the browser already has an
 * opinion on.
 */

import type { MinimalStorage } from './layout-store';

export interface NamespaceVisibilityStore {
	getHidden(): Set<string>;
	setHidden(baseIri: string, hidden: boolean): void;
	/** True once this browser has an explicit stored preference (hidden or shown) for this
	 *  namespace — lets a caller seed first-encounter defaults without re-applying them once the
	 *  browser already has its own choice on record. */
	hasStoredPreference(baseIri: string): boolean;
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
		data[baseIri] = hidden;
		this.persist();
	}

	hasStoredPreference(baseIri: string): boolean {
		return baseIri in this.load();
	}

	private load(): Record<string, boolean> {
		if (this.cache) return this.cache;
		if (!this.storage) {
			this.cache = {};
			return this.cache;
		}
		try {
			const raw = this.storage.getItem(STORAGE_KEY);
			this.cache = raw ? JSON.parse(raw) : {};
		} catch {
			// Corrupted/foreign data under this key — fall back to empty rather than throwing.
			this.cache = {};
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
