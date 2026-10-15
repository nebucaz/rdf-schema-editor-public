<script lang="ts">
	/**
	 * STORY-198: the report view of a saved query — a clean, link-shareable page that re-runs the
	 * query live on every open (research Q21) and shows when it ran ("as of"). Same result table and
	 * colour rules as the workbench; read-oriented chrome only (no builder panels). Link-only for
	 * Confluence (Q22): no embedding allowances are added anywhere.
	 */
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import QueryResultsTable from '$lib/components/QueryResultsTable.svelte';
	import { QueryRunStore } from '$lib/stores/query-run-store.svelte';
	import { queryBuilderStore } from '$lib/stores/query-builder-store.svelte';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { sparqlConnector } from '$lib/services/sparql-connector';
	import { toSavedQueryItem } from '$lib/services/saved-queries';
	import { resolveReportTarget, type ReportTarget } from '$lib/services/report-id';
	import { AD_HOC_REPORT_ID } from '$lib/services/share-links';
	import { decodeModelFromUrl } from '$lib/services/query-model';
	import { cycleSort } from '$lib/services/query-model-edit';
	import { validateRunnableQueryModel, type QueryModel } from '$lib/services/query-model';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import { formatTimeWindow } from '$lib/services/query-relative-time';

	const user = $derived(page.data.user as { sub: string; displayName: string } | null | undefined);
	const id = $derived(page.params.id ?? '');

	// A report owns its run state, so opening one never disturbs the workbench's current query.
	const runStore = new QueryRunStore();

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let target = $state<ReportTarget | null>(null);
	let model = $state<QueryModel | null>(null);
	let schema = $state<BuilderSchema | null>(null);
	let modelProblem = $state<string | null>(null);
	let asOf = $state<Date | null>(null);
	let copied = $state(false);

	async function load(reportId: string) {
		loading = true;
		loadError = null;
		target = null;
		model = null;
		modelProblem = null;
		asOf = null;
		try {
			let resolved: ReportTarget;
			if (reportId === AD_HOC_REPORT_ID) {
				// Read-only result link for an unsaved query: the model travels in `?m=`.
				const decoded = decodeModelFromUrl(page.url.searchParams.get('m') ?? '');
				if (!decoded.ok) {
					loadError = decoded.error;
					return;
				}
				resolved = {
					kind: 'ready',
					model: decoded.model,
					item: {
						iri: '',
						label: 'Ad-hoc query',
						description: '',
						kind: 'builder',
						creator: '',
						mine: false,
						sparqlText: ''
					}
				};
			} else {
				const items = (await sparqlConnector.fetchSavedQueries()).map((sq) =>
					toSavedQueryItem(sq, user ?? null)
				);
				resolved = resolveReportTarget(items, reportId);
			}
			target = resolved;
			if (resolved.kind !== 'ready') return;

			if (!queryBuilderStore.schema) await queryBuilderStore.loadSchema();
			if (!queryBuilderStore.schema) {
				loadError = queryBuilderStore.schemaError ?? 'Failed to load the schema';
				return;
			}
			schema = queryBuilderStore.schema;
			const issues = validateRunnableQueryModel(resolved.model, new Set(schema.classes.keys()));
			if (issues.length > 0) {
				modelProblem = `"${resolved.item.label}" can no longer run: ${issues.map((i) => i.message).join('; ')}`;
				return;
			}
			model = resolved.model;
			await execute();
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load the report';
		} finally {
			loading = false;
		}
	}

	async function execute() {
		if (!model || !schema) return;
		await runStore.run(model, schema);
		if (!runStore.error) asOf = runStore.asOf ?? new Date();
	}

	// Re-runs the live query whenever the route's id changes (and on first open).
	$effect(() => {
		const current = id;
		untrack(() => void load(current));
	});

	function sortBy(columnId: string) {
		if (!model || !schema) return;
		model = cycleSort(model, columnId);
		void runStore.rerun(model, schema);
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			loadError = 'Could not copy the link — copy it from the address bar.';
		}
	}

	const scopeLabels = $derived(
		(model?.namespaces ?? []).map(
			(base) => namespaceStore.namespaces.find((n) => n.baseIri === base)?.prefix ?? base
		)
	);
	const title = $derived(
		target && target.kind !== 'notFound' ? target.item.label || 'Untitled query' : 'Report'
	);
</script>

<svelte:head>
	<title>{title} — Report</title>
</svelte:head>

