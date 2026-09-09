import {
	xsdDatatypeFromIri,
	iriToPrefixedName,
	EXTERNAL_PREFIXES,
	ATTRIBUTED_RELATIONSHIP_IRI,
	type XsdDatatype
} from '$lib/utils/iri';
import type { FetchedProperty, FetchedSchema, FetchedSubClassOf } from './sparql-connector';

export interface CanvasAttributeSpec {
	iri: string;
	name: string;
	datatype: XsdDatatype;
	required: boolean;
	repeatable: boolean;
	/** Whether this attribute is required as a class-level value on direct subclasses of its owning
	 *  class instead of on instances — when true, `required` above is already forced `false` (an
	 *  attribute is never both at once, `buildCanvasModel`'s own construction). Carried through
	 *  purely so `AttributeForm`'s edit mode can pre-populate its own checkbox; `EntityNode`/
	 *  `MemberForm` never read it directly. Optional so existing hand-built test fixtures don't all
	 *  need updating; treat a missing value as `false`. */
	requiredForSubclasses?: boolean;
	/** Set when this attribute is inherited from an ancestor class (STORY-108) — absent for a
	 *  class's own attributes. `className` is resolved here (not left to the renderer) so
	 *  `EntityNode` stays pure display. */
	inheritedFrom?: { classIri: string; className: string };
}

/**
 * A schema-declared `owl:ObjectProperty` relation, usable as a typed "pick an instance of the range
 * class" field on the instance form (STORY-114) — the object-property counterpart of
 * `CanvasAttributeSpec`. `targetClassIri`/`targetClassName` are the relation's `rdfs:range`, letting
 * the form scope its typeahead to instances of exactly that class rather than every individual in the
 * graph (unlike the generic Assertions object picker). Excludes relations whose domain is an
 * attributed-relationship (association) class — those are modeled as `AttributedLinkEdgeSpec` instead
 * and edited via `AssociationForm`/`AssociationEditForm`, not `MemberForm`.
 */
