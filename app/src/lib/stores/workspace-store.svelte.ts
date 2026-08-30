/**
 * Shared Workspace list (STORY-077), mirroring `namespace-store.svelte.ts` exactly: the navbar's
 * active-Workspace `<select>` and `+page.svelte`'s active-Workspace resolution both need the same
 * up-to-date list, so it's centralized here instead of each holding its own local array populated
 * via its own `sparqlConnector.fetchWorkspaces()` call.
 *
 * Not `localStorage`-backed (unlike `active-workspace-store.ts`) — Workspace *data* lives in
 * GraphDB, so this is a `.svelte.ts` reactive singleton, same shape as `namespace-store.svelte.ts`.
 */
import { sparqlConnector, type FetchedWorkspace } from '$lib/services/sparql-connector';

function createWorkspaceStore() {
	let workspaces = $state<FetchedWorkspace[]>([]);
	let loading = $state(false);
	let initialized = false;
	let pending: Promise<void> | null = null;

	async function refresh(): Promise<void> {
		loading = true;
		try {
			workspaces = await sparqlConnector.fetchWorkspaces();
		} finally {
			loading = false;
		}
	}

	/** Fetches once, the first time any consumer calls it; later calls are no-ops. Consumers that
	 *  mutate workspaces (create/rename/delete) or trigger a full reload should call `refresh()`
	 *  directly instead, to force a re-fetch. */
	function ensureLoaded(): Promise<void> {
		if (!initialized) {
			initialized = true;
			pending = refresh();
		}
		return pending!;
	}

	return {
		get workspaces() {
			return workspaces;
		},
		get loading() {
			return loading;
		},
		ensureLoaded,
		refresh
	};
}

export const workspaceStore = createWorkspaceStore();
