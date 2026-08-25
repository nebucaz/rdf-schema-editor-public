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
	let onReload: () => void = () => {};
	let onToggleTriples: () => void = () => {};

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
		registerReload(fn: () => void) {
			onReload = fn;
		},
		registerToggleTriples(fn: () => void) {
			onToggleTriples = fn;
		},
		reload() {
			onReload();
		},
		toggleTriples() {
			onToggleTriples();
		},
		openExternalVocabManagement() {
			externalVocabManagementOpen = true;
		}
	};
}

export const workbenchActions = createWorkbenchActionsStore();
