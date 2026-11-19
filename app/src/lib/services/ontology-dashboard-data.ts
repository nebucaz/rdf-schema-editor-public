/**
 * The three lazy reads behind the dashboard (spec/ontology-dashboard STORY-473). Everything else on the dashboard comes
 * from data the page already loads. The added requests, all after the first render and independent of each other:
 *
 *   loadVocabularyExtras      1 + 3 SPARQL (core namespace, then governance, collections and schemes in parallel);
 *                             also feeds the governance and collection gates, so the Model checks tile counts what
 *                             the Model checks tab counts
 *   loadOpenChangeRequests    1 SPARQL
 *   loadRecentChanges         1 `GET /api/changelog`
 *
 * Each rejects on failure; the caller shows the failure inside the one tile it belongs to.
 */
import { fetchChangeLog } from './changelog-client';
import type { ChangeLogItem } from './change-log';
import { canDecide } from './change-request';
import type { Governance } from './governance';
import type { SkosCollection } from './skos-collection';
import type { SparqlConnector } from './sparql-connector';

export const RECENT_CHANGES_LIMIT = 5;

export interface VocabularyExtras {
	/** `null` without a core vocabulary namespace. */
	governance: (Governance & { namespaceIri: string }) | null;
	collections: SkosCollection[];
	schemes: { iri: string }[];
}

type ExtrasConnector = Pick<SparqlConnector, 'fetchVocabularyNamespace' | 'fetchNamespaceGovernance' | 'fetchCollections' | 'fetchConceptSchemes'>;

export async function loadVocabularyExtras(connector: ExtrasConnector): Promise<VocabularyExtras> {
	const core = await connector.fetchVocabularyNamespace();
	if (!core) return { governance: null, collections: [], schemes: [] };
	const [governance, collections, schemes] = await Promise.all([
		connector.fetchNamespaceGovernance(core),
		connector.fetchCollections(core),
		connector.fetchConceptSchemes(core)
	]);
	return { governance: { namespaceIri: core, ...governance }, collections, schemes };
}

export async function loadOpenChangeRequests(connector: Pick<SparqlConnector, 'fetchChangeRequests'>): Promise<number> {
	return (await connector.fetchChangeRequests()).filter(canDecide).length;
}

/** The server lists newest first, so the head of the list is the latest. */
export async function loadRecentChanges(fetchFn: typeof fetch = (...args) => fetch(...args)): Promise<ChangeLogItem[]> {
	return (await fetchChangeLog(fetchFn)).slice(0, RECENT_CHANGES_LIMIT);
}