export interface CanvasRelationFieldSpec {
	iri: string;
	name: string;
	targetClassIri: string;
	targetClassName: string;
	required: boolean;
	repeatable: boolean;
	/** See `CanvasAttributeSpec.inheritedFrom` (STORY-108) — same ancestor-merge concept, reused here
	 *  by `mergeAncestorRelations`. */
	inheritedFrom?: { classIri: string; className: string };
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
	/** This class's own+inherited schema-declared object-property relations (STORY-114) — the
	 *  instance form's "pick an instance of the range class" fields, computed the same
	 *  own+inherited-nearest-first-shadowed way as `attributes` via `mergeAncestorRelations`. */
	relationFields: CanvasRelationFieldSpec[];
	/** Always-available, possibly-empty list of this class's enumerated members — no separate
	 *  "is this an enumeration" flag, consistent with how attributes/relations work (Decision 3). */
	members: CanvasMemberSpec[];
	/** Base IRI of the namespace this class belongs to (STORY-033) — lets the workbench's
	 *  namespace filter hide/show this node client-side, without re-querying GraphDB. */
	namespace: string;
	/** `true` when this class's own `sh:NodeShape`, or any ancestor's, constrains
	 *  `sh:path rdfs:label` with `sh:minCount >= 1` (STORY-112) — computed here (own class or
	 *  ancestor) so `MemberForm` doesn't need to re-walk `subClassOf` itself. */
	labelRequired: boolean;
	/** Attributes this class's *direct* superclasses mark "required for subclasses" — computed here
	 *  (via `directSuperclassRequiredAttributes`) so `EntityForm` doesn't need to re-walk
	 *  `subClassOf`/`datatypeProperties` itself, the same reasoning as `labelRequired` above.
	 *  Optional so existing hand-built `EntityNodeSpec` fixtures don't all need updating; treat a
	 *  missing value as empty. */
	subclassRequiredAttributes?: CanvasClassLevelAttributeSpec[];
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
	/** The `rse:syncSource` marker value (e.g. `"backstage"`) when a Go sync worker owns this
	 *  individual (Story 007/010), or `null` for an ordinary hand-authored one — computed the same
	 *  way `isAuthoritativeEntity` is derived from a marker triple, not inferred from IRI shape. */
	syncSource: string | null;
	/** `true` when this synced individual disappeared from its upstream source's latest sync run
	 *  (`rse:syncStatus === 'stale'`, Story 009) — always `false` for a non-synced individual. */
	isStale: boolean;
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
	/** The forward relation's IRI, when this edge is the auto-generated reverse half of a relation
	 *  pair (`rse:generatedReverseOf`, STORY-XXX) — `undefined` for every ordinary relation. Mirrors
	 *  `CanvasAttributeSpec.inheritedFrom`'s optional-tag convention: `buildCanvasModel` tags, it
	 *  doesn't filter — the canvas decides downstream whether to hide it. */
	generatedReverseOf?: string;
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

/** A generalized individual→class *or* individual→individual relation (data-catalog Story 017;
 *  widened to individual targets by relation-assertions Sprint 3 Story 007) — any predicate
 *  connecting an individual to a class or to another individual, only emitted in `'instances'` view
 *  mode. `source` is the individual's IRI, `target` the class's or target individual's IRI. Reused
 *  for every such relation regardless of predicate (including one labeled "isMasterFor") — see
 *  `FetchedIndividualClassRelation`/`FetchedIndividualIndividualRelation`. */
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
	/** Classes carrying the configured catalog marker class (data-catalog Story 003, Sprint 5
	 *  Story 014) — exposed so the UI can flag catalog-eligible classes (Story 014's "View catalog"
	 *  menu gating) and Story 008's generation engine can decide which classes to generate a catalog
	 *  entry for. Empty when no marker class is configured. */
	authoritativeEntityIris: Set<string>;
	/** Classes for which `rdfs:label` is shape-required (STORY-112) — own class or any ancestor,
	 *  already ancestor-resolved the same way `EntityNodeSpec.labelRequired` is, exposed at the model
	 *  level too so a caller that isn't rendering `EntityNodeSpec`s (e.g. a lookup keyed by class IRI
	 *  for a form that isn't itself a canvas node) doesn't need to re-derive it. */
	labelRequiredClassIris: Set<string>;
}

/**
 * Nearest-ancestor-first order of `classIriValue`'s transitive `rdfs:subClassOf` ancestors, as a
 * plain in-memory BFS over an already-fetched `subClassOf` edge list (STORY-108/109) — shared by
 * `mergeAncestorAttributes` and `isLabelRequiredForClass` (STORY-112) so both walk ancestors exactly
 * the same way. Not `SparqlConnector.findAncestors`: that's a SPARQL property path (`+`) round-trip
 * with no ordering guarantee, per `research.md`'s flagged gap.
 */
function orderedAncestors(classIriValue: string, subClassOf: FetchedSubClassOf[]): string[] {
	const parentsOf = new Map<string, string[]>();
	for (const { sub, super: superIri } of subClassOf) {
		const list = parentsOf.get(sub) ?? [];
		list.push(superIri);
		parentsOf.set(sub, list);
	}

	const visited = new Set<string>();
	const order: string[] = [];
	let frontier = parentsOf.get(classIriValue) ?? [];
	while (frontier.length > 0) {
		const next: string[] = [];
		for (const parent of frontier) {
			if (visited.has(parent)) continue;
			visited.add(parent);
			order.push(parent);
			next.push(...(parentsOf.get(parent) ?? []));
		}
		frontier = next;
	}
	return order;
}

/**
 * Whether `classIriValue`'s own `sh:NodeShape`, or any ancestor's, constrains `sh:path rdfs:label`
 * with `sh:minCount >= 1` (STORY-112) — `labelRequiredClassIris` is the already-per-class-resolved
 * set `SparqlConnector.fetchLabelRequiredClasses` returns; this just adds the same ancestor-inclusion
 * rule attribute inheritance already uses (own class or any ancestor, per `research.md`'s confirmed
 * `core:CoreEntityShape`/`core:CoreEntity`/`core:Application` example).
 */
