/**
 * Namespace-visibility helpers shared by the initial canvas build and the live namespace-filter
 * toggle (STORY-033/`+page.svelte`). Extracted as pure functions so they're unit-testable without
 * a component-testing harness — this repo has none set up yet (see `CLAUDE.md`).
 *
 * STORY-076 composes an optional, second, independent `workspaceMembers` gate on top of the
 * pre-existing namespace-only gate — both are ORed as "should hide" conditions. `workspaceMembers`
 * stays optional (defaulting to "no workspace filtering") so every pre-existing namespace-only call
 * site/test keeps its exact prior behavior unmodified (the plan's risk assessment).
 */

/**
 * Whether `nodeId` is visible given its namespace tag, the current hidden-namespace set, and
 * (STORY-076) the active Workspace's member set.
 *
 * A node with no `namespaces` entry is an external vocabulary stub (`ExternalNodeSpec` carries no
 * `namespace` field) — its visibility is instead derived from the local entities that reference it
 * via inheritance (data-catalog Story 015), via `externalReferencingSources`. An external stub has
 * no `WorkspaceMembership` of its own (research §8: "no standalone existence"), so `workspaceMembers`
 * is never consulted for it directly — only for the local entities referencing it, via
 * `isExternalNodeHidden`.
 */
export function isEndpointVisible(
	nodeId: string,
	namespaces: Map<string, string>,
	hidden: Set<string>,
	externalReferencingSources: Map<string, string[]>,
	workspaceMembers?: Set<string>
): boolean {
	const ns = namespaces.get(nodeId);
	if (ns !== undefined) {
		return !hidden.has(ns) && (workspaceMembers === undefined || workspaceMembers.has(nodeId));
	}
	return !isExternalNodeHidden(externalReferencingSources.get(nodeId), namespaces, hidden, workspaceMembers);
}

export function isEdgeHidden(
	source: string,
	target: string,
	namespaces: Map<string, string>,
	hidden: Set<string>,
	externalReferencingSources: Map<string, string[]>,
	workspaceMembers?: Set<string>
): boolean {
	return (
		!isEndpointVisible(source, namespaces, hidden, externalReferencingSources, workspaceMembers) ||
		!isEndpointVisible(target, namespaces, hidden, externalReferencingSources, workspaceMembers)
	);
}

/**
 * An external stub node is hidden iff *every* local entity referencing it via inheritance is
 * itself hidden (data-catalog Story 015) — it stays visible if any referencing source remains
 * visible, even when other namespaces are hidden. A node with no referencing sources at all
 * (shouldn't happen — `buildCanvasModel` only ever creates an external node when something
 * references it) is treated as visible rather than orphaned-hidden.
 */
export function isExternalNodeHidden(
	sources: string[] | undefined,
	namespaces: Map<string, string>,
	hidden: Set<string>,
	workspaceMembers?: Set<string>
): boolean {
	if (!sources || sources.length === 0) return false;
	return sources.every((sourceId) => {
		const ns = namespaces.get(sourceId);
		return ns !== undefined && (hidden.has(ns) || (workspaceMembers !== undefined && !workspaceMembers.has(sourceId)));
	});
}

/**
 * Builds a `Map<externalNodeId, sourceNodeId[]>` from inheritance edges targeting external nodes
 * (nodes absent from `namespaces`) — computed once by each caller (initial build and
 * `toggleNamespaceVisibility`'s live re-map) and fed into `isEndpointVisible`/`isEdgeHidden`/
 * `isExternalNodeHidden` above.
 */
export function buildExternalReferencingSources(
	inheritanceEdges: { source: string; target: string }[],
	namespaces: Map<string, string>
): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const { source, target } of inheritanceEdges) {
		if (namespaces.has(target)) continue; // has a namespace => not an external stub
		const list = map.get(target) ?? [];
		list.push(source);
		map.set(target, list);
	}
	return map;
}
