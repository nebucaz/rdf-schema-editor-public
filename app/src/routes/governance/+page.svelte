<script lang="ts">
	/** Governance of the core namespace (ontology-pipeline STORY-331): named owners, maturity and version, and
	 *  the change log. Stage 7 of the pipeline. Settings are written through the connector; log entries are
	 *  written by the backend, which stamps who and when. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import ChangeLogView from '#lib/components/ChangeLogView.svelte';
	import ChangeRequestForm from '#lib/components/ChangeRequestForm.svelte';
	import ChangeRequestList from '#lib/components/ChangeRequestList.svelte';
	import GovernanceSettingsForm from '#lib/components/GovernanceSettingsForm.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import ReleaseDialog from '#lib/components/ReleaseDialog.svelte';
	import { fetchChangeLog, postChangeLogEntry } from '#lib/services/changelog-client.js';
	import type { ChangeLogFilter, ChangeLogItem } from '#lib/services/change-log.js';
	import { recordChange } from '#lib/services/change-log-actions.js';
	import { approvedRequestEntry, type ChangeRequest, type ChangeRequestDraft, type RequestOutcome } from '#lib/services/change-request.js';
	import type { CompetencyQuestion } from '#lib/services/competency-question.js';
	import { connectorRunnerDeps, runAllCompetencyQuestions } from '#lib/services/competency-question-runner.js';
	import { runGates } from '#lib/services/gates/index.js';
	import { assessAgainst, latestOutcomes, takeSnapshot } from '#lib/services/impact-assessment.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { entriesSinceLastRelease } from '#lib/services/release.js';
	import { EMPTY_GOVERNANCE, type Governance } from '#lib/services/governance.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import { savedQueriesStore } from '#lib/stores/saved-queries-store.svelte.js';
	import { schemaStore } from '#lib/stores/schema-store.js';
	import { appUrl } from '#lib/utils/urls.js';

	/** `undefined` while loading, `null` when no namespace is marked as the vocabulary yet. */
	let core = $state<string | null | undefined>(undefined);
	let governance = $state<Governance>(EMPTY_GOVERNANCE);
	let entries = $state<ChangeLogItem[]>([]);
	/** The whole log, unfiltered: the release dialog needs everything since the last release. */
	let fullLog = $state<ChangeLogItem[]>([]);
	let releasing = $state(false);
	let requests = $state<ChangeRequest[]>([]);
	let questions = $state<CompetencyQuestion[]>([]);
	let newRequest = $state(false);
	let filter = $state<ChangeLogFilter>({});
	let error = $state<string | null>(null);

	const readLog = (f: ChangeLogFilter = filter) => fetchChangeLog((...args) => fetch(...args), f);
	const sinceRelease = $derived(entriesSinceLastRelease(fullLog));

	async function load() {
		error = null;
		try {
			core = await sparqlConnector.fetchVocabularyNamespace();
			if (!core) return;
			[governance, entries, fullLog, requests, questions] = await Promise.all([
				sparqlConnector.fetchNamespaceGovernance(core),
				readLog(),
				readLog({}),
				sparqlConnector.fetchChangeRequests(),
				sparqlConnector.fetchCompetencyQuestions()
			]);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load governance';
		}
	}

	async function saveGovernance(g: Governance) {
		if (!core) return;
		await sparqlConnector.updateNamespaceGovernance(core, g);
		governance = g;
	}

	/** The gate findings of now, over a fresh read of the model and the vocabulary. */
	async function currentFindings() {
		schemaStore.invalidate();
		const [schema, concepts] = await Promise.all([schemaStore.ensureLoaded('full'), loadAllConcepts(sparqlConnector)]);
		return runGates(schema, { concepts: concepts ?? undefined, governance: core ? { namespaceIri: core, ...governance } : null });
	}

	/** Reports a failure of a request action in the page banner instead of throwing into the list. */
	async function guarded(action: () => Promise<void>) {
		error = null;
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
			throw e;
		}
	}

	async function createRequest(draft: ChangeRequestDraft) {
		// The baseline is what the questions and gates say now, without running anything.
		const [runs, findings] = await Promise.all([sparqlConnector.fetchCompetencyQuestionRuns(), currentFindings()]);
		await sparqlConnector.insertChangeRequest(draft, takeSnapshot(latestOutcomes(runs), findings));
		newRequest = false;
		await load();
	}

	const startReview = (iri: string) => guarded(async () => {
		await sparqlConnector.startChangeRequestReview(iri);
		await load();
	});

	/** Runs the whole question suite and the gates, then stores what changed against the request's baseline. */
	const assess = (iri: string) => guarded(async () => {
		const request = requests.find((r) => r.iri === iri);
		if (!request) return;
		await savedQueriesStore.load(page.data.user ? { sub: page.data.user.sub, displayName: page.data.user.displayName } : null);
		const deps = connectorRunnerDeps(sparqlConnector, savedQueriesStore.items.map((q) => ({ iri: q.iri, sparqlText: q.sparqlText })));
		await runAllCompetencyQuestions(questions, deps);
		const [runs, findings] = await Promise.all([sparqlConnector.fetchCompetencyQuestionRuns(), currentFindings()]);
		await sparqlConnector.saveChangeRequestImpact(iri, assessAgainst(request.baseline, runs, findings));
		await load();
	});

	const decide = (iri: string, outcome: RequestOutcome, rationale: string) => guarded(async () => {
		const request = requests.find((r) => r.iri === iri);
		if (!request) return;
		await sparqlConnector.decideChangeRequest(iri, outcome, { rationale, decidedBy: page.data.user?.sub ?? '' });
		await load();
		// An approved request leaves a change log entry; a failing log write is shown, the decision stays.
		if (outcome === 'approved') {
			const problem = await recordChange(approvedRequestEntry(request, rationale));
			if (problem) error = problem;
			else entries = await readLog();
		}
	});

	/** One request: the backend writes `owl:versionInfo` and the release entry together, stamping who and when. */
	async function release(choice: { version: string; notes: string }) {
		if (!core) return;
		await postChangeLogEntry((...args) => fetch(...args), {
			kind: 'release',
			summary: choice.notes,
			version: choice.version,
			namespace: core
		});
		releasing = false;
		await load();
	}

	async function applyFilter(next: ChangeLogFilter) {
		filter = next;
		try {
			entries = await readLog();
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to read the change log';
		}
	}

	onMount(() => {
		if (page.data.user) void load();
	});
