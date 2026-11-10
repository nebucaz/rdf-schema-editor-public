<script lang="ts">
	/** Read-only competency questions with their latest result (ontology-pipeline STORY-335), in the style of the
	 *  report pages: shareable, printable, no controls. Only reads. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import CompetencyQuestionReport from '#lib/components/CompetencyQuestionReport.svelte';
	import { buildReportRows } from '#lib/services/competency-question-report.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import type { CompetencyQuestion, CompetencyQuestionRun } from '#lib/services/competency-question.js';

	let questions = $state<CompetencyQuestion[]>([]);
	let runs = $state<CompetencyQuestionRun[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let readAt = $state<Date | null>(null);

	const rows = $derived(buildReportRows(questions, runs));

	onMount(async () => {
		if (!page.data.user) return;
		try {
			[questions, runs] = await Promise.all([sparqlConnector.fetchCompetencyQuestions(), sparqlConnector.fetchCompetencyQuestionRuns()]);
			readAt = new Date();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the competency questions';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Competency questions (review) — RDF Schema Editor</title>
</svelte:head>

<div class="review-page">
	<h1>Competency questions</h1>
	{#if readAt}<p class="as-of">Results as of {readAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if loading}
		<p>Loading…</p>
	{:else}
		<CompetencyQuestionReport {rows} runningIri={null} runningAll={false} onRun={() => {}} onRunAll={() => {}} readonly />
	{/if}
</div>

<style>
	.review-page {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		height: 100%;
		box-sizing: border-box;
	}

	h1 {
		font-size: 1.3rem;
		margin: 0 0 0.25rem;
	}

	.as-of {
		margin: 0 0 1rem;
		color: var(--color-text-muted);
		font-size: 0.85rem;
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
