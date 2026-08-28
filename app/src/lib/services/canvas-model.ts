import {
	xsdDatatypeFromIri,
	iriToPrefixedName,
	EXTERNAL_PREFIXES,
	ATTRIBUTED_RELATIONSHIP_IRI,
	AUTHORITATIVE_ENTITY_IRI,
	type XsdDatatype
} from '$lib/utils/iri';
import type { FetchedSchema, FetchedSubClassOf } from './sparql-connector';

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
	/** Base IRI of the namespace this class belongs to (STORY-033) — lets the workbench's
	 *  namespace filter hide/show this node client-side, without re-querying GraphDB. */
	namespace: string;
}

export interface ExternalNodeSpec {
	kind: 'external';
	iri: string;
	prefixedName: string;
}

/** An individual (enumerated class member) rendered as its own canvas node (data-catalog Story 005)
 *  — only emitted in `'instances'` view mode, distinct from `EntityNodeSpec.members` (the flat,
 *  position-less list `'schema'` mode still uses). */
export interface IndividualNodeSpec {
	kind: 'individual';
	iri: string;
	label: string;
	/** The owning class's IRI (`rdf:type`) and display label — resolved here so `IndividualNode`
	 *  components stay pure display, not a second schema-lookup layer. */
	classIri: string;
	className: string;
	/** See `EntityNodeSpec.namespace` (STORY-033). */
	namespace: string;
}

export type NodeSpec = EntityNodeSpec | ExternalNodeSpec | IndividualNodeSpec;

export interface RelationEdgeSpec {
	kind: 'relation';
	iri: string;
	source: string;
	target: string;
	name: string;
	required: boolean;
	repeatable: boolean;
	/** 'generic' for a shared relation with no `rdfs:domain`/`rdfs:range` (STORY-051/052/054),
	 *  reconstructed from the shapes graph rather than `rdfs:domain`/`rdfs:range` directly — needed
	 *  so an edge reloaded from GraphDB still edits/deletes through the correct (reference-counted)
	 *  path instead of defaulting back to 'specific' and corrupting the shared property. */
	relationKind: 'specific' | 'generic';
	/** See `EntityNodeSpec.namespace` (STORY-033) — the source class's own namespace, since a
	 *  relationship's `owl:ObjectProperty` triple lives in its source class's `/schema` graph
	 *  (Decision 8), even when it crosses into another namespace's class as its range. */
	namespace: string;
}

export interface AttributedLinkEdgeSpec {
	kind: 'attributedLink';
	iri: string;
	source: string;
	target: string;
	propName: string;
	required: boolean;
	repeatable: boolean;
	/** See `RelationEdgeSpec.namespace` (STORY-033). */
	namespace: string;
}

export interface InheritanceEdgeSpec {
	kind: 'inheritance';
	source: string;
	target: string;
	/** See `RelationEdgeSpec.namespace` (STORY-033) — the `sub` class's own namespace, since the
	 *  `rdfs:subClassOf` triple lives in `sub`'s own `/schema` graph. */
	namespace: string;
}

/** A generalized individual→class relation (data-catalog Story 017) — any predicate connecting an
 *  individual to a class, only emitted in `'instances'` view mode. `source` is the individual's IRI,
 *  `target` the class's IRI. Reused for every individual→class relation regardless of predicate
 *  (including one labeled "isMasterFor") — see `FetchedIndividualClassRelation`. */
export interface IndividualClassRelationEdgeSpec {
	kind: 'individualRelation';
	source: string;
	target: string;
	predicateIri: string;
	/** Display label for the edge — the predicate's real `rdfs:label`. */
	name: string;
	/** See `RelationEdgeSpec.namespace` (STORY-033) — the source individual's own namespace, since
	 *  the relation triple lives in *its* `graphs.instances`. */
	namespace: string;
}

/** A derived, non-persisted edge from an individual to its own `rdf:type` class (data-catalog
 *  refinement — "connect instances to the schema"), only emitted in `'instances'` view mode.
 *  Unlike `IndividualClassRelationEdgeSpec`, this isn't reconstructed from a stored triple beyond
 *  `IndividualNodeSpec.classIri` itself, so there's nothing to edit or delete — it exists purely so
 *  every individual has *some* visible connection to the canvas instead of floating unattached. */
export interface InstanceOfEdgeSpec {
	kind: 'instanceOf';
	source: string;
	target: string;
	/** See `IndividualClassRelationEdgeSpec.namespace` — the individual's own namespace. */
	namespace: string;
}

export type EdgeSpec =
	| RelationEdgeSpec
	| AttributedLinkEdgeSpec
	| InheritanceEdgeSpec
	| IndividualClassRelationEdgeSpec
	| InstanceOfEdgeSpec;

export interface CanvasModel {
	nodes: NodeSpec[];
	edges: EdgeSpec[];
	/** Classes carrying the `AttributedRelationship` marker (STORY-020) — exposed so the UI can
	 *  pre-check the "treat as association class" toggle correctly. */
	associationClassIris: Set<string>;
	/** Classes carrying the `AuthoritativeEntity` marker (data-catalog Story 003) — exposed so the
	 *  UI can flag catalog-eligible classes (Story 014's "View catalog" menu gating) and Story 008's
	 *  generation engine can decide which classes to generate a catalog entry for. */
	authoritativeEntityIris: Set<string>;
}

