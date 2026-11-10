<script lang="ts">
	/** Content of the deprecation dialog (ontology-pipeline STORY-323): reason, optional replacement and
	 *  the offer to keep the old term findable as a hidden label on the replacement (book pp. 51, 135).
	 *  The page hosts it in a `Modal`. Deprecating never deletes. */
	import { conceptTitle, validateStatusChange, type Concept } from '#lib/services/skos-concept.js';

	interface Props {
		concept: Concept;
		/** Every concept of the vocabulary; the dialog filters out unsuitable replacements. */
		candidates: Concept[];
		onConfirm: (choice: { reason: string; replacedBy: string; moveLabel: boolean }) => Promise<void>;
		onCancel: () => void;
	}

	let { concept, candidates, onConfirm, onCancel }: Props = $props();

	let reason = $state('');
	let replacedBy = $state('');
	let moveLabel = $state(true);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const replacements = $derived(
		candidates.filter((c) => c.iri !== concept.iri && c.status !== 'retired' && c.status !== 'deprecated')
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const problem = validateStatusChange(concept.status, 'deprecated', { reason, replacedBy });
		// The lifecycle step itself is the page's concern; only the reason and replacement are checked here.
		if (problem && !/cannot go from/.test(problem)) {
			error = problem;
			return;
		}
		error = null;
		busy = true;
		try {
			await onConfirm({ reason: reason.trim(), replacedBy, moveLabel: replacedBy !== '' && moveLabel });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<p>Deprecating <strong>{conceptTitle(concept)}</strong> keeps it and everything that points to it. It stays visible, marked deprecated, until it is retired.</p>
	<label>
		Reason
		<textarea bind:value={reason} rows="2" placeholder="Why is the term no longer to be used?"></textarea>
	</label>
	<label>
		Replaced by
		<select bind:value={replacedBy}>
			<option value="">(no replacement)</option>
			{#each replacements as candidate (candidate.iri)}
				<option value={candidate.iri}>{conceptTitle(candidate)}</option>
			{/each}
		</select>
	</label>
	{#if replacedBy}
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={moveLabel} />
			Add the old preferred label as a hidden label on the replacement, so a search for it still finds the new concept
		</label>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={busy}>Cancel</button>
		<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving…' : 'Deprecate'}</button>
	</div>
</form>

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

	textarea,
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.checkbox-label {
		flex-direction: row;
		align-items: flex-start;
		gap: 0.5rem;
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
