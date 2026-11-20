<script lang="ts">
	/** Related concepts and mappings to other schemes on the concept page (ontology-pipeline STORY-329). Lists the
	 *  relations with a remove button each, and opens `AddRelationModal` to add one (concept-edit STORY-478); the page writes them. */
	import AddRelationModal from './AddRelationModal.svelte';
	import RationaleField from './RationaleField.svelte';
	import { relationsOf } from '#lib/services/concept-relations.js';
	import { conceptTitle, type Concept, type RelationKind } from '#lib/services/skos-concept.js';
	import type { FetchedExternalVocabulary } from '#lib/services/sparql-connector.js';

	interface Props {
		concept: Concept;
		/** Every concept of the vocabulary. */
		concepts: Concept[];
		/** The registered external vocabularies, offered as mapping targets. */
		externals: FetchedExternalVocabulary[];
		onAdd: (kind: RelationKind, target: string) => Promise<void>;
		onRemove: (kind: RelationKind, target: string) => Promise<void>;
		/** Why the relation is added or removed; the page writes it to the change log. */
		rationale?: string;
	}

	let { concept, concepts, externals, onAdd, onRemove, rationale = $bindable('') }: Props = $props();

	let error = $state<string | null>(null);
	let busy = $state(false);
	let adding = $state(false);

	const relations = $derived(relationsOf(concept, concepts));
	const titleOf = (iri: string) => {
		const c = concepts.find((x) => x.iri === iri);
		return c ? conceptTitle(c) : iri;
	};
	async function run(action: () => Promise<void>) {
		busy = true;
		error = null;
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	/** The dialog hands over its rationale; the page reads it from the bound value when it writes. */
	async function add(kind: RelationKind, target: string, why: string) {
		rationale = why;
		await onAdd(kind, target);
	}
</script>

<section class="relations" aria-label="Relations">
	<h3>Related and mapped</h3>
	{#if relations.related.length === 0 && relations.mappings.length === 0}
		<p class="empty">No related concepts or mappings yet.</p>
	{:else}
		<ul>
			{#each relations.related as iri (iri)}
				<li>
					<code>skos:related</code>
					<span>{titleOf(iri)}</span>
					{#if concept.related?.includes(iri)}
						<button type="button" aria-label="Remove related {titleOf(iri)}" disabled={busy} onclick={() => run(() => onRemove('related', iri))}>Remove</button>
					{:else}
						<span class="hint">stated on {titleOf(iri)}</span>
					{/if}
				</li>
			{/each}
			{#each relations.mappings as m (`${m.kind}|${m.target}`)}
				<li>
					<code>skos:{m.kind}</code>
					<span>{m.target}</span>
					<button type="button" aria-label="Remove {m.kind} {m.target}" disabled={busy} onclick={() => run(() => onRemove(m.kind, m.target))}>Remove</button>
				</li>
			{/each}
		</ul>
	{/if}

	<button type="button" class="add" disabled={busy} onclick={() => (adding = true)}>Add relation</button>
	{#if relations.related.some((iri) => concept.related?.includes(iri)) || relations.mappings.length}
		<!-- Only removing needs it here; adding asks for its own rationale in the dialog. -->
		<RationaleField bind:value={rationale} />
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

<AddRelationModal isOpen={adding} {concept} {concepts} {externals} onAdd={add} onClose={() => (adding = false)} />

<style>
	h3 {
		font-size: 0.95rem;
		margin: 1rem 0 0.4rem;
	}

	ul {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
	}

	li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.9rem;
	}

	li span {
		flex: 1;
		overflow-wrap: anywhere;
	}

	button {
		padding: 0.4rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	.add {
		margin-bottom: 0.75rem;
	}

	.hint,
	.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}
</style>
