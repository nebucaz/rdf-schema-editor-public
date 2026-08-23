import { xsdDatatypeFromIri, iriToPrefixedName, ATTRIBUTED_RELATIONSHIP_IRI, type XsdDatatype } from '$lib/utils/iri';
import type { FetchedSchema } from './sparql-connector';

export interface CanvasAttributeSpec {
	iri: string;
	name: string;
	datatype: XsdDatatype;
	required: boolean;
	repeatable: boolean;
}

/** An enumerated class member (STORY-019) — e.g. `core:RelationType`'s `nutzt`. */
export interface CanvasMemberSpec {
	iri: string;
	label: string;
}

export interface EntityNodeSpec {
	kind: 'entity';
	iri: string;
	name: string;
	description: string;
	attributes: CanvasAttributeSpec[];
	/** Always-available, possibly-empty list of this class's enumerated members — no separate
	 *  "is this an enumeration" flag, consistent with how attributes/relations work (Decision 3). */
	members: CanvasMemberSpec[];
}

export interface ExternalNodeSpec {
	kind: 'external';
	iri: string;
	prefixedName: string;
}

export type NodeSpec = EntityNodeSpec | ExternalNodeSpec;

export interface RelationEdgeSpec {
	kind: 'relation';
	iri: string;
	source: string;
	target: string;
	name: string;
	required: boolean;
	repeatable: boolean;
}

export interface AttributedLinkEdgeSpec {
	kind: 'attributedLink';
	iri: string;
	source: string;
	target: string;
	propName: string;
	required: boolean;
	repeatable: boolean;
}

export interface InheritanceEdgeSpec {
	kind: 'inheritance';
	source: string;
	target: string;
}

export type EdgeSpec = RelationEdgeSpec | AttributedLinkEdgeSpec | InheritanceEdgeSpec;

export interface CanvasModel {
	nodes: NodeSpec[];
	edges: EdgeSpec[];
	/** Classes carrying the `AttributedRelationship` marker (STORY-020) — exposed so the UI can
	 *  pre-check the "treat as association class" toggle correctly. */
	associationClassIris: Set<string>;
}

/**
 * Pure reconstruction of the canvas model from a fetched schema (STORY-009) — no GraphDB access,
 * so it's fully unit-testable.
 *
 * A class is an attributed-relationship (association) class (STORY-007) iff it's declared
 * `rdfs:subClassOf <SCHEMA_NAMESPACE>AttributedRelationship` (STORY-020) — a real, persisted marker
 * that replaced the original link-count heuristic entirely (see `spec/ui-refinement/research.md`
 * §2.4/§9). The marker class itself is infrastructure, not user-authored schema: it's excluded from
 * `nodes`, and `rdfs:subClassOf` triples pointing at it don't produce inheritance edges/external
 * stub nodes the way a normal `rdfs:subClassOf` triple would.
 *
 * Every other class becomes an `EntityNodeSpec` (association classes behave like any entity node
 * per STORY-007 — they have their own attributes too); the association/non-association distinction
 * only changes how a class's *outgoing* object properties are classified as edges.
 */
export function buildCanvasModel(schema: FetchedSchema): CanvasModel {
	const associationClassIris = new Set(
		schema.subClassOf.filter((r) => r.super === ATTRIBUTED_RELATIONSHIP_IRI).map((r) => r.sub)
	);
	const inheritanceTriples = schema.subClassOf.filter((r) => r.super !== ATTRIBUTED_RELATIONSHIP_IRI);

	const localClasses = schema.classes.filter((c) => c.iri !== ATTRIBUTED_RELATIONSHIP_IRI);
	const localClassIris = new Set(localClasses.map((c) => c.iri));

	const attributesByClass = new Map<string, CanvasAttributeSpec[]>();
	for (const dp of schema.datatypeProperties) {
		const list = attributesByClass.get(dp.domain) ?? [];
		list.push({
			iri: dp.iri,
			name: dp.label,
			datatype: xsdDatatypeFromIri(dp.range),
			required: dp.required,
			repeatable: dp.repeatable
		});
		attributesByClass.set(dp.domain, list);
	}

	const membersByClass = new Map<string, CanvasMemberSpec[]>();
	for (const individual of schema.individuals) {
		const list = membersByClass.get(individual.classIri) ?? [];
		list.push({ iri: individual.iri, label: individual.label });
		membersByClass.set(individual.classIri, list);
	}

	const entityNodes: EntityNodeSpec[] = localClasses.map((c) => ({
		kind: 'entity',
		iri: c.iri,
		name: c.label,
		description: c.comment ?? '',
		attributes: attributesByClass.get(c.iri) ?? [],
		members: membersByClass.get(c.iri) ?? []
	}));

	const edges: EdgeSpec[] = [];
	for (const op of schema.objectProperties) {
		if (associationClassIris.has(op.domain)) {
			edges.push({
				kind: 'attributedLink',
				iri: op.iri,
				source: op.domain,
				target: op.range,
				propName: op.label,
				required: op.required,
				repeatable: op.repeatable
			});
		} else {
			edges.push({
				kind: 'relation',
				iri: op.iri,
				source: op.domain,
				target: op.range,
				name: op.label,
				required: op.required,
				repeatable: op.repeatable
			});
		}
	}

	const externalNodes = new Map<string, ExternalNodeSpec>();
	for (const { sub, super: superIri } of inheritanceTriples) {
		if (!localClassIris.has(superIri) && !externalNodes.has(superIri)) {
			externalNodes.set(superIri, {
				kind: 'external',
				iri: superIri,
				prefixedName: iriToPrefixedName(superIri)
			});
		}
		edges.push({ kind: 'inheritance', source: sub, target: superIri });
	}

	return {
		nodes: [...entityNodes, ...externalNodes.values()],
		edges,
		associationClassIris
	};
}
