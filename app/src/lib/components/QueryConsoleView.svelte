<script lang="ts">
	import { onMount } from 'svelte';
	import {
		sparqlConnector,
		type SparqlSelectResults,
		type FetchedSavedQuery
	} from '$lib/services/sparql-connector';
	import { detectQueryForm } from '$lib/utils/sparql-query-form';
	import ResultsTable from './ResultsTable.svelte';

	/** Kept as `$state` (not local to a run function) so the saved-queries panel below can read
	 *  from and write into it — "Run" loads a saved query's text then executes, "Edit" loads it
	 *  without running. */
	let queryText = $state('');

	let running = $state(false);
	let queryError = $state<string | null>(null);
	let selectResults = $state<SparqlSelectResults | null>(null);
	let askResult = $state<boolean | null>(null);

	async function handleRun() {
		const form = detectQueryForm(queryText);
		queryError = null;
		selectResults = null;
		askResult = null;

		if (form === 'unsupported') {
			queryError = 'Only SELECT and ASK queries are supported in this console.';
			return;
		}

		running = true;
		try {
			if (form === 'select') {
				selectResults = await sparqlConnector.selectQuery(queryText);
			} else {
				askResult = await sparqlConnector.askQuery(queryText);
			}
		} catch (err) {
			queryError = err instanceof Error ? err.message : 'Query failed';
		} finally {
			running = false;
		}
	}

	// -- Saved queries (STORY-088) --------------------------------------------------------------

	let savedQueries = $state<FetchedSavedQuery[]>([]);
	let savedQueriesLoadError = $state<string | null>(null);

	/** IRI of the SavedQuery currently loaded via "Edit", or `null` when the console holds a fresh
	 *  or just-Run query. Only "Edit" sets it; only Running/Editing a *different* saved query or
	 *  deleting the tracked one clears it — ordinary typing to tweak the loaded text does not, since
	 *  that's exactly the tweak-then-"Update" flow this flag exists to support. */
	let editingIri = $state<string | null>(null);

	let showSaveForm = $state(false);
	let saveFormMode = $state<'create' | 'update'>('create');
	let saveName = $state('');
	let saveDescription = $state('');
	let saveError = $state<string | null>(null);
	let saveBusy = $state(false);

	let deleteTarget = $state<FetchedSavedQuery | null>(null);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);

	onMount(() => {
		void loadSavedQueries();
	});

	async function loadSavedQueries() {
		savedQueriesLoadError = null;
		try {
			savedQueries = await sparqlConnector.fetchSavedQueries();
		} catch (err) {
			savedQueriesLoadError = err instanceof Error ? err.message : 'Failed to load saved queries';
		}
	}

	function openSaveAsForm() {
		saveFormMode = 'create';
		saveName = '';
		saveDescription = '';
		saveError = null;
		showSaveForm = true;
	}

	function openUpdateForm() {
		if (!editingIri) return;
		const target = savedQueries.find((sq) => sq.iri === editingIri);
		saveFormMode = 'update';
		saveName = target?.label ?? '';
		saveDescription = target?.description ?? '';
		saveError = null;
		showSaveForm = true;
	}

	async function handleSaveFormSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!queryText.trim()) {
			saveError = 'Query text must not be empty';
			return;
		}
		if (!saveName.trim()) {
			saveError = 'Name must not be empty';
			return;
		}
		saveError = null;
		saveBusy = true;
		try {
			if (saveFormMode === 'create') {
				// Always mints a new SavedQuery, even when `editingIri` is set — Save as… never
				// silently overwrites the query currently being edited (plan ADR: saved-query delete
				// row / research §8).
				await sparqlConnector.insertSavedQuery(saveName.trim(), queryText, saveDescription || undefined);
			} else if (editingIri) {
				const target = savedQueries.find((sq) => sq.iri === editingIri);
				await sparqlConnector.updateSavedQueryText(editingIri, queryText);
				if (target && saveName.trim() !== target.label) {
					await sparqlConnector.renameSavedQuery(editingIri, saveName.trim());
				}
				if (target && saveDescription.trim() !== target.description) {
					await sparqlConnector.updateSavedQueryDescription(editingIri, saveDescription || null);
				}
			}
			await loadSavedQueries();
			showSaveForm = false;
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save query';
		} finally {
			saveBusy = false;
		}
	}

	async function handleRowRun(sq: FetchedSavedQuery) {
		queryText = sq.sparqlText;
		editingIri = null;
		showSaveForm = false;
		await handleRun();
	}

	function handleRowEdit(sq: FetchedSavedQuery) {
		queryText = sq.sparqlText;
		editingIri = sq.iri;
		queryError = null;
		selectResults = null;
		askResult = null;
		showSaveForm = false;
	}

	function requestDeleteSaved(sq: FetchedSavedQuery) {
		deleteTarget = sq;
		deleteError = null;
	}

	function cancelDeleteSaved() {
		deleteTarget = null;
		deleteError = null;
	}

	async function handleDeleteSavedConfirm() {
		if (!deleteTarget) return;
		const target = deleteTarget;
		deleteBusy = true;
		deleteError = null;
		try {
			await sparqlConnector.deleteSavedQuery(target.iri);
			if (editingIri === target.iri) editingIri = null;
			await loadSavedQueries();
			deleteTarget = null;
		} catch (err) {
			deleteError = err instanceof Error ? err.message : 'Failed to delete saved query';
		} finally {
			deleteBusy = false;
		}
	}