export function isLabelRequiredForClass(
	classIriValue: string,
	labelRequiredClassIris: ReadonlySet<string>,
	subClassOf: FetchedSubClassOf[]
): boolean {
	if (labelRequiredClassIris.has(classIriValue)) return true;
	return orderedAncestors(classIriValue, subClassOf).some((ancestor) => labelRequiredClassIris.has(ancestor));
}

/**
 * A class's own attributes plus every ancestor's own attributes merged in, nearest ancestor first
 * (STORY-108, extracted as a standalone utility by STORY-109 so the dynamic instance form, STORY-111,
 * can reuse the exact same merge instead of reimplementing it).
 *
 * Shadowing is by attribute *name* (not `sh:path` IRI — `propertyIri` scopes an attribute's IRI by
 * its declaring class, so a subclass redeclaring the same-named attribute always mints a different
 * IRI; matching on IRI could never actually shadow anything): the subclass's own copy of a name
 * always wins, and among ancestors the nearest one to declare a given name wins over a farther one —
 * mirroring OWL/SHACL property redefinition elsewhere.
 *
 * Takes plain data only (a class IRI, the own-attributes-by-class map, the `subClassOf` edge list,
 * and a class-label lookup for `inheritedFrom.className`) — no GraphDB access, no canvas-specific
 * concerns (nodes/edges/positions), so it's usable outside `buildCanvasModel` too.
 */
export function mergeAncestorAttributes(
	classIriValue: string,
	attributesByClass: Map<string, CanvasAttributeSpec[]>,
	subClassOf: FetchedSubClassOf[],
	classLabelByIri: Map<string, string>
): CanvasAttributeSpec[] {
	const own = attributesByClass.get(classIriValue) ?? [];
	const seenNames = new Set(own.map((a) => a.name));
	const inherited: CanvasAttributeSpec[] = [];
	for (const ancestorIri of orderedAncestors(classIriValue, subClassOf)) {
		for (const attr of attributesByClass.get(ancestorIri) ?? []) {
			if (seenNames.has(attr.name)) continue;
			seenNames.add(attr.name);
			inherited.push({
				...attr,
				inheritedFrom: { classIri: ancestorIri, className: classLabelByIri.get(ancestorIri) ?? ancestorIri }
			});
		}
	}
	return [...own, ...inherited];
}

/**
 * A class's own object-property relations plus every ancestor's, nearest ancestor first (STORY-114) —
 * the exact same own+inherited, name-shadowed merge `mergeAncestorAttributes` performs, just over
 * `CanvasRelationFieldSpec` instead of `CanvasAttributeSpec`. Kept as a separate sibling function
 * rather than a shared generic: the two specs' fields diverge (`datatype` vs `targetClassIri`/
 * `targetClassName`) enough that a generic would need its own shadowing-key parameter anyway.
 */
export function mergeAncestorRelations(
	classIriValue: string,
	relationsByClass: Map<string, CanvasRelationFieldSpec[]>,
	subClassOf: FetchedSubClassOf[],
	classLabelByIri: Map<string, string>
): CanvasRelationFieldSpec[] {
	const own = relationsByClass.get(classIriValue) ?? [];
	const seenNames = new Set(own.map((r) => r.name));
	const inherited: CanvasRelationFieldSpec[] = [];
	for (const ancestorIri of orderedAncestors(classIriValue, subClassOf)) {
		for (const rel of relationsByClass.get(ancestorIri) ?? []) {
			if (seenNames.has(rel.name)) continue;
			seenNames.add(rel.name);
			inherited.push({
				...rel,
				inheritedFrom: { classIri: ancestorIri, className: classLabelByIri.get(ancestorIri) ?? ancestorIri }
			});
		}
	}
	return [...own, ...inherited];
}

/** An attribute a direct superclass of the edited class marks "required for subclasses"
 *  (`REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI`) — a class-level value `EntityForm` must collect, not
 *  an instance-facing `CanvasAttributeSpec` field. */
