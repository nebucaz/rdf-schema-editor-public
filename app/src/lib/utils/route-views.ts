/**
 * Which top-level surface a pathname belongs to. `+layout.svelte` uses this to hide canvas-only
 * chrome (workspace/namespace selectors, triples, SVG export, …) on the non-canvas routes.
 * `isCanvasView` is true only on the canvas route itself, not merely "not identities".
 */
import { stripBase } from '#lib/utils/urls.js';

export interface RouteView {
	isIdentitiesView: boolean;
	isValidationView: boolean;
	isWorkbenchView: boolean;
	/** `/questions` — the competency question registry (ontology-pipeline STORY-317). */
	isQuestionsView: boolean;
	/** `/pipeline` — where each namespace stands in the pipeline stages (ontology-pipeline STORY-320). */
	isPipelineView: boolean;
	/** `/vocabulary` — the core vocabulary's SKOS concepts (ontology-pipeline STORY-323). */
	isVocabularyView: boolean;
	/** `/taxonomy` — the concept outline of `skos:broader` (ontology-pipeline STORY-328). */
	isTaxonomyView: boolean;
	/** `/governance` — owners, change log, change requests and releases (ontology-pipeline STORY-331). */
	isGovernanceView: boolean;
	/** Any page of the ontology pipeline area: the overview, questions, vocabulary, taxonomy or governance.
	 *  The main nav has one "Pipeline" entry for all of them and a sub-navigation switches between them. */
	isPipelineArea: boolean;
	/** `/review/...` — read-only pages for domain experts (ontology-pipeline STORY-335). */
	isReviewView: boolean;
	/** `/reports/<id>` — a saved query's live report page (query-workbench STORY-198). */
	isReportView: boolean;
	isCanvasView: boolean;
}

export function resolveRouteView(browserPathname: string): RouteView {
	// `page.url.pathname` includes the deployment base path; the route checks below do not.
	const pathname = stripBase(browserPathname);
	const isIdentitiesView = pathname.startsWith('/identities');
	const isValidationView = pathname.startsWith('/validation');
	const isWorkbenchView = pathname.startsWith('/workbench');
	const isReportView = pathname.startsWith('/reports');
	const isQuestionsView = pathname.startsWith('/questions');
	const isPipelineView = pathname.startsWith('/pipeline');
	const isVocabularyView = pathname.startsWith('/vocabulary');
	const isTaxonomyView = pathname.startsWith('/taxonomy');
	const isGovernanceView = pathname.startsWith('/governance');
	const isReviewView = pathname.startsWith('/review');
	return {
		isIdentitiesView,
		isValidationView,
		isWorkbenchView,
		isReportView,
		isQuestionsView,
		isPipelineView,
		isVocabularyView,
		isTaxonomyView,
		isGovernanceView,
		isPipelineArea: isPipelineView || isQuestionsView || isVocabularyView || isTaxonomyView || isGovernanceView,
		isReviewView,
		isCanvasView:
			!isIdentitiesView &&
			!isValidationView &&
			!isWorkbenchView &&
			!isReportView &&
			!isQuestionsView &&
			!isPipelineView &&
			!isVocabularyView &&
			!isTaxonomyView &&
			!isGovernanceView &&
			!isReviewView
	};
}
