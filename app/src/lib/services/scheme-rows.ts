/** The rows of the Schemes tab (spec/vocabulary-graph-and-tabs STORY-449): pure, from the concepts the page already
 *  holds, so listing the schemes costs no query of its own. Orphans come from `analyseSchemeHealth`, which leaves
 *  deprecated and retired concepts out; the concept and top-concept counts include every concept. */
import { analyseSchemeHealth } from './scheme-health';
import { normaliseLabel, schemeDisplayName, type Concept, type ConceptScheme } from './skos-concept';

export interface SchemeRow {
	scheme: ConceptScheme;
	name: string;
	conceptCount: number;
	topConceptCount: number;
	orphanCount: number;
	/** `dct:modified` of the scheme, `''` when it has none. */
	modified: string;
}

export function buildSchemeRows(schemes: ConceptScheme[], concepts: Concept[]): SchemeRow[] {
	const orphans = new Map(analyseSchemeHealth(concepts).map((h) => [h.schemeIri, h.orphans.length]));
	const rows = schemes.map((scheme) => {
		const members = concepts.filter((c) => c.schemeIri === scheme.iri);
		return {
			scheme,
			name: schemeDisplayName(scheme),
			conceptCount: members.length,
			topConceptCount: members.filter((c) => c.topConcept).length,
			orphanCount: orphans.get(scheme.iri) ?? 0,
			modified: scheme.metadata?.modified ?? ''
		};
	});
	return rows.sort((a, b) => a.name.localeCompare(b.name) || (a.scheme.iri < b.scheme.iri ? -1 : 1));
}

export function filterSchemeRows(rows: SchemeRow[], search: string): SchemeRow[] {
	const wanted = normaliseLabel(search);
	return wanted ? rows.filter((r) => normaliseLabel(r.name).includes(wanted)) : rows;
}
