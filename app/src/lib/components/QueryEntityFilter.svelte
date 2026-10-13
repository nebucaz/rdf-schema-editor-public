<script lang="ts">
	/**
	 * STORY-190: related-entity filter. A typeahead over the existing individual search, narrowed to the
	 * hop's target class and its subclasses; picking a hit filters on that entity's IRI (never its label).
	 */
	import { sparqlConnector, type IndividualSearchResult } from '$lib/services/sparql-connector';

	interface Props {
		classIris: string[];
		onPick: (entity: { iri: string; label: string }) => void;
		onCancel: () => void;
	}

	let { classIris, onPick, onCancel }: Props = $props();

	let term = $state('');
	let results = $state<IndividualSearchResult[]>([]);
	let error = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	function onInput() {
		clearTimeout(timer);
		const q = term.trim();
		if (q === '') {
			results = [];
			return;
		}
		timer = setTimeout(async () => {
			const mine = ++seq;
			try {
				const page = await sparqlConnector.searchIndividuals({ query: q, classIris, limit: 10 });
				if (mine === seq) {
					results = page.results;
					error = null;
				}
			} catch (e) {
				if (mine === seq) error = e instanceof Error ? e.message : 'Search failed';
			}
		}, 250);
	}
</script>

<div class="entity-filter" data-testid="entity-filter">
	<input
		type="search"
		placeholder="Find an entity…"
		aria-label="Find an entity"
		bind:value={term}
		oninput={onInput}
	/>
	<button type="button" onclick={onCancel}>Cancel</button>
	{#if error}<span class="error" role="alert">{error}</span>{/if}
	{#if results.length > 0}
		<ul>
			{#each results as r (r.iri)}
				<li><button type="button" onclick={() => onPick({ iri: r.iri, label: r.label })}>{r.label}</button></li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.entity-filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	ul {
		flex-basis: 100%;
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.error {
		color: var(--color-danger, #b00020);
		font-size: 0.8rem;
	}
</style>
