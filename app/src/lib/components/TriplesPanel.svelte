<script lang="ts">
	import { sparqlConnector } from '$lib/services/sparql-connector';
	import type { Partition } from '$lib/services/turtle';
	import { SchemaValidationError, type ValidationIssue } from '$lib/services/validation';
	import { extractLocalName } from '$lib/utils/iri';
	import { highlightTurtle } from '$lib/utils/turtle-highlight';

	interface Props {
		/** `null` means "whole schema graph"; otherwise the IRI of the selected entity/relation. */
		selectedIri: string | null;
		onClose: () => void;
		/** Called after a successful save so the canvas can reflect the edit without a page reload. */
		onSaved: () => void;
	}

	let { selectedIri, onClose, onSaved }: Props = $props();

	/** `'all'` never appears here — STORY-018's tabs are always exactly one of these two. */
	type TabPartition = Exclude<Partition, 'all'>;

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

	let activeTab = $state<TabPartition>('schema');
	let schemaTab = $state<TabState>(makeTabState());
	let shapesTab = $state<TabState>(makeTabState());
	const currentTab = $derived(activeTab === 'schema' ? schemaTab : shapesTab);

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

	async function load(iri: string | null) {
		loading = true;
		loadError = null;
		schemaTab.issues = [];
		schemaTab.editing = false;
		shapesTab.issues = [];
		shapesTab.editing = false;
		try {
			const pair = await sparqlConnector.fetchScopedTurtlePair(iri);
			schemaTab.savedText = pair.schema;
			schemaTab.draftText = pair.schema;
			shapesTab.savedText = pair.shapes;
			shapesTab.draftText = pair.shapes;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load triples';
		} finally {
			loading = false;
		}
	}

	// Re-fetches whenever the canvas selection changes while the panel is open.
	$effect(() => {
		void load(selectedIri);
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
		const partition = activeTab;
		currentTab.saving = true;
		currentTab.issues = [];
		try {
			await sparqlConnector.saveScopedTurtle(selectedIri, currentTab.draftText, partition);
			currentTab.editing = false;
			onSaved();
			await load(selectedIri);
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
		const base = selectedIri ? extractLocalName(selectedIri) : null;
		const filename = base ? `${base}.${activeTab}.ttl` : `${activeTab}.ttl`;
		downloadTurtle(filename, currentTab.draftText);
	}

	const layerLabel: Record<ValidationIssue['layer'], string> = {
		syntax: 'Syntax',
		shacl: 'SHACL well-formedness',
		structural: 'OWL/RDFS structural'
	};

	const scopeLabel = $derived(selectedIri ? extractLocalName(selectedIri) : 'Whole schema graph');
	const tabLabel: Record<TabPartition, string> = { schema: 'Schema', shapes: 'Shapes' };
</script>

<div class="triples-panel">
	<div class="panel-header">
		<h2>{tabLabel[activeTab]} — {scopeLabel}</h2>
		<button class="close-button" onclick={onClose} aria-label="Close">✕</button>
	</div>

	<div class="tab-switch" role="tablist">
		{#each ['schema', 'shapes'] as const as tab (tab)}
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
	</div>

	<div class="panel-body">
		{#if loading}
			<p class="status">Loading…</p>
		{:else if loadError}
			<p class="status error">{loadError}</p>
		{:else}
			{#if currentTab.issues.length > 0}
				<ul class="issues">
					{#each currentTab.issues as issue, i (i)}
						<li><strong>{layerLabel[issue.layer]}:</strong> {issue.message}</li>
					{/each}
				</ul>
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

			<div class="panel-actions">
				<button class="secondary" onclick={handleDownload}>Download .ttl</button>
				<div class="spacer"></div>
				{#if currentTab.editing}
					<button class="secondary" onclick={cancelEdit} disabled={currentTab.saving}>Cancel</button>
					<button class="primary" onclick={save} disabled={currentTab.saving}>
						{currentTab.saving ? 'Saving…' : 'Save'}
					</button>
				{:else}
					<button class="primary" onclick={startEdit}>Edit</button>
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
		gap: 0.25rem;
		padding: 0.6rem 1.25rem 0;
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
