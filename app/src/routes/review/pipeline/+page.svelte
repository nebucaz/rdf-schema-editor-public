<script lang="ts">
	/** Read-only pipeline status (ontology-pipeline STORY-335): the stage strip of each namespace, without the
	 *  debt settings or any control. Only reads. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import StageStrip from '#lib/components/StageStrip.svelte';
	import { runGates } from '#lib/services/gates/index.js';
	import { pipelineNamespaces, pipelineSummary, type NamespaceSummary } from '#lib/services/pipeline-summary.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import { schemaStore } from '#lib/stores/schema-store.js';

	let summaries = $state<NamespaceSummary[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		if (!page.data.user) return;
		try {
			const [schema, questions, runs] = await Promise.all([
				schemaStore.ensureLoaded('full'),
				sparqlConnector.fetchCompetencyQuestions(),
				sparqlConnector.fetchCompetencyQuestionRuns(),
				namespaceStore.ensureLoaded()
			]);
			summaries = pipelineSummary({ schema, namespaces: pipelineNamespaces(namespaceStore.namespaces), findings: runGates(schema), questions, runs });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the pipeline status';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Pipeline (review) — RDF Schema Editor</title>
</svelte:head>

<div class="review-page">
	<h1>Pipeline status</h1>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if loading}
		<p>Loading…</p>
	{:else if summaries.length === 0}
		<p data-testid="no-pipeline-namespaces">No namespace is part of the ontology pipeline yet.</p>
	{:else}
		{#each summaries as summary (summary.namespaceBaseIri)}
			<StageStrip {summary} />
		{/each}
	{/if}
</div>

<style>
	.review-page {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		height: 100%;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	h1 {
		font-size: 1.3rem;
		margin: 0;
	}

	.error {
		color: var(--color-error);
	}

	@media print {
		.review-page {
			padding: 0;
			overflow: visible;
			height: auto;
		}

		:global(body:has(.review-page) .app-header) {
			display: none;
		}

		:global(body:has(.review-page) .app-main) {
			overflow: visible;
			height: auto;
		}
	}
</style>