<div class="report-page">
	{#if loading}
		<p class="status" data-testid="report-loading">Loading report…</p>
	{:else if loadError}
		<p class="error" role="alert" data-testid="report-error">{loadError}</p>
	{:else if !target || target.kind === 'notFound'}
		<section class="notice" data-testid="report-not-found">
			<h1>Report not found</h1>
			<p>No saved query matches this link. It may have been deleted or renamed by its author.</p>
			<p><a href="/workbench">Go to the Query Workbench</a></p>
		</section>
	{:else}
		<header class="report-head">
			<div>
				<h1 data-testid="report-title">{target.item.label || 'Untitled query'}</h1>
				{#if target.item.description}
					<p class="description" data-testid="report-description">{target.item.description}</p>
				{/if}
			</div>
			<div class="actions no-print">
				<button type="button" onclick={copyLink} data-testid="report-copy-link">
					{copied ? 'Link copied' : 'Copy link'}
				</button>
				{#if target.kind === 'legacy'}
					<!-- Raw SPARQL queries have no report view; the notice below says where to run them. -->
				{:else}
					<a
						class="btn"
						href={id === AD_HOC_REPORT_ID
							? `/workbench${page.url.search}`
							: `/workbench?query=${encodeURIComponent(id)}`}
						data-testid="report-open-builder"
					>
						Open in builder
					</a>
					{#if target.kind === 'ready' && model}
						<button type="button" onclick={() => void execute()} disabled={runStore.running}>
							Refresh
						</button>
					{/if}
				{/if}
			</div>
		</header>

		{#if target.kind === 'legacy'}
			<p class="notice" data-testid="report-legacy">
				This is a raw SPARQL query without a visual model, so it has no report view. Run it from the
				Query Console.
			</p>
		{:else if target.kind === 'invalid'}
			<p class="error" role="alert" data-testid="report-invalid">{target.message}</p>
		{:else if modelProblem}
			<p class="error" role="alert" data-testid="report-invalid">{modelProblem}</p>
		{:else if model}
			<dl class="meta" data-testid="report-meta">
				<div>
					<dt>Namespaces</dt>
					<dd>{scopeLabels.join(', ') || '—'}</dd>
				</div>
				<div>
					<dt>As of</dt>
					<dd data-testid="report-as-of" title={asOf?.toISOString()}>
						{asOf ? asOf.toLocaleString() : runStore.running ? 'running…' : '—'}
					</dd>
				</div>
				{#if runStore.timeWindow.length > 0}
					<div>
						<dt>Time window</dt>
						<dd data-testid="report-time-window">
							{#each runStore.timeWindow as w (w.filterId)}
								<div>{formatTimeWindow(w)}</div>
							{/each}
						</dd>
					</div>
				{/if}
				{#if target.item.creator}
					<div class="no-print">
						<dt>Author</dt>
						<dd>{target.item.creator}</dd>
					</div>
				{/if}
			</dl>

			{#if runStore.error}
				<p class="error" role="alert" data-testid="report-run-error">{runStore.error}</p>
			{/if}

			{#if runStore.table && runStore.compiled}
				{@const m = model}
				{@const s = schema!}
				<QueryResultsTable
					table={runStore.table}
					columns={runStore.compiled.columns}
					sort={m.sort}
					info={runStore.info}
					pageSize={runStore.pageSize}
					running={runStore.running}
					rules={m.columnRules}
					user={user ?? null}
					onSort={sortBy}
					onNext={() => runStore.next(m, s)}
					onPrevious={() => runStore.previous(m, s)}
					onPageSize={(n) => runStore.setPageSize(n, m, s)}
				/>
				<p class="print-hint no-print">
					Printing includes the rows shown on this page — raise “Rows per page” first to print more.
				</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.report-page {
		padding: 1.5rem;
		max-width: 1200px;
		margin: 0 auto;
		box-sizing: border-box;
		overflow-y: auto;
		height: 100%;
	}
	.report-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	.description {
		margin: 0.35rem 0 0;
		opacity: 0.8;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.btn {
		text-decoration: none;
	}
	.meta {
		display: flex;
		gap: 2rem;
		flex-wrap: wrap;
		margin: 0 0 1rem;
		font-size: 0.85rem;
	}
	.meta dt {
		font-weight: 600;
		opacity: 0.7;
	}
	.meta dd {
		margin: 0;
	}
	.status,
	.notice {
		opacity: 0.85;
	}
	.error {
		color: var(--color-danger, #b00020);
	}
	.print-hint {
		font-size: 0.8rem;
		opacity: 0.7;
		margin-top: 0.5rem;
	}

	@media print {
		.no-print {
			display: none !important;
		}
		.report-page {
			padding: 0;
			max-width: none;
			overflow: visible;
			height: auto;
		}
		/* Drop the app chrome (navbar) while a report is on screen. */
		:global(body:has(.report-page) .app-header) {
			display: none;
		}
		:global(body:has(.report-page) .app-main) {
			overflow: visible;
			height: auto;
		}
	}
</style>
