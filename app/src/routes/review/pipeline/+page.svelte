<script lang="ts">
	/** Read-only Ontology status (ontology-pipeline STORY-335, spec/ontology-dashboard STORY-475): the same tiles as the
	 *  Overview, in the default order, without any control, guide link or stored arrangement. Only reads. The checklist
	 *  and the guides belong to the editor, so those two tiles are left out. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import OntologyDashboard from '#lib/components/OntologyDashboard.svelte';
	import { DEFAULT_LAYOUT, hideTile, type DashboardLayout } from '#lib/services/dashboard-layout.js';
	import { ontologyDashboardDeps } from '#lib/stores/ontology-dashboard-deps.js';
	import { createOntologyDashboardState } from '#lib/stores/ontology-dashboard-state.svelte.js';

	const dashboard = createOntologyDashboardState(ontologyDashboardDeps());
	const layout: DashboardLayout = hideTile(hideTile(DEFAULT_LAYOUT, 'getting-started'), 'guides');

	onMount(() => {
		if (page.data.user) void dashboard.load();
	});
</script>

<svelte:head>
	<title>Ontology (review) — RDF Schema Editor</title>
</svelte:head>

<div class="review-page">
	<h1>Ontology status</h1>
	<OntologyDashboard state={dashboard} {layout} readonly />
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
