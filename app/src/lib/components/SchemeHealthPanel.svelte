<script lang="ts">
	/** Scheme health (skos-support STORY-422): per scheme, the structural metrics and the concepts concerned,
	 *  each with an Open link. Read-only and advisory; computed from what the page already loaded. */
	import type { SchemeHealth } from '#lib/services/scheme-health.js';
	import { conceptTitle, type Concept } from '#lib/services/skos-concept.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		reports: SchemeHealth[];
		concepts: Concept[];
		/** Scheme names by IRI; the local name of the IRI is used for a scheme not listed. */
		schemeNames?: Record<string, string>;
	}

	let { reports, concepts, schemeNames = {} }: Props = $props();

	const titles = $derived(new Map(concepts.map((c) => [c.iri, conceptTitle(c)])));
	const title = (iri: string) => titles.get(iri) ?? iri.split(/[#/]/).pop() ?? iri;
	const open = (iri: string) => appUrl(`/vocabulary?concept=${encodeURIComponent(iri)}`);
	const nameOf = (iri: string) => (iri === '' ? 'No scheme' : (schemeNames[iri] ?? iri.split(/[#/]/).pop() ?? iri));
	const num = (n: number) => (Math.round(n * 100) / 100).toString();
</script>

<section class="health" aria-label="Scheme health">
	{#if reports.length === 0}
		<p class="empty">No concepts to analyse.</p>
	{/if}
	{#each reports as r (r.schemeIri)}
		<article>
			<h3>{nameOf(r.schemeIri)}</h3>
			<dl>
				<div data-testid="metric-concepts"><dt>Concepts</dt><dd>{r.conceptCount}</dd></div>
				<div data-testid="metric-orphans"><dt>Orphans</dt><dd>{r.orphans.length}</dd></div>
				<div data-testid="metric-clusters"><dt>Clusters</dt><dd>{r.clusters.length}</dd></div>
				<div data-testid="metric-depth"><dt>Average depth</dt><dd>{num(r.averageDepth)}</dd></div>
				<div data-testid="metric-branching"><dt>Average branching</dt><dd>{num(r.averageBranching)}</dd></div>
			</dl>
			{#each [{ id: 'orphans', label: 'Orphan concepts', items: r.orphans }, { id: 'withoutRelation', label: 'Concepts without any relation', items: r.withoutRelation }, { id: 'polyhierarchy', label: 'More than one broader concept', items: r.polyhierarchy }] as list (list.id)}
				{#if list.items.length}
					<h4>{list.label}</h4>
					<ul data-testid={`list-${list.id}`}>
						{#each list.items as iri (iri)}
							<li><a href={open(iri)}>{title(iri)}</a></li>
						{/each}
					</ul>
				{/if}
			{/each}
			{#if r.clusters.length > 1}
				<h4>Disconnected clusters</h4>
				<ul data-testid="list-clusters">
					{#each r.clusters as cluster (cluster[0])}
						<li>{cluster.length} {cluster.length === 1 ? 'concept' : 'concepts'}: {#each cluster.slice(0, 5) as iri, i (iri)}{i ? ', ' : ''}<a href={open(iri)}>{title(iri)}</a>{/each}{cluster.length > 5 ? ', …' : ''}</li>
					{/each}
				</ul>
			{/if}
			{#if r.transitiveRelated.length}
				<h4>Related only through the hierarchy</h4>
				<ul data-testid="list-transitive">
					{#each r.transitiveRelated as [a, b] (a + b)}
						<li><a href={open(a)}>{title(a)}</a> and <a href={open(b)}>{title(b)}</a></li>
					{/each}
				</ul>
			{/if}
			{#if r.undefinedReferences.length}
				<h4>References to unknown concepts</h4>
				<ul data-testid="list-undefined">
					{#each r.undefinedReferences as u (u.concept + u.target)}
						<li><a href={open(u.concept)}>{title(u.concept)}</a> → {u.target}</li>
					{/each}
				</ul>
			{/if}
		</article>
	{/each}
</section>

<style>
	.health {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	article {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface);
		padding: 0.75rem 1rem;
	}
	h3,
	h4 {
		margin: 0.25rem 0;
	}
	h4 {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}
	dl {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 0;
	}
	dl div {
		display: flex;
		flex-direction: column;
	}
	dt {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	dd {
		margin: 0;
		font-weight: 600;
	}
	ul {
		margin: 0;
		padding-left: 1.25rem;
	}
	a {
		color: var(--color-accent);
	}
	.empty {
		color: var(--color-text-muted);
	}
</style>
