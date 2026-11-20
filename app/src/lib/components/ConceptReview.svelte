<script lang="ts">
	/** One concept as a reader sees it (ontology-pipeline STORY-335): label, status, definition, hierarchy,
	 *  related concepts, mappings and the neighbourhood graph. Presentational and read-only: it renders links to other read-only pages, no control. */
	import { relationsOf } from '#lib/services/concept-relations.js';
	import { reviewConceptUrl } from '#lib/services/review-links.js';
	import { conceptTitle, primaryText, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';
	import ConceptNeighborhood from './ConceptNeighborhood.svelte';

	interface Props {
		concept: Concept;
		/** The whole vocabulary, to name the concepts this one points to. */
		concepts: Concept[];
		schemeName?: string;
		/** The read-only page of the concept's scheme, when it can be linked. */
		schemeHref?: string;
		/** The schemes, so a concept without a broader concept shows its scheme in the graph. */
		schemes?: ConceptScheme[];
		/** The read-only page of a scheme by its IRI. */
		schemeUrl?: (schemeIri: string) => string;
	}

	let { concept, concepts, schemeName = '', schemeHref = '', schemes = [], schemeUrl }: Props = $props();

	const titleOf = (iri: string) => {
		const c = concepts.find((x) => x.iri === iri);
		return c ? conceptTitle(c) : (iri.split(/[#/]/).pop() ?? iri);
	};
	const relations = $derived(relationsOf(concept, concepts));
	const narrower = $derived(concepts.filter((c) => c.broader?.includes(concept.iri)));
</script>

<article class="concept">
	<h2>{conceptTitle(concept)}</h2>
	<p class="status-line">
		<span class="badge">{concept.status}</span>
		{#if schemeName}in {#if schemeHref}<a href={schemeHref}>{schemeName}</a>{:else}{schemeName}{/if}{/if}
		{#if concept.topConcept}<span class="hint">(top concept)</span>{/if}
	</p>
	<dl>
		<dt>Definition</dt>
		<dd>{primaryText(concept.definitions) || '—'}</dd>
		{#if primaryText(concept.scopeNotes)}<dt>Scope note</dt><dd>{primaryText(concept.scopeNotes)}</dd>{/if}
		{#if concept.example?.length}
			<dt>Examples</dt>
			<dd>{#each concept.example as e, i (e + i)}{#if i > 0}; {/if}<span>{e}</span>{/each}</dd>
		{/if}
		{#if concept.altLabels.length}
			<dt>Also called</dt>
			<dd>{#each concept.altLabels as l, i (l.text + l.lang)}{#if i > 0}, {/if}<span>{l.text}</span>{/each}</dd>
		{/if}
		{#if concept.broader?.length}
			<dt>Broader</dt>
			<dd>{#each concept.broader as iri, i (iri)}{#if i > 0}, {/if}<a href={reviewConceptUrl(iri)}>{titleOf(iri)}</a>{/each}</dd>
		{/if}
		{#if narrower.length}
			<dt>Narrower</dt>
			<dd>{#each narrower as c, i (c.iri)}{#if i > 0}, {/if}<a href={reviewConceptUrl(c.iri)}>{conceptTitle(c)}</a>{/each}</dd>
		{/if}
		{#if relations.related.length}
			<dt>Related</dt>
			<dd>{#each relations.related as iri, i (iri)}{#if i > 0}, {/if}<a href={reviewConceptUrl(iri)}>{titleOf(iri)}</a>{/each}</dd>
		{/if}
		{#each relations.mappings as m (m.kind + m.target)}
			<dt>{m.kind}</dt>
			<dd>{m.target}</dd>
		{/each}
		{#if concept.source || concept.authority}
			<dt>Source</dt>
			<dd>{[concept.source, concept.authority].filter(Boolean).join(' · ')}</dd>
		{/if}
		{#if concept.status === 'deprecated' || concept.status === 'retired'}
			<dt>Deprecated</dt>
			<dd>
				{concept.deprecationReason}{#if concept.deprecatedOn} ({concept.deprecatedOn}){/if}
				{#if concept.replacedBy} · replaced by <a href={reviewConceptUrl(concept.replacedBy)}>{titleOf(concept.replacedBy)}</a>{/if}
			</dd>
		{/if}
	</dl>
	<ConceptNeighborhood {concepts} iri={concept.iri} href={reviewConceptUrl} {schemes} schemeHref={schemeUrl} />
</article>

<style>
	.concept {
		max-width: 48rem;
	}

	h2 {
		margin: 0 0 0.25rem;
		font-size: 1.3rem;
	}

	.status-line {
		margin: 0 0 1rem;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.badge {
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0 0.5rem;
		font-size: 0.78rem;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.4rem 1rem;
		margin: 0;
	}

	dt {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