</script>

<div class="query-console">
	<textarea
		bind:value={queryText}
		placeholder={'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 20'}
		spellcheck="false"
		rows="8"
	></textarea>

	<div class="actions">
		<button type="button" class="primary" onclick={() => void handleRun()} disabled={running}>
			{running ? 'Running…' : 'Run'}
		</button>
		<button type="button" class="secondary" onclick={openSaveAsForm}>Save as…</button>
		{#if editingIri}
			<button type="button" class="secondary" onclick={openUpdateForm}>Update</button>
		{/if}
	</div>

	{#if showSaveForm}
		<form class="save-form" onsubmit={(e) => void handleSaveFormSubmit(e)}>
			<label>
				Name
				<input type="text" bind:value={saveName} placeholder="e.g. Undocumented Classes" />
			</label>
			<label>
				Description (optional)
				<input type="text" bind:value={saveDescription} placeholder="What this query finds" />
			</label>
			{#if saveError}
				<p class="error">{saveError}</p>
			{/if}
			<div class="actions">
				<button type="button" class="secondary" onclick={() => (showSaveForm = false)} disabled={saveBusy}>
					Cancel
				</button>
				<button type="submit" class="primary" disabled={saveBusy}>
					{saveBusy ? 'Saving…' : saveFormMode === 'create' ? 'Save as…' : 'Update'}
				</button>
			</div>
		</form>
	{/if}

	{#if queryError}
		<p class="error">{queryError}</p>
	{:else if askResult !== null}
		<p class="ask-result">
			<span class="ask-badge" class:true={askResult} class:false={!askResult}
				>{askResult ? 'true' : 'false'}</span
			>
		</p>
	{:else if selectResults}
		<ResultsTable results={selectResults} />
	{/if}

	<div class="saved-queries">
		<h3>Saved Queries</h3>
		{#if savedQueriesLoadError}
			<p class="error">{savedQueriesLoadError}</p>
		{:else if deleteTarget}
			{@const target = deleteTarget}
			<div class="delete-confirm">
				<p>Delete saved query <strong>{target.label}</strong>?</p>
				{#if deleteError}
					<p class="error">{deleteError}</p>
				{/if}
				<div class="actions">
					<button type="button" class="secondary" onclick={cancelDeleteSaved} disabled={deleteBusy}>
						Cancel
					</button>
					<button
						type="button"
						class="danger"
						onclick={() => void handleDeleteSavedConfirm()}
						disabled={deleteBusy}
					>
						{deleteBusy ? 'Deleting…' : 'Delete'}
					</button>
				</div>
			</div>
		{:else}
			<ul>
				{#each savedQueries as sq (sq.iri)}
					<li class:editing={sq.iri === editingIri}>
						<div class="saved-query-info">
							<span class="saved-query-name">{sq.label}</span>
							{#if sq.description}
								<span class="saved-query-description">{sq.description}</span>
							{/if}
						</div>
						<span class="saved-query-actions">
							<button type="button" class="text-button" onclick={() => void handleRowRun(sq)}>Run</button>
							<button type="button" class="text-button" onclick={() => handleRowEdit(sq)}>Edit</button>
							<button type="button" class="text-button" onclick={() => requestDeleteSaved(sq)}>Delete</button>
						</span>
					</li>
				{:else}
					<li class="empty">No saved queries yet.</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.query-console {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	textarea {
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.85rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.65rem;
		resize: vertical;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.primary,
	.secondary,
	.danger {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
		border: none;
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

	.danger {
		background: var(--color-error);
		color: #fff;
		border: none;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
		margin: 0;
	}

	.save-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}

	.save-form label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.save-form input {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.saved-queries h3 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted);
	}

	.saved-queries ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.saved-queries li {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.saved-queries li:first-child {
		border-top: none;
	}

	.saved-queries li.editing {
		background: var(--color-hover);
	}

	.saved-queries li.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.saved-query-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.saved-query-name {
		font-weight: 600;
	}

	.saved-query-description {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.saved-query-actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.text-button {
		padding: 0.2rem 0.4rem;
		font-size: 0.8rem;
		color: var(--color-accent);
		background: transparent;
		border: none;
		border-radius: 4px;
	}

	.text-button:hover {
		background: var(--color-hover);
	}

	.delete-confirm p {
		font-size: 0.9rem;
		color: var(--color-text);
		margin: 0 0 0.75rem;
	}

	.ask-result {
		margin: 0;
	}

	.ask-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		border-radius: 4px;
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.ask-badge.true {
		background: var(--color-success-bg);
		color: var(--color-success);
	}

	.ask-badge.false {
		background: var(--color-error-bg);
		color: var(--color-error);
	}
</style>
