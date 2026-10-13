<script lang="ts">
	/**
	 * STORY-192: the workbench result table. Rendering only — rows are one server-side page already
	 * built by `buildResultRows`; sorting is a header click handled by the parent (updates `model.sort`
	 * and re-queries), paging is OFFSET-based. Separate from the console's `ResultsTable`, which stays
	 * a generic `head.vars × bindings` grid.
	 */
	import type { CompiledColumn } from '$lib/services/query-compiler';
	import type { SortKey } from '$lib/services/query-model';
	import type { PageInfo, ResultRows } from '$lib/services/query-results';
	import { PAGE_SIZES } from '$lib/services/query-results';
	import type { ColumnRule } from '$lib/services/column-rules';
	import { chipStyle, ruleCellStyle } from '$lib/services/column-rules';
	import { cellRule, rowRuleColor } from '$lib/services/column-rules-editor';
	import { sparqlConnector, type FetchedAnnotation } from '$lib/services/sparql-connector';
	import {
		annotationsForFact,
		loadPageAnnotations,
		type BadgeUser
	} from '$lib/services/annotation-badges';
	import AnnotationBadge from './AnnotationBadge.svelte';
	import AnnotationPanel from './AnnotationPanel.svelte';
	import {
		pendingAnnotation,
		runOptimistic,
		withAnnotation,
		withReplacedAnnotation,
		withoutAnnotation
	} from '$lib/services/annotation-edits';
	import { deleteAnnotationRequest, postAnnotation } from '$lib/services/annotation-client';
	import { factKeyString, type AnnotationInput } from '$lib/services/sparql-connector';
	import { toFactKey } from '$lib/services/annotation-badges';
	import type { ResultCell } from '$lib/services/query-results';
	import type { ColumnMarkerState } from '$lib/services/query-column-groups';
	import ColumnMarkers from './ColumnMarkers.svelte';

	interface Props {
		table: ResultRows;
		columns: CompiledColumn[];
		sort: SortKey[];
		info: PageInfo | null;
		pageSize: number;
		running: boolean;
		/** Value-to-colour rules (STORY-196); shared with the report so both render alike. */
		rules?: ColumnRule[];
		/** Current user — own annotations show their display name (STORY-199). */
		user?: BadgeUser | null;
		onSort: (columnId: string) => void;
		/** Shared sort/filter marker state (workbench only). Omitted = the plain sort-by-header table. */
		markers?: Map<string, ColumnMarkerState>;
		/** Opens the filter dialog for a column; only columns of a property get a filter marker. */
		onFilter?: (columnId: string) => void;
		onNext: () => void;
		onPrevious: () => void;
		onPageSize: (size: number) => void;
		/** Shown in the empty body instead of "No results" — e.g. before the query was first run. */
		emptyText?: string;
	}

	let {
		table,
		columns,
		sort,
		info,
		pageSize,
		running,
		rules,
		user = null,
		onSort,
		markers,
		onFilter,
		onNext,
		onPrevious,
		onPageSize,
		emptyText = 'No results'
	}: Props = $props();

	const sortOf = (columnId: string) => {
		const i = sort.findIndex((s) => s.columnId === columnId);
		return i < 0 ? null : { direction: sort[i].direction, rank: i + 1 };
	};
	const fmt = (n: number) => n.toLocaleString();

	// Annotation badges (STORY-199): one batched lookup per loaded page. It never blocks the table —
	// rows render first, badges appear when the lookup resolves, and a failure just leaves none.
	let annotations = $state<Map<string, FetchedAnnotation[]>>(new Map());
	let loadSeq = 0;
	$effect(() => {
		const current = table;
		const mine = ++loadSeq;
		void loadPageAnnotations(sparqlConnector, current).then((loaded) => {
			if (mine === loadSeq) annotations = loaded;
		});
		// A new page of results closes the panel — its cell no longer exists.
		selected = null;
		panelError = null;
	});

	// Annotation panel (STORY-200): clicking a fact-bearing cell opens it under the toolbar.
	let selected = $state<{ row: number; columnId: string } | null>(null);
	let panelError = $state<string | null>(null);
	let panelBusy = $state(false);
	let labels = $state<{ iri: string; label: string }[]>([]);
	let labelsLoaded = false;
	let pendingSeq = 0;

	const selectedCell = $derived(
		selected ? table.rows[selected.row]?.find((c) => c.columnId === selected!.columnId) : undefined
	);
	const selectedFact = $derived(selectedCell?.fact);

	function openPanel(row: number, cell: ResultCell) {
		if (!cell.fact) return; // aggregate rows, label/IRI columns and measures have no fact
		selected = { row, columnId: cell.columnId };
		panelError = null;
		if (!labelsLoaded) {
			labelsLoaded = true;
			sparqlConnector
				.fetchAnnotationLabels()
				.then((l) => (labels = l))
				.catch(() => {
					labelsLoaded = false; // retry on the next open; label mode just stays empty
				});
		}
	}

	async function addAnnotation(input: AnnotationInput): Promise<boolean> {
		const fact = selectedFact;
		if (!fact || !user) return false;
		const factKey = toFactKey(fact);
		const key = factKeyString(factKey);
		const pending = pendingAnnotation(input, user, labels, ++pendingSeq);
		panelError = null;
		panelBusy = true;
		try {
			await runOptimistic({
				apply: () => (annotations = withAnnotation(annotations, key, pending)),
				request: () => postAnnotation(fetch, factKey, input),
				// Author and timestamp shown afterwards are the server's, not the browser's.
				commit: (saved) =>
					(annotations = withReplacedAnnotation(annotations, key, pending.iri, {
						...pending,
						...saved
					})),
				rollback: () => (annotations = withoutAnnotation(annotations, key, pending.iri))
			});
			return true;
		} catch (e) {
			panelError = e instanceof Error ? e.message : 'The annotation could not be saved.';
			return false;
		} finally {
			panelBusy = false;
		}
	}

	async function removeAnnotation(iri: string) {
		const fact = selectedFact;
		if (!fact) return;
		const key = factKeyString(toFactKey(fact));
		const list = annotations.get(key) ?? [];
		const index = list.findIndex((a) => a.iri === iri);
		if (index < 0) return;
		const removed = list[index];
		panelError = null;
		try {
			await runOptimistic({
				apply: () => (annotations = withoutAnnotation(annotations, key, iri)),
				request: () => deleteAnnotationRequest(fetch, iri),
				commit: () => {},
				rollback: () => (annotations = withAnnotation(annotations, key, removed, index))
			});
		} catch (e) {
			panelError = e instanceof Error ? e.message : 'The annotation could not be removed.';
		}
	}
