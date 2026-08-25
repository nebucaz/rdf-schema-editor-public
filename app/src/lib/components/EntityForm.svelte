<script lang="ts">
	import ColorSwatchPicker from './ColorSwatchPicker.svelte';
	import type { FetchedNamespace } from '$lib/services/sparql-connector';

	interface Props {
		mode?: 'create' | 'edit';
		iri?: string;
		initialName?: string;
		initialDescription?: string;
		initialColor?: string;
		namespaceOptions?: FetchedNamespace[];
		initialNamespaceBaseIri?: string;
		submitLabel: string;
		onSubmit: (
			name: string,
			description: string,
			color: string | undefined,
			namespaceBaseIri?: string
		) => Promise<void>;
		onCancel: () => void;
	}

	let {
		mode = 'create',
		iri,
		initialName = '',
		initialDescription = '',
		initialColor,
		namespaceOptions = [],
		initialNamespaceBaseIri = '',
		submitLabel,
		onSubmit,
		onCancel
	}: Props = $props();

	let name = $state(initialName);
	let description = $state(initialDescription);
	let color = $state<string | undefined>(initialColor);
	let namespaceBaseIri = $state(initialNamespaceBaseIri);
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
			await onSubmit(name.trim(), description.trim(), color, mode === 'create' ? namespaceBaseIri : undefined);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	{#if mode === 'edit' && iri}
		<label>
			IRI
			<input type="text" class="iri" value={iri} readonly title={iri} />
		</label>
	{/if}
	<label>
		Name
		<input type="text" bind:value={name} placeholder="e.g. Person" />
	</label>
	<label>
		Description
		<textarea bind:value={description} placeholder="Optional description" rows="3"></textarea>
	</label>
	<label>
		Color
		<ColorSwatchPicker {color} onChange={(c) => (color = c)} />
	</label>
	{#if mode === 'create' && namespaceOptions.length > 0}
		<label>
			Namespace
			<select bind:value={namespaceBaseIri}>
				{#each namespaceOptions as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix}</option>
				{/each}
			</select>
		</label>
	{/if}
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

	input,
	textarea,
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	input.iri {
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
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
