/**
 * Associative and mapping relations of a concept (ontology-pipeline STORY-329; book pp. 137, 154-155).
 * Pure: validation before a write, and the read-side view that merges both directions of `skos:related`.
 */
import { isWellFormedIri } from '#lib/utils/iri.js';
import { MAPPING_KINDS, type Concept, type ConceptMapping, type MappingKind, type RelationKind } from './skos-concept';

export const RELATION_KINDS: readonly RelationKind[] = ['related', ...MAPPING_KINDS];

export const isMappingKind = (kind: RelationKind): kind is MappingKind => kind !== 'related';

/** `null` when `kind` from `sourceIri` to `target` may be added, else the reason it may not. A mapping must
 *  leave the scheme: it may point to an outside IRI or to a concept of another scheme. */
export function validateRelation(concepts: Concept[], sourceIri: string, kind: RelationKind, target: string): string | null {
	const to = target.trim();
	if (!isWellFormedIri(to)) return 'The target must be an IRI';
	if (to === sourceIri) return 'A concept cannot be related to itself';
	const source = concepts.find((c) => c.iri === sourceIri);
	const targetConcept = concepts.find((c) => c.iri === to);
	if (kind === 'related') {
		if (!targetConcept) return 'A related concept must be a concept of this vocabulary';
		if (source && relationsOf(source, concepts).related.includes(to)) return 'These concepts are already related';
		return null;
	}
	if (targetConcept && source && source.schemeIri && targetConcept.schemeIri === source.schemeIri) {
		return 'A mapping must point to a concept of another scheme; use broader, narrower or related inside the same scheme';
	}
	if (source?.mappings?.some((m) => m.kind === kind && m.target === to)) return `This ${kind} mapping already exists`;
	return null;
}

/** The related concepts of `concept` from both directions (a `skos:related` is stored once, on one side) and
 *  its own mappings. */
export function relationsOf(concept: Concept, concepts: Concept[]): { related: string[]; mappings: ConceptMapping[] } {
	const related = new Set(concept.related ?? []);
	for (const c of concepts) if (c.related?.includes(concept.iri)) related.add(c.iri);
	return { related: [...related], mappings: concept.mappings ?? [] };
}

/** A full IRI typed in wins; otherwise the term is appended to the registered vocabulary's base IRI. */
export function composeMappingTarget(baseIri: string, input: string): string {
	const text = input.trim();
	if (isWellFormedIri(text) || !baseIri) return text;
	return `${baseIri}${text}`;
}
