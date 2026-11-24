import { schemaStore } from './schema-store.js';

/** What the Triples panel shows: one node, the whole namespace, or a workspace (read-only). */
export type TriplesPanelScope =
	| { kind: 'node'; iri: string; namespaceBaseIri: string }
	| { kind: 'workspace'; workspaceIri: string; label: string }
	| { kind: 'all' };

export type TriplesPanelTab = 'schema' | 'instances' | 'shapes' | 'vocab' | 'catalog';

/** One open request: where the panel points and which tab it opens on. */
export interface TriplesPanelRequest {
	scope: TriplesPanelScope;
	initialTab: TriplesPanelTab;
	/** Namespace the selector starts on; the layout falls back to the active namespace. */
	namespaceBaseIri?: string;
	/** Whether the node-scope entity carries the catalog marker (canvas knows; other pages do not). */
	showCatalogTab?: boolean;
}

/**
 * Host state for the one `TriplesPanel` mounted in `+layout.svelte` (triples-tabs ADR T5). Pages
 * open it with a request; the canvas page also registers an `onSaved` handler (reload from
 * GraphDB), every other page falls back to refreshing the shared schema store.
 */
function createTriplesPanelStore() {
	let open = $state(false);
	let request = $state<TriplesPanelRequest>({ scope: { kind: 'all' }, initialTab: 'schema' });
	let onSaved: (() => void | Promise<unknown>) | null = null;

	return {
		get open() {
			return open;
		},
		get request() {
			return request;
		},
		show(next: TriplesPanelRequest) {
			request = next;
			open = true;
		},
		close() {
			open = false;
		},
		toggle(defaults: TriplesPanelRequest) {
			if (open) open = false;
			else this.show(defaults);
		},
		registerOnSaved(fn: (() => void | Promise<unknown>) | null) {
			onSaved = fn;
		},
		async notifySaved() {
			if (onSaved) await onSaved();
			else await schemaStore.refresh();
		}
	};
}

export const triplesPanel = createTriplesPanelStore();
