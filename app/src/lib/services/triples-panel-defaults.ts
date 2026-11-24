import { resolveRouteView } from '#lib/utils/route-views.js';
import type { TriplesPanelRequest } from '#lib/stores/triples-panel-store.svelte.js';

/**
 * The one table `route → { initialTab, scope }` for the settings menu's View Triples
 * (triples-tabs STORY-604). Pure: the vocabulary namespace comes in as an argument. Vocabulary and
 * Taxonomy open the Vocab tab (on the vocabulary namespace) only when one exists, else Schema.
 */
export function triplesDefaultsForPath(
	browserPathname: string,
	vocabularyNamespaceBaseIri: string | null
): TriplesPanelRequest {
	const v = resolveRouteView(browserPathname);
	const all = { kind: 'all' } as const;
	if (v.isVocabularyView || v.isTaxonomyView) {
		return vocabularyNamespaceBaseIri
			? { scope: all, initialTab: 'vocab', namespaceBaseIri: vocabularyNamespaceBaseIri }
			: { scope: all, initialTab: 'schema' };
	}
	if (v.isIdentitiesView || v.isWorkbenchView || v.isReportView || v.isQuestionsView) {
		return { scope: all, initialTab: 'instances' };
	}
	if (v.isValidationView || v.isIssuesView) return { scope: all, initialTab: 'shapes' };
	// Canvas, Ontology (/pipeline) and Governance.
	return { scope: all, initialTab: 'schema' };
}
