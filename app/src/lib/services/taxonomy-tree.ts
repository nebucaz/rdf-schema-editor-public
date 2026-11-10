/**
 * Trees for the taxonomy outline (ontology-pipeline STORY-328): the `skos:broader` tree of one scheme and
 * the read-only `rdfs:subClassOf` tree of one namespace. Pure; nothing here reads or writes GraphDB.
 */
import { conceptTitle, type Concept } from './skos-concept';
import type { FetchedSchema } from './sparql-connector';

export type TaxonomyMarker = 'orphan' | 'cycle' | 'multiple-parents' | 'top-with-broader';

export interface TaxonomyNode {
	iri: string;
	label: string;
	/** 0 for a root, one more per level. A polyhierarchy concept appears once per parent, each with its own depth. */
	depth: number;
	markers: TaxonomyMarker[];
	children: TaxonomyNode[];
}

const byLabel = (a: { label: string; iri: string }, b: { label: string; iri: string }) =>
	a.label.localeCompare(b.label) || (a.iri < b.iri ? -1 : 1);

/** The broader concepts of `c` that sit in the same scheme; a parent elsewhere does not place a concept in this tree. */
function parentsIn(c: Concept, inScheme: Map<string, Concept>): string[] {
	return (c.broader ?? []).filter((p) => inScheme.has(p));
}

/** Concepts that lie on a `skos:broader` cycle (not merely below one). */
function cycleMembers(inScheme: Map<string, Concept>): Set<string> {
	const members = new Set<string>();
	for (const start of inScheme.keys()) {
		// A concept is on a cycle when walking up from it can reach it again.
		const seen = new Set<string>();
		const stack = [...parentsIn(inScheme.get(start)!, inScheme)];
		while (stack.length) {
			const next = stack.pop()!;
			if (next === start) {
				members.add(start);
				break;
			}
			if (seen.has(next)) continue;
			seen.add(next);
			stack.push(...parentsIn(inScheme.get(next)!, inScheme));
		}
	}
	return members;
}

/** The `skos:broader` outline of one scheme (`''` = concepts without a scheme). Roots are the concepts with no
 *  broader concept in the scheme; whatever no root reaches is caught in a cycle and is shown, marked, as extra roots. */
export function buildTaxonomy(concepts: Concept[], schemeIri: string): TaxonomyNode[] {
	const inScheme = new Map(concepts.filter((c) => c.schemeIri === schemeIri).map((c) => [c.iri, c]));
	const children = new Map<string, Concept[]>();
	for (const c of inScheme.values()) {
		for (const p of parentsIn(c, inScheme)) children.set(p, [...(children.get(p) ?? []), c]);
	}
	const cyclic = cycleMembers(inScheme);
	const reached = new Set<string>();

	const node = (c: Concept, depth: number, path: Set<string>): TaxonomyNode => {
		reached.add(c.iri);
		const parents = parentsIn(c, inScheme);
		const markers: TaxonomyMarker[] = [];
		if (parents.length === 0 && !c.topConcept) markers.push('orphan');
		if (parents.length > 1) markers.push('multiple-parents');
		if (c.topConcept && parents.length > 0) markers.push('top-with-broader');
		if (cyclic.has(c.iri)) markers.push('cycle');
		const next = new Set(path).add(c.iri);
		return {
			iri: c.iri,
			label: conceptTitle(c),
			depth,
			markers,
			children: (children.get(c.iri) ?? [])
				.filter((child) => !next.has(child.iri))
				.map((child) => node(child, depth + 1, next))
				.sort(byLabel)
		};
	};

	const roots = [...inScheme.values()].filter((c) => parentsIn(c, inScheme).length === 0 || c.topConcept);
	const tree = roots.map((c) => node(c, 0, new Set()));
	// A concept with a broader concept is only a root when it is a top concept; a top concept that has one is
	// also drawn below it, so the contradiction is visible in both places.
	for (const c of [...inScheme.values()].sort((a, b) => byLabel({ label: conceptTitle(a), iri: a.iri }, { label: conceptTitle(b), iri: b.iri }))) {
		if (!reached.has(c.iri)) tree.push(node(c, 0, new Set()));
	}
	return tree.sort(byLabel);
}