export interface CanvasClassLevelAttributeSpec {
	iri: string;
	name: string;
	datatype: XsdDatatype;
	ownerClassIri: string;
	ownerClassName: string;
}

/**
 * Attributes required as a class-level value on `classIriValue`'s *direct* `rdfs:subClassOf`
 * superclasses (`FetchedProperty.requiredForSubclasses`) — one hop only, mirroring the Catalog
 * marker class's own `isAuthoritativeEntity` check, unlike `mergeAncestorAttributes`'s transitive
 * walk for instance-facing fields (a class-level requirement doesn't cascade past its own direct
 * children the same way an instance-facing attribute inherits down an entire subtree). Drives
 * `EntityForm`'s required-class-level-attribute inputs (generalizes the Concept Namespace pattern
 * to any user-defined attribute, not just `rse:namespace`).
 */
export function directSuperclassRequiredAttributes(
	classIriValue: string,
	subClassOf: FetchedSubClassOf[],
	datatypeProperties: FetchedProperty[],
	classLabelByIri: Map<string, string>
): CanvasClassLevelAttributeSpec[] {
	const directSupers = new Set(subClassOf.filter((r) => r.sub === classIriValue).map((r) => r.super));
	return datatypeProperties
		.filter((p) => p.requiredForSubclasses && directSupers.has(p.domain))
		.map((p) => ({
			iri: p.iri,
			name: p.label,
			datatype: xsdDatatypeFromIri(p.range),
			ownerClassIri: p.domain,
			ownerClassName: classLabelByIri.get(p.domain) ?? p.domain
		}));
}

/**
 * Whether `classIriValue` is declared `rdfs:subClassOf` the configured catalog marker class
 * (Sprint 5 Story 014 — `markerClassIri`, the user-configured setting, replacing the old hardcoded
 * `AUTHORITATIVE_ENTITY_IRI` constant) — the same single-hop `rdfs:subClassOf` walk `buildCanvasModel`
 * uses to classify association classes, exposed standalone so callers other than `buildCanvasModel`
 * (e.g. Story 008's generation engine) can reuse it against a fetched `subClassOf` list directly.
 * Returns `false` unconditionally when `markerClassIri` is `null` — no configured marker means
 * nothing is catalog-eligible, no fallback.
 */
