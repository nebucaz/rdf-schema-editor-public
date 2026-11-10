<script lang="ts">
	/** One concept as a reader sees it (ontology-pipeline STORY-335): label, status, definition, hierarchy,
	 *  related concepts and mappings. Presentational and read-only: it renders no control. */
	import { relationsOf } from '#lib/services/concept-relations.js';
	import { conceptTitle, type Concept } from '#lib/services/skos-concept.js';

	interface Props {
		concept: Concept;
		/** The whole vocabulary, to name the concepts this one points to. */
		concepts: Concept[];
		schemeName?: string;
	}

	let { concept, concepts, schemeName = '' }: Props = $props();

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
		{#if schemeName}in {schemeName}{/if}
		{#if concept.topConcept}<span class="hint">(top concept)</span>{/if}
	</p>
	<dl>
		<dt>Definition</dt>
		<dd>{concept.definition || '—'}</dd>
		{#if concept.scopeNote}<dt>Scope note</dt><dd>{concept.scopeNote}</dd>{/if}
		{#if concept.altLabels.length}
			<dt>Also called</dt>
			<dd>{#each concept.altLabels as l, i (l.text + l.lang)}{#if i > 0}, {/if}<span>{l.text}</span>{/each}</dd>
		{/if}
		{#if concept.broader?.length}
			<dt>Broader</dt>
			<dd>{#each concept.broader as iri, i (iri)}{#if i > 0}, {/if}<span>{titleOf(iri)}</span>{/each}</dd>
		{/if}
		{#if narrower.length}
			<dt>Narrower</dt>
			<dd>{#each narrower as c, i (c.iri)}{#if i > 0}, {/if}<span>{conceptTitle(c)}</span>{/each}</dd>
		{/if}
		{#if relations.related.length}
			<dt>Related</dt>
			<dd>{#each relations.related as iri, i (iri)}{#if i > 0}, {/if}<span>{titleOf(iri)}</span>{/each}</dd>
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
				{#if concept.replacedBy} · replaced by <span>{titleOf(concept.replacedBy)}</span>{/if}
			</dd>
		{/if}
	</dl>
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
