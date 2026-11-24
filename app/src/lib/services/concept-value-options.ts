/**
 * Concept values for a concept property (spec/concept-valued-properties STORY-438): the typeahead options of a
 * concept field, built from one scheme's concepts. Pure builders plus one connector-facing loader; the form
 * itself (`MemberForm`) is the existing relation typeahead and knows nothing about concepts beyond the scheme IRI.
 *
 * Only preferred labels (with the disambiguation qualifier) are ever shown: hidden labels and editorial notes of a
 * concept never leave this module.
 */
import { conceptTitle, type Concept } from './skos-concept';
import { extractLocalName } from '#lib/utils/iri.js';
import { disambiguateOptionLabels, type RelationTargetOption } from '#lib/utils/relation-values.js';

/** The most concepts one field lists (`fetchConcepts` caps a page at 1000). */
export const CONCEPT_OPTION_LIMIT = 1000;

/** Key under which a field's options carry the "more concepts exist" marker (an empty list). */
export const conceptOptionsMoreKey = (fieldIri: string): string => `${fieldIri}\u0000more`;

/** Options for the concepts that may be picked: not deprecated, not retired, labelled by preferred label. Concepts
 *  sharing a label get the notation, or else the local name, appended in brackets. */
export function buildConceptOptions(concepts: Concept[]): RelationTargetOption[] {
	const offered = concepts.filter((c) => c.status !== 'deprecated' && c.status !== 'retired');
	const titles = offered.map((c) => conceptTitle(c));
	return disambiguateOptionLabels(
		offered.map((c, i) => {
			const shared = titles.filter((t) => t === titles[i]).length > 1;
			const suffix = c.notation?.[0]?.trim() || extractLocalName(c.iri);
			return { iri: c.iri, label: shared ? `${titles[i]} [${suffix}]` : titles[i] };
		})
	);
}

/** Adds the values an individual already holds to each field's options, so editing never drops one that is no
 *  longer offered (deprecated, retired, or beyond the limit). A kept value is listed under the label the form shows
 *  for it, which can differ from the offered label of the same concept. */
export function mergeKeptValues(
	options: Record<string, RelationTargetOption[]>,
	kept: Record<string, RelationTargetOption[]>
): Record<string, RelationTargetOption[]> {
	const fields = Object.keys(kept).filter((k) => kept[k].length > 0);
	if (fields.length === 0) return options;
	const merged = { ...options };
	for (const field of fields) {
		const list = [...(merged[field] ?? [])];
		for (const value of kept[field]) {
			if (!list.some((o) => o.iri === value.iri && o.label === value.label)) list.push(value);
		}
		merged[field] = list;
	}
	return merged;
}

interface ConceptSource {
	fetchVocabularyNamespace(): Promise<string | null>;
	fetchConcepts(
		coreBaseIri: string,
		options: { schemeIri?: string; limit?: number }
	): Promise<{ concepts: Concept[]; hasMore: boolean }>;
}

/** The `[fieldIri, options]` entries of a concept field for a `relationTargetOptions` record: its options, and the
 *  "more" marker when the scheme has more concepts than the limit. */
export async function conceptOptionEntries(
	connector: ConceptSource,
	field: { iri: string; valueSchemeIri?: string }
): Promise<[string, RelationTargetOption[]][]> {
	const core = field.valueSchemeIri ? await connector.fetchVocabularyNamespace() : null;
	if (!core || !field.valueSchemeIri) return [[field.iri, []]];
	const { concepts, hasMore } = await connector.fetchConcepts(core, { schemeIri: field.valueSchemeIri, limit: CONCEPT_OPTION_LIMIT });
	const entries: [string, RelationTargetOption[]][] = [[field.iri, buildConceptOptions(concepts)]];
	if (hasMore) entries.push([conceptOptionsMoreKey(field.iri), []]);
	return entries;
}

/** The relation and concept fields of an entity, in the order `MemberForm` renders them: a concept field is filled
 *  through the same typeahead as a relation field. */
export function memberFormFields<F extends { iri: string }>(
	entity: { relationFields: F[]; conceptFields?: F[] } | undefined
): F[] {
	return [...(entity?.relationFields ?? []), ...(entity?.conceptFields ?? [])];
}
