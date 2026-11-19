<script lang="ts">
	/** The Guides tile (spec/ontology-dashboard STORY-471): the stage guides, each listed once. Without a handler (the
	 *  read-only review page) it shows nothing, because the guides belong to the editor. */
	import { STAGE_GUIDES } from '#lib/services/pipeline-guides.js';

	interface Props {
		/** Opens the documentation on a section. */
		onOpenGuide?: (sectionId: string) => void;
	}

	let { onOpenGuide }: Props = $props();

	const TITLE: Record<string, string> = {
		'guide-vocabulary': 'Vocabulary',
		'guide-metadata': 'Metadata',
		'guide-taxonomy': 'Taxonomy',
		'guide-thesaurus': 'Thesaurus',
		'guide-ontology': 'Ontology',
		'guide-knowledge-graph': 'Knowledge graph (validation and application)'
	};

	// Validation and application share one guide, so de-duplicate by section while keeping the stage order.
	const guides = [...new Map(Object.values(STAGE_GUIDES).flat().map((g) => [g.sectionId, g])).values()];
</script>

{#if onOpenGuide}
	<ul>
		{#each guides as guide (guide.sectionId)}
			<li>
				<button type="button" onclick={() => onOpenGuide(guide.sectionId)}>{TITLE[guide.sectionId] ?? guide.sectionId} guide</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	button {
		padding: 0;
		border: none;
		background: none;
		color: var(--color-accent);
		font-size: 0.85rem;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	button:hover {
		color: var(--color-accent-hover);
	}
</style>
