<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector, type FetchedNamespace } from '$lib/services/sparql-connector';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import NamespaceForm from './NamespaceForm.svelte';

	let loadError = $state<string | null>(null);

	let showAddForm = $state(false);
	let editTarget = $state<FetchedNamespace | null>(null);
	let deleteTarget = $state<FetchedNamespace | null>(null);
	let deleteEntryCount = $state<number | null>(null);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);

	onMount(async () => {
		await refresh();
	});

	async function refresh() {
		loadError = null;
		try {
			await namespaceStore.refresh();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load namespaces';
		}
	}

	async function handleAddSubmit(values: {
		prefix: string;
		baseIri: string;
		description: string;
		color: string | undefined;
		publisher: string;
		license: string;
	}) {
		await sparqlConnector.insertNamespace(
			values.prefix,
			values.baseIri,
			values.description || undefined,
			values.color,
			values.publisher || undefined,
			values.license || undefined
		);
		await namespaceStore.refresh();
		showAddForm = false;
	}

	async function handleEditSubmit(
		target: FetchedNamespace,
		values: { description: string; color: string | undefined; publisher: string; license: string }
	) {
		await sparqlConnector.updateNamespaceDescription(target.baseIri, values.description || null);
		await sparqlConnector.updateNamespaceColor(target.baseIri, values.color ?? null);
		await sparqlConnector.updateNamespacePublisher(target.baseIri, values.publisher || null);
		await sparqlConnector.updateNamespaceLicense(target.baseIri, values.license || null);
		await namespaceStore.refresh();
		editTarget = null;
	}

	function requestDelete(ns: FetchedNamespace) {
		deleteTarget = ns;
		deleteEntryCount = null;
		deleteError = null;
	}

	function cancelDelete() {
		deleteTarget = null;
		deleteEntryCount = null;
		deleteError = null;
	}

	async function handleDeleteConfirm(force: boolean) {
		if (!deleteTarget) return;
		const target = deleteTarget;
		deleteBusy = true;
		deleteError = null;
		try {
			const result = await sparqlConnector.deleteNamespace(target.baseIri, { force });
			if (!result.deleted) {
				deleteEntryCount = result.entryCount;
				return;
			}
			await namespaceStore.refresh();
			deleteTarget = null;
			deleteEntryCount = null;
		} catch (err) {
			deleteError = err instanceof Error ? err.message : 'Failed to delete namespace';
		} finally {
			deleteBusy = false;
		}
	}
</script>

{#if showAddForm}
	<NamespaceForm mode="create" submitLabel="Create" onCancel={() => (showAddForm = false)} onSubmit={handleAddSubmit} />
{:else if editTarget}
	{@const target = editTarget}
	<NamespaceForm
		mode="edit"
		initialPrefix={target.prefix}
		initialBaseIri={target.baseIri}
		initialDescription={target.description ?? ''}
		initialColor={target.color ?? undefined}
		initialPublisher={target.publisher ?? ''}
		initialLicense={target.license ?? ''}
		submitLabel="Save"
		onCancel={() => (editTarget = null)}
		onSubmit={(values) => handleEditSubmit(target, values)}
	/>
{:else if deleteTarget}
	{@const target = deleteTarget}
	<div class="delete-confirm">
		{#if deleteEntryCount !== null && deleteEntryCount > 0}
			<p>
				<strong>{target.prefix}</strong> (<code>{target.baseIri}</code>) still has
				{deleteEntryCount} triple(s) across its graphs. Deleting it will drop all of them.
			</p>
			{#if deleteError}
				<p class="error">{deleteError}</p>
			{/if}
			<div class="actions">
				<button type="button" class="secondary" onclick={cancelDelete} disabled={deleteBusy}>Cancel</button>
				<button type="button" class="danger" onclick={() => handleDeleteConfirm(true)} disabled={deleteBusy}>
					{deleteBusy ? 'Deleting…' : 'Delete Anyway'}
				</button>
			</div>
		{:else}
			<p>Delete namespace <strong>{target.prefix}</strong> (<code>{target.baseIri}</code>)? This cannot be undone.</p>
			{#if deleteError}
				<p class="error">{deleteError}</p>
			{/if}
			<div class="actions">
				<button type="button" class="secondary" onclick={cancelDelete} disabled={deleteBusy}>Cancel</button>
				<button type="button" class="danger" onclick={() => handleDeleteConfirm(false)} disabled={deleteBusy}>
					{deleteBusy ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		{/if}
	</div>
{:else if namespaceStore.loading}
	<p class="status">Loading namespaces…</p>
{:else if loadError}
	<p class="error">{loadError}</p>
{:else}
	<ul class="namespaces">
		{#each namespaceStore.namespaces as ns (ns.baseIri)}
			<li>
				<div class="namespace-info">
					<span class="namespace-prefix">
						{#if ns.color}
							<span class="namespace-color-dot" style={`background-color: ${ns.color}`}></span>
						{/if}
						{ns.prefix}
					</span>
					<span class="namespace-iri">{ns.baseIri}</span>
					{#if ns.description}
						<span class="namespace-description">{ns.description}</span>
					{/if}
				</div>
				<span class="namespace-actions">
					<button
						class="icon-button"
						onclick={() => (editTarget = ns)}
						aria-label={`Edit ${ns.prefix}`}
						title="Edit"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
					</button>
					<button
						class="icon-button"
						onclick={() => requestDelete(ns)}
						aria-label={`Delete ${ns.prefix}`}
						title="Delete"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					</button>
				</span>
			</li>
		{:else}
			<li class="empty">No namespaces yet.</li>
		{/each}
	</ul>

	<button type="button" class="add-namespace" onclick={() => (showAddForm = true)}>+ Add namespace</button>
{/if}

<style>
	.namespaces {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.namespaces li {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.namespaces li:first-child {
		border-top: none;
	}

	.namespaces li.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.namespace-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.namespace-prefix {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-weight: 600;
	}

	.namespace-color-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
		border: 1px solid var(--color-border);
	}

	.namespace-iri {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.namespace-description {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.namespace-actions {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
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
	}

	.icon-button:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.add-namespace {
		width: 100%;
		padding: 0.5rem 0;
		text-align: center;
		font-size: 0.85rem;
		color: var(--color-accent);
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		background: transparent;
	}

	.add-namespace:hover {
		background: var(--color-hover);
	}

	.status {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.delete-confirm p {
		font-size: 0.9rem;
		color: var(--color-text);
		margin: 0 0 0.75rem;
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

	.actions button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-hover);
	}

	.danger {
		background: var(--color-error);
		color: #fff;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
