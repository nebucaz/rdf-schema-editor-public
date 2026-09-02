/**
 * Bridges page-owned canvas actions — reload from GraphDB, toggle the Triples panel — into
 * `+layout.svelte`'s hamburger menu (STORY-034), plus the reverse direction: opening the
 * layout-owned "External Vocabularies" modal (STORY-046) from `ExternalClassForm`'s "Manage
 * vocabularies" link, which lives inside `+page.svelte`'s canvas modals. Either way, the layout and
 * the page are siblings under `+layout.svelte`'s `children` snippet, not ancestor/descendant, so
 * props/context (which only flow down the component tree) can't carry state between them directly.
 * Not a `LocalStorage*Store` (`layout-store.ts`/`node-color-store.ts`) — nothing here is persisted,
 * it's an in-memory reactive bridge.
 */
function createWorkbenchActionsStore() {
	let loading = $state(false);
	let triplesOpen = $state(false);
	let externalVocabManagementOpen = $state(false);
	let exportingSvg = $state(false);
	let hiddenNamespaces = $state<Set<string>>(new Set());
	let viewMode = $state<'schema' | 'instances'>('schema');
	let activeWorkspace = $state<string | null>(null);
	let activeNamespace = $state<string | null>(null);
	let addElementOpen = $state(false);
	/** STORY-082: a one-shot request to open the Triples panel scoped to one Workspace — set by
	 *  `WorkspaceManagementView`'s "View triples" button (rendered inside `+layout.svelte`), read and
	 *  cleared by `+page.svelte` (which owns `showTriplesPanel`/`TriplesPanel`), mirroring
	 *  `externalVocabManagementOpen`'s cross-sibling bridge shape. A fresh object every call (even for
	 *  the same Workspace clicked twice in a row) so `+page.svelte`'s `$effect` reliably re-fires. */
	let triplesWorkspaceScope = $state<{ workspaceIri: string; label: string } | null>(null);
	let onReload: () => void = () => {};
	let onToggleTriples: () => void = () => {};
	let onExportSvg: () => void = () => {};
	let onToggleNamespaceVisibility: (baseIri: string) => void = () => {};
	let onSetViewMode: (mode: 'schema' | 'instances') => void = () => {};
	let onSetActiveWorkspace: (workspaceIri: string) => void = () => {};
	let onSetActiveNamespace: (baseIri: string) => void = () => {};

	return {
		get loading() {
			return loading;
		},
		set loading(value: boolean) {
			loading = value;
		},
		get triplesOpen() {
			return triplesOpen;
		},
		set triplesOpen(value: boolean) {
			triplesOpen = value;
		},
		get externalVocabManagementOpen() {
			return externalVocabManagementOpen;
		},
		set externalVocabManagementOpen(value: boolean) {
			externalVocabManagementOpen = value;
		},
		/** STORY-067: mirrors `loading`/`triplesOpen` — `+page.svelte` owns the export (it needs the
		 *  canvas's `nodes`/`edges`/DOM), the hamburger menu (`+layout.svelte`) triggers it. */
		get exportingSvg() {
			return exportingSvg;
		},
		set exportingSvg(value: boolean) {
			exportingSvg = value;
		},
		/** Namespace-visibility filter (STORY-033): `+page.svelte` owns the `Set` (it drives node/edge
		 *  hidden state and persists via `namespaceVisibilityStore`), the header's filter button
		 *  (`+layout.svelte`) only displays the current count and triggers toggles. */
		get hiddenNamespaces() {
			return hiddenNamespaces;
		},
		set hiddenNamespaces(value: Set<string>) {
			hiddenNamespaces = value;
		},
		/** Schema/Instances view mode (data-catalog Story 007): `+page.svelte` owns the canvas
		 *  rebuild, the header's segmented toggle (`+layout.svelte`) only displays the current value
		 *  and triggers changes — same bridge shape as `hiddenNamespaces`/`toggleNamespaceVisibility`. */
		get viewMode() {
			return viewMode;
		},
		set viewMode(value: 'schema' | 'instances') {
			viewMode = value;
		},
		/** Active Workspace (STORY-077): `+page.svelte` owns the resolved current value (it drives
		 *  `GraphDbLayoutStore`/the workspace-membership visibility gate and persists via
		 *  `activeWorkspaceStore`), the navbar's Workspace `<select>` (`+layout.svelte`) only displays
		 *  it and triggers changes — same bridge shape as `hiddenNamespaces`/`viewMode`. */
		get activeWorkspace() {
			return activeWorkspace;
		},
		set activeWorkspace(value: string | null) {
			activeWorkspace = value;
		},
		/** Active namespace (Sprint 6 Story 016): `+page.svelte` owns the canonical value (it drives
		 *  new-entity/relation namespace defaulting via `activeNamespaceBaseIri()` and persists via
		 *  `activeNamespaceStore`), the navbar's namespace `<select>` (`+layout.svelte`) only displays
		 *  it and triggers changes — same bridge shape as `activeWorkspace`/`setActiveWorkspace`. */
		get activeNamespace() {
			return activeNamespace;
		},
		set activeNamespace(value: string | null) {
			activeNamespace = value;
		},
		/** "Add Element" typeahead modal (STORY-080): `+layout.svelte`'s hamburger entry opens it,
		 *  `+page.svelte` owns the rendered `Modal`/`AddElementForm` (it needs the canvas's
		 *  `nextPosition()`/`addWorkspaceMember` wiring) — same bridge shape as
		 *  `externalVocabManagementOpen`. */
		get addElementOpen() {
			return addElementOpen;
		},
		set addElementOpen(value: boolean) {
			addElementOpen = value;
		},
		openAddElement() {
			addElementOpen = true;
		},
		get triplesWorkspaceScope() {
			return triplesWorkspaceScope;
		},
		set triplesWorkspaceScope(value: { workspaceIri: string; label: string } | null) {
			triplesWorkspaceScope = value;
		},
		registerReload(fn: () => void) {
			onReload = fn;
		},
		registerToggleTriples(fn: () => void) {
			onToggleTriples = fn;
		},
		registerExportSvg(fn: () => void) {
			onExportSvg = fn;
		},
		registerToggleNamespaceVisibility(fn: (baseIri: string) => void) {
			onToggleNamespaceVisibility = fn;
		},
		registerSetViewMode(fn: (mode: 'schema' | 'instances') => void) {
			onSetViewMode = fn;
		},
		registerSetActiveWorkspace(fn: (workspaceIri: string) => void) {
			onSetActiveWorkspace = fn;
		},
		registerSetActiveNamespace(fn: (baseIri: string) => void) {
			onSetActiveNamespace = fn;
		},
		reload() {
			onReload();
		},
		toggleTriples() {
			onToggleTriples();
		},
		exportSvg() {
			onExportSvg();
		},
		toggleNamespaceVisibility(baseIri: string) {
			onToggleNamespaceVisibility(baseIri);
		},
		setViewMode(mode: 'schema' | 'instances') {
			onSetViewMode(mode);
		},
		setActiveWorkspace(workspaceIri: string) {
			onSetActiveWorkspace(workspaceIri);
		},
		setActiveNamespace(baseIri: string) {
			onSetActiveNamespace(baseIri);
		},
		openExternalVocabManagement() {
			externalVocabManagementOpen = true;
		}
	};
}

export const workbenchActions = createWorkbenchActionsStore();
