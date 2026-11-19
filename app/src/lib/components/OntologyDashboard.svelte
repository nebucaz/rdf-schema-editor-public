<script lang="ts">
	/** The Ontology dashboard (spec/ontology-dashboard STORY-474): the tiles fed from one `OntologyDashboardState` and
	 *  arranged by `DashboardGrid`. The editable page and the read-only review page both use it; the review page passes
	 *  `readonly`, so nothing here can write. Storage of the layout is the host's business (`onchange`). */
	import DashboardGrid from '#lib/components/DashboardGrid.svelte';
	import GovernanceTile from '#lib/components/GovernanceTile.svelte';
	import GuidesTile from '#lib/components/GuidesTile.svelte';
	import ModelChecksTile from '#lib/components/ModelChecksTile.svelte';
	import PipelineGettingStarted from '#lib/components/PipelineGettingStarted.svelte';
	import QuestionsTile from '#lib/components/QuestionsTile.svelte';
	import RecentChangesTile from '#lib/components/RecentChangesTile.svelte';
	import SchemeHealthTile from '#lib/components/SchemeHealthTile.svelte';
	import StagesTile from '#lib/components/StagesTile.svelte';
	import type { DashboardLayout, TileId } from '#lib/services/dashboard-layout.js';
	import { checksTileModel, questionsTileModel } from '#lib/services/ontology-dashboard-model.js';
	import type { OntologyDashboardState } from '#lib/stores/ontology-dashboard-state.svelte.js';

	interface Props {
		state: OntologyDashboardState;
		layout: DashboardLayout;
		onchange?: (layout: DashboardLayout) => void;
		readonly?: boolean;
		/** Opens a documentation section; left out where the guides do not belong (the read-only page). */
		onOpenGuide?: (sectionId: string) => void;
		/** Where a changed term can be looked at; `null` when nowhere. */
		linkFor?: (termIri: string) => string | null;
	}

	let { state: dashboard, layout, onchange, readonly = false, onOpenGuide, linkFor }: Props = $props();

	const TITLES: Record<TileId, string> = {
		'getting-started': 'Getting started',
		stages: 'Stages',
		'model-checks': 'Model checks',
		questions: 'Competency questions',
		'scheme-health': 'Scheme health',
		governance: 'Governance',
		'recent-changes': 'Recent changes',
		guides: 'Guides'
	};

	const checks = $derived(checksTileModel(dashboard.problems));
	const questionModel = $derived(questionsTileModel(dashboard.questions, dashboard.runs));
</script>

{#snippet loadingOr(ready: boolean, content: import('svelte').Snippet)}
	{#if dashboard.error}
		<p class="error" role="alert">{dashboard.error}</p>
	{:else if !ready}
		<p>Loading…</p>
	{:else}
		{@render content()}
	{/if}
{/snippet}

{#snippet tile(id: TileId)}
	{#if id === 'getting-started'}
		<PipelineGettingStarted hasPipelineNamespace={dashboard.hasPipelineNamespace} />
	{:else if id === 'stages'}
		{#snippet stages()}<StagesTile summaries={dashboard.summaries} pending={dashboard.pendingStages} />{/snippet}
		{@render loadingOr(!dashboard.loading, stages)}
	{:else if id === 'model-checks'}
		{#snippet modelChecks()}<ModelChecksTile model={checks} />{/snippet}
		{@render loadingOr(!dashboard.loading, modelChecks)}
	{:else if id === 'questions'}
		{#snippet questionsContent()}<QuestionsTile model={questionModel} />{/snippet}
		{@render loadingOr(!dashboard.loading, questionsContent)}
	{:else if id === 'scheme-health'}
		{#snippet health()}<SchemeHealthTile reports={dashboard.health} />{/snippet}
		{@render loadingOr(dashboard.concepts !== null, health)}
	{:else if id === 'governance'}
		<GovernanceTile status={dashboard.governance.status} governance={dashboard.governance.governance} openRequests={dashboard.governance.openRequests} error={dashboard.governance.error} />
	{:else if id === 'recent-changes'}
		<RecentChangesTile status={dashboard.changes.status} entries={dashboard.changes.entries} error={dashboard.changes.error} {linkFor} />
	{:else if id === 'guides'}
		<GuidesTile {onOpenGuide} />
	{/if}
{/snippet}

<DashboardGrid {layout} titles={TITLES} {tile} {onchange} {readonly} />

<style>
	.error {
		color: var(--color-error);
		margin: 0;
	}
	p {
		margin: 0;
	}
</style>
