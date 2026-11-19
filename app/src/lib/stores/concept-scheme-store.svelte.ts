/**
 * The concept schemes of the vocabulary namespace, for the canvas' "Add concept property" entry, the concept
 * property form and the scheme label on an entity row (spec/concept-valued-properties STORY-437). One request per
 * canvas load (none without a vocabulary namespace); `refresh()` re-reads it.
 */
import { schemeDisplayName } from '#lib/services/skos-concept.js';
import { sparqlConnector } from '#lib/services/sparql-connector.js';
import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';

export interface SchemeOption {
	iri: string;
	name: string;
}

function createConceptSchemeStore() {
	let schemes = $state<SchemeOption[]>([]);

	async function refresh(): Promise<void> {
		const vocabulary = namespaceStore.namespaces.find((n) => n.vocabulary);
		if (!vocabulary) {
			schemes = [];
			return;
		}
		const found = await sparqlConnector.fetchConceptSchemes(vocabulary.baseIri);
		schemes = found.map((s) => ({ iri: s.iri, name: schemeDisplayName(s) }));
	}

	return {
		get schemes() {
			return schemes;
		},
		/** Whether a concept property can be defined: a vocabulary namespace with at least one scheme. */
		get available() {
			return schemes.length > 0;
		},
		nameOf(iri: string): string | undefined {
			return schemes.find((s) => s.iri === iri)?.name;
		},
		refresh
	};
}

export const conceptSchemeStore = createConceptSchemeStore();
