<script lang="ts">
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import HamburgerMenu from '$lib/components/HamburgerMenu.svelte';
	import NamespaceFilter from '$lib/components/NamespaceFilter.svelte';
	import ViewModeToggle from '$lib/components/ViewModeToggle.svelte';
	import DescriptionVisibilityToggle from '$lib/components/DescriptionVisibilityToggle.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import NamespaceManagementView from '$lib/components/NamespaceManagementView.svelte';
	import ExternalVocabularyManagementView from '$lib/components/ExternalVocabularyManagementView.svelte';
	import ImportResultView from '$lib/components/ImportResultView.svelte';
	import { sparqlConnector, type ImportSummary } from '$lib/services/sparql-connector';
	import { quadsToNQuads } from '$lib/services/turtle';
	import { SchemaValidationError } from '$lib/services/validation';
	import { DEFAULT_NAMESPACE_BASE_IRI } from '$lib/config';
	import { activeNamespaceStore } from '$lib/stores/active-namespace-store';
	import { workbenchActions } from '$lib/stores/workbench-actions.svelte';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { externalVocabStore } from '$lib/stores/external-vocab-store.svelte';

	let { children } = $props();

	let showNamespaceManagement = $state(false);
	let showExternalVocabManagement = $state(false);
	let exportingQuads = $state(false);

	let importFileInput = $state<HTMLInputElement | undefined>();
	let importing = $state(false);
	let importSummary = $state<ImportSummary | null>(null);
	let importError = $state<string | null>(null);

	let activeNamespace = $state(activeNamespaceStore.getActive() ?? DEFAULT_NAMESPACE_BASE_IRI);

	onMount(() => {
		void namespaceStore.ensureLoaded();
		void externalVocabStore.ensureLoaded();
	});

	function handleActiveNamespaceChange(baseIri: string) {
		activeNamespace = baseIri;
		activeNamespaceStore.setActive(baseIri);
	}

	/** Browser-native download — no new dependency (matches `TriplesPanel.svelte`'s helper). */
	function downloadFile(filename: string, text: string, mimeType: string) {
		const blob = new Blob([text], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	/** STORY-036: exports every registered namespace's three graphs as one N-Quads file, each
	 *  triple's graph term preserved. */
	async function handleExportQuads() {
		exportingQuads = true;
		try {
			const quads = await sparqlConnector.fetchAllQuadsForExport();
			const nquads = await quadsToNQuads(quads);
			downloadFile('export.nq', nquads, 'application/n-quads');
		} finally {
			exportingQuads = false;
		}
	}

	function readFileAsText(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
			reader.readAsText(file);
		});
	}

	/** STORY-045: reads the picked `.ttl` file client-side and merges it into the active namespace
	 *  via STORY-044's `importTurtle`, never deleting anything. On success, reuses the existing
	 *  "Reload from GraphDB" wiring (`workbenchActions.reload()`) and STORY-037's
	 *  `namespaceStore.refresh()` so the merged content — and any namespace the import newly touched
	 *  — show up immediately. Parse/validation failures surface as a specific error instead of being
	 *  swallowed; STORY-044 guarantees zero writes happened in that case. */
	async function handleImportFileSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-selecting the same file later (no change-event otherwise)
		if (!file) return;

		importing = true;
		importSummary = null;
		importError = null;
		try {
			const text = await readFileAsText(file);
			const summary = await sparqlConnector.importTurtle(text, activeNamespace);
			importSummary = summary;
			workbenchActions.reload();
			void namespaceStore.refresh();
		} catch (err) {
			importError =
				err instanceof SchemaValidationError
					? err.issues.map((i) => `[${i.layer}] ${i.message}`).join('\n')
					: err instanceof Error
						? err.message
						: 'Failed to import Turtle file';
		} finally {
			importing = false;
		}
	}
</script>

<ModeWatcher defaultMode="system" />

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>RDF Schema Editor</title>
</svelte:head>

