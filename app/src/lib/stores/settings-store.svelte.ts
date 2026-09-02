/**
 * Shared app-settings value (Sprint 5 Story 015) — currently just the configured catalog marker
 * class IRI, mirroring `namespace-store.svelte.ts`'s shape exactly. Not `localStorage`-backed: the
 * setting lives in GraphDB (`sparqlConnector.fetchAuthoritativeEntityClassIri`/
 * `setAuthoritativeEntityClassIri`, Story 014), not the browser, so this is a `.svelte.ts` reactive
 * singleton fetched once and cached, the same "fetch-once-then-cache, refresh on mutation" shape
 * `namespaceStore`/`workspaceStore` already use.
 */
import { sparqlConnector } from '$lib/services/sparql-connector';

function createSettingsStore() {
	let authoritativeEntityClassIri = $state<string | null>(null);
	let loading = $state(false);
	let initialized = false;
	let pending: Promise<void> | null = null;

	async function refresh(): Promise<void> {
		loading = true;
		try {
			authoritativeEntityClassIri = await sparqlConnector.fetchAuthoritativeEntityClassIri();
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
		get loading() {
			return loading;
		},
		ensureLoaded,
		refresh
	};
}

export const settingsStore = createSettingsStore();
