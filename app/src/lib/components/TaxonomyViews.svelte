<script lang="ts">
	/** The Taxonomy page body (vocabulary-graph-and-tabs STORY-453): an Outline | Graph toggle over the editable
	 *  outline and the read-only scheme graph. The view and the scheme live in the page's URL, so this component only
	 *  reports changes. Moves and top-concept changes stay in the outline. */
	import TaxonomyGraph from './TaxonomyGraph.svelte';
	import TaxonomyOutline from './TaxonomyOutline.svelte';
	import type { GateFinding } from '#lib/services/gates/types.js';
	import { schemeDisplayName, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';
	import type { TaxonomyView } from '#lib/services/taxonomy-url-state.js';
	import type { TaxonomyNode } from '#lib/services/taxonomy-tree.js';

	interface Props {
		concepts: Concept[];
		schemes: ConceptScheme[];
		classTree: TaxonomyNode[];
		findings?: GateFinding[];
		view: TaxonomyView;
		/** `''` is the first scheme. */
		scheme: string;
		onViewChange: (view: TaxonomyView) => void;
		onSchemeChange: (iri: string) => void;
		onOpenConcept: (iri: string) => void;
		onMove: (childIri: string, fromIri: string | null, toIri: string | null) => Promise<void>;
		onTopChange: (iri: string, top: boolean) => Promise<void>;
	}

	let { concepts, schemes, classTree, findings = [], view, scheme, onViewChange, onSchemeChange, onOpenConcept, onMove, onTopChange }: Props =
		$props();

	const schemeIri = $derived(scheme || schemes[0]?.iri || '');
	const VIEWS: { id: TaxonomyView; label: string }[] = [
		{ id: 'outline', label: 'Outline' },
		{ id: 'graph', label: 'Graph' }
	];
</script>

<div class="views">
	<div class="toggle" role="group" aria-label="Taxonomy view">
		{#each VIEWS as v (v.id)}
			<button type="button" class:active={view === v.id} aria-pressed={view === v.id} onclick={() => onViewChange(v.id)}>
				{v.label}
			</button>
		{/each}
	</div>

	{#if view === 'graph'}
		<label class="scheme">
			Scheme
			<select value={schemeIri} onchange={(e) => onSchemeChange(e.currentTarget.value)}>
				{#each schemes as s (s.iri)}
					<option value={s.iri}>{schemeDisplayName(s)}</option>
				{/each}
			</select>
		</label>
		{#key schemeIri}
			<TaxonomyGraph {concepts} {schemes} {schemeIri} onOpen={onOpenConcept} />
		{/key}
	{:else}
		<TaxonomyOutline {concepts} {schemes} {classTree} {findings} {scheme} {onSchemeChange} {onMove} {onTopChange} />
	{/if}
</div>

<style>
	.views {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.toggle {
		display: inline-flex;
		align-self: flex-start;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}
	.toggle button {
		border: 0;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		padding: 0.35rem 0.9rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.toggle button.active {
		background: var(--color-accent);
		color: #fff;
	}
	.scheme {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		max-width: 20rem;
	}
	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}
</style>
