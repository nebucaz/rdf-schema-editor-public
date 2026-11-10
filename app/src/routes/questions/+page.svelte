<script lang="ts">
	/** Competency question registry (ontology-pipeline STORY-317): list, add, edit and delete the
	 *  questions the model must answer. Running them is STORY-318. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { reviewQuestionsUrl } from '#lib/services/review-links.js';
	import CompetencyQuestionForm from '#lib/components/CompetencyQuestionForm.svelte';
	import CompetencyQuestionReport from '#lib/components/CompetencyQuestionReport.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import {
		competencyElementOptions,
		type CompetencyQuestion,
		type CompetencyQuestionDraft,
		type CompetencyQuestionRun
	} from '#lib/services/competency-question.js';
	import { buildReportRows } from '#lib/services/competency-question-report.js';
	import {
		connectorRunnerDeps,
		runAllCompetencyQuestions,
		runCompetencyQuestion
	} from '#lib/services/competency-question-runner.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import { savedQueriesStore } from '#lib/stores/saved-queries-store.svelte.js';
	import { schemaStore } from '#lib/stores/schema-store.js';

	let questions = $state<CompetencyQuestion[]>([]);
	let runs = $state<CompetencyQuestionRun[]>([]);
	let runningIri = $state<string | null>(null);
	let runningAll = $state(false);
	let elements = $state<{ iri: string; label: string }[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	/** `null` = closed, `'new'` = adding, otherwise the question being edited. */
	let editing = $state<CompetencyQuestion | 'new' | null>(null);
	let confirmingDelete = $state<string | null>(null);

	const savedQueries = $derived(savedQueriesStore.items.map((q) => ({ iri: q.iri, label: q.label })));
	const reportRows = $derived(buildReportRows(questions, runs));
	const labels = $derived(new Map(elements.map((e) => [e.iri, e.label])));

	/** Pure label for an IRI the schema does not know (deleted element): its local name. */
	function labelOf(iri: string): string {
		return labels.get(iri) ?? iri.split(/[#/]/).pop() ?? iri;
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const [loaded, loadedRuns, schema] = await Promise.all([
				sparqlConnector.fetchCompetencyQuestions(),
				sparqlConnector.fetchCompetencyQuestionRuns(),
				schemaStore.ensureLoaded('schema'),
				savedQueriesStore.load(page.data.user ? { sub: page.data.user.sub, displayName: page.data.user.displayName } : null)
			]);
			runs = loadedRuns;
			questions = loaded.sort((a, b) => a.question.localeCompare(b.question));
			elements = competencyElementOptions(schema);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the competency questions';
		} finally {
			loading = false;
		}
	}

	async function save(draft: CompetencyQuestionDraft) {
		if (editing && editing !== 'new') await sparqlConnector.updateCompetencyQuestion(editing.iri, draft);
		else await sparqlConnector.insertCompetencyQuestion(draft);
		editing = null;
		await load();
	}

	async function remove(iri: string) {
		try {
			await sparqlConnector.deleteCompetencyQuestion(iri);
			confirmingDelete = null;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete the question';
		}
	}

	function runnerDeps() {
		return connectorRunnerDeps(
			sparqlConnector,
			savedQueriesStore.items.map((q) => ({ iri: q.iri, sparqlText: q.sparqlText }))
		);
	}

	/** Runs go one at a time; the stored history is re-read afterwards so the strip shows what was saved. */
	async function runOne(iri: string) {
		const question = questions.find((q) => q.iri === iri);
		if (!question) return;
		runningIri = iri;
		error = null;
		try {
			const run = await runCompetencyQuestion(question, runnerDeps());
			await sparqlConnector.insertCompetencyQuestionRun(run);
			runs = await sparqlConnector.fetchCompetencyQuestionRuns();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to run the question';
		} finally {
			runningIri = null;
		}
	}

	async function runAll() {
		runningAll = true;
		error = null;
		try {
			await runAllCompetencyQuestions(questions, runnerDeps(), (run) => {
				runs = [...runs, run];
			});
			runs = await sparqlConnector.fetchCompetencyQuestionRuns();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to run the questions';
		} finally {
			runningAll = false;
		}
	}

	onMount(() => {
		if (page.data.user) void load();
	});
</script>

<svelte:head>
	<title>Competency Questions — RDF Schema Editor</title>
</svelte:head>

<div class="questions-page">
	<header>
		<h1>Competency Questions</h1>
		<a class="review-link" href={reviewQuestionsUrl()} data-testid="review-link">Read-only view to share</a>
		<button type="button" onclick={() => (editing = 'new')} data-testid="add-question">Add question</button>
	</header>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if !loading && questions.length > 0}
		<div id="results">
			<CompetencyQuestionReport rows={reportRows} {runningIri} {runningAll} onRun={runOne} onRunAll={runAll} />
		</div>
	{/if}

	{#if loading}
		<p>Loading…</p>
	{:else if questions.length === 0}
		<p class="empty">No competency questions yet. Add the questions the model must be able to answer.</p>
	{:else}
		<table data-testid="question-table">
			<thead>
				<tr><th>Question</th><th>Expected</th><th>Linked elements</th><th>Owner</th><th>Last reviewed</th><th></th></tr>
			</thead>
			<tbody>
				{#each questions as q (q.iri)}
					<tr>
						<td>{q.question}</td>
						<td class="mono">{q.expected.kind === 'ask' ? `ASK ${q.expected.value}` : q.expected.kind === 'minRows' ? `≥ ${q.expected.count} rows` : `${q.expected.values.length} values`}</td>
						<td>{q.linkedElements.map(labelOf).join(', ')}</td>
						<td>{q.owner}</td>
						<td>{q.lastReviewed}</td>
						<td class="actions">
							<button type="button" onclick={() => (editing = q)}>Edit</button>
							{#if confirmingDelete === q.iri}
								<button type="button" class="danger" onclick={() => remove(q.iri)}>Confirm delete</button>
								<button type="button" onclick={() => (confirmingDelete = null)}>Keep</button>
							{:else}
								<button type="button" onclick={() => (confirmingDelete = q.iri)}>Delete</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<Modal
	isOpen={editing !== null}
	title={editing === 'new' ? 'Add competency question' : 'Edit competency question'}
	onClose={() => (editing = null)}
	maxWidth="640px"
	dismissible={false}
>
	{#if editing !== null}
		<CompetencyQuestionForm
			initial={editing === 'new' ? undefined : editing}
			{elements}
			{savedQueries}
			onSave={save}
			onCancel={() => (editing = null)}
		/>
	{/if}
</Modal>

<style>
	.questions-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		gap: 1rem;
		box-sizing: border-box;
		overflow-y: auto;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	table {
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}
	.mono {
		font-family: monospace;
		white-space: nowrap;
	}
	.actions {
		white-space: nowrap;
		display: flex;
		gap: 0.4rem;
	}
	.error {
		color: var(--color-error);
		margin: 0;
	}
	.empty {
		color: var(--color-text-muted, inherit);
	}
	.danger {
		color: var(--color-error);
	}
</style>
