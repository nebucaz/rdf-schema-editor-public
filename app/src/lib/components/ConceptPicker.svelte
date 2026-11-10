<script lang="ts">
	/** Picks the vocabulary concept that defines a class (ontology-pipeline STORY-325). While no concept is
	 *  linked it offers a search over the vocabulary, and, given the name being typed for a new class,
	 *  concepts that already match it. Once linked it shows the concept's definition read-only, since the
	 *  definition is stored once, in the vocabulary. */
	import {
		conceptTitle,
		filterConcepts,
		findSimilarConcepts,
		type Concept
	} from '#lib/services/skos-concept.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		concepts: Concept[];
		/** IRI of the linked concept, or empty. */
		value: string;
		/** The class name typed so far; matching concepts are suggested while nothing is linked. */
		suggestFor?: string;
		onChange: (conceptIri: string) => void;
	}

	let { concepts, value, suggestFor = '', onChange }: Props = $props();

	let search = $state('');

	const usable = $derived(concepts.filter((c) => c.status !== 'retired'));
	const linked = $derived(concepts.find((c) => c.iri === value) ?? null);
	const matches = $derived(search.trim() ? filterConcepts(usable, { search }) : []);
	const suggestions = $derived(
		value ? [] : findSimilarConcepts(suggestFor, usable).flatMap((m) => usable.filter((c) => c.iri === m.iri))
	);
	/** A live replacement for the linked concept when that one is deprecated or retired. */
	const replacement = $derived.by(() => {
		if (!linked || (linked.status !== 'deprecated' && linked.status !== 'retired') || !linked.replacedBy) return null;
		const next = concepts.find((c) => c.iri === linked.replacedBy);
		return next && next.status !== 'deprecated' && next.status !== 'retired' ? next : null;
	});
	const localName = (iri: string) => iri.split(/[#/]/).pop() ?? iri;

	function pick(iri: string) {
		search = '';
		onChange(iri);
	}
</script>

<div class="picker">
	{#if value}
		<div class="linked">
			<p class="title">
				Defined by <strong>{linked ? conceptTitle(linked) : localName(value)}</strong>
				{#if linked && (linked.status === 'deprecated' || linked.status === 'retired')}<span class="hint">({linked.status})</span>{/if}
			</p>
			{#if linked}
				<p class="definition">{linked.definition || 'This concept has no definition yet.'}</p>
			{/if}
			{#if replacement}
				<p class="replacement">
					Replaced by <strong>{conceptTitle(replacement)}</strong>.
					<button type="button" class="link" onclick={() => pick(replacement.iri)}>Retarget to {conceptTitle(replacement)}</button>
				</p>
			{/if}
			<p class="links">
				<a href={appUrl(`/vocabulary?concept=${encodeURIComponent(value)}`)}>Open in Vocabulary</a>
				<button type="button" class="link" onclick={() => pick('')}>Remove link</button>
			</p>
		</div>
	{:else}
		{#if suggestions.length}
			<div class="suggestions" role="status">
				<p>Existing concepts that match this name. Link one instead of writing a second definition:</p>
				<ul>
					{#each suggestions as s (s.iri)}
						<li>
							<span>{conceptTitle(s)}</span>
							<button type="button" class="link" onclick={() => pick(s.iri)} aria-label="Use {conceptTitle(s)}">Use</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<label>
			Defined by concept
			<input type="search" bind:value={search} placeholder="Search the vocabulary" autocomplete="off" />
		</label>
		{#if search.trim()}
			{#if matches.length}
				<ul class="results" role="listbox" aria-label="Matching concepts">
					{#each matches as m (m.iri)}
						<li>
							<button type="button" role="option" aria-selected="false" onclick={() => pick(m.iri)}>{conceptTitle(m)}</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">No matching concept.</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	p {
		margin: 0;
		font-size: 0.85rem;
	}

	.linked,
	.suggestions {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.definition {
		color: var(--color-text-muted);
		margin: 0.25rem 0;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	ul {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
	}

	.suggestions li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.results button {
		width: 100%;
		text-align: left;
		padding: 0.35rem 0.5rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
	}

	.results button:hover {
		background: var(--color-hover);
	}

	.links {
		display: flex;
		gap: 0.75rem;
	}

	.link {
		background: none;
		border: none;
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}
</style>
