<script lang="ts">
	/**
	 * STORY-185: the Query Workbench landing shell. Three regions — global search (STORY-186), saved
	 * queries (STORY-195) and "Create New Query" (STORY-188) — are placeholders later stories fill.
	 * The existing Queries console modal stays reachable via "Advanced / SPARQL console".
	 */
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import NamespaceFilter from '$lib/components/NamespaceFilter.svelte';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { workbenchNamespaceStore } from '$lib/stores/workbench-namespace-store.svelte';
	import { hiddenFromSelection } from '$lib/utils/workbench-namespace';
	import { filterListedNamespaces } from '$lib/utils/visibility';
	import AddColumnModal from '$lib/components/AddColumnModal.svelte';
	import FilterModal from '$lib/components/FilterModal.svelte';
	import {
		columnMarkers,
		filterMarkers,
		type FilterTarget
	} from '$lib/services/query-column-groups';
	import QueryColumnStrip from '$lib/components/QueryColumnStrip.svelte';
	import QueryResultShapePanel from '$lib/components/QueryResultShapePanel.svelte';
	import QueryExportButton from '$lib/components/QueryExportButton.svelte';
	import QueryShowDrawer from '$lib/components/QueryShowDrawer.svelte';
	import QueryColumnRules from '$lib/components/QueryColumnRules.svelte';
	import QueryResultsTable from '$lib/components/QueryResultsTable.svelte';
	import { queryRunStore } from '$lib/stores/query-run-store.svelte';
	import { compileQuery } from '$lib/services/query-compiler';
	import { formatTimeWindow } from '$lib/services/query-relative-time';
	import { resultKey, validateRunnableQueryModel } from '$lib/services/query-model';
	import QueryFilterChips from '$lib/components/QueryFilterChips.svelte';
	import { queryBuilderStore } from '$lib/stores/query-builder-store.svelte';
	import {
		sparqlConnector,
		type IndividualSearchResult
	} from '$lib/services/sparql-connector';
	import { extractLocalName } from '$lib/utils/iri';
	import SavedQueriesModal from '$lib/components/SavedQueriesModal.svelte';
	import SaveQueryModal from '$lib/components/SaveQueryModal.svelte';
	import { savedQueriesStore } from '$lib/stores/saved-queries-store.svelte';
	import { openSavedQuery, saveDisabledReason, toSavedQueryItem, type SavedQueryItem } from '$lib/services/saved-queries';
	import { adHocLink, adHocReportLink, resolveSharedLoad } from '$lib/services/share-links';
	import { prepareModelLoad, prepareSplLoad } from '$lib/services/query-load';
	import type { SplParseError } from '$lib/services/query-spl-parser';
	import { formatSplError, shouldOfferSplMode } from '$lib/services/spl-error-format';
	import SplErrorView from '$lib/components/SplErrorView.svelte';
	import { documentationStore } from '$lib/stores/documentation-store';
	import { readSplMode, writeSplMode, type SplMode } from '$lib/services/spl-mode-preference';
	import type { QueryModel } from '$lib/services/query-model';

	// Builder schema is discovered from the graph on every visit (STORY-188). `queryBuilderStore` is a
	// module singleton that outlives this page, so a schema (or load error) cached from an earlier
	// visit would hide classes imported since — e.g. the SOC sample imported after first opening the
	// workbench — until a hard reload.
	onMount(() => {
		if (!queryBuilderStore.schemaLoading) void queryBuilderStore.loadSchema();
	});

	const scope = $derived(workbenchNamespaceStore.selected ?? []);
	const rootClass = $derived(
		queryBuilderStore.model && queryBuilderStore.schema
			? queryBuilderStore.schema.classes.get(queryBuilderStore.model.root.classIri)
			: undefined
	);

	const runnable = $derived(
		queryBuilderStore.model && queryBuilderStore.schema
			? validateRunnableQueryModel(
					queryBuilderStore.model,
					new Set(queryBuilderStore.schema.classes.keys())
				).length === 0
			: false
	);

	/**
	 * What the results table shows: the last result, or — before the first run — just the header row
	 * for the columns defined so far (compiled, so aggregated queries show their group/measure columns).
	 */
	const resultsView = $derived.by(() => {
		const model = queryBuilderStore.model;
		const schema = queryBuilderStore.schema;
		if (!model || !schema || model.columns.length === 0) return null;
		if (queryRunStore.table && queryRunStore.compiled) {
			return { table: queryRunStore.table, columns: queryRunStore.compiled.columns, ran: true };
		}
		try {
			const columns = compileQuery(model, schema, { limit: 1, offset: 0 }).columns;
			return columns.length === 0
				? null
				: { table: { headers: columns.map((c) => c.header), rows: [] }, columns, ran: false };
		} catch {
			return null;
		}
	});

	/** `resultKey` of the model the displayed (or in-flight) result was produced from. */
	let ranKey = '';

	function runQuery() {
		if (queryBuilderStore.model && queryBuilderStore.schema) {
			ranKey = resultKey(queryBuilderStore.model);
			void queryRunStore.run(queryBuilderStore.model, queryBuilderStore.schema);
		}
	}

	// A result that is already on screen follows the builder: adding a column, filter or hop re-runs it
	// (debounced), so the table never shows a stale column set. Colour rules are display-only and skip this.
	$effect(() => {
		const model = queryBuilderStore.model;
		const schema = queryBuilderStore.schema;
		if (!model || !schema) return;
		const key = resultKey(model);
		if (key === ranKey || !untrack(() => queryRunStore.table) || !runnable) return;
		const timer = setTimeout(() => {
			ranKey = key;
			void queryRunStore.run(model, schema);
		}, 300);
		return () => clearTimeout(timer);
	});

	/**
	 * The only way external input (shared links, saved queries, typed SPL) reaches the builder:
	 * schema ready → runnable check → load → run. Returns an error message, or null on success.
	 */
	async function loadModelIntoBuilder(model: QueryModel): Promise<string | null> {
		if (!queryBuilderStore.schema) await queryBuilderStore.loadSchema();
		const schema = queryBuilderStore.schema;
		if (!schema) return queryBuilderStore.schemaError ?? 'Failed to load the schema';
		const prepared = prepareModelLoad(model, schema);
		if (!prepared.ok) return prepared.message;
		queryBuilderStore.load(prepared.model);
		runQuery();
		return null;
	}

	/** Header click: cycle that column's sort in the model, then re-query server-side. */
	function sortBy(columnId: string) {
		queryBuilderStore.cycleSort(columnId);
		if (queryBuilderStore.model && queryBuilderStore.schema) {
			ranKey = resultKey(queryBuilderStore.model);
			void queryRunStore.rerun(queryBuilderStore.model, queryBuilderStore.schema);
		}
	}

	const user = $derived(page.data.user as { sub: string; displayName: string } | null | undefined);

	$effect(() => {
		void savedQueriesStore.load(user ?? null);
	});

	let openError = $state<string | null>(null);

	async function openSaved(item: SavedQueryItem) {
		openError = null;
		const opened = openSavedQuery(item);
		if (opened.kind === 'sparql') {
			openError = `"${item.label}" is a raw SPARQL query; open it from the Query Console.`;
		} else if (opened.kind === 'error') {
			openError = opened.message;
		} else {
			openError = await loadModelIntoBuilder(opened.model);
		}
	}

	let showAddColumn = $state(false);
	/** `'group:<hopId|root>'` opens the dialog on that group's columns (edit); `null` = plain Add column. */
	let addColumnTarget = $state<string | null>(null);
	let filterTarget = $state<FilterTarget | null>(null);
	let showSavedModal = $state(false);
	let showSaveModal = $state(false);
	const saveReason = $derived(saveDisabledReason(user ?? null, runnable));

	async function saveCurrent(name: string, description: string): Promise<boolean> {
		if (!queryBuilderStore.model || !queryBuilderStore.schema) return false;
		return savedQueriesStore.save({
			name,
			description,
			model: queryBuilderStore.model,
			schema: queryBuilderStore.schema,
			user: user ?? null
		});
	}

	// Share links (STORY-201): `?query=<id>` opens a saved query, `?m=<base64url model>` an ad-hoc one.
	let shareError = $state<string | null>(null);
	let shareNotice = $state<string | null>(null);
	let handledSearch = '';

	$effect(() => {
		const search = page.url.search;
		if (search === handledSearch) return;
		handledSearch = search;
		untrack(() => void loadShared(new URLSearchParams(search)));
	});

	async function loadShared(params: URLSearchParams) {
		if (!params.has('query') && !params.has('m')) return;
		shareError = null;
		try {
			const items = params.has('query')
				? (await sparqlConnector.fetchSavedQueries()).map((sq) => toSavedQueryItem(sq, user ?? null))
				: [];
			const shared = resolveSharedLoad(params, items);
			if (shared.kind === 'error') {
				shareError = shared.message;
			} else if (shared.kind === 'console') {
				shareError = 'This link points to a raw SPARQL query; open it from the Query Console.';
			} else if (shared.kind === 'model') {
				shareError = await loadModelIntoBuilder(shared.model);
			}
		} catch (e) {
			shareError = e instanceof Error ? e.message : 'The shared query could not be opened';
		}
	}

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			shareNotice = 'Link copied';
			setTimeout(() => (shareNotice = null), 2500);
		} catch {
			shareError = 'Could not copy the link — copy it from the address bar instead.';
		}
	}

	function copyAdHocLink(kind: 'editor' | 'result') {
		const model = queryBuilderStore.model;
		if (!model) return;
		shareError = null;
		const build = kind === 'result' ? adHocReportLink : adHocLink;
		const link = build(window.location.origin, model);
		if (!link.ok) {
			shareError = link.error;
			return;
		}
		void copyText(link.url);
	}

	// Search | SPL toggle (STORY-220): remembered per viewer; storage failure degrades to Search.
	let searchMode = $state<SplMode>('search');
	let splText = $state('');
	let splError = $state<SplParseError | null>(null);
	let splRunning = $state(false);

	$effect(() => {
		let storage: Storage | undefined;
		try {
			storage = window.localStorage;
		} catch {
			storage = undefined;
		}
		searchMode = readSplMode(storage);
	});

	function setSearchMode(mode: SplMode) {
		searchMode = mode;
		try {
			writeSplMode(window.localStorage, mode);
		} catch {
			/* best-effort */
		}
	}

	const splFeedback = $derived(splError ? formatSplError(splText, splError) : null);
	let helpNotice = $state<string | null>(null);

	function openSplHelp(topic: string) {
		documentationStore.setLastSectionId(topic);
		helpNotice = 'Open Documentation from the menu — it will open on "SPL in the Workbench".';
	}

	/** "Run as SPL?": switches mode and carries the text over; never happens on its own. */
	function switchToSpl() {
		splText = searchTerm;
		setSearchMode('spl');
	}

	async function runSpl(event: Event) {
		event.preventDefault();
		splError = null;
		openError = null;
		splRunning = true;
		try {
			if (!queryBuilderStore.schema) await queryBuilderStore.loadSchema();
			const schema = queryBuilderStore.schema;
			if (!schema) {
				openError = queryBuilderStore.schemaError ?? 'Failed to load the schema';
				return;
			}
			const parsed = prepareSplLoad(splText, schema, scope);
			if (!parsed.ok) {
				splError = parsed.error;
				return;
			}
			openError = await loadModelIntoBuilder(parsed.model);
		} finally {
			splRunning = false;
		}
	}

	let searchTerm = $state('');
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let hits = $state<IndividualSearchResult[] | null>(null);

	async function runSearch(event: Event) {
		event.preventDefault();
		searching = true;
		searchError = null;
		try {
			const page = await sparqlConnector.searchIndividuals({
				query: searchTerm.trim(),
				matchAllStringProperties: true,
				limit: 20
			});
			hits = page.results;
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Search failed';
		} finally {
			searching = false;
		}
	}

	// Seeds the workbench's own selection (all namespaces except `defaultHidden` ones) once the
	// namespace list has loaded; never touches the canvas's visibility state.
	$effect(() => {
		if (namespaceStore.namespaces.length > 0) {
			workbenchNamespaceStore.ensureInitialised(namespaceStore.namespaces);
		}
	});

	const listedNamespaces = $derived(filterListedNamespaces(namespaceStore.namespaces));
	const hiddenNamespaces = $derived(
		hiddenFromSelection(listedNamespaces, workbenchNamespaceStore.selected ?? [])
	);
