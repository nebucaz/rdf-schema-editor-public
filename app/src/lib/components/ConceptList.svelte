<script lang="ts">
	/** The rows of one page of concepts (ontology-pipeline STORY-323, reshaped by vocabulary-graph-and-tabs STORY-448).
	 *  Searching, filtering and paging happen on the server and in `VocabularyConceptsTab`; the list only shows the
	 *  rows it is given, each with its status and scheme name. */
	import type { GateFinding } from '#lib/services/gates/types.js';
	import { conceptTitle, schemeDisplayName, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';

	interface Props {
		concepts: Concept[];
		schemes: ConceptScheme[];
		selectedIri?: string | null;
		/** Vocabulary gate findings; each concept shows how many are about it. */
		findings?: GateFinding[];
		onSelect: (iri: string) => void;
	}

	let { concepts, schemes, selectedIri = null, findings = [], onSelect }: Props = $props();

	const findingCount = $derived(
		findings.reduce((m, f) => m.set(f.elementIri, (m.get(f.elementIri) ?? 0) + 1), new Map<string, number>())
	);
	const schemeName = $derived(new Map(schemes.map((sc) => [sc.iri, schemeDisplayName(sc)])));
</script>

<ul class="concepts">
	{#each concepts as concept (concept.iri)}
		<li>
			<button
				type="button"
				class:selected={concept.iri === selectedIri}
				aria-current={concept.iri === selectedIri ? 'true' : undefined}
				onclick={() => onSelect(concept.iri)}
			>
				<span class="title" class:muted={concept.status === 'deprecated' || concept.status === 'retired'}>{conceptTitle(concept)}</span>
				<span class="meta">
					<span class="status status-{concept.status}">{concept.status}</span>
					<span class="scheme">{concept.schemeIri ? (schemeName.get(concept.schemeIri) ?? schemeDisplayName({ iri: concept.schemeIri, name: '' })) : 'No scheme'}</span>
					{#if findingCount.get(concept.iri)}
						{@const n = findingCount.get(concept.iri)}
						<span class="findings" aria-label="{n} finding{n === 1 ? '' : 's'}">{n}</span>
					{/if}
				</span>
			</button>
		</li>
	{/each}
</ul>

<style>
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

	.meta {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		white-space: nowrap;
	}

	.scheme {
		font-size: 0.75rem;
		color: var(--color-text-muted);
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
</style>
