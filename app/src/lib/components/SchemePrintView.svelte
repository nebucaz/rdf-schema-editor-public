<script lang="ts">
	/** One concept scheme laid out for reading and printing (skos-support STORY-427): title and Dublin Core metadata,
	 *  then the hierarchy with each concept's definition, alternative labels, scope note and examples, and the
	 *  collections. Presentational and read-only. No hidden labels, no editorial notes, no controls. */
	import TaxonomyGraph from './TaxonomyGraph.svelte';
	import { glossaryLabel } from '#lib/services/glossary-search.js';
	import type { SkosCollection } from '#lib/services/skos-collection.js';
	import { schemeDisplayName, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';
	import { buildTaxonomy, type TaxonomyNode } from '#lib/services/taxonomy-tree.js';

	interface Props {
		/** `null` when the id named no scheme. */
		scheme: ConceptScheme | null;
		concepts: Concept[];
		collections?: SkosCollection[];
		lang?: string;
		/** Opens one concept (the review page of it); without it the graph is not offered. */
		onOpenConcept?: (iri: string) => void;
	}

	let { scheme, concepts, collections = [], lang = 'en', onOpenConcept }: Props = $props();

	let showGraph = $state(false);

	const tree = $derived(scheme ? buildTaxonomy(concepts, scheme.iri) : []);
	const byIri = $derived(new Map(concepts.map((c) => [c.iri, c])));
	const inScheme = $derived(new Set(concepts.filter((c) => c.schemeIri === scheme?.iri).map((c) => c.iri)));
	const schemeCollections = $derived(collections.filter((col) => col.members.some((m) => inScheme.has(m))));
	const labelOf = (iri: string) => {
		const c = byIri.get(iri);
		return c ? glossaryLabel(c, lang) : iri;
	};
	const collectionLabel = (col: SkosCollection) => col.prefLabels.find((l) => l.lang === lang)?.text ?? col.prefLabels[0]?.text ?? col.iri;
	const meta = $derived(
		scheme?.metadata
			? ([
					['Creator', scheme.metadata.creator],
					['Publisher', scheme.metadata.publisher],
					['Modified', scheme.metadata.modified],
					['Rights', scheme.metadata.rights]
				] as const).filter(([, v]) => v)
			: []
	);
</script>

{#snippet entry(node: TaxonomyNode)}
	{@const c = byIri.get(node.iri)}
	{#if c}
		<section class="concept">
			<h3 class:deprecated={c.status === 'deprecated' || c.status === 'retired'}>{glossaryLabel(c, lang)}</h3>
			{#if c.altLabels.length}<p class="also">Also called: {c.altLabels.map((l) => l.text).join(', ')}</p>{/if}
			<p>{c.definition || '—'}</p>
			{#if c.scopeNote}<p><em>Scope:</em> {c.scopeNote}</p>{/if}
			{#if c.example?.length}<p><em>Example:</em> {c.example.join('; ')}</p>{/if}
			{#if c.replacedBy}<p><em>Replaced by:</em> {labelOf(c.replacedBy)}</p>{/if}
			{#each node.children as child (child.iri)}{@render entry(child)}{/each}
		</section>
	{/if}
{/snippet}

{#if !scheme}
	<p role="alert">This scheme was not found. It may have been deleted, or the link is incomplete.</p>
{:else}
	<article class="scheme">
		<h1>{scheme.metadata?.title || schemeDisplayName(scheme)}</h1>
		{#if scheme.description}<p class="lead">{scheme.description}</p>{/if}
		{#if meta.length}
			<dl class="meta">
				{#each meta as [label, value] (label)}<dt>{label}</dt><dd>{value}</dd>{/each}
			</dl>
		{/if}
		{#if onOpenConcept}
			<div class="graph-toggle no-print">
				<button type="button" onclick={() => (showGraph = !showGraph)}>{showGraph ? 'Hide graph' : 'Show graph'}</button>
			</div>
			{#if showGraph}
				<TaxonomyGraph {concepts} schemes={[scheme]} schemeIri={scheme.iri} onOpen={onOpenConcept} />
			{/if}
		{/if}
		<h2>Terms</h2>
		{#each tree as node (node.iri)}{@render entry(node)}{/each}
		{#if schemeCollections.length}
			<h2>Collections</h2>
			<ul>
				{#each schemeCollections as col (col.iri)}
					<li>{collectionLabel(col)}: {col.members.filter((m) => inScheme.has(m)).map(labelOf).join(', ')}</li>
				{/each}
			</ul>
		{/if}
	</article>
{/if}

<style>
	.graph-toggle {
		margin: 1rem 0 0.5rem;
	}

	@media print {
		.no-print {
			display: none;
		}
	}

	.scheme {
		max-width: 48rem;
	}

	h1 {
		font-size: 1.5rem;
		margin: 0 0 0.25rem;
	}

	h2 {
		font-size: 1.15rem;
		margin: 1.5rem 0 0.5rem;
	}

	h3 {
		font-size: 1rem;
		margin: 0;
	}

	.deprecated {
		text-decoration: line-through;
	}

	.lead,
	.also {
		color: var(--color-text-muted);
	}

	.meta {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.2rem 1rem;
		margin: 0.5rem 0;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		margin: 0;
	}

	.concept {
		margin: 0.6rem 0 0 1.25rem;
	}

	.concept p {
		margin: 0.15rem 0;
	}

	@media print {
		h2,
		h3 {
			break-after: avoid;
		}

		.concept p {
			break-inside: avoid;
		}
	}
</style>
