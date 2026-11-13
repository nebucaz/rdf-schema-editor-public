<script lang="ts">
	/** Where each namespace stands in the ontology pipeline (ontology-pipeline STORY-320). Read-only: the
	 *  stages are a recommended order, nothing here disables anything. Requests: the shared schema load plus
	 *  the competency question results. */
	import { onMount } from 'svelte';
	import { appUrl } from '#lib/utils/urls.js';
	import { page } from '$app/state';
	import { reviewPipelineUrl } from '#lib/services/review-links.js';
	import SemanticDebtList from '#lib/components/SemanticDebtList.svelte';
	import PipelineGettingStarted from '#lib/components/PipelineGettingStarted.svelte';
	import StageStrip from '#lib/components/StageStrip.svelte';
	import type { DebtSettings } from '#lib/services/debt-settings.js';
	import { collectDebt, countDebt } from '#lib/services/semantic-debt.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { debtSettingsStore } from '#lib/stores/debt-settings-store.js';
	import { runGates } from '#lib/services/gates/index.js';
	import { pipelineNamespaces, pipelineSummary, unlinkedQuestionCount, type NamespaceSummary, type StageId } from '#lib/services/pipeline-summary.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import { schemaStore } from '#lib/stores/schema-store.js';
	import { useOpenDocumentation } from '#lib/utils/documentation-context.js';

	const openDocumentation = useOpenDocumentation();

	let summaries = $state<NamespaceSummary[]>([]);
	let questionCount = $state(0);
	let unlinkedQuestions = $state(0);
	let debtSettings = $state<DebtSettings>(debtSettingsStore.get());
	let debtInput = $state<Omit<Parameters<typeof collectDebt>[0], 'settings' | 'now'> | null>(null);

	/** Only the namespaces flagged as part of the pipeline are listed. */
	const flagged = $derived(pipelineNamespaces(namespaceStore.namespaces));

	/** Computed over what is already loaded: changing a setting costs no request. */
	const debt = $derived(debtInput ? collectDebt({ ...debtInput, settings: debtSettings, now: new Date() }) : []);

	function changeSettings(next: DebtSettings) {
		debtSettingsStore.set(next);
		debtSettings = next;
	}
	let loading = $state(true);
	let error = $state<string | null>(null);

	/** Stages whose numbers still wait for the slow instance queries. */
	const PENDING_STAGES: StageId[] = ['application'];
	let detailsLoaded = $state(false);

	/** Two phases. The schema (cheap) renders the strips at once; the instance queries and the concepts, which
	 *  take seconds on a large repository, then fill in the Application stage and the semantic debt. */
	async function load() {
		try {
			// Started together, but `schema` is requested first so it gets its own cheap load instead of
			// waiting for the `full` one.
			const schemaPromise = schemaStore.ensureLoaded('schema');
			const fullPromise = schemaStore.ensureLoaded('full');
			// A repository without a vocabulary simply has no concept debt.
			const conceptsPromise = loadAllConcepts(sparqlConnector).catch(() => null);
			// Unhandled-rejection guard: failures are reported where they are awaited below.
			fullPromise.catch(() => {});
			const [schema, questions, runs] = await Promise.all([
				schemaPromise,
				sparqlConnector.fetchCompetencyQuestions(),
				sparqlConnector.fetchCompetencyQuestionRuns(),
				namespaceStore.ensureLoaded()
			]);
			const namespaces = pipelineNamespaces(namespaceStore.namespaces);
			questionCount = questions.length;
			unlinkedQuestions = unlinkedQuestionCount(questions);
			summaries = pipelineSummary({ schema, namespaces, findings: runGates(schema), questions, runs });
			loading = false;

			const [full, concepts] = await Promise.all([fullPromise, conceptsPromise]);
			debtInput = { schema: full, concepts: concepts ?? [], questions, runs };
			summaries = pipelineSummary({
				schema: full,
				namespaces: pipelineNamespaces(namespaceStore.namespaces),
				findings: runGates(full),
				questions,
				runs
			});
			detailsLoaded = true;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the pipeline view';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (page.data.user) void load();
	});
</script>

<svelte:head>
	<title>Pipeline — RDF Schema Editor</title>
</svelte:head>

<div class="pipeline-page">
	<h1>Ontology Pipeline</h1>
	<a class="review-link" href={reviewPipelineUrl()} data-testid="review-link">Read-only view to share</a>
	<p class="note" data-testid="pipeline-note">
		Recommended order: vocabulary, taxonomy, thesaurus, ontology, validation, application. It is a guide, not a
		rule. Work on any stage at any time, return to earlier ones, and skip what you do not need. Nothing here
		blocks anything.
	</p>

	<PipelineGettingStarted hasPipelineNamespace={flagged.length > 0} />

	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if loading}
		<p>Loading…</p>
	{:else if summaries.length === 0}
		<p data-testid="no-pipeline-namespaces">
			No namespace is part of the pipeline yet. Tick <em>Part of the ontology pipeline</em> in a namespace's form to list it here.
		</p>
	{:else}
		{#if questionCount === 0 || unlinkedQuestions > 0}
		<p class="questions-note" data-testid="questions-note">
			{#if questionCount === 0}
				No competency questions yet. Write them before modelling: they define the scope of the ontology.
				<a href={appUrl('/questions')}>Questions</a>
			{:else if unlinkedQuestions > 0}
				{unlinkedQuestions} of {questionCount} competency {questionCount === 1 ? 'question is' : 'questions are'} not linked to the model yet.
				<a href={appUrl('/questions')}>Questions</a>
			{/if}
		</p>
		{/if}
		{#each summaries as summary (summary.namespaceBaseIri)}
			<StageStrip {summary} pending={detailsLoaded ? [] : PENDING_STAGES} onOpenGuide={openDocumentation} />
		{/each}
		<section id="debt" aria-label="Semantic debt">
			<h2>Semantic debt {#if detailsLoaded}<span class="debt-count" data-testid="debt-count">{countDebt(debt)}</span>{/if}</h2>
			{#if detailsLoaded}
				<SemanticDebtList items={debt} settings={debtSettings} onSettingsChange={changeSettings} />
			{:else}
				<p class="pending" data-testid="debt-loading">Loading…</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.pipeline-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		gap: 1rem;
		box-sizing: border-box;
		overflow-y: auto;
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.note {
		margin: 0;
		max-width: 60rem;
		font-size: 0.9rem;
	}
	.questions-note {
		margin: 0;
		max-width: 60rem;
		font-size: 0.9rem;
	}
	.pending {
		margin: 0;
		color: var(--color-text-muted);
	}
	.error {
		color: var(--color-error);
		margin: 0;
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
	}
	.debt-count {
		font-size: 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0 0.5rem;
		color: var(--color-text-muted);
	}
</style>
