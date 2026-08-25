/**
 * Shared external-vocabulary list (STORY-046), mirroring `namespace-store.svelte.ts`'s
 * fetch-once-plus-`refresh()` shape: `ExternalVocabularyManagementView`'s CRUD modal,
 * `ExternalClassForm`'s prefix validation, and `+layout.svelte`'s reload-triggered schema load all
 * need the same merged (built-in ∪ GraphDB-registered) prefix list, so it's centralized here instead
 * of each holding its own local fetch.
 *
 * Not `localStorage`-backed — registered vocabularies live in GraphDB, not the browser — so this is a
 * `.svelte.ts` reactive singleton, same as `namespace-store.svelte.ts`/`workbench-actions.svelte.ts`.
 */
import { sparqlConnector, type FetchedExternalVocabulary } from '$lib/services/sparql-connector';

function createExternalVocabStore() {
	let vocabularies = $state<FetchedExternalVocabulary[]>([]);
	let loading = $state(false);
	let initialized = false;
	let pending: Promise<void> | null = null;

	async function refresh(): Promise<void> {
		loading = true;
		try {
			vocabularies = await sparqlConnector.fetchExternalVocabularies();
		} finally {
			loading = false;
		}
	}

	/** Fetches once, the first time any consumer calls it; later calls are no-ops. Consumers that
	 *  mutate vocabularies (create/delete) or trigger a full reload should call `refresh()` directly
	 *  instead, to force a re-fetch. */
	function ensureLoaded(): Promise<void> {
		if (!initialized) {
			initialized = true;
			pending = refresh();
		}
		return pending!;
	}

	/** `{prefix: baseIri}` map, the shape `resolvePrefixedName`/`iriToPrefixedName` (`iri.ts`) take. */
	function asPrefixMap(): Record<string, string> {
		return Object.fromEntries(vocabularies.map((v) => [v.prefix, v.baseIri]));
	}

	return {
		get vocabularies() {
			return vocabularies;
		},
		get loading() {
			return loading;
		},
		ensureLoaded,
		refresh,
		asPrefixMap
	};
}

export const externalVocabStore = createExternalVocabStore();