/** `null` when making `parentIri` the broader concept of `childIri` is allowed, else the reason it is not. */
export function validateReparent(concepts: Concept[], childIri: string, parentIri: string): string | null {
	const child = concepts.find((c) => c.iri === childIri);
	const parent = concepts.find((c) => c.iri === parentIri);
	if (!child || !parent) return 'The concept was not found';
	if (childIri === parentIri) return 'A concept cannot be broader than itself';
	if (child.topConcept) return 'A top concept has no broader concept; clear its top-concept mark first';
	if (child.schemeIri !== parent.schemeIri) return 'Both concepts must be in the same scheme';
	// The move closes a cycle when the new parent already sits below the child.
	const byIri = new Map(concepts.map((c) => [c.iri, c]));
	const seen = new Set<string>();
	const stack = [parentIri];
	while (stack.length) {
		const current = stack.pop()!;
		if (current === childIri) return `That would create a cycle: "${conceptTitle(parent)}" is already below "${conceptTitle(child)}"`;
		if (seen.has(current)) continue;
		seen.add(current);
		stack.push(...(byIri.get(current)?.broader ?? []));
	}
	return null;
}

/** The read-only `rdfs:subClassOf` tree of the classes owned by `namespaceBaseIri`. A class whose superclass is
 *  elsewhere is a root here. */
export function buildClassTree(schema: FetchedSchema, namespaceBaseIri: string): TaxonomyNode[] {
	const own = new Map(schema.classes.filter((c) => c.namespaceBaseIri === namespaceBaseIri).map((c) => [c.iri, c]));
	const parents = new Map<string, string[]>();
	const kids = new Map<string, string[]>();
	for (const { sub, super: sup } of schema.subClassOf) {
		if (!own.has(sub) || !own.has(sup) || sub === sup) continue;
		parents.set(sub, [...(parents.get(sub) ?? []), sup]);
		kids.set(sup, [...(kids.get(sup) ?? []), sub]);
	}
	const node = (iri: string, depth: number, path: Set<string>): TaxonomyNode => {
		const next = new Set(path).add(iri);
		return {
			iri,
			label: own.get(iri)!.label,
			depth,
			markers: (parents.get(iri)?.length ?? 0) > 1 ? ['multiple-parents'] : [],
			children: (kids.get(iri) ?? [])
				.filter((k) => !next.has(k))
				.map((k) => node(k, depth + 1, next))
				.sort(byLabel)
		};
	};
	return [...own.keys()]
		.filter((iri) => !parents.has(iri))
		.map((iri) => node(iri, 0, new Set()))
		.sort(byLabel);
}

/** Every concept above `iri` by `skos:broader`, however far; safe on cycles. */
export function ancestorsOf(concepts: Concept[], iri: string): Set<string> {
	const byIri = new Map(concepts.map((c) => [c.iri, c]));
	const found = new Set<string>();
	const stack = [...(byIri.get(iri)?.broader ?? [])];
	while (stack.length) {
		const next = stack.pop()!;
		if (found.has(next)) continue;
		found.add(next);
		stack.push(...(byIri.get(next)?.broader ?? []));
	}
	return found;
}

/** The concepts that lie on a `skos:broader` cycle, whatever their scheme. */
export function broaderCycleMembers(concepts: Concept[]): Set<string> {
	return cycleMembers(new Map(concepts.map((c) => [c.iri, c])));
}

/** Levels of the deepest path below (and including) a node. */
export function branchDepth(node: TaxonomyNode): number {
	return 1 + Math.max(0, ...node.children.map(branchDepth));
}
