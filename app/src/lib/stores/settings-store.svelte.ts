/**
 * Shared app-settings values (Sprint 5 Story 015; Backstage-sync STORY-104) — the configured catalog
 * marker class IRI and represents-predicate IRI, mirroring `namespace-store.svelte.ts`'s shape
 * exactly. Not `localStorage`-backed: both settings live in GraphDB
 * (`sparqlConnector.fetchAuthoritativeEntityClassIri`/`setAuthoritativeEntityClassIri`, Story 014;
 * `fetchRepresentsPredicateIri`/`setRepresentsPredicateIri`, STORY-103), not the browser, so this is a
 * `.svelte.ts` reactive singleton fetched once and cached, the same "fetch-once-then-cache, refresh on
 * mutation" shape `namespaceStore`/`workspaceStore` already use.
 */
import { sparqlConnector } from '$lib/services/sparql-connector';

function createSettingsStore() {
	let authoritativeEntityClassIri = $state<string | null>(null);
	// representsPredicateIri (Backstage-sync STORY-104) — the configured `rse:representsPredicate`
	// setting, loaded/cached the exact same fetch-once-then-cache way as authoritativeEntityClassIri.
	let representsPredicateIri = $state<string | null>(null);
	let loading = $state(false);
	let initialized = false;
	let pending: Promise<void> | null = null;

	async function refresh(): Promise<void> {
		loading = true;
		try {
			[authoritativeEntityClassIri, representsPredicateIri] = await Promise.all([
				sparqlConnector.fetchAuthoritativeEntityClassIri(),
				sparqlConnector.fetchRepresentsPredicateIri()
			]);
		} finally {
			loading = false;
		}
	}

	/** Fetches once, the first time any consumer calls it; later calls are no-ops. Consumers that
	 *  change the setting should call `refresh()` directly instead, to force a re-fetch. */
	function ensureLoaded(): Promise<void> {
		if (!initialized) {
			initialized = true;
			pending = refresh();
		}
		return pending!;
	}

	return {
		get authoritativeEntityClassIri() {
			return authoritativeEntityClassIri;
		},
		get representsPredicateIri() {
			return representsPredicateIri;
		},
		get loading() {
			return loading;
		},
		ensureLoaded,
		refresh
	};
}

export const settingsStore = createSettingsStore();
