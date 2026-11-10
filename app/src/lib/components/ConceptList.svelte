<script lang="ts">
	/** Searchable, filterable list of concepts (ontology-pipeline STORY-323). Filtering is the pure
	 *  `filterConcepts`; the list only holds the filter inputs. */
	import type { GateFinding } from '#lib/services/gates/types.js';
	import {
		CONCEPT_STATUSES,
		conceptTitle,
		filterConcepts,
		type Concept,
		type ConceptScheme,
		type ConceptStatus
	} from '#lib/services/skos-concept.js';

	interface Props {
		concepts: Concept[];
		schemes: ConceptScheme[];
		selectedIri?: string | null;
		/** Vocabulary gate findings; each concept shows how many are about it. */
		findings?: GateFinding[];
		onSelect: (iri: string) => void;
	}

	let { concepts, schemes, selectedIri = null, findings = [], onSelect }: Props = $props();

	let search = $state('');
	let status = $state<ConceptStatus | ''>('');
	let schemeIri = $state('');

	const findingCount = $derived(
		findings.reduce((m, f) => m.set(f.elementIri, (m.get(f.elementIri) ?? 0) + 1), new Map<string, number>())
	);

	const shown = $derived(
		filterConcepts(concepts, { search, status: status || undefined, schemeIri: schemeIri || undefined })
	);
</script>

<div class="filters">
	<label>
		Search
		<input type="search" bind:value={search} placeholder="Label, synonym or definition" />
	</label>
	<label>
		Status
		<select bind:value={status}>
			<option value="">All</option>
			{#each CONCEPT_STATUSES as s (s)}
				<option value={s}>{s}</option>
			{/each}
		</select>
	</label>
	<label>
		Scheme
		<select bind:value={schemeIri}>
			<option value="">All</option>
			{#each schemes as scheme (scheme.iri)}
				<option value={scheme.iri}>{scheme.name}</option>
			{/each}
		</select>
	</label>
</div>

{#if concepts.length === 0}
	<p class="empty">No concepts yet. Add the first term of the vocabulary.</p>
{:else if shown.length === 0}
	<p class="empty">No concepts match.</p>
{:else}
	<ul class="concepts">
		{#each shown as concept (concept.iri)}
			<li>
				<button
					type="button"
					class:selected={concept.iri === selectedIri}
					aria-current={concept.iri === selectedIri ? 'true' : undefined}
					onclick={() => onSelect(concept.iri)}
				>
					<span class="title" class:muted={concept.status === 'deprecated' || concept.status === 'retired'}>{conceptTitle(concept)}</span>
					<span class="status status-{concept.status}">{concept.status}</span>
					{#if findingCount.get(concept.iri)}
						{@const n = findingCount.get(concept.iri)}
						<span class="findings" aria-label="{n} finding{n === 1 ? '' : 's'}">{n}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	input,
	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	.concepts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	li button {
		width: 100%;
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		text-align: left;
		padding: 0.5rem 0.65rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		font-size: 0.92rem;
		cursor: pointer;
	}

	li button:hover {
		background: var(--color-hover);
	}

	li button.selected {
		background: var(--color-hover);
		font-weight: 600;
	}

	.muted {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}

	.findings {
		min-width: 1.2rem;
		text-align: center;
		font-size: 0.75rem;
		border: 1px solid var(--color-error);
		color: var(--color-error);
		border-radius: 999px;
		padding: 0 0.3rem;
	}

	.status {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.empty {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
</style>
