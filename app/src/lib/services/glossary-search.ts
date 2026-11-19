/**
 * Reader-facing search and views over the vocabulary (skos-support STORY-425): which concepts match a query, in
 * which language a label is shown and how the tree and the A-Z list are built. Pure. Hidden labels and notation are
 * matched but never displayed by the callers; definitions and editorial notes are not searched.
 */
import { buildTaxonomy, type TaxonomyNode } from './taxonomy-tree';
import { conceptTitle, normaliseLabel, type Concept } from './skos-concept';

/** Concepts with a preferred, alternative or hidden label, or a notation, that contains the query; all when it is blank. */
export function searchGlossary(concepts: Concept[], query: string): Concept[] {
	const wanted = normaliseLabel(query);
	if (!wanted) return concepts;
	return concepts.filter((c) =>
		[...c.prefLabels.map((l) => l.text), ...c.altLabels.map((l) => l.text), ...c.hiddenLabels.map((l) => l.text), ...(c.notation ?? [])].some(
			(text) => normaliseLabel(text).includes(wanted)
		)
	);
}

/** The preferred label in `lang`, else English, else the first one; the homonym qualifier is kept. */
export function glossaryLabel(c: Concept, lang = 'en'): string {
	const labels = c.prefLabels.filter((l) => l.text.trim());
	const pick =
		labels.find((l) => l.lang.toLowerCase() === lang.toLowerCase()) ?? labels.find((l) => l.lang.toLowerCase() === 'en') ?? labels[0];
	if (!pick) return conceptTitle(c);
	return conceptTitle({ ...c, prefLabels: [pick] });
}

export function alphabeticalList(concepts: Concept[], lang = 'en'): Concept[] {
	return [...concepts].sort((a, b) => glossaryLabel(a, lang).localeCompare(glossaryLabel(b, lang)) || (a.iri < b.iri ? -1 : 1));
}

const keep = (node: TaxonomyNode, wanted: Set<string>): TaxonomyNode | null => {
	const children = node.children.map((n) => keep(n, wanted)).filter((n): n is TaxonomyNode => n !== null);
	return wanted.has(node.iri) || children.length ? { ...node, children } : null;
};

/** The `skos:broader` tree of every scheme (and of concepts without one), cut down to `shown` and their ancestors. */
export function glossaryTree(all: Concept[], shown: Concept[]): TaxonomyNode[] {
	const wanted = new Set(shown.map((c) => c.iri));
	const schemes = [...new Set(all.map((c) => c.schemeIri))];
	return schemes
		.flatMap((s) => buildTaxonomy(all, s))
		.map((n) => keep(n, wanted))
		.filter((n): n is TaxonomyNode => n !== null);
}
