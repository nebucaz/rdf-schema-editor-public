<script lang="ts">
	import { XSD_DATATYPES, type XsdDatatype } from '$lib/utils/iri';

	interface Props {
		initialName?: string;
		initialDatatype?: XsdDatatype;
		initialRequired?: boolean;
		initialRepeatable?: boolean;
		submitLabel: string;
		onSubmit: (
			name: string,
			datatype: XsdDatatype,
			required: boolean,
			repeatable: boolean
		) => Promise<void>;
		onCancel: () => void;
	}

	let {
		initialName = '',
		initialDatatype = 'string',
		initialRequired = false,
		initialRepeatable = false,
		submitLabel,
		onSubmit,
		onCancel
	}: Props = $props();

	let name = $state(initialName);
	let datatype = $state<XsdDatatype>(initialDatatype);
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
		error = null;
		submitting = true;
		try {
			await onSubmit(name.trim(), datatype, required, repeatable);
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
		<input type="text" bind:value={name} placeholder="e.g. birthDate" />
	</label>
	<label>
		Datatype
		<select bind:value={datatype}>
			{#each XSD_DATATYPES as dt (dt)}
				<option value={dt}>{dt}</option>
			{/each}
		</select>
	</label>
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
