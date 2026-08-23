<script lang="ts">
	import { resolvePrefixedName, EXTERNAL_PREFIXES } from '$lib/utils/iri';

	interface Props {
		onSubmit: (prefixedName: string, iri: string) => void;
		onCancel: () => void;
	}

	let { onSubmit, onCancel }: Props = $props();

	let value = $state('');
	let error = $state<string | null>(null);

	const resolved = $derived(resolvePrefixedName(value));
	const knownPrefixes = Object.keys(EXTERNAL_PREFIXES).join(', ');

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const result = resolvePrefixedName(value);
		if (!result) {
			error = `Enter a prefixed name using a known prefix (${knownPrefixes}), e.g. "schema:Organization"`;
			return;
		}
		error = null;
		onSubmit(value.trim(), result.iri);
	}
</script>

<form onsubmit={handleSubmit}>
	<label>
		Prefixed name
		<input type="text" bind:value placeholder="e.g. schema:Organization" />
	</label>
	{#if resolved}
		<p class="hint">Resolves to <code>{resolved.iri}</code></p>
	{:else}
		<p class="hint">Known prefixes: {knownPrefixes}</p>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel}>Cancel</button>
		<button type="submit" class="primary">Add</button>
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

	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: -0.5rem 0 0;
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

	.primary:hover {
		background: var(--color-accent-hover);
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary:hover {
		background: var(--color-hover);
	}
</style>