<div class="app-container">
	<header class="app-header">
		<span class="app-title">RDF Schema Editor</span>
		<div class="app-header-actions">
			{#if namespaceStore.namespaces.length > 0}
				<select
					class="namespace-select"
					aria-label="Active namespace"
					value={activeNamespace}
					onchange={(e) => handleActiveNamespaceChange(e.currentTarget.value)}
				>
					{#each namespaceStore.namespaces as ns (ns.baseIri)}
						<option value={ns.baseIri}>{ns.prefix}</option>
					{/each}
				</select>
			{/if}
			<ViewModeToggle
				viewMode={workbenchActions.viewMode}
				onChange={(mode) => workbenchActions.setViewMode(mode)}
			/>
			<DescriptionVisibilityToggle />
			<NamespaceFilter
				namespaces={namespaceStore.namespaces}
				hiddenNamespaces={workbenchActions.hiddenNamespaces}
				onToggle={(baseIri) => workbenchActions.toggleNamespaceVisibility(baseIri)}
			/>
			<ThemeToggle />
			<HamburgerMenu>
				{#snippet children()}
					<button type="button" class="menu-item" onclick={() => (showNamespaceManagement = true)}>
						Namespaces
					</button>
					<button type="button" class="menu-item" onclick={() => (showExternalVocabManagement = true)}>
						External Vocabularies
					</button>
					<button
						type="button"
						class="menu-item"
						onclick={() => workbenchActions.reload()}
						disabled={workbenchActions.loading}
					>
						{workbenchActions.loading ? 'Loading…' : '⟳ Reload from GraphDB'}
					</button>
					<button type="button" class="menu-item" onclick={() => workbenchActions.toggleTriples()}>
						{workbenchActions.triplesOpen ? 'Hide Triples' : 'View Triples'}
					</button>
					<button
						type="button"
						class="menu-item"
						onclick={() => workbenchActions.exportSvg()}
						disabled={workbenchActions.exportingSvg}
						title="Export the whole canvas as SVG — or, if any entities are selected, just the selection and the relations between them. The exported file embeds HTML (foreignObject) for node visuals, so it may not open correctly in every external vector/PDF tool."
					>
						{workbenchActions.exportingSvg ? 'Exporting…' : 'Export SVG'}
					</button>
					<button
						type="button"
						class="menu-item"
						onclick={() => void handleExportQuads()}
						disabled={exportingQuads}
					>
						{exportingQuads ? 'Exporting…' : 'Export quads'}
					</button>
					<button
						type="button"
						class="menu-item"
						onclick={() => importFileInput?.click()}
						disabled={importing}
					>
						{importing ? 'Importing…' : 'Import Turtle…'}
					</button>
				{/snippet}
			</HamburgerMenu>
			<input
				bind:this={importFileInput}
				type="file"
				accept=".ttl"
				class="import-file-input"
				onchange={(e) => void handleImportFileSelected(e)}
			/>
		</div>
	</header>
	<main class="app-main">
		{@render children()}
	</main>
</div>

<Modal isOpen={showNamespaceManagement} title="Namespaces" onClose={() => (showNamespaceManagement = false)}>
	<NamespaceManagementView />
</Modal>

<Modal
	isOpen={showExternalVocabManagement || workbenchActions.externalVocabManagementOpen}
	title="External Vocabularies"
	onClose={() => {
		showExternalVocabManagement = false;
		workbenchActions.externalVocabManagementOpen = false;
	}}
>
	<ExternalVocabularyManagementView />
</Modal>

<Modal
	isOpen={importSummary !== null || importError !== null}
	title={importError ? 'Import Failed' : 'Import Result'}
	onClose={() => {
		importSummary = null;
		importError = null;
	}}
>
	{#if importError}
		<p class="import-error">{importError}</p>
	{:else if importSummary}
		<ImportResultView summary={importSummary} />
	{/if}
</Modal>

<style>
	.app-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--nav-height);
		padding: 0 1.5rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.app-title {
		font-weight: 600;
	}

	.import-file-input {
		display: none;
	}

	.import-error {
		color: var(--color-error);
		white-space: pre-wrap;
		font-size: 0.9rem;
	}

	.app-header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.namespace-select {
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.menu-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 0.875rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.menu-item:hover {
		background: var(--color-hover);
	}

	.menu-item:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.app-main {
		flex: 1;
		overflow: auto;
	}
</style>
