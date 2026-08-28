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
	let onReload: () => void = () => {};
	let onToggleTriples: () => void = () => {};
	let onExportSvg: () => void = () => {};
	let onToggleNamespaceVisibility: (baseIri: string) => void = () => {};
	let onSetViewMode: (mode: 'schema' | 'instances') => void = () => {};

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
		openExternalVocabManagement() {
			externalVocabManagementOpen = true;
		}
	};
}

export const workbenchActions = createWorkbenchActionsStore();