export function isAuthoritativeEntity(
	classIriValue: string,
	subClassOf: FetchedSubClassOf[],
	markerClassIri: string | null
): boolean {
	if (markerClassIri === null) return false;
	return subClassOf.some((r) => r.sub === classIriValue && r.super === markerClassIri);
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
	options?: { viewMode?: 'schema' | 'instances'; authoritativeEntityClassIri?: string | null }
): CanvasModel {
	const markerClassIri = options?.authoritativeEntityClassIri ?? null;
	const associationClassIris = new Set(
		schema.subClassOf.filter((r) => r.super === ATTRIBUTED_RELATIONSHIP_IRI).map((r) => r.sub)
	);
	const authoritativeEntityIris = new Set(
		markerClassIri === null
			? []
			: schema.subClassOf.filter((r) => r.super === markerClassIri).map((r) => r.sub)
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
			// requiredForSubclasses always wins over sh:minCount for instance purposes — an attribute
			// is either an instance-facing requirement or a class-level one, never both at once
			// (STORY: generalized Concept Namespace pattern).
			required: dp.required && !dp.requiredForSubclasses,
			repeatable: dp.repeatable,
			requiredForSubclasses: dp.requiredForSubclasses
		});
		attributesByClass.set(dp.domain, list);
	}

	const membersByClass = new Map<string, CanvasMemberSpec[]>();
	for (const individual of schema.individuals) {
		const list = membersByClass.get(individual.classIri) ?? [];
		list.push({ iri: individual.iri, label: individual.label });
		membersByClass.set(individual.classIri, list);
	}

	// -- Inherited attributes (STORY-108, merge logic extracted to `mergeAncestorAttributes` by
	// STORY-109 so STORY-111's dynamic instance form can reuse it directly) ---------------------
	const classLabelByIri = new Map(localClasses.map((c) => [c.iri, c.label]));

	// -- Relation fields (STORY-114) — schema-declared owl:ObjectProperty relations, keyed by domain
	// exactly like attributesByClass is keyed by domain, excluding association-class domains (those
	// become AttributedLinkEdgeSpec below instead, edited via AssociationForm, not MemberForm).
	// A generic relation (STORY-051/054) reused from the same domain against more than one range class
	// produces one `schema.objectProperties` row per (domain, range) pair, unlike a datatype property
	// (always single-owner) — deduped here by predicate IRI so a relation gets exactly one form field
	// regardless of how many ranges it's declared against, keeping the first-seen range as the field's
	// typeahead scope (accepted v1 limitation, same "not widened" spirit as the target-scope ADR).
	const relationsByClass = new Map<string, CanvasRelationFieldSpec[]>();
	for (const op of schema.objectProperties) {
		if (associationClassIris.has(op.domain)) continue;
		const list = relationsByClass.get(op.domain) ?? [];
		if (list.some((r) => r.iri === op.iri)) continue;
		list.push({
			iri: op.iri,
			name: op.label,
			targetClassIri: op.range,
			targetClassName: classLabelByIri.get(op.range) ?? op.range,
			required: op.required,
			repeatable: op.repeatable
		});
		relationsByClass.set(op.domain, list);
	}

	// -- Shape-required rdfs:label (STORY-112) — resolved per class here (own or ancestor) so
	// EntityNodeSpec carries a flat boolean, same shape as attributes' own required flag.
	const ownLabelRequiredClassIris = new Set(schema.labelRequiredClassIris ?? []);
	const labelRequiredClassIris = new Set(
		localClasses
			.map((c) => c.iri)
			.filter((iri) => isLabelRequiredForClass(iri, ownLabelRequiredClassIris, inheritanceTriples))
	);

	const entityNodes: EntityNodeSpec[] = localClasses.map((c) => ({
		kind: 'entity',
		iri: c.iri,
		name: c.label,
		description: c.comment ?? '',
		attributes: mergeAncestorAttributes(c.iri, attributesByClass, inheritanceTriples, classLabelByIri),
		relationFields: mergeAncestorRelations(c.iri, relationsByClass, inheritanceTriples, classLabelByIri),
		members: membersByClass.get(c.iri) ?? [],
		namespace: c.namespaceBaseIri,
		labelRequired: labelRequiredClassIris.has(c.iri),
		subclassRequiredAttributes: directSuperclassRequiredAttributes(
			c.iri,
			inheritanceTriples,
			schema.datatypeProperties,
			classLabelByIri
		)
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
				namespace: op.namespaceBaseIri,
				generatedReverseOf: op.generatedReverseOf
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
			authoritativeEntityIris,
			labelRequiredClassIris
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
		namespace: individual.namespaceBaseIri,
		syncSource: individual.syncSource,
		isStale: individual.syncStatus === 'stale'
	}));

	const individualRelationEdges: IndividualClassRelationEdgeSpec[] = [
		...schema.individualClassRelations.map(
			(relation): IndividualClassRelationEdgeSpec => ({
				kind: 'individualRelation',
				source: relation.individualIri,
				target: relation.classIri,
				predicateIri: relation.predicateIri,
				name: relation.name,
				namespace: relation.namespaceBaseIri
			})
		),
		// Story 007: individual→individual assertions (Story 019's `insertAssertion`, or Story 006's
		// drag-connect gesture) rendered as the same edge kind/component as individual→class
		// relations — reusing one generalized spec rather than forking a second parallel type.
		...schema.individualIndividualRelations.map(
			(relation): IndividualClassRelationEdgeSpec => ({
				kind: 'individualRelation',
				source: relation.individualIri,
				target: relation.targetIndividualIri,
				predicateIri: relation.predicateIri,
				name: relation.name,
				namespace: relation.namespaceBaseIri
			})
		)
	];

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
		authoritativeEntityIris,
		labelRequiredClassIris
	};
}
