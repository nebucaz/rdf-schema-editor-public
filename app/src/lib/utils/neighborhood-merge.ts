/**
 * Pure merge-and-dedupe logic for STORY-120's expand-on-click flow, extracted from
 * `semantic-crm`'s `handleNodeExpand` (`+page.svelte:251-266`) so it's covered by this repo's
 * colocated `*.spec.ts` convention without needing a component-testing project. `fetchIdentityNeighborhood`
 * (STORY-117) deliberately returns an undeduped delta — this is the caller-side merge step it expects.
 */
import type { NeighborhoodGraph, NeighborhoodLink } from '$lib/services/sparql-connector';

function linkKey(l: NeighborhoodLink): string {
	return `${l.source}\t${l.predicateIri}\t${l.target}`;
}

/** Merges `delta` (one `fetchIdentityNeighborhood` call's result) into `existing`. Nodes are
 *  deduped/overwritten by `iri` (a re-fetched node's fresher label/classIri wins, matching the
 *  ported original's `Map.set` overwrite semantics); links are deduped by `(source, predicateIri,
 *  target)` and only ever appended, never replaced. */
export function mergeNeighborhood(existing: NeighborhoodGraph, delta: NeighborhoodGraph): NeighborhoodGraph {
	const nodeMap = new Map(existing.nodes.map((n) => [n.iri, n]));
	for (const n of delta.nodes) nodeMap.set(n.iri, n);

	const existingKeys = new Set(existing.links.map(linkKey));
	const newLinks = delta.links.filter((l) => !existingKeys.has(linkKey(l)));

	return {
		nodes: Array.from(nodeMap.values()),
		links: [...existing.links, ...newLinks]
	};
}
