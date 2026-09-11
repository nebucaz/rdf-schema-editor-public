/**
 * Resolves a display color for a `NeighborhoodNode` (STORY-120 color follow-up) from namespace
 * default colors (`FetchedNamespace.color`) — no per-class color exists anywhere in this app (only
 * a namespace-level default and a purely client-side, `localStorage`-only per-node override on the
 * schema canvas, `node-color-store.ts`, which the read-only Explore graph has no use for).
 *
 * Resolution order, per an identity node:
 * 1. The individual's own namespace's default color (`NeighborhoodNode.namespaceBaseIri`).
 * 2. Its class's own namespace's default color.
 * 3. Walking up `rdfs:subClassOf` from that class — since a class can have more than one direct
 *    superclass (multiple inheritance), each parent is tried in a deterministic (alphabetical-by-IRI)
 *    order, recursing into a parent's own ancestors before moving to the next parent, so the first
 *    ancestor found (by that fixed order) whose namespace has a color wins. A `visited` set guards
 *    against a malformed/cyclic `subClassOf` graph (the app's own validation layer normally prevents
 *    cycles, but this walk must still terminate over bad data mid-edit).
 * 4. `undefined` when no ancestor's namespace has a color — callers fall back to the same static
 *    theme accent every other uncolored node already uses.
 */

export interface ClassHierarchyIndex {
	/** classIri -> the namespace base IRI that class's own `/schema` graph lives in. */
	classNamespaceByIri: Map<string, string>;
	/** classIri -> its direct `rdfs:subClassOf` superclass IRIs (possibly more than one). */
	parentsByClassIri: Map<string, string[]>;
}

/** Builds a `ClassHierarchyIndex` from a `FetchedSchema`-shaped `{classes, subClassOf}` pair —
 *  callers pass `fetchFullSchemaForAllNamespaces()`'s result directly. */
export function buildClassHierarchyIndex(
	classes: { iri: string; namespaceBaseIri: string }[],
	subClassOf: { sub: string; super: string }[]
): ClassHierarchyIndex {
	const classNamespaceByIri = new Map(classes.map((c) => [c.iri, c.namespaceBaseIri]));
	const parentsByClassIri = new Map<string, string[]>();
	for (const { sub, super: superIri } of subClassOf) {
		const parents = parentsByClassIri.get(sub) ?? [];
		parents.push(superIri);
		parentsByClassIri.set(sub, parents);
	}
	return { classNamespaceByIri, parentsByClassIri };
}

/** Resolves the color an ancestor class's namespace contributes, per the algorithm above. Exported
 *  separately from `resolveNodeColor` so a class-only caller (no individual involved) can reuse it. */
export function resolveClassColor(
	classIri: string,
	index: ClassHierarchyIndex,
	namespaceColorByBaseIri: Map<string, string>,
	visited: Set<string> = new Set()
): string | undefined {
	if (visited.has(classIri)) return undefined;
	visited.add(classIri);

	const ownNamespace = index.classNamespaceByIri.get(classIri);
	const ownColor = ownNamespace ? namespaceColorByBaseIri.get(ownNamespace) : undefined;
	if (ownColor) return ownColor;

	const parents = [...(index.parentsByClassIri.get(classIri) ?? [])].sort();
	for (const parent of parents) {
		const color = resolveClassColor(parent, index, namespaceColorByBaseIri, visited);
		if (color) return color;
	}
	return undefined;
}

/** Full resolution for one neighborhood node: its own namespace's color, else its class hierarchy's
 *  (see module doc comment). */
export function resolveNodeColor(
	node: { namespaceBaseIri: string; classIri: string },
	index: ClassHierarchyIndex,
	namespaceColorByBaseIri: Map<string, string>
): string | undefined {
	const ownColor = namespaceColorByBaseIri.get(node.namespaceBaseIri);
	if (ownColor) return ownColor;
	return resolveClassColor(node.classIri, index, namespaceColorByBaseIri);
}
