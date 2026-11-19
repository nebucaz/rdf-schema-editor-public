<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	/** The Collections tab of the Vocabulary page (spec/vocabulary-graph-and-tabs STORY-450): a searchable, paged list of
	 *  the SKOS collections with Add collection above it; the selected collection opens in the existing
	 *  `CollectionPanel`. Collections are few, so search and paging run in the browser. */
	import CollectionPanel from '#lib/components/CollectionPanel.svelte';
	import PagedListShell from '#lib/components/PagedListShell.svelte';
	import { clampPage, pageCount } from '#lib/services/list-paging.js';
	import { patchListState, type ListUrlState } from '#lib/services/list-url-state.js';
	import { validateCollectionDraft, type CollectionDraft, type SkosCollection } from '#lib/services/skos-collection.js';
	import { normaliseLabel, type Concept, type LangText } from '#lib/services/skos-concept.js';

	const PAGE_SIZE = 25;

	interface Props {
		collections: SkosCollection[];
		concepts: Concept[];
		namespaces: { baseIri: string; prefix: string }[];
		listState: ListUrlState;
		onStateChange: (next: ListUrlState) => void;
		onCreate: (draft: CollectionDraft) => Promise<void>;
		onSaveLabels: (iri: string, prefLabels: LangText[]) => Promise<void>;
		onAddMember: (iri: string, member: string) => Promise<void>;
		onRemoveMember: (iri: string, member: string) => Promise<void>;
		onReorder: (iri: string, members: string[]) => Promise<void>;
		onDelete: (iri: string, force: boolean) => Promise<{ deleted: boolean; members: string[] }>;
		onCreateEnumeration: (collectionIri: string, namespaceBaseIri: string) => Promise<string>;
	}

	let { collections, concepts, namespaces, listState, onStateChange, onCreate, ...panel }: Props = $props();

	let selectedIri = $state<string | null>(null);
	let adding = $state(false);
	let newLabel = $state('');
	let newOrdered = $state(false);
	let errors = $state<string[]>([]);

	const localName = (iri: string) => iri.split(/[#/]/).pop() ?? iri;
	const titleOf = (c: SkosCollection) => c.prefLabels.find((l) => l.text.trim())?.text ?? localName(c.iri);

	const matching = $derived.by(() => {
		const wanted = normaliseLabel(listState.q);
		const all = [...collections].sort((a, b) => titleOf(a).localeCompare(titleOf(b)) || (a.iri < b.iri ? -1 : 1));
		return wanted ? all.filter((c) => normaliseLabel(titleOf(c)).includes(wanted)) : all;
	});
	const page = $derived(clampPage(listState.page, pageCount(matching.length, PAGE_SIZE)));
	const visible = $derived(matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	async function create(event: SubmitEvent) {
		event.preventDefault();
		const draft: CollectionDraft = { prefLabels: newLabel.trim() ? [{ text: newLabel.trim(), lang: 'en' }] : [], ordered: newOrdered };
		errors = validateCollectionDraft(draft);
		if (errors.length) return;
		try {
			await onCreate(draft);
			newLabel = '';
			newOrdered = false;
			adding = false;
		} catch (e) {
			errors = [e instanceof Error ? e.message : 'Could not add the collection'];
		}
	}
</script>

<p class="explainer" data-testid="collections-explainer">
	A collection groups concepts for navigation and facets, for example a menu of regions, and implies no hierarchy. A scheme says
	which vocabulary a concept belongs to; a collection cuts across schemes.
</p>

<div class="columns">
	<section class="list">
		<PagedListShell
			label="Collections"
			total={matching.length}
			pageSize={PAGE_SIZE}
			page={listState.page}
			search={listState.q}
			onChange={(next) => onStateChange(patchListState(listState, { q: next.search, page: next.page }))}
		>
			{#snippet toolbar()}
				<button type="button" class="primary" onclick={() => (adding = !adding)} data-testid="add-collection">Add collection</button>
			{/snippet}
			<table>
				<thead>
					<tr><th>Collection</th><th>Kind</th><th>Members</th></tr>
				</thead>
				<tbody>
					{#each visible as c (c.iri)}
						<tr class:selected={c.iri === selectedIri}>
							<td>
								<button type="button" class="link" aria-current={c.iri === selectedIri ? 'true' : undefined} onclick={() => (selectedIri = c.iri)}>{titleOf(c)}</button>
							</td>
							<td>{c.ordered ? 'Ordered' : 'Unordered'}</td>
							<td>{c.members.length}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</PagedListShell>

		<Modal isOpen={adding} title="Add collection" onClose={() => (adding = false)}>
			<form class="add" onsubmit={create}>
				<label>
					Label
					<input type="text" bind:value={newLabel} placeholder="e.g. Regions" />
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={newOrdered} />
					Ordered collection
				</label>
				<div class="buttons">
					<button type="submit" class="primary" disabled={!newLabel.trim()}>Create collection</button>
					<button type="button" onclick={() => (adding = false)}>Cancel</button>
				</div>
				{#each errors as message (message)}<p class="error" role="alert">{message}</p>{/each}
			</form>
		</Modal>
	</section>

	<section class="detail" aria-label="Collection">
		{#if selectedIri && collections.some((c) => c.iri === selectedIri)}
			<CollectionPanel {collections} {concepts} {namespaces} only={selectedIri} showCreate={false} onCreate={onCreate} {...panel} />
		{:else}
			<p class="empty">Select a collection to edit its label, members and order.</p>
		{/if}
	</section>
</div>

<style>
	.explainer {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-text-muted);
		max-width: 46rem;
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(16rem, 1fr) minmax(18rem, 2fr);
		gap: 1.5rem;
	}
	@media (max-width: 720px) {
		.columns {
			grid-template-columns: 1fr;
		}
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
	.buttons {
		display: flex;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	label.check {
		flex-direction: row;
		align-items: center;
	}
	input[type='text'] {
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