</script>

<svelte:head>
	<title>Query Workbench — RDF Schema Editor</title>
</svelte:head>

<div class="workbench-page">
	<header class="workbench-header">
		<h1>Query Workbench</h1>
		<div class="workbench-header-actions">
			{#if user}
				<span class="workbench-user" data-testid="workbench-user">{user.displayName}</span>
			{/if}
			<NamespaceFilter
				namespaces={listedNamespaces}
				{hiddenNamespaces}
				onToggle={(baseIri) => workbenchNamespaceStore.toggle(baseIri)}
			/>
		</div>
	</header>

	{#if shareError}
		<p class="error" role="alert" data-testid="share-error">{shareError}</p>
	{/if}
	{#if shareNotice}
		<p class="placeholder" role="status" data-testid="share-notice">{shareNotice}</p>
	{/if}

	<section class="region" data-testid="region-search" aria-labelledby="region-search-title">
		<h2 id="region-search-title">Search or create a query</h2>
		<div class="mode-toggle" role="group" aria-label="Input mode">
			<button
				type="button"
				aria-pressed={searchMode === 'search'}
				onclick={() => setSearchMode('search')}
				data-testid="mode-search">Search</button
			>
			<button
				type="button"
				aria-pressed={searchMode === 'spl'}
				onclick={() => setSearchMode('spl')}
				data-testid="mode-spl">SPL</button
			>
		</div>
		{#if searchMode === 'spl'}
			<form class="spl-form" onsubmit={runSpl}>
				<textarea
					rows="4"
					spellcheck="false"
					placeholder="Alert | where severity=High | stats count by title"
					aria-label="SPL query"
					bind:value={splText}
					oninput={() => (splError = null)}
					data-testid="workbench-spl"
				></textarea>
				{#if splFeedback}
					<SplErrorView error={splFeedback} onOpenHelp={openSplHelp} />
				{/if}
				{#if helpNotice}<p class="placeholder" role="status">{helpNotice}</p>{/if}
				<div><button type="submit" disabled={splRunning} data-testid="spl-run">{splRunning ? 'Running…' : 'Run'}</button></div>
			</form>
		{:else}
			<form class="search-form" onsubmit={runSearch}>
				<input
					type="search"
					placeholder="Search all properties…"
					aria-label="Search all properties"
					bind:value={searchTerm}
					data-testid="workbench-search"
				/>
				<button type="submit" disabled={searching}>Search</button>
			</form>
			{#if shouldOfferSplMode(searchTerm)}
				<p class="spl-hint" role="status" data-testid="spl-hint">
					This looks like SPL.
					<button type="button" onclick={switchToSpl} data-testid="spl-hint-switch">Run as SPL?</button>
				</p>
			{/if}
		{/if}
		<div class="create-row">
			{#if queryBuilderStore.schemaLoading}
				<p class="placeholder">Loading schema…</p>
			{:else if queryBuilderStore.schemaError}
				<p class="error" role="alert">{queryBuilderStore.schemaError}</p>
			{/if}
			{#if queryBuilderStore.schema && !queryBuilderStore.model}
				<button type="button" onclick={() => {
					addColumnTarget = null;
					showAddColumn = true;
				}} data-testid="add-column">
					Add column to start
				</button>
			{/if}
			<button type="button" onclick={() => (showSavedModal = true)} data-testid="open-saved-queries">
				Saved queries
			</button>
		</div>
		{#if openError}<p class="error" role="alert">{openError}</p>{/if}
		{#if searchError}
			<p class="error" role="alert">{searchError}</p>
		{:else if hits}
			{#if hits.length === 0}
				<p class="placeholder">No matches.</p>
			{:else}
				<ul class="hits" data-testid="search-hits">
					{#each hits as hit (hit.iri + hit.namespaceBaseIri)}
						<li>
							<span>{hit.label}</span>
							<span class="meta">
								{extractLocalName(hit.classIri)}{#if hit.matchedValue}
									· {extractLocalName(hit.matchedPropertyIri ?? '')}: {hit.matchedValue}{/if}
							</span>
							<button
								type="button"
								onclick={() => queryBuilderStore.startFromSearchHit(hit, scope)}
							>
								Open in builder
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>

	{#if queryBuilderStore.model && rootClass}
		<section class="region" data-testid="region-builder" aria-labelledby="region-builder-title">
			<div class="builder-head">
				<h2 id="region-builder-title">Query: {rootClass.label}</h2>
				<button type="button" class="run-btn" disabled={!runnable || queryRunStore.running} onclick={runQuery} data-testid="run-query">
					{queryRunStore.running ? 'Running…' : 'Run'}
				</button>
				<button type="button" disabled={!runnable} onclick={() => (showSaveModal = true)} data-testid="open-save-modal">
					Save
				</button>
				<button type="button" onclick={() => copyAdHocLink('editor')} data-testid="copy-adhoc-link">
					Copy editor link
				</button>
				<button
					type="button"
					disabled={!runnable}
					onclick={() => copyAdHocLink('result')}
					data-testid="copy-adhoc-result-link"
				>
					Copy result link (read-only)
				</button>
				<button type="button" onclick={() => queryBuilderStore.close()}>Close</button>
			</div>
			{#if queryBuilderStore.schema}
				<QueryColumnStrip
					model={queryBuilderStore.model}
					schema={queryBuilderStore.schema}
					store={queryBuilderStore}
					onAddColumn={() => {
						addColumnTarget = null;
						showAddColumn = true;
					}}
					onEditColumns={(hopId) => {
						addColumnTarget = `group:${hopId ?? 'root'}`;
						showAddColumn = true;
					}}
					onFilter={(t) => (filterTarget = t)}
				/>
				<QueryResultShapePanel
					model={queryBuilderStore.model}
					store={queryBuilderStore}
					schema={queryBuilderStore.schema}
					knownClassIris={new Set(queryBuilderStore.schema.classes.keys())}
				/>
				<QueryShowDrawer
					model={queryBuilderStore.model}
					schema={queryBuilderStore.schema}
				/>
				{#if queryRunStore.error}
					<p class="error" role="alert" data-testid="run-error">{queryRunStore.error}</p>
				{/if}
				{#if queryRunStore.table && queryRunStore.compiled}
					<QueryExportButton model={queryBuilderStore.model} schema={queryBuilderStore.schema} disabled={!runnable} />
					<QueryColumnRules model={queryBuilderStore.model} schema={queryBuilderStore.schema} store={queryBuilderStore} />
				{/if}
				<QueryFilterChips
					markers={filterMarkers(queryBuilderStore.model, queryBuilderStore.schema)}
					onEdit={(m) =>
						(filterTarget = m.propertyIri === null
							? { kind: 'entity', hopId: m.hopId }
							: { kind: 'property', hopId: m.hopId, propertyIri: m.propertyIri })}
					onRemove={(m) => m.filters.forEach((f) => queryBuilderStore.removeFilter(f.id))}
					onAdd={() => (filterTarget = { kind: 'pick' })}
					onGroup={(ids) => queryBuilderStore.groupFilters(ids)}
					onUngroup={(groupId) => queryBuilderStore.ungroupFilters(groupId)}
					onRemoveFromGroup={(m) => m.filters.forEach((f) => queryBuilderStore.removeFromGroup(f.id))}
				/>
				{#if resultsView}
					{@const model = queryBuilderStore.model}
					{@const schema = queryBuilderStore.schema}
					{#if queryRunStore.timeWindow.length > 0}
						<p class="time-window" data-testid="time-window">
							Time window{queryRunStore.asOf ? ` as of ${queryRunStore.asOf.toLocaleString()}` : ''}:
							{queryRunStore.timeWindow.map(formatTimeWindow).join('; ')}
						</p>
					{/if}
					<QueryResultsTable
						table={resultsView.table}
						columns={resultsView.columns}
						emptyText={resultsView.ran ? 'No results' : 'Run the query to see rows'}
						sort={model.sort}
						info={queryRunStore.info}
						pageSize={queryRunStore.pageSize}
						running={queryRunStore.running}
						rules={model.columnRules}
						user={user ?? null}
						onSort={sortBy}
						markers={columnMarkers(model, schema)}
						onFilter={(columnId) => {
							const c = model.columns.find((x) => x.id === columnId);
							if (c && typeof c.source === 'object')
								filterTarget = { kind: 'property', hopId: c.hopId, propertyIri: c.source.propertyIri };
						}}
						onNext={() => queryRunStore.next(model, schema)}
						onPrevious={() => queryRunStore.previous(model, schema)}
						onPageSize={(n) => queryRunStore.setPageSize(n, model, schema)}
					/>
				{/if}
			{/if}
		</section>
	{/if}

	{#if queryBuilderStore.schema && queryBuilderStore.model}
		<FilterModal
			isOpen={filterTarget !== null}
			target={filterTarget}
			model={queryBuilderStore.model}
			schema={queryBuilderStore.schema}
			store={queryBuilderStore}
			onClose={() => (filterTarget = null)}
		/>
	{/if}

	{#if queryBuilderStore.schema}
		<AddColumnModal
			isOpen={showAddColumn}
			schema={queryBuilderStore.schema}
			namespaces={namespaceStore.namespaces}
			model={queryBuilderStore.model}
			initialTarget={addColumnTarget}
			onStep={(step, picks) => {
				queryBuilderStore.addStepWithColumns(step, picks);
				showAddColumn = false;
			}}
			onGroup={(hopId, picks, removeIds) => {
				queryBuilderStore.editGroupColumns(hopId, picks, removeIds);
				showAddColumn = false;
			}}
			onStart={(classIri, picks) => {
				queryBuilderStore.startWithColumns(classIri, scope, picks);
				showAddColumn = false;
			}}
			onClose={() => (showAddColumn = false)}
		/>
	{/if}

	<SavedQueriesModal
		isOpen={showSavedModal}
		items={savedQueriesStore.items.filter((i) => i.kind === 'builder')}
		user={user ?? null}
		error={savedQueriesStore.error}
		loading={savedQueriesStore.loading}
		onOpen={openSaved}
		onDelete={(iri) => savedQueriesStore.remove(iri)}
		onClose={() => (showSavedModal = false)}
	/>
	<SaveQueryModal
		isOpen={showSaveModal}
		disabledReason={saveReason}
		onSave={saveCurrent}
		onClose={() => (showSaveModal = false)}
	/>
</div>

<style>
	.time-window {
		margin: 0.25rem 0;
		font-size: 0.8rem;
		color: var(--color-text-secondary, inherit);
	}
	.workbench-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		gap: 1rem;
		box-sizing: border-box;
		overflow-y: auto;
	}

	.workbench-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.workbench-header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}

	.region {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 1rem;
		background: var(--color-bg-secondary);
	}

	.create-row {
		margin-top: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.placeholder {
		margin: 0;
		opacity: 0.7;
	}

	.workbench-user {
		font-size: 0.875rem;
		opacity: 0.8;
	}

	.search-form {
		display: flex;
		gap: 0.5rem;
	}

	.mode-toggle {
		display: inline-flex;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.mode-toggle button[aria-pressed='true'] {
		font-weight: 600;
		text-decoration: underline;
	}

	.spl-hint {
		margin: 0.5rem 0 0;
		font-size: 0.875rem;
	}

	.spl-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.spl-form textarea {
		font-family: monospace;
		width: 100%;
		box-sizing: border-box;
	}

	.search-form input {
		flex: 1;
	}

	.hits {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.hits li,
	.builder-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.meta {
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.error {
		color: var(--color-danger, #b00020);
	}


</style>
