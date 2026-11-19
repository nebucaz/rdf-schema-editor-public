<script lang="ts">
	/** Content of the "Merge into…" dialog (skos-support STORY-423); hosted in a `Modal` by the Vocabulary page.
	 *  Pick the surviving concept, read what moves, decide the conflicts, then merge. Nothing is written until Merge. */
	import { hasUnresolved, planMerge, type MergeDecisions, type MergePlan } from '#lib/services/concept-merge.js';
	import { conceptTitle, findSimilarConcepts, type Concept } from '#lib/services/skos-concept.js';
	import type { SkosCollection } from '#lib/services/skos-collection.js';

	interface Props {
		/** The concept that goes away (stays as a retired tombstone). */
		duplicate: Concept;
		concepts: Concept[];
		collections: SkosCollection[];
		/** Classes whose `rse:definedByConcept` is the duplicate. */
		classLinks: { classIri: string; label: string }[];
		onConfirm: (plan: MergePlan) => Promise<void>;
		onCancel: () => void;
	}

	let { duplicate, concepts, collections, classLinks, onConfirm, onCancel }: Props = $props();

	const candidates = $derived(
		concepts.filter((c) => c.iri !== duplicate.iri && (c.status === 'proposed' || c.status === 'approved' || c.status === 'active')).sort((a, b) => conceptTitle(a).localeCompare(conceptTitle(b)))
	);
	/* svelte-ignore state_referenced_locally */
	let survivor = $state(findSimilarConcepts(duplicate.prefLabels[0]?.text ?? '', concepts, { ignoreIri: duplicate.iri })[0]?.iri ?? '');
	let decisions = $state<MergeDecisions>({});
	let busy = $state(false);
	let error = $state<string | null>(null);

	const plan = $derived(survivor ? planMerge({ concepts, collections, classLinks, survivor, duplicate: duplicate.iri, decisions }) : null);
	const ready = $derived(plan !== null && plan.error === null && !hasUnresolved(plan));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!plan || !ready) return;
		busy = true;
		error = null;
		try {
			await onConfirm(plan);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit}>
	<p>
		Merge <strong>{conceptTitle(duplicate)}</strong> into another concept. Its labels, relations, collection memberships and
		class links move to the concept you keep. The old concept stays as a retired entry that points to it, so its IRI still resolves.
	</p>
	<label>
		Merge into
		<select bind:value={survivor} onchange={() => (decisions = {})}>
			<option value="">Choose the concept to keep…</option>
			{#each candidates as c (c.iri)}
				<option value={c.iri}>{conceptTitle(c)}</option>
			{/each}
		</select>
	</label>

	{#if plan?.error}
		<p class="error" role="alert">{plan.error}</p>
	{:else if plan}
		{#each plan.warnings as w (w)}
			<p class="warning" role="status">{w}</p>
		{/each}
		{#each plan.conflicts as conflict (conflict.field)}
			<fieldset>
				<legend>{conflict.field === 'definition' ? 'Two definitions' : 'Two notations'}: decide which stays</legend>
				{#if conflict.field === 'definition'}
					<label class="choice"><input type="radio" name="definition" checked={decisions.definition === 'survivor'} onchange={() => (decisions = { ...decisions, definition: 'survivor' })} /> Keep the survivor's definition<span class="quote">{conflict.survivor}</span></label>
					<label class="choice"><input type="radio" name="definition" checked={decisions.definition === 'duplicate'} onchange={() => (decisions = { ...decisions, definition: 'duplicate' })} /> Use the duplicate's definition<span class="quote">{conflict.duplicate}</span></label>
				{:else}
					<label class="choice"><input type="radio" name="notation" checked={decisions.notation === 'survivor'} onchange={() => (decisions = { ...decisions, notation: 'survivor' })} /> Keep the survivor's notation<span class="quote">{conflict.survivor}</span></label>
					<label class="choice"><input type="radio" name="notation" checked={decisions.notation === 'both'} onchange={() => (decisions = { ...decisions, notation: 'both' })} /> Keep both notations<span class="quote">{conflict.survivor}, {conflict.duplicate}</span></label>
				{/if}
			</fieldset>
		{/each}
		<h4>What moves</h4>
		{#if plan.moves.length}
			<ul aria-label="What moves">
				{#each plan.moves as m (m)}
					<li>{m}</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Nothing but the retirement of the duplicate.</p>
		{/if}
		{#if plan.dropped.length}
			<h4>Left out</h4>
			<ul aria-label="Left out">
				{#each plan.dropped as m (m)}
					<li>{m}</li>
				{/each}
			</ul>
		{/if}
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={busy}>Cancel</button>
		<button type="submit" class="primary" disabled={busy || !ready}>Merge</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	p,
	ul {
		margin: 0;
		font-size: 0.9rem;
	}
	ul {
		padding-left: 1.25rem;
	}
	h4 {
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}
	fieldset {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.choice {
		display: block;
		color: var(--color-text);
	}
	.quote {
		display: block;
		margin-left: 1.4rem;
		color: var(--color-text-muted);
	}
	.muted {
		color: var(--color-text-muted);
	}
	.warning {
		color: var(--color-warning);
		background: var(--color-warning-bg);
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
	}
	.error {
		color: var(--color-error);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	button {
		padding: 0.45rem 0.9rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}
	button.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
