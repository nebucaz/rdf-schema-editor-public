/**
 * Everything the Ontology dashboard shows, loaded once and shared by the editable page and the read-only review page
 * (spec/ontology-dashboard STORY-474). Loading is in phases so the first render never waits for the slow parts:
 *
 *   1. the cheap schema, the questions and their runs, and the namespaces  -> stages table, questions tile
 *   2. started right after phase 1, independent of each other:
 *        the full schema and the concepts   -> application stage, Model checks and Scheme health tiles
 *        the vocabulary extras, the open change requests and the change log -> Governance and Recent changes tiles
 *
 * A failure of the lazy reads stays inside its own tile; only the schema failing is a page error. The Model checks
 * tile is computed with the same gate inputs as the Model checks tab, so their counts agree.
 */
import type { ChangeLogItem } from '#lib/services/change-log.js';
import type { CompetencyQuestion, CompetencyQuestionRun } from '#lib/services/competency-question.js';
import type { DebtSettings } from '#lib/services/debt-settings.js';
import { runGates } from '#lib/services/gates/index.js';
import type { Governance } from '#lib/services/governance.js';
import type { VocabularyExtras } from '#lib/services/ontology-dashboard-data.js';
import { pipelineNamespaces, pipelineSummary, type StageId } from '#lib/services/pipeline-summary.js';
import { analyseSchemeHealth } from '#lib/services/scheme-health.js';
import type { Concept } from '#lib/services/skos-concept.js';
import type { FetchedSchema } from '#lib/services/sparql-connector.js';

export interface OntologyDashboardDeps {
	loadSchema: (variant: 'schema' | 'full') => Promise<FetchedSchema>;
	loadNamespaces: () => Promise<{ baseIri: string; prefix: string; pipeline: boolean; vocabulary?: boolean }[]>;
	loadQuestions: () => Promise<{ questions: CompetencyQuestion[]; runs: CompetencyQuestionRun[] }>;
	/** `null` when there is no core vocabulary. */
	loadConcepts: () => Promise<Concept[] | null>;
	loadExtras: () => Promise<VocabularyExtras>;
	loadOpenRequests: () => Promise<number>;
	loadChanges: () => Promise<ChangeLogItem[]>;
	settings: () => DebtSettings;
}

type TileStatus = 'loading' | 'ready' | 'error';

/** Stages whose numbers still wait for the slow instance queries. */
const PENDING_STAGES: StageId[] = ['application'];
/** Stages that come from the concepts, which load beside the instance queries. */
const CONCEPT_STAGES: StageId[] = ['vocabulary', 'taxonomy', 'thesaurus'];

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function createOntologyDashboardState(deps: OntologyDashboardDeps) {
	let schema = $state<FetchedSchema | null>(null);
	let namespaces = $state<{ baseIri: string; prefix: string; pipeline: boolean; vocabulary?: boolean }[]>([]);
	let questions = $state<CompetencyQuestion[]>([]);
	let runs = $state<CompetencyQuestionRun[]>([]);
	/** `null` until loaded; `[]` without a vocabulary or when it could not be read. */
	let concepts = $state<Concept[] | null>(null);
	let extras = $state<VocabularyExtras | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let detailsLoaded = $state(false);
	let governance = $state<{ status: TileStatus; governance: Governance | null; openRequests: number | null; error: string }>({
		status: 'loading',
		governance: null,
		openRequests: null,
		error: ''
	});
	let changes = $state<{ status: TileStatus; entries: ChangeLogItem[]; error: string }>({ status: 'loading', entries: [], error: '' });

	const flagged = $derived(pipelineNamespaces(namespaces));
	const problems = $derived(
		schema
			? runGates(schema, {
					...(concepts ? { concepts } : {}),
					governance: extras?.governance ?? null,
					collections: extras?.collections ?? [],
					schemes: extras?.schemes ?? [],
					questions,
					runs,
					...deps.settings()
				})
			: []
	);
	const summaries = $derived(schema ? pipelineSummary({ schema, namespaces: flagged, concepts, findings: problems, questions, runs }) : []);
	const health = $derived(concepts && concepts.length > 0 ? analyseSchemeHealth(concepts) : []);

	async function loadLazy() {
		await Promise.all([
			deps
				.loadExtras()
				.then((loaded) => {
					extras = loaded;
					governance = { ...governance, status: 'ready', governance: loaded.governance };
				})
				.catch((e) => {
					governance = { ...governance, status: 'error', error: message(e, 'unknown error') };
				}),
			deps
				.loadOpenRequests()
				.then((count) => {
					governance = { ...governance, openRequests: count };
				})
				.catch(() => {
					/* the tile shows the count as unknown */
				}),
			deps
				.loadChanges()
				.then((entries) => {
					changes = { status: 'ready', entries, error: '' };
				})
				.catch((e) => {
					changes = { status: 'error', entries: [], error: message(e, 'unknown error') };
				})
		]);
	}

	async function load() {
		try {
			// `schema` is requested first so it gets its own cheap load instead of waiting for the `full` one.
			const schemaPromise = deps.loadSchema('schema');
			const fullPromise = deps.loadSchema('full');
			const conceptsPromise = deps.loadConcepts().catch(() => null);
			// Unhandled-rejection guard: a failure is reported where it is awaited below.
			fullPromise.catch(() => {});
			const [cheap, loadedNamespaces, loadedQuestions] = await Promise.all([schemaPromise, deps.loadNamespaces(), deps.loadQuestions()]);
			namespaces = loadedNamespaces;
			questions = loadedQuestions.questions;
			runs = loadedQuestions.runs;
			schema = cheap;
			loading = false;

			const lazy = loadLazy();
			const [full, loadedConcepts] = await Promise.all([fullPromise, conceptsPromise]);
			schema = full;
			concepts = loadedConcepts ?? [];
			detailsLoaded = true;
			await lazy;
		} catch (e) {
			error = message(e, 'Failed to load the ontology status');
		} finally {
			loading = false;
		}
	}

	return {
		load,
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get detailsLoaded() {
			return detailsLoaded;
		},
		get pendingStages(): StageId[] {
			return [...(detailsLoaded ? [] : PENDING_STAGES), ...(concepts === null ? CONCEPT_STAGES : [])];
		},
		get hasPipelineNamespace() {
			return flagged.length > 0;
		},
		get summaries() {
			return summaries;
		},
		get problems() {
			return problems;
		},
		get questions() {
			return questions;
		},
		get runs() {
			return runs;
		},
		/** `null` while the concepts load. */
		get concepts() {
			return concepts;
		},
		get health() {
			return health;
		},
		get schema() {
			return schema;
		},
		get governance() {
			return governance;
		},
		get changes() {
			return changes;
		}
	};
}

export type OntologyDashboardState = ReturnType<typeof createOntologyDashboardState>;
