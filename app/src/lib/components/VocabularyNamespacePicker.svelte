<script lang="ts">
	/** Empty state of `/vocabulary` (ontology-pipeline STORY-323): no namespace is marked as the
	 *  vocabulary namespace yet, so pick one here instead of hunting for the checkbox in the namespace
	 *  dialog (which does the same through `updateNamespaceVocabulary`). */
	import type { FetchedNamespace } from '#lib/services/sparql-connector.js';

	interface Props {
		namespaces: FetchedNamespace[];
		onMark: (baseIri: string) => Promise<void>;
	}

	let { namespaces, onMark }: Props = $props();

	// Seeded once; the user changes it with the select.
	/* svelte-ignore state_referenced_locally */
	let chosen = $state(namespaces[0]?.baseIri ?? '');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function mark() {
		busy = true;
		error = null;
		try {
			await onMark(chosen);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<section class="picker">
	<h2>No vocabulary namespace yet</h2>
	<p>
		Terms are kept in one core namespace, in a graph of their own, apart from the model. Choose the namespace that
		should hold them. Only one namespace can; you can change it later in the namespace settings.
	</p>
	<label>
		Namespace
		<select bind:value={chosen} disabled={namespaces.length === 0}>
			{#each namespaces as ns (ns.baseIri)}
				<option value={ns.baseIri}>{ns.prefix || ns.baseIri}</option>
			{/each}
		</select>
	</label>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<button type="button" onclick={mark} disabled={busy || !chosen}>Use as vocabulary namespace</button>
</section>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 36rem;
	}

	h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	p {
		margin: 0;
		color: var(--color-text-muted);
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

	.error {
		color: var(--color-error);
	}

	button {
		align-self: flex-start;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		background: var(--color-accent);
		color: #fff;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