</script>

<svelte:head>
	<title>Governance — RDF Schema Editor</title>
</svelte:head>

<div class="governance-page">
	<h1>Governance</h1>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if core === undefined}
		<p>Loading…</p>
	{:else if core === null}
		<p>No namespace is marked as the core vocabulary yet. <a href={appUrl('/vocabulary')}>Set it up in Vocabulary</a>.</p>
	{:else}
		<section aria-label="Settings">
			<h2>Owners and version</h2>
			<button type="button" onclick={() => (releasing = true)} data-testid="open-release">Release…</button>
			{#key governance}
				<GovernanceSettingsForm initial={governance} onSave={saveGovernance} />
			{/key}
		</section>

		<section aria-label="Change requests">
			<h2>Change requests</h2>
			<button type="button" onclick={() => (newRequest = true)} data-testid="new-request">New request…</button>
			<ChangeRequestList {requests} {questions} onStartReview={startReview} onAssess={assess} onDecide={decide} />
		</section>

		<section aria-label="Change log">
			<h2>Change log</h2>
			<ChangeLogView {entries} onFilter={applyFilter} />
		</section>
	{/if}
</div>

<Modal isOpen={newRequest} title="New change request" onClose={() => (newRequest = false)} maxWidth="640px" dismissible={false}>
	{#if newRequest}
		<ChangeRequestForm {questions} requestor={page.data.user?.sub ?? ''} onSave={createRequest} onCancel={() => (newRequest = false)} />
	{/if}
</Modal>

<Modal isOpen={releasing} title="Release" onClose={() => (releasing = false)} maxWidth="640px" dismissible={false}>
	{#if releasing}
		<ReleaseDialog entries={sinceRelease} currentVersion={governance.version} onConfirm={release} onCancel={() => (releasing = false)} />
	{/if}
</Modal>

<style>
	.governance-page {
		padding: 1rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	h1 {
		font-size: 1.3rem;
		margin: 0;
	}

	h2 {
		font-size: 1rem;
		margin: 0 0 0.5rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}
</style>
