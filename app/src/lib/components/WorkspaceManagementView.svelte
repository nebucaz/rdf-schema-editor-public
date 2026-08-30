<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector, type FetchedWorkspace } from '$lib/services/sparql-connector';
	import { workspaceStore } from '$lib/stores/workspace-store.svelte';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { workbenchActions } from '$lib/stores/workbench-actions.svelte';
	import { extractLocalName } from '$lib/utils/iri';

	let loadError = $state<string | null>(null);

	let showAddForm = $state(false);
	let newName = $state('');
	let newDefaultNamespace = $state('');
	let createError = $state<string | null>(null);
	let createBusy = $state(false);

	let editTarget = $state<FetchedWorkspace | null>(null);
	let editName = $state('');
	let editDefaultNamespace = $state('');
	let editError = $state<string | null>(null);
	let editBusy = $state(false);

	let deleteTarget = $state<FetchedWorkspace | null>(null);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);

	onMount(async () => {
		loadError = null;
		try {
			await workspaceStore.refresh();
			await namespaceStore.ensureLoaded();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load workspaces';
		}
	});

	function labelOf(ws: FetchedWorkspace): string {
		return ws.label || extractLocalName(ws.iri);
	}

	function startCreate() {
		showAddForm = true;
		newName = '';
		newDefaultNamespace = '';
		createError = null;
	}

	async function handleCreateSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!newName.trim()) {
			createError = 'Name must not be empty';
			return;
		}
		createError = null;
		createBusy = true;
		try {
			const iri = await sparqlConnector.insertWorkspace(newName.trim(), newDefaultNamespace || undefined);
			await workspaceStore.refresh();
			// Switch straight to the just-created Workspace — otherwise it only sits in the list as an
			// option the user has to notice and pick themselves, which is what read as "can't be
			// selected" (the navbar `<select>` needs a full page reload to visibly re-sync its options).
			workbenchActions.setActiveWorkspace(iri);
			showAddForm = false;
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Failed to create workspace';
		} finally {
			createBusy = false;
		}
	}

	function startEdit(ws: FetchedWorkspace) {
		editTarget = ws;
		editName = labelOf(ws);
		editDefaultNamespace = ws.defaultNamespaceBaseIri ?? '';
		editError = null;
	}

	async function handleEditSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!editTarget) return;
		if (!editName.trim()) {
			editError = 'Name must not be empty';
			return;
		}
		editError = null;
		editBusy = true;
		try {
			const target = editTarget;
			await sparqlConnector.renameWorkspace(target.iri, editName.trim());
			await sparqlConnector.updateWorkspaceDefaultNamespace(target.iri, editDefaultNamespace || null);
			await workspaceStore.refresh();
			editTarget = null;
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Failed to update workspace';
		} finally {
			editBusy = false;
		}
	}

	function requestDelete(ws: FetchedWorkspace) {
		deleteTarget = ws;
		deleteError = null;
	}

	function cancelDelete() {
		deleteTarget = null;
		deleteError = null;
	}

	/** Blocks deleting the only remaining Workspace client-side (research §10, resolved in the plan's
	 *  ADR: mirrors the "always require an active Workspace" rule) — `deleteWorkspace` itself has no
	 *  such guard, since nothing forces it to be the caller's responsibility except this UI. */
	async function handleDeleteConfirm() {
		if (!deleteTarget) return;
		const target = deleteTarget;
		deleteBusy = true;
		deleteError = null;
		try {
			await sparqlConnector.deleteWorkspace(target.iri);
			await workspaceStore.refresh();
			deleteTarget = null;
		} catch (err) {
			deleteError = err instanceof Error ? err.message : 'Failed to delete workspace';
		} finally {
			deleteBusy = false;
		}
	}

	function handleViewTriples(ws: FetchedWorkspace) {
		workbenchActions.triplesWorkspaceScope = { workspaceIri: ws.iri, label: labelOf(ws) };
	}
</script>

