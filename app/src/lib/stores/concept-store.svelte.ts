/**
 * Shared copy of the core vocabulary's concepts (ontology-pipeline STORY-325), for the class form's concept
 * picker and the canvas "no concept" badge. Same cache rule as `schemaStore`: a copy is reused only while
 * `SparqlConnector.writeCount` is unchanged, so any write makes the next `ensureLoaded` refetch.
 *
 * The canvas badge does not use this store: whether a vocabulary exists is already known from
 * `namespaceStore`, and which classes are linked comes with the schema, so the badge costs no request.
 */
import type { Concept } from '#lib/services/skos-concept.js';
import { sparqlConnector } from '#lib/services/sparql-connector.js';
import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';

export interface ConceptStoreDeps {
	/** The concepts, or `null` when no namespace is the vocabulary namespace. */
	load(): Promise<Concept[] | null>;
	writeCount(): number;
}

export function createConceptStore(deps: ConceptStoreDeps) {
	let slot: { promise: Promise<Concept[]>; writes: number } | null = null;

	function load(): Promise<Concept[]> {
		const writes = deps.writeCount();
		const promise = deps.load().then((concepts) => concepts ?? []);
		const mine = { promise, writes };
		slot = mine;
		// A failed load must not be remembered, or every later caller would get the same rejection.
		promise.catch(() => {
			if (slot === mine) slot = null;
		});
		return promise;
	}

	return {
		ensureLoaded(): Promise<Concept[]> {
			return slot && slot.writes === deps.writeCount() ? slot.promise : load();
		},
		refresh(): Promise<Concept[]> {
			return load();
		}
	};
}

export const conceptStore = createConceptStore({
	load: () => loadAllConcepts(sparqlConnector),
	writeCount: () => sparqlConnector.writeCount
});
