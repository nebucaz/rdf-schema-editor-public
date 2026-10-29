<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import SignInRequired from '$lib/components/SignInRequired.svelte';
	import { devLogout } from '$lib/services/auth-client';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { ModeWatcher, toggleMode, mode } from 'mode-watcher';
	import AppNav from '$lib/components/AppNav.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import ProfileView from '$lib/components/ProfileView.svelte';
	import DropdownMenu from '$lib/components/DropdownMenu.svelte';
	import DropdownSubmenuGroup from '$lib/components/DropdownSubmenuGroup.svelte';
	import NamespaceFilter from '$lib/components/NamespaceFilter.svelte';
	import ViewModeToggle from '$lib/components/ViewModeToggle.svelte';
	import DescriptionVisibilityToggle from '$lib/components/DescriptionVisibilityToggle.svelte';
	import InheritedAttributesVisibilityToggle from '$lib/components/InheritedAttributesVisibilityToggle.svelte';
	import ReverseRelationsVisibilityToggle from '$lib/components/ReverseRelationsVisibilityToggle.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import NamespaceManagementView from '$lib/components/NamespaceManagementView.svelte';
	import WorkspaceManagementView from '$lib/components/WorkspaceManagementView.svelte';
	import ExternalVocabularyManagementView from '$lib/components/ExternalVocabularyManagementView.svelte';
	import ImportResultView from '$lib/components/ImportResultView.svelte';
	import ImportTurtleDialog from '$lib/components/ImportTurtleDialog.svelte';
	import { DEFAULT_NAMESPACE_BASE_IRI, DEV_LOGIN_ENABLED } from '$lib/config';
	import QueryConsoleView from '$lib/components/QueryConsoleView.svelte';
	import MissingConceptsPanel from '$lib/components/MissingConceptsPanel.svelte';
	import SettingsView from '$lib/components/SettingsView.svelte';
	import DocumentationPanel from '$lib/components/DocumentationPanel.svelte';
	import {
		sparqlConnector,
		type ImportSummary,
		type WorkspaceImportSummary
	} from '$lib/services/sparql-connector';
	import { quadsToNQuads } from '$lib/services/turtle';
	import { SchemaValidationError } from '$lib/services/validation';
	import { workbenchActions } from '$lib/stores/workbench-actions.svelte';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { validationReportFilterStore } from '$lib/stores/validation-report-filter-store.svelte';
	import { workspaceStore } from '$lib/stores/workspace-store.svelte';
	import { externalVocabStore } from '$lib/stores/external-vocab-store.svelte';
	import { resolveRouteView } from '$lib/utils/route-views';
	import { downloadFile } from '$lib/utils/download';
	import { filterListedNamespaces } from '$lib/utils/visibility';
	import WorkspaceImportResultView from '$lib/components/WorkspaceImportResultView.svelte';

	let { children } = $props();

	let showNamespaceManagement = $state(false);
	let showWorkspaceManagement = $state(false);
	let showExternalVocabManagement = $state(false);
	let showQueryConsole = $state(false);
	let showMissingConcepts = $state(false);
	let showSettings = $state(false);
	let showDocumentation = $state(false);
	let exportingQuads = $state(false);

	let showImportDialog = $state(false);
	let importing = $state(false);
	let importSummary = $state<ImportSummary | null>(null);
	let importError = $state<string | null>(null);

	let importWorkspaceFileInput = $state<HTMLInputElement | undefined>();
	let importingWorkspace = $state(false);
	let workspaceImportSummary = $state<WorkspaceImportSummary | null>(null);
	let workspaceImportError = $state<string | null>(null);

	/** STORY-118/119's Identities area is a separate surface from the canvas — no `viewMode`,
	 *  namespace/workspace selection, or canvas-visibility toggles apply there, and several
	 *  settings-menu actions (reload, triples, SVG export, workspace import) operate on
	 *  canvas-only state that isn't even mounted on this route. */
	const routeView = $derived(resolveRouteView(page.url.pathname));
	const isIdentitiesView = $derived(routeView.isIdentitiesView);
	/** STORY-133: the Validation Report is its own route, not a modal; it shows only the namespace
	 *  filter in the header actions. */
	const isValidationView = $derived(routeView.isValidationView);
	/** STORY-185: the Query Workbench is its own route too, and — like Identities — has no canvas
	 *  state mounted, so the same canvas-only menu items are hidden there. */
	const isWorkbenchView = $derived(routeView.isWorkbenchView);
	/** True only on the canvas ("/") route — none of Identities, Validation or Workbench. Canvas-only
	 *  menu items (View Triples, Export SVG, Import Workspace) must key off actually being on the
	 *  canvas. */
	const isCanvasView = $derived(routeView.isCanvasView);
	/** Menu items that operate on canvas state and are hidden on both non-canvas "area" routes. */
	const hideCanvasOnlyItems = $derived(isIdentitiesView || isWorkbenchView || routeView.isReportView);

	let showProfile = $state(false);

	async function handleLogout() {
		const result = await devLogout();
		if (result.ok) await invalidateAll();
		return result;
	}

	// The data routes refuse a signed-out caller, so load only once a user exists (and again after a
	// login: ensureLoaded is a no-op once it has run).
	$effect(() => {
		if (!page.data.user) return;
		void namespaceStore.ensureLoaded();
		void workspaceStore.ensureLoaded();
		void externalVocabStore.ensureLoaded();
	});

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

	/** STORY-045: reads the chosen `.ttl` file client-side and merges it into `namespaceBaseIri` — the
	 *  target the Import dialog made the user pick explicitly — via STORY-044's `importTurtle`, never
	 *  deleting anything. On success, reuses the existing "Reload from GraphDB" wiring
	 *  (`workbenchActions.reload()`) and STORY-037's `namespaceStore.refresh()` so the merged content —
	 *  and any namespace the import newly touched — show up immediately. Parse/validation failures
	 *  surface as a specific error instead of being swallowed; STORY-044 guarantees zero writes
	 *  happened in that case. */
	async function handleImportFile(file: File, namespaceBaseIri: string) {
		showImportDialog = false;
		importing = true;
		importSummary = null;
		importError = null;
		try {
			const text = await readFileAsText(file);
			const summary = await sparqlConnector.importTurtle(text, namespaceBaseIri);
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

	/** STORY-094: reads a workspace-export bundle (STORY-090's `exportWorkspaceBundle` output)
	 *  client-side and merges it via STORY-092's `importWorkspaceBundle` — a separate entry from
	 *  "Import Turtle…" since the bundle carries Workspace/WorkspaceMembership/Note/Namespace rows
	 *  alongside ordinary schema/shapes content, and needs the workspace store refreshed on success
	 *  (a plain schema import never creates/merges a Workspace, so it only refreshes the namespace
	 *  list). */
	async function handleImportWorkspaceFileSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-selecting the same file later (no change-event otherwise)
		if (!file) return;

		importingWorkspace = true;
		workspaceImportSummary = null;
		workspaceImportError = null;
		try {
			const text = await readFileAsText(file);
			const summary = await sparqlConnector.importWorkspaceBundle(text);
			workspaceImportSummary = summary;
			workbenchActions.reload();
			void namespaceStore.refresh();
			void workspaceStore.refresh();
		} catch (err) {
			workspaceImportError =
				err instanceof SchemaValidationError
					? err.issues.map((i) => `[${i.layer}] ${i.message}`).join('\n')
					: err instanceof Error
						? err.message
						: 'Failed to import workspace bundle';
		} finally {
			importingWorkspace = false;
		}
	}
</script>

<!-- The head script it would inject is inline (blocked by the CSP) and pointless in a client-only app. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>RDF Schema Editor</title>
</svelte:head>

<div class="app-container">
	<header class="app-header">
		<a href="/" class="app-title">RDF Schema Editor</a>
		{#if page.data.user}
			<AppNav {routeView} />
		{/if}
		<div class="app-header-actions">
			{#if page.data.user}
				{#if isCanvasView}
					{#if namespaceStore.namespaces.length > 0}
						<select
							class="namespace-select"
							aria-label="Active namespace"
							title="Active namespace — where new classes, individuals, and namespace-scoped IRIs are created by default"
							value={workbenchActions.activeNamespace}
							onchange={(e) => workbenchActions.setActiveNamespace(e.currentTarget.value)}
						>
							{#each namespaceStore.namespaces as ns (ns.baseIri)}
								<option value={ns.baseIri}>{ns.prefix}</option>
							{/each}
						</select>
					{/if}
					{#if workspaceStore.workspaces.length > 0}
						<select
							class="workspace-select"
							aria-label="Active workspace"
							title="Active workspace — which diagram is shown on the canvas"
							value={workbenchActions.activeWorkspace}
							onchange={(e) => workbenchActions.setActiveWorkspace(e.currentTarget.value)}
						>
							{#each workspaceStore.workspaces as ws (ws.iri)}
								<option value={ws.iri}>{ws.label}</option>
							{/each}
						</select>
					{/if}
					<ViewModeToggle
						viewMode={workbenchActions.viewMode}
						onChange={(mode) => workbenchActions.setViewMode(mode)}
					/>
					<DescriptionVisibilityToggle />
					<InheritedAttributesVisibilityToggle />
					<ReverseRelationsVisibilityToggle />
					<NamespaceFilter
						namespaces={filterListedNamespaces(namespaceStore.namespaces)}
						hiddenNamespaces={workbenchActions.hiddenNamespaces}
						onToggle={(baseIri) => workbenchActions.toggleNamespaceVisibility(baseIri)}
					/>
				{:else if isValidationView}
					<NamespaceFilter
						namespaces={filterListedNamespaces(namespaceStore.namespaces)}
						hiddenNamespaces={validationReportFilterStore.hiddenNamespaces}
						onToggle={(baseIri) => validationReportFilterStore.toggle(baseIri)}
					/>
				{/if}
				<DropdownMenu label="Settings">
					{#snippet icon()}
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
							<circle cx="12" cy="12" r="3" />
						</svg>
					{/snippet}
					{#snippet children()}
						<DropdownSubmenuGroup label="Manage">
							{#snippet children()}
								<button
									type="button"
									class="menu-item"
									onclick={() => (showNamespaceManagement = true)}
								>
									Namespaces
								</button>
								{#if !hideCanvasOnlyItems}
									<button
										type="button"
										class="menu-item"
										onclick={() => (showWorkspaceManagement = true)}
									>
										Workspaces
									</button>
								{/if}
								<button
									type="button"
									class="menu-item"
									onclick={() => (showExternalVocabManagement = true)}
								>
									External Vocabularies
								</button>
							{/snippet}
						</DropdownSubmenuGroup>
						<DropdownSubmenuGroup label="Import / Export">
							{#snippet children()}
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
									onclick={() => (showImportDialog = true)}
									disabled={importing}
								>
									{importing ? 'Importing…' : 'Import Turtle…'}
								</button>
								{#if isCanvasView}
									<button
										type="button"
										class="menu-item"
										onclick={() => importWorkspaceFileInput?.click()}
										disabled={importingWorkspace}
										title="Merge a workspace-export bundle (STORY-090) — recreates the workspace, layout, and notes"
									>
										{importingWorkspace ? 'Importing…' : 'Import Workspace…'}
									</button>
								{/if}
								{#if isCanvasView}
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
										onclick={() => workbenchActions.exportErd()}
										title="Export the workspace as a strict-SVG ERD in Crow's Foot, Chen or UML notation — opens cleanly in Inkscape, Illustrator and Figma."
									>
										Export ERD…
									</button>
								{/if}
							{/snippet}
						</DropdownSubmenuGroup>
						<hr class="menu-divider" />
						{#if !hideCanvasOnlyItems}
							<button
								type="button"
								class="menu-item"
								onclick={() => workbenchActions.reload()}
								disabled={workbenchActions.loading}
							>
								{workbenchActions.loading ? 'Loading…' : '⟳ Reload from GraphDB'}
							</button>
						{/if}
						{#if isCanvasView}
							<button type="button" class="menu-item" onclick={() => workbenchActions.toggleTriples()}>
								{workbenchActions.triplesOpen ? 'Hide Triples' : 'View Triples'}
							</button>
						{/if}
						<hr class="menu-divider" />
						<button type="button" class="menu-item" onclick={() => (showQueryConsole = true)}>
							Queries
						</button>
						{#if !hideCanvasOnlyItems}
							<button type="button" class="menu-item" onclick={() => (showMissingConcepts = true)}>
								Missing Concepts
							</button>
						{/if}
						<hr class="menu-divider" />
						<button type="button" class="menu-item" onclick={() => (showSettings = true)}>
							Catalog settings…
						</button>
						<button type="button" class="menu-item" onclick={() => (showDocumentation = true)}>
							Documentation
						</button>
						<hr class="menu-divider" />
						<button type="button" class="menu-item" onclick={toggleMode}>
							{mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
						</button>
					{/snippet}
				</DropdownMenu>
				<UserMenu
					user={page.data.user}
					logoutEnabled={DEV_LOGIN_ENABLED}
					onProfile={() => (showProfile = true)}
					onLogout={handleLogout}
				/>
				<input
					bind:this={importWorkspaceFileInput}
					type="file"
					accept=".ttl"
					class="import-file-input"
					onchange={(e) => void handleImportWorkspaceFileSelected(e)}
				/>
			{/if}
		</div>
	</header>
	<main class="app-main">
		{#if page.data.user}
			{@render children()}
		{:else}
			<SignInRequired devLoginEnabled={DEV_LOGIN_ENABLED} onSignedIn={() => invalidateAll()} />
		{/if}
	</main>
</div>

{#if showDocumentation}
	<DocumentationPanel onClose={() => (showDocumentation = false)} />
{/if}

<Modal
	isOpen={showNamespaceManagement}
	title="Namespaces"
	onClose={() => (showNamespaceManagement = false)}
	dismissible={false}
>
	<NamespaceManagementView />
</Modal>

<Modal
	isOpen={showMissingConcepts}
	title="Missing Concepts"
	onClose={() => (showMissingConcepts = false)}
	dismissible={false}
>
	<MissingConceptsPanel namespaces={namespaceStore.namespaces} onCreated={() => workbenchActions.reload()} />
</Modal>

<Modal isOpen={showProfile} title="Profile" onClose={() => (showProfile = false)}>
	{#if page.data.user}
		<ProfileView user={page.data.user} />
	{/if}
</Modal>

<Modal isOpen={showSettings} title="Settings" onClose={() => (showSettings = false)} dismissible={false}>
	<SettingsView />
</Modal>

<Modal
	isOpen={showWorkspaceManagement}
	title="Workspaces"
	onClose={() => {
		showWorkspaceManagement = false;
		// Belt-and-suspenders re-sync: the navbar `<select>` below reads the same `workspaceStore`
		// singleton `WorkspaceManagementView` already refreshes on create/rename/delete, but closing
		// the dialog is a reliable point to force one more fetch so a newly created Workspace is never
		// left looking unselectable in the dropdown.
		void workspaceStore.refresh();
	}}
	dismissible={false}
>
	<WorkspaceManagementView />
</Modal>

<Modal
	isOpen={showExternalVocabManagement || workbenchActions.externalVocabManagementOpen}
	title="External Vocabularies"
	onClose={() => {
		showExternalVocabManagement = false;
		workbenchActions.externalVocabManagementOpen = false;
	}}
	dismissible={false}
>
	<ExternalVocabularyManagementView />
</Modal>

<Modal
	isOpen={showQueryConsole || workbenchActions.queryConsoleOpen}
	title="Queries"
	maxWidth="900px"
	onClose={() => {
		showQueryConsole = false;
		workbenchActions.queryConsoleOpen = false;
	}}
	dismissible={false}
>
	<QueryConsoleView />
</Modal>

<ImportTurtleDialog
	isOpen={showImportDialog}
	namespaces={namespaceStore.namespaces}
	activeNamespace={workbenchActions.activeNamespace}
	excludeBaseIri={DEFAULT_NAMESPACE_BASE_IRI}
	{importing}
	onImport={(file, ns) => void handleImportFile(file, ns)}
	onClose={() => (showImportDialog = false)}
/>

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

<Modal
	isOpen={workspaceImportSummary !== null || workspaceImportError !== null}
	title={workspaceImportError ? 'Workspace Import Failed' : 'Workspace Import Result'}
	onClose={() => {
		workspaceImportSummary = null;
		workspaceImportError = null;
	}}
>
	{#if workspaceImportError}
		<p class="import-error">{workspaceImportError}</p>
	{:else if workspaceImportSummary}
		<WorkspaceImportResultView summary={workspaceImportSummary} />
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
		gap: 1.5rem;
		height: var(--nav-height);
		padding: 0 1.5rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.app-title {
		flex-shrink: 0;
		white-space: nowrap;
		font-weight: 600;
		color: inherit;
		text-decoration: none;
	}

	.app-title:hover {
		text-decoration: underline;
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
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.namespace-select,
	.workspace-select {
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.menu-divider {
		border: none;
		border-top: 1px solid var(--color-border);
		margin: 0.4rem 0;
	}

	.app-main {
		flex: 1;
		overflow: auto;
	}
</style>