</script>

<div class="results group" class:running aria-busy={running} data-testid="query-results">
	<div class="toolbar">
		{#if info}
			<span data-testid="row-range">
				{#if info.total === 0}No rows{:else}Rows {fmt(info.from)}–{fmt(info.to)} of {fmt(info.total)}{#if info.uncappedTotal !== undefined}
						<span data-testid="row-cap">(showing first {fmt(info.total)} of {fmt(info.uncappedTotal)})</span>{/if}{/if}
			</span>
		{/if}
		<span class="spacer"></span>
		<label>
			Rows per page
			<select value={pageSize} onchange={(e) => onPageSize(Number(e.currentTarget.value))}>
				{#each PAGE_SIZES as size (size)}<option value={size}>{size}</option>{/each}
			</select>
		</label>
		<button type="button" disabled={!info?.hasPrev || running} onclick={onPrevious}>Previous</button>
		<button type="button" disabled={!info?.hasNext || running} onclick={onNext}>Next</button>
	</div>

	{#if selectedCell && selectedFact}
		<AnnotationPanel
			title={`${selectedCell.header}: ${selectedCell.text || '(empty)'}`}
			annotations={annotationsForFact(annotations, selectedFact)}
			{labels}
			{user}
			error={panelError}
			busy={panelBusy}
			onAdd={addAnnotation}
			onDelete={removeAnnotation}
			onClose={() => (selected = null)}
		/>
	{/if}

	{#if columns.length === 0}
		<p class="empty">{emptyText}</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						{#each columns as col (col.id)}
							{@const s = sortOf(col.id)}
							<th aria-sort={s ? (s.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
								{#if markers?.get(col.id)}
									<span class="sort-text">{col.header}</span>
									<ColumnMarkers
										state={markers.get(col.id)!}
										header={col.header}
										onSort={() => onSort(col.id)}
										onFilter={onFilter && markers.get(col.id)!.filterable ? () => onFilter(col.id) : undefined}
									/>
								{:else}
									<button type="button" class="sort" onclick={() => onSort(col.id)}>
										{col.header}
										{#if s}
											<span class="arrow">{s.direction === 'asc' ? '▲' : '▼'}{sort.length > 1 ? s.rank : ''}</span>
										{/if}
									</button>
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#if table.rows.length === 0}
						<tr class="empty-row">
							<td colspan={columns.length} data-testid="results-empty">{emptyText}</td>
						</tr>
					{/if}
					{#each table.rows as row, i (i)}
						{@const rowColor = rowRuleColor(rules, row)}
						<tr class:row-ruled={rowColor !== undefined} style={ruleCellStyle(rowColor)}>
							{#each row as cell (cell.columnId)}
								{@const matched = cell.isMeasure ? undefined : cellRule(rules, cell)}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
								<td
									class:annotatable={cell.fact !== undefined}
									onclick={(e) => {
										// Links and the badge keep their own behaviour; only a plain cell click opens the panel.
										if ((e.target as HTMLElement).closest('a')) return;
										openPanel(i, cell);
									}}
									class:measure={cell.isMeasure}
									class:ruled={matched !== undefined && !matched.chip}
									style={matched && !matched.chip ? ruleCellStyle(matched.color) : undefined}
									title={cell.title}
								>
									{#if matched?.chip && cell.text !== ''}
										<span class="rule-chip" style={chipStyle(matched.color)} data-testid="rule-chip">
											{#if cell.href}<a href={cell.href}>{cell.text}</a>{:else}{cell.text}{/if}
										</span>
									{:else if cell.href}<a href={cell.href}>{cell.text}</a>{:else}{cell.text}{/if}
									{#if cell.fact}
										<AnnotationBadge annotations={annotationsForFact(annotations, cell.fact)} {user} />
										<button
											type="button"
											class="annotate"
											aria-label={`Annotate ${cell.header}`}
											onclick={(e) => {
												e.stopPropagation();
												openPanel(i, cell);
											}}>✎</button
										>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.results.running {
		opacity: 0.6;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 0.85rem;
	}
	.spacer {
		flex: 1;
	}
	.table-wrap {
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		max-height: 60vh;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.85rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.65rem;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}
	th {
		position: sticky;
		top: 0;
		background: var(--color-bg-secondary);
	}
	td.annotatable {
		cursor: pointer;
	}
	.annotate {
		margin-left: 0.25rem;
		padding: 0 0.2rem;
		border: none;
		background: none;
		font-size: 0.8em;
		opacity: 0;
		cursor: pointer;
		color: var(--color-text-muted);
	}
	td:hover .annotate,
	.annotate:focus-visible {
		opacity: 0.8;
	}
	td.ruled a,
	.rule-chip a {
		color: inherit;
	}
	.rule-chip {
		display: inline-block;
		padding: 0.1rem 0.6rem;
		border-radius: 4px;
		font-size: 0.8em;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		white-space: nowrap;
		print-color-adjust: exact;
		-webkit-print-color-adjust: exact;
	}
	.empty-row td {
		opacity: 0.7;
		font-style: italic;
	}
	tr.row-ruled td:not(.ruled) {
		background: inherit;
	}
	td.measure {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.sort {
		border: none;
		background: none;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.sort-text {
		font-weight: 600;
		color: var(--color-text-muted);
	}
	.arrow {
		font-size: 0.75em;
	}
	.empty {
		margin: 0;
		opacity: 0.7;
	}

	/* Print / PDF (STORY-198): a plain, fully expanded table; paging controls are interaction-only. */
	@media print {
		.toolbar label,
		.toolbar button {
			display: none;
		}
		.table-wrap {
			max-height: none;
			overflow: visible;
			border: none;
		}
		th {
			position: static;
		}
		.sort {
			color: inherit;
		}
		.arrow {
			display: none;
		}
		tr {
			break-inside: avoid;
		}
		.annotate {
			display: none;
		}
		tr.row-ruled,
		td.ruled {
			print-color-adjust: exact;
			-webkit-print-color-adjust: exact;
		}
	}
</style>
