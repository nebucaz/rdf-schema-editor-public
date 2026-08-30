<script lang="ts">
	interface Props {
		targetName: string;
		submitLabel: string;
		/** Existing declared relation predicates (data-catalog Story 019/021's
		 *  `fetchRelationPredicateOptions`) offered as a typeahead — picking one by name reuses its
		 *  real IRI (generic or domain/range-specific) instead of minting a new generic predicate. */
		predicateOptions?: { iri: string; label: string }[];
		onSubmit: (relationName: string) => Promise<void>;
		onCancel: () => void;
	}

	let { targetName, submitLabel, predicateOptions = [], onSubmit, onCancel }: Props = $props();

	let name = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Name must not be empty';
			return;
		}
		error = null;
		submitting = true;
		try {
			await onSubmit(name.trim());
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	<label>
		Relation name
		<input type="text" bind:value={name} list="individual-relation-names" placeholder="e.g. isAuthorityFor" />
		<datalist id="individual-relation-names">
			{#each predicateOptions as p (p.iri)}
				<option value={p.label}></option>
			{/each}
		</datalist>
	</label>
	<div class="field">
		<span class="field-label">Target</span>
		<span class="static-value">{targetName}</span>
	</div>
	{#if error}
		<p class="error">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={submitting}>Cancel</button>
		<button type="submit" class="primary" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input[type='text'] {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.static-value {
		font-size: 0.95rem;
		color: var(--color-text);
		padding: 0.5rem 0.65rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
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

	.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-hover);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
