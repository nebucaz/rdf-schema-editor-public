/** The real loaders behind the Ontology dashboard, shared by the editable page and the read-only review page. */
import { loadOpenChangeRequests, loadRecentChanges, loadVocabularyExtras } from '#lib/services/ontology-dashboard-data.js';
import { sparqlConnector } from '#lib/services/sparql-connector.js';
import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';
import { debtSettingsStore } from './debt-settings-store.js';
import { namespaceStore } from './namespace-store.svelte.js';
import { schemaStore } from './schema-store.js';
import type { OntologyDashboardDeps } from './ontology-dashboard-state.svelte.js';

export function ontologyDashboardDeps(): OntologyDashboardDeps {
	return {
		loadSchema: (variant) => schemaStore.ensureLoaded(variant),
		loadNamespaces: async () => {
			await namespaceStore.ensureLoaded();
			return namespaceStore.namespaces;
		},
		loadQuestions: async () => {
			const [questions, runs] = await Promise.all([sparqlConnector.fetchCompetencyQuestions(), sparqlConnector.fetchCompetencyQuestionRuns()]);
			return { questions, runs };
		},
		loadConcepts: () => loadAllConcepts(sparqlConnector),
		loadExtras: () => loadVocabularyExtras(sparqlConnector),
		loadOpenRequests: () => loadOpenChangeRequests(sparqlConnector),
		loadChanges: () => loadRecentChanges(),
		settings: () => debtSettingsStore.get()
	};
}
