<script lang="ts">
	interface Props {
		/** The concept schemes of the vocabulary namespace. */
		schemes: { iri: string; name: string }[];
		initialName?: string;
		initialSchemeIri?: string;
		initialRequired?: boolean;
		initialRepeatable?: boolean;
		submitLabel: string;
		onSubmit: (name: string, schemeIri: string, required: boolean, repeatable: boolean) => Promise<void>;
		onCancel: () => void;
	}

	let {
		schemes,
		initialName = '',
		initialSchemeIri = '',
		initialRequired = false,
		initialRepeatable = false,
		submitLabel,
		onSubmit,
		onCancel
	}: Props = $props();

	let name = $state(initialName);
	let schemeIri = $state(initialSchemeIri || schemes[0]?.iri || '');
	let required = $state(initialRequired);
	let repeatable = $state(initialRepeatable);
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Name must not be empty';
			return;
		}
		if (!schemeIri) {
			error = 'Choose a scheme';
			return;
		}
		error = null;
		submitting = true;
		try {
			await onSubmit(name.trim(), schemeIri, required, repeatable);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	<label>
		Name
		<input type="text" bind:value={name} placeholder="e.g. lifecycleStage" />
	</label>
	<label>
		Scheme
		<select bind:value={schemeIri}>
			{#each schemes as scheme (scheme.iri)}
				<option value={scheme.iri}>{scheme.name}</option>
			{/each}
		</select>
	</label>
	<p class="hint">Values must be concepts of this scheme. The validation report flags any other value.</p>
	<label class="checkbox">
		<input type="checkbox" bind:checked={required} />
		Required (sh:minCount 1)
	</label>
	<label class="checkbox">
		<input type="checkbox" bind:checked={repeatable} />
		Repeatable (allows multiple values)
	</label>
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

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	label.checkbox {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	input[type='text'],
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

	.hint {
		font-size: 0.78rem;
		color: var(--color-text-muted);
		opacity: 0.85;
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
