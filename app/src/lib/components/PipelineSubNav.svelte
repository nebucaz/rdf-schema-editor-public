<script lang="ts">
	/** The pages of the ontology pipeline area under its single main-nav entry. */
	import { appUrl } from '#lib/utils/urls.js';
	import type { RouteView } from '#lib/utils/route-views.js';

	interface Props {
		routeView: RouteView;
		/** Opens the in-app documentation at the quick start. */
		onOpenGuide: () => void;
	}

	let { routeView, onOpenGuide }: Props = $props();

	const tabs = $derived([
		{ href: appUrl('/pipeline'), label: 'Overview', title: 'Where each namespace stands, and the semantic debt', active: routeView.isPipelineView },
		{ href: appUrl('/questions'), label: 'Questions', title: 'Competency questions: what the model must be able to answer', active: routeView.isQuestionsView },
		{ href: appUrl('/vocabulary'), label: 'Vocabulary', title: 'The agreed terms and their definitions', active: routeView.isVocabularyView },
		{ href: appUrl('/taxonomy'), label: 'Taxonomy', title: 'Terms arranged from general to specific', active: routeView.isTaxonomyView },
		{ href: appUrl('/governance'), label: 'Governance', title: 'Owners, change requests, change log and releases', active: routeView.isGovernanceView }
	]);
</script>

<nav class="pipeline-subnav" aria-label="Ontology pipeline">
	{#each tabs as tab (tab.href)}
		<a href={tab.href} title={tab.title} aria-current={tab.active ? 'page' : undefined}>{tab.label}</a>
	{/each}
	<button type="button" class="guide" onclick={onOpenGuide}>Quick start</button>
</nav>

<style>
	.pipeline-subnav {
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
		padding: 0 1rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg);
		overflow-x: auto;
	}

	a {
		display: flex;
		align-items: center;
		padding: 0.35rem 0.75rem;
		border-bottom: 2px solid transparent;
		color: var(--color-text);
		font-size: 0.85rem;
		text-decoration: none;
		white-space: nowrap;
	}

	a:hover {
		background: var(--color-hover);
	}

	a[aria-current='page'] {
		border-bottom-color: var(--color-accent);
		font-weight: 600;
		cursor: default;
	}

	.guide {
		margin-left: auto;
		align-self: center;
		padding: 0.2rem 0.65rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.guide:hover {
		background: var(--color-hover);
	}
</style>
