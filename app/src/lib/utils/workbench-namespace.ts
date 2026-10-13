/**
 * Namespace scope helpers for the Query Workbench (STORY-187). The workbench keeps its own
 * selection, independent of the canvas's `namespaceVisibilityStore`; the default is derived from each
 * namespace's author-set `defaultHidden` flag — nothing here knows the bookkeeping namespace's IRI.
 */

interface NamespaceScopeInfo {
	baseIri: string;
	defaultHidden: boolean;
}

/** Base IRIs of every namespace not flagged `defaultHidden`. */
export function defaultWorkbenchNamespaces(namespaces: NamespaceScopeInfo[]): string[] {
	return namespaces.filter((ns) => !ns.defaultHidden).map((ns) => ns.baseIri);
}

/** The namespaces offered in the selection control (`listedInFilter`) that are not currently
 *  selected, in the shape `NamespaceFilter.svelte` expects (`hiddenNamespaces`). */
export function hiddenFromSelection(
	namespaces: (NamespaceScopeInfo & { listedInFilter: boolean })[],
	selected: string[]
): Set<string> {
	const sel = new Set(selected);
	return new Set(namespaces.filter((ns) => ns.listedInFilter && !sel.has(ns.baseIri)).map((ns) => ns.baseIri));
}
