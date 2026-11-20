<script lang="ts">
	/** Dialog that adds one related or mapped concept (concept-edit STORY-478). Apply closes it only on success;
	 *  a validation message or a failed write keeps it open. Cancel discards the input. */
	import Modal from './Modal.svelte';
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
		isOpen: boolean;
		concept: Concept;
		/** Every concept of the vocabulary. */
		concepts: Concept[];
		/** The registered external vocabularies, offered as mapping targets. */
		externals: FetchedExternalVocabulary[];
		onAdd: (kind: RelationKind, target: string, rationale: string) => Promise<void>;
		onClose: () => void;
	}

	let { isOpen, concept, concepts, externals, onAdd, onClose }: Props = $props();

	let kind = $state<RelationKind>('related');
	let relatedTarget = $state('');
	let vocabularyBase = $state('');
	let term = $state('');
	let rationale = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	// Every opening starts empty.
	$effect(() => {
		if (!isOpen) return;
		kind = 'related';
		relatedTarget = '';
		vocabularyBase = '';
		term = '';
		rationale = '';
		error = null;
		busy = false;
	});

	const relations = $derived(relationsOf(concept, concepts));
	const candidates = $derived(
		concepts.filter((c) => c.iri !== concept.iri && c.status !== 'retired' && !relations.related.includes(c.iri))
	);

	async function apply(event: SubmitEvent) {
		event.preventDefault();
		const target = isMappingKind(kind) ? composeMappingTarget(vocabularyBase, term) : relatedTarget;
		const problem = validateRelation(concepts, concept.iri, kind, target);
		if (problem) {
			error = problem;
			return;
		}
		busy = true;
		error = null;
		try {
			await onAdd(kind, target.trim(), rationale);
			onClose();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<Modal {isOpen} title="Add relation" {onClose} dismissible={false}>
	<form onsubmit={apply} novalidate>
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
		<RationaleField bind:value={rationale} />
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={onClose} disabled={busy}>Cancel</button>
			<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving…' : 'Apply'}</button>
		</div>
	</form>
</Modal>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input,
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
