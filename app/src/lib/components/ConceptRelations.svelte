<script lang="ts">
	/** Related concepts and mappings to other schemes on the concept page (ontology-pipeline STORY-329). Lists the
	 *  relations with a remove button each, and adds one at a time after `validateRelation`; the page writes them. */
	import RationaleField from './RationaleField.svelte';
	import {
		RELATION_KINDS,
		composeMappingTarget,
		isMappingKind,
		relationsOf,
		validateRelation
	} from '#lib/services/concept-relations.js';
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

	let kind = $state<RelationKind>('related');
	let relatedTarget = $state('');
	let vocabularyBase = $state('');
	let term = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	const relations = $derived(relationsOf(concept, concepts));
	const titleOf = (iri: string) => {
		const c = concepts.find((x) => x.iri === iri);
		return c ? conceptTitle(c) : iri;
	};
	const candidates = $derived(
		concepts.filter((c) => c.iri !== concept.iri && c.status !== 'retired' && !relations.related.includes(c.iri))
	);

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

	async function add(event: SubmitEvent) {
		event.preventDefault();
		const target = isMappingKind(kind) ? composeMappingTarget(vocabularyBase, term) : relatedTarget;
		const problem = validateRelation(concepts, concept.iri, kind, target);
		if (problem) {
			error = problem;
			return;
		}
		await run(async () => {
			await onAdd(kind, target.trim());
			relatedTarget = '';
			term = '';
		});
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

	<form onsubmit={add} novalidate>
		<label>
			Relation
			<select bind:value={kind}>
				{#each RELATION_KINDS as k (k)}
					<option value={k}>{k}</option>
				{/each}
			</select>
		</label>
		{#if isMappingKind(kind)}
			<label>
				Vocabulary
				<select bind:value={vocabularyBase}>
					<option value="">(enter a full IRI)</option>
					{#each externals as ext (ext.baseIri)}
						<option value={ext.baseIri}>{ext.prefix}</option>
					{/each}
				</select>
			</label>
			<label>
				Term or IRI
				<input type="text" bind:value={term} />
			</label>
		{:else}
			<label>
				Related concept
				<select bind:value={relatedTarget}>
					<option value="">(choose)</option>
					{#each candidates as c (c.iri)}
						<option value={c.iri}>{conceptTitle(c)}</option>
					{/each}
				</select>
			</label>
		{/if}
		<button type="submit" disabled={busy}>Add relation</button>
	</form>
	<RationaleField bind:value={rationale} />
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

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

	form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.6rem;
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

	button {
		padding: 0.4rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
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
