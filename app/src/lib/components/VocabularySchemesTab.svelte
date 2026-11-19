<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	/** The Schemes tab of the Vocabulary page (spec/vocabulary-graph-and-tabs STORY-449): a searchable, paged list of
	 *  the concept schemes with their counts, Add scheme above the list, and the selected scheme's scope and metadata
	 *  forms and actions beside it. Counts come from the concepts the page already holds. */
	import PagedListShell from '#lib/components/PagedListShell.svelte';
	import SchemeScopeForm from '#lib/components/SchemeScopeForm.svelte';
	import { clampPage } from '#lib/services/list-paging.js';
	import { DEFAULT_LIST_STATE, patchListState, type ListUrlState } from '#lib/services/list-url-state.js';
	import { reviewSchemeUrl } from '#lib/services/review-links.js';
	import { schemeIdForIri } from '#lib/services/scheme-id.js';
	import { buildSchemeRows, filterSchemeRows } from '#lib/services/scheme-rows.js';
	import type { SchemeMetadata } from '#lib/services/scheme-metadata.js';
	import type { Concept, ConceptScheme, SchemeScope } from '#lib/services/skos-concept.js';
	import { appUrl } from '#lib/utils/urls.js';

	const PAGE_SIZE = 25;

	interface Props {
		core: string;
		schemes: ConceptScheme[];
		concepts: Concept[];
		listState: ListUrlState;
		onStateChange: (next: ListUrlState) => void;
		/** Creates the scheme and resolves with its IRI. */
		onAdd: (draft: { name: string; description: string }) => Promise<string>;
		onSaveScope: (schemeIri: string, scope: SchemeScope) => Promise<void>;
		onSaveMetadata: (schemeIri: string, metadata: SchemeMetadata) => Promise<void>;
		/** Without `force` a scheme with concepts or references is refused and what blocks it comes back. */
		onDelete: (
			schemeIri: string,
			force: boolean
		) => Promise<{ deleted: boolean; concepts: string[]; linkedClasses: string[]; conceptProperties: string[]; collections: string[] }>;
	}

	let { core, schemes, concepts, listState, onStateChange, onAdd, onSaveScope, onSaveMetadata, onDelete }: Props = $props();

	let selectedIri = $state<string | null>(null);
	let adding = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let error = $state<string | null>(null);

	const rows = $derived(filterSchemeRows(buildSchemeRows(schemes, concepts), listState.q));
	const page = $derived(clampPage(listState.page, Math.ceil(rows.length / PAGE_SIZE)));
	const visible = $derived(rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
	const selected = $derived(schemes.find((s) => s.iri === selectedIri) ?? null);
	const selectedRow = $derived(rows.find((r) => r.scheme.iri === selectedIri) ?? buildSchemeRows(schemes, concepts).find((r) => r.scheme.iri === selectedIri) ?? null);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!newName.trim()) return;
		error = null;
		try {
			selectedIri = await onAdd({ name: newName.trim(), description: newDescription.trim() });
			newName = '';
			newDescription = '';
			adding = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not add the scheme';
		}
	}

	let confirming = $state<{ iri: string; name: string; concepts: number; classes: number; properties: number; collections: number } | null>(null);
	let deleteError = $state<string | null>(null);

	async function remove(iri: string, force: boolean) {
		deleteError = null;
		try {
			const r = await onDelete(iri, force);
			if (r.deleted) {
				confirming = null;
				if (selectedIri === iri) selectedIri = null;
			} else {
				confirming = {
					iri,
					name: selectedRow?.name ?? iri,
					concepts: r.concepts.length,
					classes: r.linkedClasses.length,
					properties: r.conceptProperties.length,
					collections: r.collections.length
				};
			}
		} catch (e) {
			confirming = null;
			deleteError = e instanceof Error ? e.message : 'Could not delete the scheme';
		}
	}

	const openConcepts = (iri: string) =>
		onStateChange(patchListState({ ...DEFAULT_LIST_STATE }, { tab: 'concepts', scheme: iri }));
</script>

