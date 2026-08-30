<script lang="ts">
	import { sparqlConnector, type FetchedNamespace } from '$lib/services/sparql-connector';
	import { SchemaValidationError, type ValidationIssue } from '$lib/services/validation';
	import { extractLocalName } from '$lib/utils/iri';
	import { highlightTurtle } from '$lib/utils/turtle-highlight';
	import { buildCanvasModel } from '$lib/services/canvas-model';
	import { canvasModelToLinkML } from '$lib/services/linkml';
	import { externalVocabStore } from '$lib/stores/external-vocab-store.svelte';
	import CatalogMetadataForm from './CatalogMetadataForm.svelte';

	/**
	 * The panel's scope (STORY-082 widens this from a bare `selectedIri: string | null`): a single
	 * node (editable), the whole schema graph (editable, `selectedIri === null`'s old meaning), or a
	 * Workspace (read-only — a multi-node union has no single addressable subject to structurally
	 * replace the way node-level `saveScopedTurtle` does, research §9).
	 */
	type TriplesPanelScope =
		| { kind: 'node'; iri: string; namespaceBaseIri: string }
		| { kind: 'workspace'; workspaceIri: string; label: string }
		| { kind: 'all' };

	interface Props {
		scope: TriplesPanelScope;
		/** Every registered namespace (STORY-027's `fetchNamespaces()`), for the panel's selector. */
		namespaces: FetchedNamespace[];
		/** Base IRI the selector defaults to (STORY-031's active namespace) when the panel opens. */
		initialNamespaceBaseIri: string;
		/** Whether the node-scope entity carries the `AuthoritativeEntity` marker (data-catalog Story
		 *  003) — gates the Catalog tab (Story 009): catalog entries only exist for such classes, and
		 *  `scope.kind` must be `'node'` for the tab to make sense. */
		showCatalogTab: boolean;
		/** Data-catalog Story 014: which tab to activate. Defaults to `'schema'`; per-node "View
		 *  catalog" passes `'catalog'` so the panel opens straight onto the requested tab. Re-applied
		 *  whenever the caller passes a new value (not just on mount), so re-opening the already-open
		 *  panel from a different menu entry still jumps tabs. */
		initialTab?: TabPartition;
		onClose: () => void;
		/** Called after a successful save so the canvas can reflect the edit without a page reload. */
		onSaved: () => void;
	}

	let {
		scope,
		namespaces,
		initialNamespaceBaseIri,
		showCatalogTab,
		initialTab = 'schema',
		onClose,
		onSaved
	}: Props = $props();

	// Set once from `initialNamespaceBaseIri` when the panel mounts; the user's own selection then
	// persists across `scope` changes (canvas selection) without resetting to the default.
	let selectedNamespace = $state(initialNamespaceBaseIri);

	/** The node-scope IRI, or `null` for `'all'`/`'workspace'` scope — the single place every
	 *  catalog/save/download helper below reads "is there one addressable node" from, so a Workspace's
	 *  multi-node union is never mistaken for a single editable subject (STORY-082). */
	function nodeIri(): string | null {
		return scope.kind === 'node' ? scope.iri : null;
	}

	/** STORY-082: a Workspace's multi-node union has no single addressable subject to structurally
	 *  replace the way node-level `saveScopedTurtle` does — editing is out of scope entirely at this
	 *  level (research §9), so the pencil/save controls are absent, not merely disabled. */
	const editingAllowed = $derived(scope.kind !== 'workspace');

	/** STORY-018's Schema/Shapes tabs, plus Story 009's Catalog tab — unlike Schema/Shapes (a
	 *  `turtle.ts` `Partition` filtered out of one whole-graph fetch), Catalog lives in its own
	 *  graph entirely and is fetched/saved through its own dedicated connector methods, so it isn't
	 *  a `Partition` value. */
	type TabPartition = 'schema' | 'shapes' | 'catalog';

	interface TabState {
		editing: boolean;
		savedText: string;
		draftText: string;
		saving: boolean;
		issues: ValidationIssue[];
	}

	function makeTabState(): TabState {
		return { editing: false, savedText: '', draftText: '', saving: false, issues: [] };
	}

	let activeTab = $state<TabPartition>(initialTab);
	let schemaTab = $state<TabState>(makeTabState());
	let shapesTab = $state<TabState>(makeTabState());
	let catalogTab = $state<TabState>(makeTabState());
	let generatingCatalog = $state(false);
	const currentTab = $derived(
		activeTab === 'schema' ? schemaTab : activeTab === 'shapes' ? shapesTab : catalogTab
	);

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let highlightEl = $state<HTMLPreElement>();
	let textareaEl = $state<HTMLTextAreaElement>();

	// Trailing newline keeps the highlight overlay's last (empty) line the same height as the
	// textarea's, so the two stay pixel-aligned even when `draftText` ends with "\n".
	const highlightedHtml = $derived(highlightTurtle(currentTab.draftText + '\n'));

	function syncHighlightScroll() {
		if (!highlightEl || !textareaEl) return;
		highlightEl.scrollTop = textareaEl.scrollTop;
		highlightEl.scrollLeft = textareaEl.scrollLeft;
	}

	async function load(currentScope: TriplesPanelScope, namespaceBaseIri: string) {
		loading = true;
		loadError = null;
		schemaTab.issues = [];
		schemaTab.editing = false;
		shapesTab.issues = [];
		shapesTab.editing = false;
		catalogTab.issues = [];
		catalogTab.editing = false;
		try {
			if (currentScope.kind === 'workspace') {
				const pair = await sparqlConnector.fetchScopedTurtleForWorkspace(currentScope.workspaceIri);
				schemaTab.savedText = pair.schema;
				schemaTab.draftText = pair.schema;
				shapesTab.savedText = pair.shapes;
				shapesTab.draftText = pair.shapes;
				catalogTab.savedText = '';
				catalogTab.draftText = '';
				return;
			}
			const iri = currentScope.kind === 'node' ? currentScope.iri : null;
			const [pair, catalogText] = await Promise.all([
				sparqlConnector.fetchScopedTurtlePair(iri, namespaceBaseIri),
				iri !== null && showCatalogTab
					? sparqlConnector.fetchCatalogTurtleForClass(iri, namespaceBaseIri)
					: Promise.resolve('')
			]);
			schemaTab.savedText = pair.schema;
			schemaTab.draftText = pair.schema;
			shapesTab.savedText = pair.shapes;
			shapesTab.draftText = pair.shapes;
			catalogTab.savedText = catalogText;
			catalogTab.draftText = catalogText;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load triples';
		} finally {
			loading = false;
		}
	}

	/** Reloads just the Catalog tab's content — used after "Generate catalog" and after
	 *  `CatalogMetadataForm`'s direct-to-GraphDB writes, neither of which need a full reload of the
	 *  Schema/Shapes tabs. */
	async function reloadCatalogTab() {
		const iri = nodeIri();
		if (iri === null) return;
		const text = await sparqlConnector.fetchCatalogTurtleForClass(iri, selectedNamespace);
		catalogTab.savedText = text;
		catalogTab.draftText = text;
		catalogTab.editing = false;
		catalogTab.issues = [];
	}

	/** Story 008/012's "Generate catalog" action — a single entry point for both first-generation
	 *  and regeneration; `generateCatalogForClass` itself decides which, and never clobbers
	 *  user-entered `publisher`/`license`/`distribution` fields on a regeneration. */
	async function generateCatalog() {
		const iri = nodeIri();
		if (iri === null) return;
		generatingCatalog = true;
		catalogTab.issues = [];
		try {
			await sparqlConnector.generateCatalogForClass(iri, selectedNamespace);
			await reloadCatalogTab();
		} catch (err) {
			catalogTab.issues = [
				{ layer: 'structural', message: err instanceof Error ? err.message : String(err) }
			];
		} finally {
			generatingCatalog = false;
		}
	}

	// Re-fetches whenever the scope or the chosen namespace changes while the panel is open.
	$effect(() => {
		void load(scope, selectedNamespace);
	});

	// Jumps to the requested tab whenever the caller passes a new `initialTab` — e.g. clicking "View
	// catalog" on a different entity while the panel is already open on the Schema tab.
	$effect(() => {
		activeTab = initialTab;
	});

	function startEdit() {
		currentTab.draftText = currentTab.savedText;
		currentTab.issues = [];
		currentTab.editing = true;
	}

	function cancelEdit() {
		currentTab.draftText = currentTab.savedText;
		currentTab.issues = [];
		currentTab.editing = false;
	}

	async function save() {
		const iri = nodeIri();
		currentTab.saving = true;
		currentTab.issues = [];
		try {
			if (activeTab === 'catalog') {
				if (iri === null) throw new Error('Catalog entries require a selected entity');
				await sparqlConnector.saveCatalogTurtleForClass(iri, currentTab.draftText, selectedNamespace);
			} else {
				await sparqlConnector.saveScopedTurtle(iri, currentTab.draftText, activeTab, selectedNamespace);
			}
			currentTab.editing = false;
			onSaved();
			await load(scope, selectedNamespace);
		} catch (err) {
			currentTab.issues =
				err instanceof SchemaValidationError ? err.issues : [{ layer: 'syntax', message: String(err) }];
		} finally {
			currentTab.saving = false;
		}
	}

	/** Browser-native download — no new dependency (`research.md` §4.7). */
	function downloadTurtle(filename: string, text: string) {
		const blob = new Blob([text], { type: 'text/turtle' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function handleDownload() {
		const base =
			scope.kind === 'node'
				? extractLocalName(scope.iri)
				: scope.kind === 'workspace'
					? scope.label.replace(/\s+/g, '-')
					: null;
		const filename = base ? `${base}.${activeTab}.ttl` : `${activeTab}.ttl`;
		downloadTurtle(filename, currentTab.draftText);
	}

	// -- LinkML export (STORY-070) --------------------------------------------------------------
	// Unlike the Turtle download above, this isn't scoped down to a single selected entity — a
	// LinkML schema file naturally represents a whole schema (STORY-068/069's exporter takes a
	// whole `CanvasModel`, not a triple-level selection), so this always exports the currently
	// selected namespace's full schema, regardless of `selectedIri`. Available whenever the panel
	// itself is open, matching the Turtle download's availability.

	let exportingLinkML = $state(false);
	let linkMLError = $state<string | null>(null);

	function downloadYaml(filename: string, text: string) {
		const blob = new Blob([text], { type: 'text/yaml' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleDownloadLinkML() {
		exportingLinkML = true;
		linkMLError = null;
		try {
			const schema = await sparqlConnector.fetchFullSchemaForAllNamespaces();
			const model = buildCanvasModel(schema, externalVocabStore.asPrefixMap());
			const ns = namespaces.find((n) => n.baseIri === selectedNamespace);
			const yaml = canvasModelToLinkML(model, namespaces, ns?.prefix ?? 'schema');
			downloadYaml(`${ns?.prefix ?? 'schema'}.linkml.yaml`, yaml);
		} catch (err) {
			linkMLError = err instanceof Error ? err.message : 'Failed to export LinkML';
		} finally {
			exportingLinkML = false;
		}
	}

	const layerLabel: Record<ValidationIssue['layer'], string> = {
		syntax: 'Syntax',
		shacl: 'SHACL well-formedness',
		structural: 'OWL/RDFS structural'
	};

	const scopeLabel = $derived(
		scope.kind === 'node' ? extractLocalName(scope.iri) : scope.kind === 'workspace' ? scope.label : 'Whole schema graph'
	);
	const tabLabel: Record<TabPartition, string> = { schema: 'Schema', shapes: 'Shapes', catalog: 'Catalog' };
	const visibleTabs = $derived(
		showCatalogTab ? (['schema', 'shapes', 'catalog'] as const) : (['schema', 'shapes'] as const)
	);
</script>

<div class="triples-panel">
	<div class="panel-header">
		<h2>{tabLabel[activeTab]} — {scopeLabel}</h2>
		<button class="close-button" onclick={onClose} aria-label="Close">✕</button>
	</div>

	<div class="tab-switch" role="tablist">
		{#each visibleTabs as tab (tab)}
			<button
				role="tab"
				aria-selected={activeTab === tab}
				class="tab-button"
				class:active={activeTab === tab}
				onclick={() => (activeTab = tab)}
			>
				{tabLabel[tab]}
			</button>
		{/each}
		<div class="spacer"></div>
		{#if namespaces.length > 0 && scope.kind !== 'workspace'}
			<select
				class="namespace-select"
				aria-label="Namespace"
				bind:value={selectedNamespace}
			>
				{#each namespaces as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix}</option>
				{/each}
			</select>
		{/if}
	</div>

	<div class="panel-body">
		{#if loading}
			<p class="status">Loading…</p>
		{:else if loadError}
			<p class="status error">{loadError}</p>
		{:else if activeTab === 'catalog' && nodeIri() === null}
			<p class="status">Select an entity to view or generate its catalog entry.</p>
		{:else if activeTab === 'catalog' && catalogTab.savedText === '' && !currentTab.editing}
			{#if currentTab.issues.length > 0}
				<ul class="issues">
					{#each currentTab.issues as issue, i (i)}
						<li><strong>{layerLabel[issue.layer]}:</strong> {issue.message}</li>
					{/each}
				</ul>
			{/if}
			<p class="status">No catalog entry has been generated yet for this entity.</p>
			<button class="primary" onclick={generateCatalog} disabled={generatingCatalog}>
				{generatingCatalog ? 'Generating…' : 'Generate catalog'}
			</button>
		{:else}
			{#if currentTab.issues.length > 0}
				<ul class="issues">
					{#each currentTab.issues as issue, i (i)}
						<li><strong>{layerLabel[issue.layer]}:</strong> {issue.message}</li>
					{/each}
				</ul>
			{/if}

			{#if activeTab === 'catalog' && nodeIri() !== null}
				<CatalogMetadataForm classIri={nodeIri() ?? ''} namespaceBaseIri={selectedNamespace} onSaved={reloadCatalogTab} />
			{/if}

			<div class="editor-wrap">
				<pre class="turtle-highlight" bind:this={highlightEl} aria-hidden="true"><code>{@html highlightedHtml}</code></pre>
				<textarea
					class="turtle-editor"
					readonly={!currentTab.editing}
					bind:value={currentTab.draftText}
					bind:this={textareaEl}
					onscroll={syncHighlightScroll}
					spellcheck="false"
				></textarea>
			</div>

			{#if linkMLError}
				<p class="status error">{linkMLError}</p>
			{/if}

			<div class="panel-actions">
				<button class="secondary" onclick={handleDownload}>Download .ttl</button>
				<button
					class="secondary"
					onclick={handleDownloadLinkML}
					disabled={exportingLinkML}
					title="Download the current namespace's full schema as a LinkML (https://linkml.io/) YAML file."
				>
					{exportingLinkML ? 'Exporting…' : 'Download LinkML'}
				</button>
				{#if activeTab === 'catalog' && nodeIri() !== null}
					<button class="secondary" onclick={generateCatalog} disabled={generatingCatalog}>
						{generatingCatalog ? 'Regenerating…' : 'Regenerate'}
					</button>
				{/if}
				<div class="spacer"></div>
				{#if editingAllowed}
					{#if currentTab.editing}
						<button class="secondary" onclick={cancelEdit} disabled={currentTab.saving}>Cancel</button>
						<button class="primary" onclick={save} disabled={currentTab.saving}>
							{currentTab.saving ? 'Saving…' : 'Save'}
						</button>
					{:else}
						<button class="primary" onclick={startEdit}>Edit</button>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.triples-panel {
		position: fixed;
		top: var(--nav-height, 60px);
		right: 0;
		bottom: 0;
		width: min(560px, 45vw);
		background: var(--color-bg-secondary);
		border-left: 1px solid var(--color-border);
		box-shadow: -4px 0 16px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		z-index: 500;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.panel-header h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.close-button {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		font-size: 1rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
	}

	.close-button:hover {
		color: var(--color-text);
	}

	.tab-switch {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.6rem 1.25rem 0;
	}

	.namespace-select {
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.8rem;
	}

	.tab-button {
		padding: 0.4rem 0.9rem;
		border-radius: 6px 6px 0 0;
		background: transparent;
		border: 1px solid transparent;
		border-bottom: none;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.tab-button:hover {
		color: var(--color-text);
	}

	.tab-button.active {
		background: var(--color-bg);
		border-color: var(--color-border);
		color: var(--color-text);
		font-weight: 600;
	}

	.panel-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		min-height: 0;
	}

	.status {
		color: var(--color-text-muted);
	}

	.status.error {
		color: var(--color-error);
	}

	.issues {
		margin: 0;
		padding: 0.5rem 0.75rem;
		list-style: none;
		background: var(--color-error-bg);
		border: 1px solid var(--color-error);
		border-radius: 6px;
		color: var(--color-error);
		font-size: 0.85rem;
	}

	/* Syntax highlighting overlay: `.turtle-highlight` and `.turtle-editor` are stacked exactly on
	   top of each other with identical font metrics/padding. The textarea's own text is made
	   transparent so the colored tokens underneath show through, while the textarea itself stays
	   on top to keep receiving clicks, selection, and the caret. */
	.editor-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
	}

	.turtle-highlight,
	.turtle-editor {
		position: absolute;
		inset: 0;
		margin: 0;
		padding: 0.75rem;
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.8rem;
		line-height: 1.4;
		white-space: pre-wrap;
		word-break: break-word;
		overflow: auto;
	}

	.turtle-highlight {
		color: var(--color-text);
		pointer-events: none;
	}

	.turtle-highlight code {
		font: inherit;
	}

	.turtle-editor {
		resize: none;
		color: transparent;
		caret-color: var(--color-text);
		background: transparent;
		border: none;
		border-radius: 6px;
	}

	.turtle-editor[readonly] {
		caret-color: transparent;
	}

	:global(.ttl-comment) {
		color: var(--ttl-comment);
		font-style: italic;
	}

	:global(.ttl-keyword) {
		color: var(--ttl-keyword);
		font-weight: 600;
	}

	:global(.ttl-iri) {
		color: var(--ttl-iri);
	}

	:global(.ttl-prefixed) {
		color: var(--ttl-prefixed);
	}

	:global(.ttl-string) {
		color: var(--ttl-string);
	}

	:global(.ttl-number) {
		color: var(--ttl-number);
	}

	:global(.ttl-bnode) {
		color: var(--ttl-bnode);
	}

	:global(.ttl-at) {
		color: var(--ttl-keyword);
	}

	:global(.ttl-punctuation) {
		color: var(--color-text-muted);
	}

	.panel-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.spacer {
		flex: 1;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
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

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
