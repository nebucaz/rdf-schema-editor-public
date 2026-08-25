/**
 * Shared namespace list (STORY-037). `+layout.svelte`'s active-namespace `<select>`,
 * `NamespaceManagementView.svelte`'s CRUD modal, and `+page.svelte`'s `namespaceOptions` (feeding
 * `NamespaceFilter`/`TriplesPanel`/`EntityForm`/`AssociationForm`/`MemberForm`) previously each held
 * their own local `namespaces` array, populated once via `sparqlConnector.fetchNamespaces()` in their
 * own `onMount` — so a namespace created or deleted in one place never appeared in the others without
 * a full page reload. This store centralizes that fetch behind a single reactive `namespaces` value.
 *
 * Unlike `layout-store.ts`/`node-color-store.ts`, this isn't `localStorage`-backed — namespaces live
 * in GraphDB, not the browser — so it's a `.svelte.ts` reactive singleton (like
 * `workbench-actions.svelte.ts`) rather than an injectable-storage class.
 */
import { sparqlConnector, type FetchedNamespace } from '$lib/services/sparql-connector';

function createNamespaceStore() {
	let namespaces = $state<FetchedNamespace[]>([]);
	let loading = $state(false);
	let initialized = false;
	let pending: Promise<void> | null = null;

	async function refresh(): Promise<void> {
		loading = true;
		try {
			namespaces = await sparqlConnector.fetchNamespaces();
		} finally {
			loading = false;
		}
	}

	/** Fetches once, the first time any consumer calls it; later calls are no-ops. Consumers that
	 *  mutate namespaces (create/delete/edit) or trigger a full reload should call `refresh()`
	 *  directly instead, to force a re-fetch. */
	function ensureLoaded(): Promise<void> {
		if (!initialized) {
			initialized = true;
			pending = refresh();
		}
		return pending!;
	}

	return {
		get namespaces() {
			return namespaces;
		},
		get loading() {
			return loading;
		},
		ensureLoaded,
		refresh
	};
}

export const namespaceStore = createNamespaceStore();