<div class="columns">
	<section class="list">
		<PagedListShell
			label="Schemes"
			total={rows.length}
			pageSize={PAGE_SIZE}
			page={listState.page}
			search={listState.q}
			onChange={(next) => onStateChange(patchListState(listState, { q: next.search, page: next.page }))}
		>
			{#snippet toolbar()}
				<button type="button" class="primary" onclick={() => (adding = !adding)} data-testid="add-scheme">Add scheme</button>
			{/snippet}
			<table>
				<thead>
					<tr><th>Scheme</th><th>Concepts</th><th>Top</th><th>Orphans</th><th>Modified</th></tr>
				</thead>
				<tbody>
					{#each visible as row (row.scheme.iri)}
						<tr class:selected={row.scheme.iri === selectedIri}>
							<td>
								<button type="button" class="link" aria-current={row.scheme.iri === selectedIri ? 'true' : undefined} onclick={() => (selectedIri = row.scheme.iri)}>{row.name}</button>
							</td>
							<td>{row.conceptCount}</td>
							<td>{row.topConceptCount}</td>
							<td>{row.orphanCount}</td>
							<td>{row.modified ? row.modified.slice(0, 10) : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</PagedListShell>
		{#if schemes.length === 0}
			<p class="empty">No scheme yet. A scheme groups concepts and records why the vocabulary exists.</p>
		{/if}

		<Modal isOpen={adding} title="Add scheme" onClose={() => (adding = false)}>
			<form class="add" onsubmit={create}>
				<label>
					Name
					<input type="text" bind:value={newName} placeholder="e.g. Business glossary" />
				</label>
				<label>
					Description
					<input type="text" bind:value={newDescription} />
				</label>
				<div class="buttons">
					<button type="submit" class="primary" disabled={!newName.trim()}>Create scheme</button>
					<button type="button" onclick={() => (adding = false)}>Cancel</button>
				</div>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
			</form>
		</Modal>
	</section>

	<section class="detail" aria-label="Scheme">
		{#if selected && selectedRow}
			<h2>{selectedRow.name}</h2>
			<p class="actions">
				<button type="button" onclick={() => openConcepts(selected.iri)} data-testid="scheme-open-concepts">Open concepts</button>
				<a href={appUrl(`/taxonomy?scheme=${encodeURIComponent(selected.iri)}`)} data-testid="scheme-taxonomy-link">Open taxonomy</a>
				<a href={reviewSchemeUrl(schemeIdForIri(selected.iri, core))} data-testid="scheme-review-link">Printable view to share</a>
				<button type="button" class="danger" onclick={() => remove(selected.iri, false)} data-testid="scheme-delete">Delete scheme</button>
			</p>
			{#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
			{#key selected.iri}
				<SchemeScopeForm
					scheme={selected}
					onSave={(scope) => onSaveScope(selected.iri, scope)}
					onSaveMetadata={(metadata) => onSaveMetadata(selected.iri, metadata)}
				/>
			{/key}
		{:else}
			<p class="empty">Select a scheme to see its scope, its metadata and what you can do with it.</p>
		{/if}
	</section>
</div>

<Modal isOpen={confirming !== null} title="Delete scheme" onClose={() => (confirming = null)}>
	{#if confirming}
		<p>
			Delete <strong>{confirming.name}</strong>? This also removes its {confirming.concepts} concept{confirming.concepts === 1 ? '' : 's'} and
			their links to other concepts.
		</p>
		<ul>
			{#if confirming.classes}<li>{confirming.classes} class link{confirming.classes === 1 ? '' : 's'} to these concepts will be removed.</li>{/if}
			{#if confirming.collections}<li>{confirming.collections} collection{confirming.collections === 1 ? '' : 's'} lose these concepts as members.</li>{/if}
			{#if confirming.properties}<li>{confirming.properties} concept propert{confirming.properties === 1 ? 'y' : 'ies'} take values of this scheme and stay; the Model checks will flag them.</li>{/if}
		</ul>
		<div class="buttons">
			<button type="button" class="danger" onclick={() => remove(confirming!.iri, true)} data-testid="scheme-delete-confirm">
				Delete scheme and {confirming.concepts} concept{confirming.concepts === 1 ? '' : 's'}
			</button>
			<button type="button" onclick={() => (confirming = null)}>Cancel</button>
		</div>
	{/if}
</Modal>

<style>
	.columns {
		display: grid;
		grid-template-columns: minmax(18rem, 1fr) minmax(18rem, 1fr);
		gap: 1.5rem;
	}
	@media (max-width: 720px) {
		.columns {
			grid-template-columns: 1fr;
		}
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th {
		text-align: left;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	th,
	td {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}
	tr.selected {
		background: var(--color-hover);
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
		text-align: left;
	}
	button:not(.link) {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.85rem;
		cursor: pointer;
	}
	button.primary {
		background: var(--color-accent);
		color: var(--color-bg);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.add {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}
	.buttons,
	.danger {
		color: var(--color-error);
		border-color: var(--color-error);
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	input {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}
	.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-error);
	}
</style>