/**
 * Whether `classIriValue` is declared `rdfs:subClassOf <SCHEMA_NAMESPACE>AuthoritativeEntity`
 * (data-catalog Story 003) — the same single-hop `rdfs:subClassOf` walk `buildCanvasModel` uses to
 * classify association classes, exposed standalone so callers other than `buildCanvasModel` (e.g.
 * Story 008's generation engine) can reuse it against a fetched `subClassOf` list directly.
 */
export function isAuthoritativeEntity(classIriValue: string, subClassOf: FetchedSubClassOf[]): boolean {
	return subClassOf.some((r) => r.sub === classIriValue && r.super === AUTHORITATIVE_ENTITY_IRI);
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
/**
 * `externalPrefixes` (STORY-046, defaults to the three built-in `EXTERNAL_PREFIXES`) is threaded in
 * explicitly rather than fetched here — this function stays a pure, GraphDB-free reconstruction of
 * the canvas model, so the caller resolves the merged built-in ∪ GraphDB-registered map once
 * (`external-vocab-store.ts`) and passes it in.
 */
export function buildCanvasModel(
	schema: FetchedSchema,
	externalPrefixes: Record<string, string> = EXTERNAL_PREFIXES,
	options?: { viewMode?: 'schema' | 'instances' }
): CanvasModel {
	const associationClassIris = new Set(
		schema.subClassOf.filter((r) => r.super === ATTRIBUTED_RELATIONSHIP_IRI).map((r) => r.sub)
	);
	const authoritativeEntityIris = new Set(
		schema.subClassOf.filter((r) => r.super === AUTHORITATIVE_ENTITY_IRI).map((r) => r.sub)
	);
	const inheritanceTriples = schema.subClassOf.filter(
		(r) => r.super !== ATTRIBUTED_RELATIONSHIP_IRI && r.super !== AUTHORITATIVE_ENTITY_IRI
	);

	const localClasses = schema.classes.filter(
		(c) => c.iri !== ATTRIBUTED_RELATIONSHIP_IRI && c.iri !== AUTHORITATIVE_ENTITY_IRI
	);
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
		members: membersByClass.get(c.iri) ?? [],
		namespace: c.namespaceBaseIri
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
				repeatable: op.repeatable,
				namespace: op.namespaceBaseIri
			});
		} else {
			edges.push({
				kind: 'relation',
				iri: op.iri,
				source: op.domain,
				target: op.range,
				name: op.label,
				required: op.required,
				repeatable: op.repeatable,
				relationKind: op.relationKind,
				namespace: op.namespaceBaseIri
			});
		}
	}

	const externalNodes = new Map<string, ExternalNodeSpec>();
	for (const { sub, super: superIri, namespaceBaseIri } of inheritanceTriples) {
		if (!localClassIris.has(superIri) && !externalNodes.has(superIri)) {
			externalNodes.set(superIri, {
				kind: 'external',
				iri: superIri,
				prefixedName: iriToPrefixedName(superIri, externalPrefixes)
			});
		}
		edges.push({ kind: 'inheritance', source: sub, target: superIri, namespace: namespaceBaseIri });
	}

	const viewMode = options?.viewMode ?? 'schema';
	if (viewMode === 'schema') {
		return {
			nodes: [...entityNodes, ...externalNodes.values()],
			edges,
			associationClassIris,
			authoritativeEntityIris
		};
	}

	// -- 'instances' view mode (data-catalog Story 005/006/016): individuals as their own nodes,
	// alongside the *same* namespace-visible entity-node set 'schema' mode returns — Story 016
	// dropped the earlier "only classes an individual relation references" filter so every relation
	// target the user might want to link to (e.g. a cross-namespace generalized relation, Story 017)
	// is already on canvas.
	const classByIri = new Map(localClasses.map((c) => [c.iri, c]));

	const individualNodes: IndividualNodeSpec[] = schema.individuals.map((individual) => ({
		kind: 'individual',
		iri: individual.iri,
		label: individual.label,
		classIri: individual.classIri,
		className: classByIri.get(individual.classIri)?.label ?? individual.classIri,
		namespace: individual.namespaceBaseIri
	}));

	const individualRelationEdges: IndividualClassRelationEdgeSpec[] = schema.individualClassRelations.map(
		(relation) => ({
			kind: 'individualRelation',
			source: relation.individualIri,
			target: relation.classIri,
			predicateIri: relation.predicateIri,
			name: relation.name,
			namespace: relation.namespaceBaseIri
		})
	);

	const instanceOfEdges: InstanceOfEdgeSpec[] = schema.individuals.map((individual) => ({
		kind: 'instanceOf',
		source: individual.iri,
		target: individual.classIri,
		namespace: individual.namespaceBaseIri
	}));

	return {
		nodes: [...individualNodes, ...entityNodes],
		edges: [...instanceOfEdges, ...individualRelationEdges],
		associationClassIris,
		authoritativeEntityIris
	};
}