{#if showAddForm}
	<form onsubmit={handleCreateSubmit}>
		<label>
			Name
			<input type="text" bind:value={newName} placeholder="e.g. Onboarding Diagram" />
		</label>
		{#if namespaceStore.namespaces.length > 0}
			<label>
				Default namespace (optional)
				<select bind:value={newDefaultNamespace}>
					<option value="">— none —</option>
					{#each namespaceStore.namespaces as ns (ns.baseIri)}
						<option value={ns.baseIri}>{ns.prefix}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if createError}
			<p class="error">{createError}</p>
		{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={() => (showAddForm = false)} disabled={createBusy}>
				Cancel
			</button>
			<button type="submit" class="primary" disabled={createBusy}>{createBusy ? 'Creating…' : 'Create'}</button>
		</div>
	</form>
{:else if editTarget}
	<form onsubmit={handleEditSubmit}>
		<label>
			Name
			<input type="text" bind:value={editName} />
		</label>
		{#if namespaceStore.namespaces.length > 0}
			<label>
				Default namespace (optional)
				<select bind:value={editDefaultNamespace}>
					<option value="">— none —</option>
					{#each namespaceStore.namespaces as ns (ns.baseIri)}
						<option value={ns.baseIri}>{ns.prefix}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if editError}
			<p class="error">{editError}</p>
		{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={() => (editTarget = null)} disabled={editBusy}>
				Cancel
			</button>
			<button type="submit" class="primary" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</button>
		</div>
	</form>
{:else if deleteTarget}
	{@const target = deleteTarget}
	{@const isLast = workspaceStore.workspaces.length <= 1}
	<div class="delete-confirm">
		{#if isLast}
			<p>
				<strong>{labelOf(target)}</strong> is the only remaining Workspace and can't be deleted — the
				canvas always needs an active Workspace to show.
			</p>
			<div class="actions">
				<button type="button" class="secondary" onclick={cancelDelete}>Close</button>
			</div>
		{:else}
			<p>
				Delete workspace <strong>{labelOf(target)}</strong>? Its members' underlying classes/individuals
				are unaffected — only this Workspace and its membership rows are removed.
			</p>
			{#if deleteError}
				<p class="error">{deleteError}</p>
			{/if}
			<div class="actions">
				<button type="button" class="secondary" onclick={cancelDelete} disabled={deleteBusy}>Cancel</button>
				<button type="button" class="danger" onclick={handleDeleteConfirm} disabled={deleteBusy}>
					{deleteBusy ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		{/if}
	</div>
{:else if workspaceStore.loading}
	<p class="status">Loading workspaces…</p>
{:else if loadError}
	<p class="error">{loadError}</p>
{:else}
	<ul class="workspaces">
		{#each workspaceStore.workspaces as ws (ws.iri)}
			<li>
				<div class="workspace-info">
					<span class="workspace-name">{labelOf(ws)}</span>
					{#if ws.defaultNamespaceBaseIri}
						<span class="workspace-namespace">{ws.defaultNamespaceBaseIri}</span>
					{/if}
				</div>
				<span class="workspace-actions">
					<button
						class="icon-button"
						onclick={() => handleViewTriples(ws)}
						aria-label={`View triples for ${labelOf(ws)}`}
						title="View triples"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>
					</button>
					<button class="icon-button" onclick={() => startEdit(ws)} aria-label={`Edit ${labelOf(ws)}`} title="Edit">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
					</button>
					<button
						class="icon-button"
						onclick={() => requestDelete(ws)}
						aria-label={`Delete ${labelOf(ws)}`}
						title="Delete"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					</button>
				</span>
			</li>
		{:else}
			<li class="empty">No workspaces yet.</li>
		{/each}
	</ul>

	<button type="button" class="add-workspace" onclick={startCreate}>+ Add workspace</button>
{/if}

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
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.workspaces {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.workspaces li {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.workspaces li:first-child {
		border-top: none;
	}

	.workspaces li.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.workspace-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.workspace-name {
		font-weight: 600;
	}

	.workspace-namespace {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.workspace-actions {
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

	.add-workspace {
		width: 100%;
		padding: 0.5rem 0;
		text-align: center;
		font-size: 0.85rem;
		color: var(--color-accent);
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		background: transparent;
	}

	.add-workspace:hover {
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

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
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
