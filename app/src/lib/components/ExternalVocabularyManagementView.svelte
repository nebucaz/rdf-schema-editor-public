<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector } from '$lib/services/sparql-connector';
	import { externalVocabStore } from '$lib/stores/external-vocab-store.svelte';
	import ExternalVocabularyForm from './ExternalVocabularyForm.svelte';

	let loadError = $state<string | null>(null);
	let showAddForm = $state(false);
	let deleteError = $state<string | null>(null);
	let deleteBusy = $state(false);

	onMount(async () => {
		await refresh();
	});

	async function refresh() {
		loadError = null;
		try {
			await externalVocabStore.refresh();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load external vocabularies';
		}
	}

	async function handleAddSubmit(values: { prefix: string; baseIri: string }) {
		await sparqlConnector.insertExternalVocabulary(values.prefix, values.baseIri);
		await externalVocabStore.refresh();
		showAddForm = false;
	}

	async function handleDelete(baseIri: string) {
		deleteBusy = true;
		deleteError = null;
		try {
			await sparqlConnector.deleteExternalVocabulary(baseIri);
			await externalVocabStore.refresh();
		} catch (err) {
			deleteError = err instanceof Error ? err.message : 'Failed to delete vocabulary';
		} finally {
			deleteBusy = false;
		}
	}
</script>

{#if showAddForm}
	<ExternalVocabularyForm submitLabel="Register" onCancel={() => (showAddForm = false)} onSubmit={handleAddSubmit} />
{:else if externalVocabStore.loading}
	<p class="status">Loading vocabularies…</p>
{:else if loadError}
	<p class="error">{loadError}</p>
{:else}
	{#if deleteError}
		<p class="error">{deleteError}</p>
	{/if}
	<ul class="vocabularies">
		{#each externalVocabStore.vocabularies as v (v.baseIri)}
			<li>
				<div class="vocab-info">
					<span class="vocab-prefix">{v.prefix}</span>
					<span class="vocab-iri">{v.baseIri}</span>
				</div>
				{#if v.builtIn}
					<span class="builtin-badge" title="Built into the app — cannot be removed">built-in</span>
				{:else}
					<button
						class="icon-button"
						onclick={() => handleDelete(v.baseIri)}
						aria-label={`Delete ${v.prefix}`}
						title="Delete"
						disabled={deleteBusy}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					</button>
				{/if}
			</li>
		{:else}
			<li class="empty">No vocabularies yet.</li>
		{/each}
	</ul>

	<button type="button" class="add-vocabulary" onclick={() => (showAddForm = true)}>+ Register vocabulary</button>
{/if}

<style>
	.vocabularies {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.vocabularies li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.vocabularies li:first-child {
		border-top: none;
	}

	.vocabularies li.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.vocab-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.vocab-prefix {
		font-weight: 600;
	}

	.vocab-iri {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.builtin-badge {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.1rem 0.4rem;
	}

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		min-height: 22px;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted);
		border: none;
		flex-shrink: 0;
	}

	.icon-button:hover:not(:disabled) {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.icon-button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.add-vocabulary {
		width: 100%;
		padding: 0.5rem 0;
		text-align: center;
		font-size: 0.85rem;
		color: var(--color-accent);
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		background: transparent;
	}

	.add-vocabulary:hover {
		background: var(--color-hover);
	}

	.status {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}
</style>
