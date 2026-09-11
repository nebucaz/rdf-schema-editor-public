import {
	buildCanvasModel,
	type CanvasAttributeSpec,
	type CanvasRelationFieldSpec,
	type EntityNodeSpec
} from '$lib/services/canvas-model';
import type { FetchedSchema } from '$lib/services/sparql-connector';

/**
 * Indexes `buildCanvasModel(schema)`'s entity nodes by class IRI (STORY-121) — gives the Identities
 * route (and `IdentityResourcePage`'s future Edit entry point, STORY-124) O(1) lookup of a class's
 * own+inherited `attributes`/`relationFields`/`labelRequired`, the exact same derived shape
 * `MemberForm` already consumes on the schema canvas, without a new query. A class IRI absent from
 * the schema (e.g. a bare `rdf:type` triple with no declared `owl:Class`) is simply absent from the
 * returned map — callers decide how to handle a missing lookup, this is just a safe index.
 */
export function buildEntityNodeIndex(schema: FetchedSchema): Map<string, EntityNodeSpec> {
	const { nodes } = buildCanvasModel(schema);
	const index = new Map<string, EntityNodeSpec>();
	for (const node of nodes) {
		if (node.kind === 'entity') index.set(node.iri, node);
	}
	return index;
}

/**
 * Resolves the "governing class" for a possibly multi-`rdf:type` identity (research.md §6 decision
 * 1): the identities view's active class-filter facet, when the identity actually carries that type
 * — otherwise the identity's own first outgoing `rdf:type`. This also covers the two fallback cases:
 * no active facet, and a facet set but not among the identity's own types (e.g. reached via a link
 * from an unrelated class). Returns `null` only when `identityTypeIris` is empty.
 */
export function resolveGoverningClass(identityTypeIris: string[], activeClassFacet: string | null): string | null {
	if (activeClassFacet !== null && identityTypeIris.includes(activeClassFacet)) {
		return activeClassFacet;
	}
	return identityTypeIris[0] ?? null;
}

export interface EditFormSpec {
	attributes: CanvasAttributeSpec[];
	relationFields: CanvasRelationFieldSpec[];
	labelRequired: boolean;
}

/**
 * STORY-124's edge-case decision for an identity whose `resolveGoverningClass` resolves to `null`
 * (zero declared `rdf:type`s): rather than hiding the Edit entry point entirely, this resolves to an
 * empty spec — `MemberForm` then renders with no Attributes/Relations sections, i.e. generic
 * Assertions-only editing (its Assertions section needs only `individualIri`, not a governing class)
 * — matching the old bespoke per-relation delete UI's own behavior of working regardless of an
 * identity's declared type. A `governingClassIri` present but absent from the schema index (a class
 * IRI with no declared `owl:Class`) falls back the same way, for the same reason.
 */
export function resolveEditFormSpec(
	entityNodeByClassIri: Map<string, EntityNodeSpec>,
	governingClassIri: string | null
): EditFormSpec {
	const node = governingClassIri ? entityNodeByClassIri.get(governingClassIri) : undefined;
	return {
		attributes: node?.attributes ?? [],
		relationFields: node?.relationFields ?? [],
		labelRequired: node?.labelRequired ?? false
	};
}
