<script lang="ts">
	/** The Concepts tab of the Vocabulary page (spec/vocabulary-graph-and-tabs STORY-448): one server page of concepts
	 *  behind the shared `PagedListShell`, with the status and scheme filters, and the list's own buttons in the
	 *  toolbar above it. The page owns the URL state, the selection and the writes; this component only reads. */
	import PagedListShell from '#lib/components/PagedListShell.svelte';
	import ConceptList from '#lib/components/ConceptList.svelte';
	import type { GateFinding } from '#lib/services/gates/types.js';
	import { pageCount } from '#lib/services/list-paging.js';
	import { patchListState, type ListUrlState } from '#lib/services/list-url-state.js';
	import { CONCEPT_STATUSES, schemeDisplayName, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';

	export const CONCEPTS_PAGE_SIZE = 25;

	/** The slice of `SparqlConnector` this tab reads. */
	export interface ConceptsTabConnector {
		fetchConcepts(
			core: string,
			options: { limit: number; offset: number; search: string; status?: ListUrlState['status'] extends infer S ? Exclude<S, ''> : never; schemeIri?: string }
		): Promise<{ concepts: Concept[]; hasMore: boolean }>;
		countConcepts(core: string, options: { search: string; status?: Exclude<ListUrlState['status'], ''>; schemeIri?: string }): Promise<number>;
		countConceptsByScheme(core: string): Promise<Record<string, number>>;
	}

	interface Props {
		core: string;
		connector: ConceptsTabConnector;
		schemes: ConceptScheme[];
		findings: GateFinding[];
		selectedIri: string | null;
		/** Bumped by the page after every write, so the list is read again. */
		reloadKey: number;
		listState: ListUrlState;
		onStateChange: (next: ListUrlState) => void;
		onSelect: (iri: string) => void;
		onAdd: () => void;
		onBackfill: () => void;
	}

	let { core, connector, schemes, findings, selectedIri, reloadKey, listState, onStateChange, onSelect, onAdd, onBackfill }: Props = $props();

	let rows = $state<Concept[]>([]);
	let total = $state(0);
	let schemeCounts = $state<Record<string, number>>({});
	let error = $state<string | null>(null);
	/** Only the newest request may write its answer. */
	let ticket = 0;

	$effect(() => {
		const mine = ++ticket;
		const filter = { search: listState.q, status: listState.status || undefined, schemeIri: listState.scheme || undefined };
		const offset = (listState.page - 1) * CONCEPTS_PAGE_SIZE;
		void reloadKey;
		(async () => {
			try {
				const [page, count] = await Promise.all([
					connector.fetchConcepts(core, { limit: CONCEPTS_PAGE_SIZE, offset, ...filter }),
					connector.countConcepts(core, filter)
				]);
				if (mine !== ticket) return;
				error = null;
				total = count;
				rows = page.concepts;
				const last = pageCount(count, CONCEPTS_PAGE_SIZE);
				if (listState.page > last) onStateChange({ ...listState, page: last });
			} catch (e) {
				if (mine === ticket) error = e instanceof Error ? e.message : 'Failed to load the concepts';
			}
		})();
	});

	$effect(() => {
		void reloadKey;
		const mine = core;
		connector
			.countConceptsByScheme(mine)
			.then((counts) => {
				if (mine === core) schemeCounts = counts;
			})
			.catch(() => {});
	});

	const change = (patch: Partial<ListUrlState>) => onStateChange(patchListState(listState, patch));
</script>

<PagedListShell
	label="Concepts"
	{total}
	pageSize={CONCEPTS_PAGE_SIZE}
	page={listState.page}
	search={listState.q}
	onChange={(next) => change({ q: next.search, page: next.page })}
>
	{#snippet toolbar()}
		<button type="button" class="primary" onclick={onAdd} data-testid="add-concept">Add concept</button>
		<button type="button" onclick={onBackfill} data-testid="backfill-concepts">Create concepts for unlinked classes</button>
	{/snippet}
	{#snippet filters()}
		<label>
			Status
			<select value={listState.status} onchange={(e) => change({ status: e.currentTarget.value as ListUrlState['status'] })}>
				<option value="">All</option>
				{#each CONCEPT_STATUSES as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
		</label>
		<label>
			Scheme
			<select value={listState.scheme} onchange={(e) => change({ scheme: e.currentTarget.value })}>
				<option value="">All</option>
				{#each schemes as scheme (scheme.iri)}
					<option value={scheme.iri}>{schemeDisplayName(scheme)}{scheme.iri in schemeCounts ? ` (${schemeCounts[scheme.iri]})` : ''}</option>
				{/each}
			</select>
		</label>
	{/snippet}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<ConceptList concepts={rows} {schemes} {selectedIri} {findings} {onSelect} />
</PagedListShell>

<style>
	button {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.85rem;
		cursor: pointer;
	}
	button:hover {
		background: var(--color-accent);
		color: var(--color-bg);
	}
	button.primary {
		background: var(--color-accent);
		color: var(--color-bg);
	}
	button.primary:hover {
		background: var(--color-accent-hover);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}
	.error {
		color: var(--color-error);
	}
</style>
