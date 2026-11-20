<script lang="ts">
	import { reviewConceptUrl } from '#lib/services/review-links.js';
	/** The glossary as a reader sees it (skos-support STORY-425): search, a tree and an A-Z list of the same concepts,
	 *  and a detail panel. Presentational and read-only. Hidden labels are matched by the search but never rendered,
	 *  and neither are editorial notes. */
	import { relationsOf } from '#lib/services/concept-relations.js';
	import { alphabeticalList, glossaryLabel, glossaryTree, searchGlossary } from '#lib/services/glossary-search.js';
	import type { SkosCollection } from '#lib/services/skos-collection.js';
	import { primaryText, type Concept } from '#lib/services/skos-concept.js';
	import type { TaxonomyNode } from '#lib/services/taxonomy-tree.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface LinkedClass {
		iri: string;
		label: string;
		definedByConcept?: string;
	}
	interface Props {
		concepts: Concept[];
		collections?: SkosCollection[];
		classes?: LinkedClass[];
		lang?: string;
	}

	let { concepts, collections = [], classes = [], lang = 'en' }: Props = $props();

	let query = $state('');
	let view = $state<'list' | 'tree'>('list');
	let selectedIri = $state<string | null>(null);

	const matches = $derived(searchGlossary(concepts, query));
	const list = $derived(alphabeticalList(matches, lang));
	const tree = $derived(glossaryTree(concepts, matches));
	const selected = $derived(concepts.find((c) => c.iri === selectedIri) ?? null);
	const labelOf = (iri: string) => {
		const c = concepts.find((x) => x.iri === iri);
		return c ? glossaryLabel(c, lang) : (iri.split(/[#/]/).pop() ?? iri);
	};
	const relations = $derived(selected ? relationsOf(selected, concepts) : null);
	const narrower = $derived(selected ? concepts.filter((c) => c.broader?.includes(selected.iri)) : []);
	const inCollections = $derived(selected ? collections.filter((col) => col.members.includes(selected.iri)) : []);
	const linkedClasses = $derived(selected ? classes.filter((k) => k.definedByConcept === selected.iri) : []);
	const isDeprecated = (c: Concept) => c.status === 'deprecated' || c.status === 'retired';
	const collectionLabel = (col: SkosCollection) => col.prefLabels.find((l) => l.lang === lang)?.text ?? col.prefLabels[0]?.text ?? col.iri;
</script>

{#snippet branch(nodes: TaxonomyNode[])}
	<ul role="group">
		{#each nodes as node (node.iri + node.depth + node.label)}
			{@const c = concepts.find((x) => x.iri === node.iri)}
			<li role="none">
				<button type="button" role="treeitem" aria-selected={selectedIri === node.iri} class:deprecated={c && isDeprecated(c)} onclick={() => (selectedIri = node.iri)}>
					{c ? glossaryLabel(c, lang) : node.label}
				</button>
				{#if node.children.length}{@render branch(node.children)}{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="glossary">
	<div class="browse">
		<input type="search" placeholder="Search terms" aria-label="Search terms" bind:value={query} />
		<div class="views">
			<button type="button" aria-pressed={view === 'list'} onclick={() => (view = 'list')}>A–Z</button>
			<button type="button" aria-pressed={view === 'tree'} onclick={() => (view = 'tree')}>Tree</button>
		</div>
		{#if matches.length === 0}
			<p class="hint">No term matches.</p>
		{:else if view === 'list'}
			<ul class="az">
				{#each list as c (c.iri)}
					<li>
						<button type="button" class:deprecated={isDeprecated(c)} aria-current={selectedIri === c.iri} onclick={() => (selectedIri = c.iri)}>
							{glossaryLabel(c, lang)}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<div role="tree">{@render branch(tree)}</div>
		{/if}
	</div>

	<article class="detail">
		{#if selected}
			<h2 class:deprecated={isDeprecated(selected)}>
				{glossaryLabel(selected, lang)}
				<a class="share" href={reviewConceptUrl(selected.iri)} title="Page of this term to share" aria-label="Page of this term to share">
					<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
						<line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
					</svg>
				</a>
			</h2>
			{#if selected.altLabels.length}
				<p class="hint">Also called: {selected.altLabels.map((l) => l.text).join(', ')}</p>
			{/if}
			<dl>
				<dt>Definition</dt>
				<dd>{primaryText(selected.definitions, lang) || '—'}</dd>
				{#if primaryText(selected.scopeNotes, lang)}<dt>Scope note</dt><dd>{primaryText(selected.scopeNotes, lang)}</dd>{/if}
				{#if selected.example?.length}<dt>Examples</dt><dd>{selected.example.join('; ')}</dd>{/if}
				{#if selected.broader?.length}
					<dt>Broader</dt>
					<dd>{#each selected.broader as iri, i (iri)}{#if i > 0}, {/if}<button type="button" class="link" onclick={() => (selectedIri = iri)}>{labelOf(iri)}</button>{/each}</dd>
				{/if}
				{#if narrower.length}
					<dt>Narrower</dt>
					<dd>{#each narrower as c, i (c.iri)}{#if i > 0}, {/if}<button type="button" class="link" onclick={() => (selectedIri = c.iri)}>{glossaryLabel(c, lang)}</button>{/each}</dd>
				{/if}
				{#if relations?.related.length}
					<dt>Related</dt>
					<dd>{#each relations.related as iri, i (iri)}{#if i > 0}, {/if}<button type="button" class="link" onclick={() => (selectedIri = iri)}>{labelOf(iri)}</button>{/each}</dd>
				{/if}
				{#each relations?.mappings ?? [] as m (m.kind + m.target)}
					<dt>{m.kind}</dt>
					<dd>{m.target}</dd>
				{/each}
				{#if inCollections.length}
					<dt>Collections</dt>
					<dd>{inCollections.map(collectionLabel).join(', ')}</dd>
				{/if}
				{#if linkedClasses.length}
					<dt>Used by classes</dt>
					<dd>{#each linkedClasses as k, i (k.iri)}{#if i > 0}, {/if}<a href={appUrl(`/?focus=${encodeURIComponent(k.iri)}`)}>{k.label}</a>{/each}</dd>
				{/if}
				{#if isDeprecated(selected)}
					<dt>Deprecated</dt>
					<dd>
						{selected.deprecationReason}
						{#if selected.replacedBy} · replaced by <button type="button" class="link" onclick={() => (selectedIri = selected.replacedBy)}>{labelOf(selected.replacedBy)}</button>{/if}
					</dd>
				{/if}
			</dl>
		{:else}
			<p class="hint">Select a term to read its definition.</p>
		{/if}
	</article>
</div>

<style>
	.glossary {
		display: grid;
		grid-template-columns: minmax(14rem, 22rem) 1fr;
		gap: 1.5rem;
	}

	.browse ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.browse ul[role='group'] {
		padding-left: 1rem;
	}

	input[type='search'] {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: 0.5rem;
	}

	.views {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.views button[aria-pressed='true'] {
		font-weight: 600;
	}

	.browse li > button,
	.link {
		background: none;
		border: none;
		padding: 0.1rem 0;
		color: inherit;
		cursor: pointer;
		text-align: left;
		font: inherit;
	}

	.share {
		color: var(--color-text-muted);
		margin-left: 0.4rem;
		vertical-align: middle;
	}

	.link {
		text-decoration: underline;
	}

	.deprecated {
		text-decoration: line-through;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	h2 {
		margin: 0 0 0.25rem;
		font-size: 1.3rem;
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
