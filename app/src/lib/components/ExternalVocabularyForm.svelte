<script lang="ts">
	interface Props {
		submitLabel: string;
		onSubmit: (values: { prefix: string; baseIri: string }) => Promise<void>;
		onCancel: () => void;
	}

	let { submitLabel, onSubmit, onCancel }: Props = $props();

	let prefix = $state('');
	let baseIri = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!prefix.trim()) {
			error = 'Prefix must not be empty';
			return;
		}
		if (!baseIri.trim()) {
			error = 'Base IRI must not be empty';
			return;
		}
		error = null;
		submitting = true;
		try {
			await onSubmit({ prefix: prefix.trim(), baseIri: baseIri.trim() });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	<label>
		Prefix
		<input type="text" bind:value={prefix} placeholder="e.g. gist" />
	</label>
	<label>
		Base IRI
		<input type="text" bind:value={baseIri} placeholder="e.g. https://ontologies.semanticarts.com/gist/" />
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

	input {
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
