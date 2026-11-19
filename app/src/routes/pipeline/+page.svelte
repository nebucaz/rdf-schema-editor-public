<script lang="ts">
	/** The Ontology page (ontology-pipeline STORY-320, spec/ontology-dashboard): an Overview dashboard of arrangeable tiles
	 *  and the Model checks tab. Read-only toward the model: the stages are a recommended order, nothing here disables
	 *  anything. The arrangement is stored per user; the schema and the other data load in phases, see
	 *  `ontology-dashboard-state`. */
	import { onMount } from 'svelte';
	import { appUrl, stripBase } from '#lib/utils/urls.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ModelChecksView from '#lib/components/ModelChecksView.svelte';
	import OntologyDashboard from '#lib/components/OntologyDashboard.svelte';
	import OntologyTabs from '#lib/components/OntologyTabs.svelte';
	import { DEFAULT_LAYOUT, type DashboardLayout } from '#lib/services/dashboard-layout.js';
	import { parseModelChecksState, withModelChecksState, type ModelChecksState } from '#lib/services/model-checks-model.js';
	import { parseOntologyTab, withOntologyTab, type OntologyTab } from '#lib/services/ontology-tabs.js';
	import { reviewPipelineUrl } from '#lib/services/review-links.js';
	import { ApiDashboardLayoutStore } from '#lib/stores/dashboard-layout-store.js';
	import { ontologyDashboardDeps } from '#lib/stores/ontology-dashboard-deps.js';
	import { createOntologyDashboardState } from '#lib/stores/ontology-dashboard-state.svelte.js';
	import { useOpenDocumentation } from '#lib/utils/documentation-context.js';

	const openDocumentation = useOpenDocumentation();

	/** `?tab=checks` shows the Model checks list; its filters live in the same query string. */
	const tab = $derived(parseOntologyTab(page.url.searchParams));
	const checksTab = $derived(tab === 'checks');
	const checksState = $derived(parseModelChecksState(page.url.searchParams));

	function navigate(params: URLSearchParams) {
		const search = params.toString();
		void goto(appUrl(stripBase(page.url.pathname)) + (search ? `?${search}` : ''), { replace: true, reset: false });
	}
	const selectTab = (next: OntologyTab) => navigate(withOntologyTab(page.url.searchParams, next));
	const changeChecks = (next: ModelChecksState) => navigate(withModelChecksState(page.url.searchParams, next));

	const dashboard = createOntologyDashboardState(ontologyDashboardDeps());

	// The default order renders at once; the stored one replaces it when it arrives, unless the user has already moved something.
	let layout = $state<DashboardLayout>(DEFAULT_LAYOUT);
	let arranged = false;
	let saveNotice = $state<string | null>(null);
	const layoutStore = new ApiDashboardLayoutStore({ onSaveError: (message) => (saveNotice = message) });

	function arrange(next: DashboardLayout) {
		arranged = true;
		layout = next;
		layoutStore.save(next);
	}

	/** A changed term can be looked at in the Vocabulary area (a concept) or on the canvas (a class). */
	function linkFor(termIri: string): string | null {
		if (dashboard.concepts?.some((c) => c.iri === termIri)) return appUrl(`/vocabulary?concept=${encodeURIComponent(termIri)}`);
		if (dashboard.schema?.classes.some((c) => c.iri === termIri)) return appUrl(`/?focus=${encodeURIComponent(termIri)}`);
		return null;
	}

	onMount(() => {
		if (!page.data.user) return;
		void dashboard.load();
		void layoutStore.load().then((stored) => {
			if (!arranged) layout = stored;
		});
	});
</script>

<svelte:head>
	<title>Ontology — RDF Schema Editor</title>
</svelte:head>

<div class="pipeline-page">
	<h1>Ontology</h1>
	<a class="review-link" href={reviewPipelineUrl()} data-testid="review-link">Read-only view to share</a>

	<OntologyTabs {tab} onSelect={selectTab} />

	{#if checksTab}
		<ModelChecksView query={checksState} onStateChange={changeChecks} />
	{:else}
		{#if saveNotice}
			<p class="error" role="status" data-testid="layout-save-error">{saveNotice}</p>
		{/if}
		<OntologyDashboard state={dashboard} {layout} onchange={arrange} onOpenGuide={openDocumentation} {linkFor} />
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
	.error {
		color: var(--color-error);
		margin: 0;
	}
</style>
