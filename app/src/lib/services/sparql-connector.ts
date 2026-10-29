import { isShortId } from './short-links';
import { isSafeSparqlIri, assertSafeSparqlIri, escapeSparqlString } from '../utils/sparql-safe';
import {
	classIri,
	propertyIri,
	genericPropertyIri,
	individualIri,
	isValidIdentifierLocalName,
	nodeShapeIri,
	xsdIri,
	extractLocalName,
	SHAPES_NAMESPACE,
	ATTRIBUTED_RELATIONSHIP_IRI,
	APP_SETTINGS_IRI,
	AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI,
	REPRESENTS_PREDICATE_SETTING_IRI,
	BACKSTAGE_KIND_PREDICATE_IRI,
	NAMESPACE_PREDICATE_IRI,
	REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI,
	SOURCE_FIELD_PREDICATE_IRI,
	SOURCE_RELATION_PREDICATE_IRI,
	GENERATED_REVERSE_OF_PREDICATE_IRI,
	GROUP_ON_ONE_LINE_PREDICATE_IRI,
	DISPLAY_AS_CHIPS_PREDICATE_IRI,
	SYNC_SOURCE_PREDICATE_IRI,
	SYNC_STATUS_PREDICATE_IRI,
	NAMESPACE_CLASS_IRI,
	NAMESPACE_PREFIX_PREDICATE_IRI,
	NAMESPACE_COLOR_PREDICATE_IRI,
	NAMESPACE_LOCKED_PREDICATE_IRI,
	NAMESPACE_DEFAULT_HIDDEN_PREDICATE_IRI,
	NAMESPACE_LISTED_IN_FILTER_PREDICATE_IRI,
	WORKSPACE_CLASS_IRI,
	WORKSPACE_MEMBERSHIP_CLASS_IRI,
	WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI,
	WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI,
	WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI,
	WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI,
	WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI,
	WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI,
	workspaceIri,
	workspaceMembershipIri,
	workspaceMembershipIriDisambiguated,
	SAVED_QUERY_CLASS_IRI,
	SAVED_QUERY_TEXT_PREDICATE_IRI,
	ANNOTATION_CLASS_IRI,
	ANNOTATION_LABEL_CLASS_IRI,
	SEED_ANNOTATION_LABELS,
	ANNOTATES_PREDICATE_IRI,
	ANNOTATION_TYPE_PREDICATE_IRI,
	ANNOTATION_VALUE_PREDICATE_IRI,
	ANNOTATED_BY_PREDICATE_IRI,
	ANNOTATED_AT_PREDICATE_IRI,
	annotationIri,
	SAVED_QUERY_MODEL_PREDICATE_IRI,
	SAVED_QUERY_CREATED_BY_PREDICATE_IRI,
	SAVED_QUERY_CREATED_AT_PREDICATE_IRI,
	SAVED_QUERY_PUBLISHED_PREDICATE_IRI,
	savedQueryIri,
	SHARED_QUERY_CLASS_IRI,
	sharedQueryIri,
	NOTE_CLASS_IRI,
	NOTE_WORKSPACE_PREDICATE_IRI,
	NOTE_TEXT_PREDICATE_IRI,
	NOTE_COLOR_PREDICATE_IRI,
	NOTE_X_PREDICATE_IRI,
	NOTE_Y_PREDICATE_IRI,
	NOTE_LINKED_ELEMENT_PREDICATE_IRI,
	noteIri,
	EXTERNAL_VOCABULARY_CLASS_IRI,
	EXTERNAL_PREFIXES,
	catalogIri,
	datasetIri,
	distributionIri,
	splitDatasetIri,
	splitDistributionIri,
	publicationActivityIri,
	statementIri,
	kebabCase,
	XSD_NAMESPACE,
	type XsdDatatype
} from '$lib/utils/iri';
import {
	DEFAULT_NAMESPACE_BASE_IRI,
	namespaceGraphs,
	SCHEMA_GRAPH,
	type NamespaceGraphs
} from '$lib/config';
import {
	parseTurtle,
	quadsToTurtle,
	quadsToGroundTriples,
	selectScope,
	groupSchemaQuads,
	partitionQuads,
	nestBlankNodes,
	buildDisplayPrefixes,
	bindingToQuad,
	quadKey,
	isRdfType,
	selectCatalogScope,
	classIncomingRelationTargets,
	filterIncomingRelationQuads,
	resolveExternalDependencyClosure,
	EXTERNAL_DEPENDENCY_CLOSURE_CAP,
	RDF,
	OWL,
	RDFS,
	SH,
	SH_NS,
	DCAT,
	DCT,
	PROV,
	type Quad,
	type Partition
} from './turtle';
import {
	checkShaclWellFormedness,
	checkStructural,
	checkCatalogStructural,
	SchemaValidationError
} from './validation';
import { gridPosition } from '$lib/stores/layout-store';

export interface SparqlBinding {
	[key: string]: {
		type: string;
		value: string;
		datatype?: string;
		'xml:lang'?: string;
	};
}

export interface SparqlSelectResults {
	head: { vars: string[] };
	results: { bindings: SparqlBinding[] };
}

export interface SparqlAskResults {
	head: Record<string, never>;
	boolean: boolean;
}

export interface DeleteClassResult {
	deleted: boolean;
	/** Non-empty only when `deleted` is false: IRIs of properties elsewhere whose `rdfs:range`
	 *  points at this class, which would be left dangling. Retry with `{ force: true }` to delete
	 *  anyway. */
	externalReferences: string[];
	/** Non-empty only when `deleted` is false: other classes declared `rdfs:subClassOf` this class
	 *  (STORY-047), which would be left with a dangling superclass reference. Retry with
	 *  `{ force: true }` to delete anyway — the `subClassOf` triples are removed first. */
	subClassReferences: { subIri: string; namespaceBaseIri: string }[];
}

export interface DatatypePropertyUpdate {
	name: string;
	datatype: XsdDatatype;
	required: boolean;
	repeatable: boolean;
	/** See `REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI` (`utils/iri.ts`) — required on direct subclasses
	 *  of this attribute's owning class, as a class-level value, independent of `required`. */
	requiredForSubclasses?: boolean;
}

export interface ObjectPropertyUpdate {
	name: string;
	targetClassIri: string;
	required: boolean;
	repeatable: boolean;
}

export interface AssociationLink {
	/** e.g. "employee" / "employer" — becomes an `owl:ObjectProperty` on the association class. */
	propName: string;
	targetClassIri: string;
	required: boolean;
	/** `true` -> `sh:maxCount 1` (single value); `false` -> repeatable (no `sh:maxCount`). */
	maxOne: boolean;
}

export interface AssociationClassResult {
	iri: string;
	links: Array<{ iri: string; propName: string; targetClassIri: string; required: boolean; repeatable: boolean }>;
}

/** One classified triple from an `importTurtle` call — enough to show the user which
 *  subject/predicate pair it was and why it landed where it did (STORY-044). */
export interface ImportedTripleInfo {
	subject: string;
	predicate: string;
}

/** Result of `importTurtle` (STORY-044): every parsed triple lands in exactly one bucket —
 *  `inserted` (written), `duplicates` (already present, exact subject+predicate+object match,
 *  skipped), or `conflicts` (existing triple shares subject+predicate but a different object,
 *  skipped rather than overwritten). */
export interface ImportSummary {
	inserted: ImportedTripleInfo[];
	duplicates: ImportedTripleInfo[];
	conflicts: ImportedTripleInfo[];
}

/** Result of `exportWorkspaceBundle` (STORY-090): the self-contained `.ttl` bundle text, plus how
 *  many external-dependency classes/properties (STORY-089) were left out of it once
 *  `EXTERNAL_DEPENDENCY_CLOSURE_CAP` was hit — `0` when the closure never saturated the cap, i.e.
 *  every discovered dependency made it into `turtle`. Surfaced (rather than silently dropped) so
 *  STORY-093's export UI can warn the user before download. */
export interface WorkspaceExportBundle {
	turtle: string;
	truncatedDependencyCount: number;
}

/** One bucket's insert/no-op tally within `importWorkspaceBundle`'s combined summary (STORY-092) —
 *  `alreadyPresent` covers both "this exact row already existed" (STORY-091's idempotent upsert
 *  primitives) and, for the Namespace bucket, "a namespace with this base IRI was already
 *  registered". */
export interface WorkspaceImportBucketSummary {
	inserted: number;
	alreadyPresent: number;
}

/** Result of `importWorkspaceBundle` (STORY-092): `schema` is the exact `ImportSummary` shape
 *  `importTurtle` itself returns for the bundle's ordinary schema/shapes content, kept distinct from
 *  the four workspace-vocabulary buckets (`namespaces`/`workspaces`/`memberships`/`notes`) so
 *  STORY-094's UI can render both clearly. */
export interface WorkspaceImportSummary {
	schema: ImportSummary;
	namespaces: WorkspaceImportBucketSummary;
	workspaces: WorkspaceImportBucketSummary;
	memberships: WorkspaceImportBucketSummary;
	notes: WorkspaceImportBucketSummary;
}

// -- Full-schema fetch (STORY-009: reconstructing the canvas from GraphDB) --------------------

export interface FetchedClass {
	iri: string;
	label: string;
	comment: string | null;
	/** Base IRI of the namespace this class was fetched from (STORY-033) — every fetch method is
	 *  already scoped to one namespace's graphs, so this is just that namespace echoed back onto
	 *  each record for `canvas-model.ts` to carry through to the canvas's namespace filter. */
	namespaceBaseIri: string;
}

/** A property declaration with domain/range but no cardinality yet — see `FetchedProperty`. */
export interface FetchedPropertyBase {
	iri: string;
	label: string;
	domain: string;
	range: string;
	/** See `FetchedClass.namespaceBaseIri` (STORY-033). */
	namespaceBaseIri: string;
	/** The forward property's IRI, when this property is the auto-generated reverse half of a
	 *  relation pair (`rse:generatedReverseOf`) — `undefined` for every ordinary property, including
	 *  a *hand-drawn* relation pointing the same direction a reverse relation would. Only ever set on
	 *  object properties in practice (a datatype property has no reverse concept), but lives here
	 *  since both share `fetchPropertiesByType`. */
	generatedReverseOf?: string;
}

/** `domain`/`range`, plus cardinality merged in from the owning class's `sh:property` entry. */
export interface FetchedProperty extends FetchedPropertyBase {
	required: boolean;
	repeatable: boolean;
	/** The raw `sh:minCount`/`sh:maxCount` of the owning shape, when present — `required`/`repeatable`
	 *  collapse them to booleans, but a hand-edited shape may say e.g. `2..5`. Optional so existing
	 *  fixtures needn't set them. */
	minCount?: number;
	maxCount?: number;
	/** Whether this attribute is required on direct subclasses of `domain` as a class-level value
	 *  (`REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI`), independent of `required`'s "required on
	 *  instances" meaning — see that predicate's own doc comment in `utils/iri.ts`. Optional (like
	 *  `FetchedSchema.labelRequiredClassIris`) so existing hand-built fixtures elsewhere don't all
	 *  need updating; treat a missing value as `false`. */
	requiredForSubclasses?: boolean;
}

/**
 * An object property tagged with which relation kind (STORY-051/052) it is — 'specific' for the
 * unchanged `rdfs:domain`/`rdfs:range`-scoped default, 'generic' for a shared, domain/range-less
 * relation reconstructed from the shapes graph (STORY-054). Datatype properties have no such
 * distinction (always single-owner), so this only widens `FetchedSchema.objectProperties`.
 */
export interface FetchedObjectProperty extends FetchedProperty {
	relationKind: 'specific' | 'generic';
}

export interface FetchedShapeConstraint {
	/** The `sh:path` value — matches a property's IRI. */
	path: string;
	minCount?: number;
	maxCount?: number;
	requiredForSubclasses?: boolean;
}

export interface FetchedSubClassOf {
	sub: string;
	super: string;
	/** See `FetchedClass.namespaceBaseIri` (STORY-033) — the namespace `sub`'s own graph lives in. */
	namespaceBaseIri: string;
}

/** An enumerated class member (STORY-019) — e.g. `core:RelationType`'s `nutzt`/`verbucht`. */
export interface FetchedIndividual {
	iri: string;
	label: string;
	classIri: string;
	/** See `FetchedClass.namespaceBaseIri` (STORY-033). */
	namespaceBaseIri: string;
	/** The `rse:syncSource` marker value (e.g. `"backstage"`) a Go sync worker writes on every
	 *  individual it owns (Story 007/010), or `null` for an ordinary hand-authored individual. */
	syncSource: string | null;
	/** The `rse:syncStatus` value (currently only ever `"stale"`, Story 009), or `null` when the
	 *  individual isn't flagged stale — including for every non-synced individual. */
	syncStatus: string | null;
}

/** A generalized individual→class relation — any predicate connecting an individual to a class,
 *  written as a plain triple into the individual's own `graphs.instances`, no SHACL shape involved.
 *  Every predicate used here is a properly declared `owl:ObjectProperty` (generic or reused from an
 *  existing domain/range-specific one, see `resolveOrMintPredicate`), so `name` always reflects a
 *  real `rdfs:label` triple rather than a derived fallback. */
export interface FetchedIndividualClassRelation {
	individualIri: string;
	predicateIri: string;
	/** Display name — the predicate's real `rdfs:label`, falling back to its local name only if
	 *  somehow undeclared. */
	name: string;
	classIri: string;
	/** See `FetchedClass.namespaceBaseIri` (STORY-033) — the source individual's own namespace. */
	namespaceBaseIri: string;
}

/** A generalized individual→individual relation (data-catalog Story 019, canvas support added by
 *  relation-assertions Sprint 3 Story 007) — any predicate connecting one individual to another,
 *  written as a plain triple into the source individual's own `graphs.instances` (via
 *  `insertAssertion` or `insertIndividualClassRelation`, both of which write an identical triple
 *  shape regardless of the object's kind). Read-side counterpart of
 *  `FetchedIndividualClassRelation`, narrowed to individual-typed objects instead of class-typed
 *  ones — kept as its own fetch/type rather than widening that one, so `buildCanvasModel` can tell
 *  the two apart without re-deriving object-kind from IRI shape. */
export interface FetchedIndividualIndividualRelation {
	individualIri: string;
	predicateIri: string;
	/** Display name — the predicate's real `rdfs:label`, falling back to its local name only if
	 *  somehow undeclared. */
	name: string;
	targetIndividualIri: string;
	/** See `FetchedClass.namespaceBaseIri` (STORY-033) — the source individual's own namespace. */
	namespaceBaseIri: string;
}

/** A generic `<predicate, object>` assertion on an individual (data-catalog Story 019) — the
 *  editor's own CRUD read shape, unfiltered by target type (unlike `FetchedIndividualClassRelation`,
 *  which only keeps class-typed objects). */
export interface FetchedAssertion {
	individualIri: string;
	predicateIri: string;
	predicateLabel: string;
	objectIri: string;
	objectLabel: string;
}

// -- Identity browsing (STORY-115/116/117, `spec/browse-identity/plan.md`) ----------------------

/** `searchIndividuals` input (STORY-115) — every field optional and ANDed together with the others;
 *  an omitted `query` means no label filter, not "match nothing". `limit`/`offset` page through
 *  results (default `limit` 50, `offset` 0) — there is no keyset alternative in v1. */
export interface IndividualSearchParams {
	/** Case-insensitive substring match against `rdfs:label`. */
	query?: string;
	/** Only individuals without any `rdf:type` (Unclassified); ignores the class filters. */
	unclassified?: boolean;
	/** Exact-type match only (`FILTER(?type = <classIri>)`) — selecting an abstract/parent class
	 *  misses individuals typed only as one of its subclasses, since this repo runs no OWL2-RL
	 *  reasoning to materialize supertype `rdf:type` triples itself. Pass `classIris` instead when the
	 *  facet should also match subclasses (`identities/+page.svelte` does, expanding the selected
	 *  class's transitive subclass closure client-side from the already-loaded cross-namespace schema
	 *  before calling this method — this method has no schema access to compute that closure itself).
	 *  Ignored when `classIris` is also given. */
	classIri?: string;
	/** Same facet as `classIri`, but OR-matches every IRI in the list (`FILTER(?type IN (...))`) —
	 *  see `classIri`'s doc comment. */
	classIris?: string[];
	namespaceBaseIri?: string;
	/** Exact match against the `rse:syncSource` marker (e.g. `"backstage"`). */
	syncSource?: string;
	/** Exact match against the `rse:syncStatus` marker (currently only ever `"stale"`). */
	syncStatus?: string;
	/** query-workbench STORY-186: when true, `query` matches *any* literal-valued property of the
	 *  individual (not just `rdfs:label`) and each result reports the property/value that matched.
	 *  Off by default so `/identities` keeps its label-only behaviour. Terms shorter than
	 *  `MIN_ALL_STRINGS_SEARCH_LENGTH` return an empty page without querying. */
	matchAllStringProperties?: boolean;
	limit?: number;
	offset?: number;
	/** Unclassified mode only: continue after this row (keyset paging, no `OFFSET`), so a deep page
	 *  costs the same as the first. Takes precedence over `offset`. */
	after?: { label: string; iri: string };
}

/** Minimum term length for the all-strings search — a 1-character substring scan over every literal
 *  in the store is never useful and expensive. */
export const MIN_ALL_STRINGS_SEARCH_LENGTH = 2;

/** `searchIndividualFacetCounts` result (query-workbench STORY-186): counts over the *whole* match set,
 *  independent of any result page. */
export interface IndividualFacetCounts {
	byClass: { classIri: string; count: number }[];
	byNamespace: { namespaceBaseIri: string; count: number }[];
}

/** One `searchIndividuals` row — same shape as `FetchedIndividual`, kept as its own type since a
 *  search result is conceptually a distinct read path (paginated, filtered) even though the fields
 *  happen to match today. */
export interface IndividualSearchResult {
	iri: string;
	label: string;
	classIri: string;
	namespaceBaseIri: string;
	syncSource: string | null;
	syncStatus: string | null;
	/** Only set by `matchAllStringProperties` searches: the property and literal that matched. */
	matchedPropertyIri?: string;
	matchedValue?: string;
}

/** `searchIndividuals`' return shape — `hasMore` is computed by fetching one extra row past `limit`
 *  and trimming it off, so the caller never gets a "did this page fill exactly?" ambiguity. */
export interface IndividualSearchPage {
	results: IndividualSearchResult[];
	hasMore: boolean;
}

/** One outgoing `<iri> ?p ?o` triple (STORY-116) — `fetchResourcePage`'s "everything this IRI has on
 *  it" half. `objectDatatype` is only ever set when `objectType` is `'literal'` and the literal is
 *  typed (e.g. `xsd:date`). */
export interface ResourcePageTriple {
	predicateIri: string;
	/** Resolved `rdfs:label` on the predicate, falling back to its local name (STORY-116 AC). */
	predicateLabel: string;
	object: string;
	objectType: 'uri' | 'literal';
	objectDatatype?: string;
	/** Resolved `rdfs:label` on the object, only ever set when `objectType === 'uri'` — a literal
	 *  object is its own display value, not a labeled resource. `undefined` when the target IRI has
	 *  no `rdfs:label` of its own; callers fall back the same way `predicateLabel`'s absence would be
	 *  handled elsewhere (`labelOrPrettify`, not a server-side fallback here, since the caller already
	 *  has `object` to prettify from). */
	objectLabel?: string;
	/** `<predicateIri> rse:groupOnOneLine true` on the predicate itself (`GROUP_ON_ONE_LINE_PREDICATE_IRI`,
	 *  `utils/iri.ts`) — `true` only when explicitly asserted; `undefined` otherwise. Consumed by
	 *  `buildPropertyRows` (`utils/resource-page-format.ts`) to merge every triple sharing this
	 *  predicate into one display row instead of one row per triple. */
	predicateGroupOnOneLine?: boolean;
	/** `<predicateIri> rse:displayAsChips true` on the predicate itself (`DISPLAY_AS_CHIPS_PREDICATE_IRI`,
	 *  `utils/iri.ts`) — same grouping effect as `predicateGroupOnOneLine`, but each merged value
	 *  renders as its own chip instead of comma-joined text. */
	predicateDisplayAsChips?: boolean;
}

/** One incoming `?s ?p <iri>` triple (STORY-116) — `fetchResourcePage`'s "what links here" half. */
export interface ResourcePageIncomingTriple {
	subjectIri: string;
	/** Resolved `rdfs:label` on the subject, falling back to its local name. */
	subjectLabel: string;
	predicateIri: string;
	/** Resolved `rdfs:label` on the predicate, falling back to its local name. */
	predicateLabel: string;
}

/** `fetchResourcePage`'s return shape (STORY-116) — every outgoing and incoming triple for one
 *  arbitrary IRI, with predicate/subject labels already resolved. */
export interface ResourcePage {
	iri: string;
	outgoing: ResourcePageTriple[];
	incoming: ResourcePageIncomingTriple[];
}

/** One node in a `fetchIdentityNeighborhood` result (STORY-117) — always a real individual, never a
 *  class/property/shape (see the method's own doc comment for the join that guarantees this). */
export interface NeighborhoodNode {
	iri: string;
	label: string;
	classIri: string;
	/** Base IRI of the namespace this individual's own triples live in (STORY-120 color follow-up) —
	 *  its instances graph *is* the namespace base IRI (`namespaceGraphs()`'s `instances: base`), so
	 *  this is just that graph IRI echoed back, no suffix-stripping needed (unlike a class's `/schema`
	 *  graph). Lets a caller color a neighborhood node by its own namespace's default color rather
	 *  than only its class's. */
	namespaceBaseIri: string;
}

/** One edge in a `fetchIdentityNeighborhood` result (STORY-117) — never a structural/ontology
 *  predicate (`rdf:type`, `rdfs:subClassOf`, `skos:broader`/`inScheme`/`topConceptOf`). */
export interface NeighborhoodLink {
	source: string;
	target: string;
	predicateIri: string;
	predicateLabel: string;
}

/** `fetchIdentityNeighborhood`'s return shape (STORY-117) — a small, mergeable node/link delta; the
 *  caller (not this method) is responsible for deduping across repeated expand-on-click calls. */
export interface NeighborhoodGraph {
	nodes: NeighborhoodNode[];
	links: NeighborhoodLink[];
}

/** One attribute's resolved provenance (Sprint 4 Story 012) — the `fetchProvenanceReport` row shape.
 *  `masterIri`/`masterLabel` are `null` when neither the attribute nor its owning class has any
 *  `isMasterFor` assertion anywhere in the chain (Story 013's "no known contributor" case);
 *  `isAttributeOverride` distinguishes an attribute-specific override from the class-level default so
 *  the report can show which one is actually in effect. */
export interface ProvenanceAttributeEntry {
	attributeIri: string;
	attributeLabel: string;
	masterIri: string | null;
	masterLabel: string | null;
	isAttributeOverride: boolean;
	/** The master system's own operating authority, resolved via `fetchOperatingAuthority`
	 *  (`isMasterFor` → `isOperatedBy` → authority) — `null` when there's no master, or the master has
	 *  no `isOperatedBy` edge. */
	authorityIri: string | null;
	authorityLabel: string | null;
	/** ISO timestamp from the last "Generate catalog" run's `prov:Activity` for this attribute's own
	 *  dataset (its split dataset if `isAttributeOverride`, else the class's parent dataset) — `null`
	 *  when that dataset has never been generated. */
	generatedAt: string | null;
}

/** Per-class/per-attribute provenance report (Sprint 4 Story 012) — `fetchProvenanceReport`'s return
 *  shape, driving Story 013's read-only "Provenance" view. A read path over data the data-catalog
 *  feature already writes; never mutates anything. */
export interface ProvenanceReport {
	classIri: string;
	className: string;
	attributes: ProvenanceAttributeEntry[];
}

/** What kind of thing a `NameableEntity` resolves to — shown alongside its label in the Story 019
 *  object typeahead so same-named entities of different kinds stay distinguishable.
 *  `'relationInstance'` (relation-assertions Story 011) is a reified `rdf:Statement` — a single
 *  relation-edge instance someone has already annotated (Story 009/010), pickable as the object of
 *  another assertion (e.g. `core:itam gov:isMasterFor core:linkabc124`). */
export type NameableEntityKind = 'class' | 'attribute' | 'relation' | 'individual' | 'relationInstance';

/** Anything nameable the Story 019 assertion editor's object typeahead can resolve by label — a
 *  class, an attribute, a relation, or an individual. */
export interface NameableEntity {
	iri: string;
	label: string;
	kind: NameableEntityKind;
}

/** The object of a fact (query-workbench STORY-181): an IRI (a relation) or a literal (an attribute
 *  value). Literals match on value + datatype + language exactly, so `"1"`, `"1"^^xsd:integer` and
 *  `"1"@en` are three distinct facts. */
export type FactObject =
	| { kind: 'iri'; iri: string }
	| { kind: 'literal'; value: string; datatype?: string; lang?: string };

/** One fact to annotate or look up (query-workbench STORY-182). */
export interface FactKey {
	subjectIri: string;
	predicateIri: string;
	object: FactObject;
}

/** Annotation text is capped so a report cell stays readable. */
export const ANNOTATION_MAX_TEXT_LENGTH = 2000;

export type AnnotationInput = { type: 'text'; text: string } | { type: 'label'; labelIri: string };

export interface FetchedAnnotation {
	iri: string;
	type: 'text' | 'label';
	text?: string;
	labelIri?: string;
	labelText?: string;
	annotatedBy: string;
	annotatedAt: string;
}

const XSD_STRING_IRI = 'http://www.w3.org/2001/XMLSchema#string';

/**
 * Canonical string key for a fact, used to index `fetchAnnotationsForFacts`' result. A plain literal
 * and an `xsd:string` literal are the same RDF 1.1 term, so they share a key; typed and
 * language-tagged literals stay distinct.
 */
export function factKeyString(fact: FactKey): string {
	const o = fact.object;
	const obj =
		o.kind === 'iri'
			? `iri:${o.iri}`
			: `lit:${o.value}\u0001${o.datatype && o.datatype !== XSD_STRING_IRI ? o.datatype : ''}\u0001${o.lang?.toLowerCase() ?? ''}`;
	return `${fact.subjectIri}\u0000${fact.predicateIri}\u0000${obj}`;
}

/** A labelled subject in a namespace's instances graph with no `rdf:type` at all — shown as an
 *  "Unclassified" individual until a class is assigned (`instances-issues` STORY-004). */
/** Labelled subjects with no `rdf:type` in their graph (`?ig`), the definition of Unclassified.
 *  `?i != ?ig` drops a namespace's own declaration subject (its base IRI is its instances graph's IRI). */
const unclassifiedBlock = () => `{
				GRAPH ?ig {
					?i rdfs:label ?label .
					FILTER NOT EXISTS { ?i rdf:type ?t }
					FILTER(!isBlank(?i))
					FILTER(?i != ?ig)
				}
				${VOCAB_FILTER('?i')}
			}`;

export interface BulkUnclassifiedFilter {
	query?: string;
	namespaceBaseIri?: string;
	/** An explicit selection; omitted means every individual matching the other filters. */
	iris?: string[];
}

/** Largest explicit selection a bulk run can undo. */
export const BULK_UNDO_LIMIT = 5000;

/** The Instances view loads at most this many Unclassified individuals; the rest are reached from the
 *  Identities page (`FetchedSchema.untypedTotal` says how many exist). */
export const UNCLASSIFIED_CANVAS_CAP = 200;

export interface FetchedUntypedIndividual {
	iri: string;
	label: string;
	namespaceBaseIri: string;
}

export interface FetchedSchema {
	classes: FetchedClass[];
	datatypeProperties: FetchedProperty[];
	objectProperties: FetchedObjectProperty[];
	subClassOf: FetchedSubClassOf[];
	individuals: FetchedIndividual[];
	/** Individuals without any `rdf:type` — optional for the same reason as `labelRequiredClassIris`;
	 *  always populated by `fetchFullSchema`. */
	untypedIndividuals?: FetchedUntypedIndividual[];
	/** How many Unclassified individuals exist in all; `untypedIndividuals` holds at most
	 *  `UNCLASSIFIED_CANVAS_CAP` of them. */
	untypedTotal?: number;
	individualClassRelations: FetchedIndividualClassRelation[];
	individualIndividualRelations: FetchedIndividualIndividualRelation[];
	/** Class IRIs with their own `sh:property [sh:path rdfs:label; sh:minCount >= 1]` shape
	 *  (STORY-112) — optional so hand-built `FetchedSchema` fixtures elsewhere (tests) don't all need
	 *  updating; `buildCanvasModel` treats a missing field as an empty list. Always populated by
	 *  `fetchFullSchema`. */
	labelRequiredClassIris?: string[];
	/** `sh:in` value lists on a class's `sh:property` shapes (query-workbench STORY-174) — optional
	 *  for the same reason as `labelRequiredClassIris`. Always populated by `fetchFullSchema`. */
	shapeInConstraints?: FetchedInConstraint[];
}

/** One `sh:property [ sh:path ?p ; sh:in (...) ]` list on `classIri`'s NodeShape. List order is not
 *  preserved (the list is read by walking `rdf:rest` / `rdf:first`). */
export interface FetchedInConstraint {
	classIri: string;
	propertyIri: string;
	values: { value: string; isIri: boolean }[];
}

// -- Namespace management (STORY-027) -----------------------------------------------------------

export interface FetchedNamespace {
	baseIri: string;
	prefix: string;
	description: string | null;
	/** Optional default color (STORY-042) for entities/relations in this namespace with no
	 *  per-node color override. */
	color: string | null;
	/** Optional default `dct:publisher` (data-catalog Story 011) — a plain literal (organization
	 *  name), pre-filled onto a class's generated dataset at first-generation time when no
	 *  per-entity override is later set. */
	publisher: string | null;
	/** Optional default `dct:license` (data-catalog Story 011) — a well-formed IRI, same pre-fill
	 *  semantics as `publisher`. */
	license: string | null;
	/** `locked` flag (STORY-095) — when `true`, `deleteNamespace` refuses unconditionally, even
	 *  under `{force: true}`. Defaults to `false` when the triple is absent. */
	locked: boolean;
	/** `defaultHidden` flag (STORY-096) — seeds `namespaceVisibilityStore`'s hidden/visible state
	 *  the first time a given browser encounters this namespace. Defaults to `false` when absent,
	 *  except for `DEFAULT_NAMESPACE_BASE_IRI` itself, which defaults to `true` (preserving its
	 *  pre-existing hardcoded "starts hidden" behavior) unless explicitly overridden. */
	defaultHidden: boolean;
	/** `listedInFilter` flag (STORY-097) — when `false`, the namespace is omitted entirely from
	 *  `NamespaceFilter.svelte`'s toggle list. Defaults to `true` when absent. */
	listedInFilter: boolean;
}

// -- Workspace management (STORY-071/072/073) ----------------------------------------------------

/** A registered Workspace (STORY-072): `{iri, label, defaultNamespaceBaseIri}`, read from the
 *  default namespace's `/schema` graph regardless of its own `defaultNamespaceBaseIri` value
 *  (research Decision 4 — that field is a UI pre-fill convenience, not a storage-location signal). */
export interface FetchedWorkspace {
	iri: string;
	label: string;
	/** Optional UI convenience: pre-fills the namespace for new items created while this Workspace
	 *  is active. `null` when unset. */
	defaultNamespaceBaseIri: string | null;
}

/** A registered SavedQuery (STORY-087): `{iri, label, sparqlText, description}`, read from the
 *  default namespace's `/schema` graph regardless of which namespace is currently active
 *  (research Decision 4). */
export interface FetchedSavedQuery {
	iri: string;
	label: string;
	sparqlText: string;
	description: string;
	/** Serialised `QueryModel` JSON (query-workbench STORY-178); `undefined` for a legacy raw-SPARQL query. */
	queryModel?: string;
	/** JWT `sub` of the creator (STORY-179); `undefined` for legacy queries. */
	createdBy?: string;
	createdAt?: string;
	/** Reserved for the BI follow-up (research Q15) — always `false` in this iteration. */
	published: boolean;
}

/** Workbench-only fields written together with a new SavedQuery (STORY-178). */
export interface SavedQueryWorkbenchFields {
	queryModelJson: string;
	createdBy: string;
	/** ISO timestamp; defaults to now. */
	createdAt?: string;
}

/** A Workspace Note (STORY-083): `{iri, text, color, x, y, linkedElementIri}`, read from the
 *  default namespace's `/schema` graph regardless of which namespace the linked element (if any)
 *  belongs to (research Decision 4). */
export interface FetchedNote {
	iri: string;
	text: string;
	color: string;
	x: number;
	y: number;
	linkedElementIri: string | null;
}

/** A registered external vocabulary (STORY-046): `{prefix, baseIri}`, merged by
 *  `fetchExternalVocabularies` with the three built-in `EXTERNAL_PREFIXES` defaults. */
export interface FetchedExternalVocabulary {
	prefix: string;
	baseIri: string;
	/** `true` for the three built-in defaults (`foaf`/`schema`/`skos`) — not stored in GraphDB, so
	 *  not user-deletable. */
	builtIn: boolean;
}

/* `isSafeSparqlIri`/`assertSafeSparqlIri`/`escapeSparqlString` live in `utils/sparql-safe.ts`, shared with
   `query-compiler.ts`. */

/** Types whose nodes are app bookkeeping, never browsable individuals: Notes, Workspaces and (query-workbench
 *  STORY-180) annotation nodes and annotation-label members. Interpolated into `?type NOT IN (...)` filters. */
const NON_INDIVIDUAL_TYPES = [
	NOTE_CLASS_IRI,
	WORKSPACE_CLASS_IRI,
	ANNOTATION_CLASS_IRI,
	ANNOTATION_LABEL_CLASS_IRI
]
	.map((iri) => `<${iri}>`)
	.join(', ');

/** Disambiguates statement IRIs minted within the same millisecond. */
let statementCounter = 0;

const PREFIXES = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX sh: <http://www.w3.org/ns/shacl#>
`;

/** `FROM <graph>` clause fragment(s) (STORY-025/026), merging one or more named graphs into a
 *  SELECT/ASK query's default graph so plain (ungraphed) triple patterns in `WHERE` see their
 *  triples. Every call site passes the specific namespace graph(s) the query actually needs —
 *  there is no module-level graph constant anymore (each namespace derives its own three graphs
 *  via `namespaceGraphs()`). */
function fromClause(...graphs: string[]): string {
	return graphs.map((g) => `FROM <${g}>`).join('\n\t\t\t\t');
}

/** `WITH <graph>` clause fragment, scoping a full `DELETE {} INSERT {} WHERE {}` Modify operation's
 *  delete/insert templates *and* its `WHERE` pattern to one named graph. Must be repeated on every
 *  `;`-separated Modify operation — `WITH` applies to a single operation only. */
function withGraph(graph: string): string {
	return `WITH <${graph}>`;
}

/** Wraps an `INSERT DATA`/`DELETE DATA`/`DELETE WHERE` triple pattern in an explicit `GRAPH` block —
 *  those update forms have no `WITH`/`USING` graph selection, so the graph must be named inline. */
function inGraph(triples: string, graph: string): string {
	return `GRAPH <${graph}> { ${triples} }`;
}

/**
 * Drops exact-duplicate quads from a single round-trip's `selectScope` results (STORY-082) — e.g. a
 * Workspace containing both a class and one of its own individuals as separate members would
 * otherwise select that individual's triples twice (once directly, once via the class's own scope
 * already including its individuals, `turtle.ts`'s `selectScope` doc comment). Object literals are
 * compared by termType/value, plus datatype+language for literals — safe only within one round-trip's
 * quads, where blank node value strings are guaranteed stable.
 */
function dedupeQuads(quads: Quad[]): Quad[] {
	const seen = new Set<string>();
	return quads.filter((q) => {
		const objectKey =
			q.object.termType === 'Literal' ? `${q.object.value}|${q.object.datatype.value}|${q.object.language}` : q.object.value;
		const key = `${q.subject.termType}:${q.subject.value}|${q.predicate.value}|${q.object.termType}:${objectKey}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Groups `quads` by their (`NamedNode`-only — blank-node subjects have no cross-round-trip identity
 *  of their own, see `importTurtle`'s doc comment) subject IRI, preserving first-seen subject order —
 *  the per-subject grouping `importWorkspaceBundle` (STORY-092) needs to reconstruct one
 *  Workspace/WorkspaceMembership/Note/Namespace row's full set of predicate values at a time. */
function groupQuadsBySubject(quads: Quad[]): Map<string, Quad[]> {
	const map = new Map<string, Quad[]>();
	for (const q of quads) {
		if (q.subject.termType !== 'NamedNode') continue;
		const list = map.get(q.subject.value) ?? [];
		list.push(q);
		map.set(q.subject.value, list);
	}
	return map;
}

/** First literal object value found for `predicateIri` among `quads` — the per-row field reader
 *  `importWorkspaceBundle` (STORY-092) uses to pull e.g. a Note's `noteText`/`noteColor` back out of
 *  one subject's grouped quads. */
function findLiteral(quads: Quad[], predicateIri: string): string | undefined {
	return quads.find((q) => q.predicate.value === predicateIri && q.object.termType === 'Literal')?.object.value;
}

/** First `NamedNode` object value found for `predicateIri` among `quads` — the per-row field reader
 *  `importWorkspaceBundle` (STORY-092) uses to pull e.g. a `WorkspaceMembership`'s linked element IRI
 *  back out of one subject's grouped quads. */
function findNamedNode(quads: Quad[], predicateIri: string): string | undefined {
	return quads.find((q) => q.predicate.value === predicateIri && q.object.termType === 'NamedNode')?.object.value;
}

/** Standard vocabulary namespaces (RDF/RDFS/OWL/XSD/SHACL) whose terms are axioms of the
 *  ontology languages themselves, not user-authored schema. GraphDB reasoners materialize
 *  triples like `rdfs:Class rdfs:subClassOf rdfs:Resource` when inference is on; excluding
 *  these namespaces keeps them out of the canvas. */
const VOCAB_NAMESPACES = [
	'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	'http://www.w3.org/2000/01/rdf-schema#',
	'http://www.w3.org/2002/07/owl#',
	'http://www.w3.org/2001/XMLSchema#',
	'http://www.w3.org/ns/shacl#'
];

/** SPARQL FILTER excluding standard vocabulary IRIs from the given bound variable. `STR()` is only
 *  defined for IRIs/literals — calling it on a blank node is a type error that SPARQL treats as a
 *  failed filter, silently dropping the row. Every `sh:property` shape in this app *is* a blank
 *  node, so the `isBlank(...)` short-circuit here is required to keep their triples (`sh:path`,
 *  `sh:class`/`sh:datatype`, cardinality, ...) from vanishing out of every raw-triples fetch. */
function VOCAB_FILTER(variable: string): string {
	const conditions = VOCAB_NAMESPACES.map((ns) => `!STRSTARTS(STR(${variable}), "${ns}")`).join(
		' && '
	);
	return `FILTER(isBlank(${variable}) || (${conditions}))`;
}

/** Vocabulary types that mark a subject as schema/shapes metadata rather than an enumerated
 *  individual — mirrors `fetchAllIndividuals`'s `?type a owl:Class` join: anything typed one of
 *  these is a class/property/shape declaration, not an instance. */
const META_TYPES = new Set<string>([OWL.Class, OWL.DatatypeProperty, OWL.ObjectProperty, SH.NodeShape]);

/** True if `subjectIri` (given its own quads within some already-scoped `Quad[]`) looks like an
 *  enumerated individual (STORY-019) rather than a class/property declaration: it carries an
 *  `rdf:type` triple whose object isn't one of the meta-vocabulary types above. */
function looksLikeIndividual(quads: Quad[], subjectIri: string): boolean {
	return quads.some(
		(q) => q.subject.value === subjectIri && q.predicate.value === RDF.type && !META_TYPES.has(q.object.value)
	);
}

/**
 * Splits `turtle.ts`'s `partitionQuads()` "schema" bucket (classes/properties **and**
 * individuals, mixed together — see its own doc comment) further into instances vs. schema, using
 * the same individual-detection rule `fetchAllIndividuals`/`looksLikeIndividual` use. Grouped by
 * subject first so a multi-triple individual (`rdf:type` + `rdfs:label`, ...) moves as one unit.
 */
function splitInstancesFromSchema(schemaBucket: Quad[]): { instances: Quad[]; schema: Quad[] } {
	const bySubject = new Map<string, Quad[]>();
	for (const q of schemaBucket) {
		const key = `${q.subject.termType}|${q.subject.value}`;
		const list = bySubject.get(key) ?? [];
		list.push(q);
		bySubject.set(key, list);
	}

	const instances: Quad[] = [];
	const schema: Quad[] = [];
	for (const quads of bySubject.values()) {
		const subjectIri = quads[0].subject.value;
		(looksLikeIndividual(quads, subjectIri) ? instances : schema).push(...quads);
	}
	return { instances, schema };
}

/**
 * Thin client for the server-proxied SPARQL routes (`/api/sparql`, `/api/sparql/update`).
 * Mirrors `semantic-crm`'s `sparql-connector.ts` approach: no RDF/SPARQL client library,
 * just hand-written query strings and SPARQL-JSON parsing. Beyond the raw select/ask/update
 * primitives, this also carries the domain-specific class/attribute/shape methods later canvas
 * stories (STORY-004 onward) build on, following the same everything-in-one-connector shape
 * `semantic-crm` uses.
 *
 * Every method that reads/writes namespace-scoped triples (STORY-026) takes an explicit
 * `namespaceBaseIri` parameter, defaulting to the app's pre-existing default namespace
 * (`DEFAULT_NAMESPACE_BASE_IRI`) so every call site predating namespace management keeps working
 * unchanged. `namespaceGraphs()` (STORY-025) derives the namespace's three storage graphs from
 * that one base IRI; class/property/shape-declaring methods pick `.schema`/`.shapes` depending on
 * which kind of triple they write, individual-declaring methods use `.instances`.
 *
 * The one exception is `insertObjectProperty`/`updateObjectProperty`/`deleteObjectProperty`
 * (Decision 8): a relation's target graph is derived automatically from its *source* class's own
 * namespace (via `findNamespaceOfClass`) rather than taking an explicit parameter — this is what
 * lets a relation cross namespaces without a new form field.
 */
export class SparqlConnector {
	private apiUrl: string;

	constructor(apiUrl: string = '/api/sparql') {
		this.apiUrl = apiUrl;
	}

	/** Execute a raw SPARQL SELECT query, returning parsed SPARQL-JSON results. Pass
	 *  `{ infer: false }` to query only asserted statements, bypassing GraphDB's reasoner — see
	 *  `fetchWholeGraphQuads`. */
	async selectQuery(query: string, options?: { infer?: boolean }): Promise<SparqlSelectResults> {
		return this.executeQuery<SparqlSelectResults>(query, options);
	}

	/** Execute a raw SPARQL ASK query, returning the boolean result. */
	async askQuery(query: string): Promise<boolean> {
		const result = await this.executeQuery<SparqlAskResults>(query);
		return result.boolean;
	}

	/** Execute a raw SPARQL Update (INSERT DATA, DELETE DATA, DELETE/INSERT WHERE, etc.). */
	async executeUpdate(update: string): Promise<void> {
		const response = await fetch(`${this.apiUrl}/update`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ update })
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(
				errorData.message || `SPARQL update failed: ${response.status} ${response.statusText}`
			);
		}
	}

	// -- Classes (owl:Class) ------------------------------------------------------------------

	async classExists(iri: string, namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<boolean> {
		this.assertSafeSparqlIri(iri, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		return this.askQuery(`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> a owl:Class }`);
	}

	/** Derives the class IRI from `name` (stable for the class's lifetime) and creates it. */
	async insertClass(
		name: string,
		description?: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ iri: string }> {
		if (!name.trim()) throw new Error('Class name must not be empty');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const iri = classIri(name, graphs.schema);
		if (await this.classExists(iri, namespaceBaseIri)) {
			throw new Error(`A class named "${name}" already exists (${iri})`);
		}

		const labelTriple = `rdfs:label "${this.escapeString(name)}"`;
		const trimmedDescription = description?.trim();
		const commentTriple = trimmedDescription
			? ` ; rdfs:comment "${this.escapeString(trimmedDescription)}"`
			: '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${iri}> a owl:Class ; ${labelTriple}${commentTriple} .`, graphs.schema)} }`
		);
		return { iri };
	}

	/** Updates only `rdfs:label` — the class's IRI is fixed at creation and never changes. */
	async renameClass(
		iri: string,
		newName: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		if (!newName.trim()) throw new Error('Class name must not be empty');
		this.assertSafeSparqlIri(iri, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const escaped = this.escapeString(newName);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${iri}> rdfs:label ?old }
			INSERT { <${iri}> rdfs:label "${escaped}" }
			WHERE { OPTIONAL { <${iri}> rdfs:label ?old } }
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a class's `rdfs:comment`. */
	async updateClassDescription(
		iri: string,
		description: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(iri, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const trimmed = description?.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${iri}> rdfs:comment ?old`, graphs.schema)} }`
			);
			return;
		}

		const escaped = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${iri}> rdfs:comment ?old }
			INSERT { <${iri}> rdfs:comment "${escaped}" }
			WHERE { OPTIONAL { <${iri}> rdfs:comment ?old } }
		`);
	}

	/**
	 * Properties this class owns (its own attributes and specific relations): anything with
	 * `rdfs:domain` = this class, **union**ed with every generic relation (STORY-051/052, no
	 * `rdfs:domain` at all) used from this class's own `sh:NodeShape` (STORY-055) — a generic
	 * relation drawn from this class is just as much "this class's own property" as a specific one,
	 * even though it carries no `rdfs:domain` triple to find it by directly.
	 */
	async findOwnProperties(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?p ${fromClause(graphs.schema, graphs.shapes)} WHERE {
				{ ?p rdfs:domain <${classIriValue}> }
				UNION
				{ ?shape sh:targetClass <${classIriValue}> ; sh:property [ sh:path ?p ] }
			}
		`);
		return [...new Set(results.results.bindings.map((b) => b.p.value))];
	}

	/**
	 * Properties belonging to *other* classes whose `rdfs:range` points at this class, **union**ed
	 * with every generic relation (STORY-051/052) whose `sh:property`/`sh:class` on *any*
	 * `sh:NodeShape` targets this class (STORY-055) — a generic relation carries no `rdfs:range` to
	 * find it by, so `deleteClass`'s refuse-then-force cascade check (which calls this) would
	 * otherwise miss it and silently orphan the reference.
	 */
	async findExternalReferences(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?p ${fromClause(graphs.schema, graphs.shapes)} WHERE {
				{ ?p rdfs:range <${classIriValue}> }
				UNION
				{ ?otherShape sh:property [ sh:path ?p ; sh:class <${classIriValue}> ] }
			}
		`);
		return [...new Set(results.results.bindings.map((b) => b.p.value))];
	}

	/** Other classes declared `rdfs:subClassOf` this class (STORY-047). Unlike
	 *  `findExternalReferences` (scoped to one namespace, since a property's `rdfs:range` lives in
	 *  the property owner's own namespace), a `subClassOf` triple lives in the *sub* class's own
	 *  namespace — which may differ from this class's namespace entirely — so every registered
	 *  namespace's schema graph is scanned, mirroring `fetchFullSchemaForAllNamespaces`. */
	async findSubClassReferences(
		classIriValue: string
	): Promise<{ subIri: string; namespaceBaseIri: string }[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const namespaces = await this.fetchNamespaces();
		const perNamespace = await Promise.all(
			namespaces.map(async (ns) => {
				const graphs = namespaceGraphs(ns.baseIri);
				const results = await this.selectQuery(
					`${PREFIXES} SELECT ?sub ${fromClause(graphs.schema)} WHERE { ?sub rdfs:subClassOf <${classIriValue}> }`
				);
				return results.results.bindings.map((b) => ({ subIri: b.sub.value, namespaceBaseIri: ns.baseIri }));
			})
		);
		return perNamespace.flat();
	}

	/**
	 * Referential-cleanup clause (STORY-081) for a deleted class: matches every `WorkspaceMembership`
	 * row referencing either the class itself or any of its own individuals (which `deleteClass`'s
	 * own `?individual a <iri>` cascade is about to remove too), across every Workspace, and deletes
	 * it — otherwise a deleted class silently leaves orphaned membership rows (and stray positions)
	 * behind (research §8, the plan's risk assessment). `?el` is bound via a `BIND`/`UNION` (the class
	 * itself, or one of its individuals found in `instancesGraph`) so this stays one `DELETE {} WHERE
	 * {}` operation rather than N per-individual round-trips. Always targets the *default* namespace's
	 * `/schema` graph (Decision 4), regardless of `iri`'s own namespace — `WorkspaceMembership` rows
	 * never live anywhere else. Must run *before* the class/individual triples themselves are deleted
	 * in the same `;`-joined update, since its `WHERE` depends on `<iri> a owl:Class`/`?el a <iri>`
	 * still being present.
	 */
	private cascadeDeleteWorkspaceMembershipsForClassClause(classIri: string, instancesGraph: string): string {
		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		return `
			DELETE { ${inGraph('?m ?p ?o .', defaultGraphs.schema)} }
			WHERE {
				{ BIND(<${classIri}> AS ?el) }
				UNION
				{ ${inGraph(`?el a <${classIri}> .`, instancesGraph)} }
				${inGraph(`?m <${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?el ; ?p ?o .`, defaultGraphs.schema)}
			}
		`;
	}

	/** Referential-cleanup clause (STORY-081) for a single deleted element (an individual, or any
	 *  other one-IRI deletion) — every `WorkspaceMembership` row referencing `elementIri`, across
	 *  every Workspace. Mirrors `deleteWorkspace`'s own membership-cleanup `DELETE WHERE` shape. */
	private cascadeDeleteWorkspaceMembershipsClause(elementIri: string): string {
		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		return `DELETE WHERE { ${inGraph(`?m <${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}> ; ?p ?o .`, defaultGraphs.schema)} }`;
	}

	/**
	 * Referential-cleanup clause (STORY-083) for a deleted class: **unlinks, not deletes** — every
	 * Note's `noteLinkedElement` pointing at the class itself or any of its own individuals is
	 * removed, but the Note's text/color/position (and the Note itself) survive, becoming an
	 * unlinked sticky note rather than silently vanishing along with the element it was annotating.
	 * Mirrors `cascadeDeleteWorkspaceMembershipsForClassClause`'s `BIND`/`UNION`-bound `?el` shape
	 * exactly. Always targets the default namespace's `/schema` graph (Decision 4). Must run before
	 * the class/individual triples themselves are deleted, since its `WHERE` depends on
	 * `<iri> a owl:Class`/`?el a <iri>` still being present.
	 */
	private cascadeUnlinkNotesForClassClause(classIri: string, instancesGraph: string): string {
		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		return `
			DELETE { ${inGraph(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?el .`, defaultGraphs.schema)} }
			WHERE {
				{ BIND(<${classIri}> AS ?el) }
				UNION
				{ ${inGraph(`?el a <${classIri}> .`, instancesGraph)} }
				${inGraph(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?el .`, defaultGraphs.schema)}
			}
		`;
	}

	/** Referential-cleanup clause (STORY-083) for a single deleted element (an individual, or any
	 *  other one-IRI deletion) — **unlinks, not deletes** — every Note's `noteLinkedElement` pointing
	 *  at `elementIri`. Mirrors `cascadeDeleteWorkspaceMembershipsClause`'s shape. */
	private cascadeUnlinkNotesClause(elementIri: string): string {
		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		return `DELETE WHERE { ${inGraph(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${elementIri}> .`, defaultGraphs.schema)} }`;
	}

	/**
	 * Deletes a class: its own `owl:Class`/`rdfs:label`/`rdfs:comment` triples, its own attributes
	 * (cascade, via `deleteDatatypeProperty`), and its `sh:NodeShape`. Deletion is refused (without
	 * writing anything) when another class's property has `rdfs:range` pointing at this class, or
	 * another class is declared `rdfs:subClassOf` this class (STORY-047), unless `{ force: true }`
	 * is passed — silently leaving a dangling reference is not acceptable, but an explicit, warned
	 * deletion is. On a forced delete, incoming `subClassOf` triples are removed first.
	 */
	async deleteClass(
		iri: string,
		options?: { force?: boolean },
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<DeleteClassResult> {
		this.assertSafeSparqlIri(iri, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);

		const externalReferences = await this.findExternalReferences(iri, namespaceBaseIri);
		const subClassReferences = await this.findSubClassReferences(iri);
		if ((externalReferences.length > 0 || subClassReferences.length > 0) && !options?.force) {
			return { deleted: false, externalReferences, subClassReferences };
		}

		for (const { subIri, namespaceBaseIri: subNamespaceBaseIri } of subClassReferences) {
			await this.deleteSubClassOf(subIri, iri, subNamespaceBaseIri);
		}

		const ownProperties = await this.findOwnProperties(iri, namespaceBaseIri);
		for (const propIri of ownProperties) {
			await this.deleteDatatypeProperty(propIri, iri, namespaceBaseIri);
		}

		const shapeIri = nodeShapeIri(iri, graphs.shapes);
		await this.executeUpdate(`
			${PREFIXES}
			${this.cascadeDeleteWorkspaceMembershipsForClassClause(iri, graphs.instances)} ;
			${this.cascadeUnlinkNotesForClassClause(iri, graphs.instances)} ;
			DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`, graphs.shapes)} } ;
			DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`, graphs.shapes)} } ;
			DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, graphs.schema)} } ;
			DELETE WHERE { ${inGraph(`?individual a <${iri}> . ?individual ?p ?o .`, graphs.instances)} }
		`);

		return { deleted: true, externalReferences: [], subClassReferences: [] };
	}

	// -- Individuals / enumerated class members (STORY-019) ------------------------------------

	/**
	 * Adds an enumerated member to `classIriValue` (e.g. `core:RelationType`'s `nutzt`): a bare
	 * `<iri> a <classIriValue> ; rdfs:label "..."` pair, no `sh:*` triples — always available per
	 * class, no separate "is this an enumeration" flag (Decision 3, `plan.md`). The IRI is derived
	 * from the owning class + label (`individualIri`) and is stable thereafter, unless the caller
	 * supplies `identifier` (STORY-113), in which case the IRI mints as `<base>#<identifier>` instead
	 * — validated against `isValidIdentifierLocalName` on top of the usual `assertSafeSparqlIri`
	 * guard, since a hand-typed identifier has no automatic sanitization. That `<base>` is
	 * `classIriValue`'s *effective Concept Namespace* (`resolveEffectiveClassNamespace`, own or
	 * inherited `rse:namespace` — STORY-099/100) when one is declared: a hand-typed identifier is
	 * exactly the kind of externally-authoritative UID a Concept Namespace exists to prefix, the
	 * contract this method must honor unconditionally once an identifier is given — falling back to
	 * `namespaceBaseIri`'s own instance graph only when the class declares no Concept Namespace
	 * anywhere in its ancestry. A plain label-derived individual (no `identifier`) always uses
	 * `namespaceBaseIri` as-is — the override is scoped to the hand-typed-identifier path only.
	 *
	 * This override was briefly removed in favor of always honoring the caller's `namespaceBaseIri`,
	 * on the theory that a Concept Namespace nobody registered was silently orphaning data (nothing
	 * ever queried an unregistered namespace's graph again, even though the triples were written
	 * correctly). That's now handled at its actual source instead — `EntityForm`'s "Concept
	 * namespace" field is a `<select>` constrained to registered namespaces, so
	 * `resolveEffectiveClassNamespace` can no longer resolve to anything unregistered — restoring
	 * this override to its original STORY-113 contract.
	 */
	async insertIndividual(
		classIriValue: string,
		label: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI,
		identifier?: string
	): Promise<{ iri: string }> {
		if (!label.trim()) throw new Error('Member name must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		let graphs = namespaceGraphs(namespaceBaseIri);

		let iri: string;
		const trimmedIdentifier = identifier?.trim();
		if (trimmedIdentifier) {
			if (!isValidIdentifierLocalName(trimmedIdentifier)) {
				throw new Error(
					'Identifier must start with a letter or digit and contain only letters, digits, "_" or "-"'
				);
			}
			const effectiveNamespace = await this.resolveEffectiveClassNamespace(classIriValue);
			if (effectiveNamespace !== null) {
				graphs = namespaceGraphs(effectiveNamespace.baseIri);
			}
			iri = `${graphs.instances}#${trimmedIdentifier}`;
			this.assertSafeSparqlIri(iri, 'individual IRI');
		} else {
			iri = individualIri(classIriValue, label, graphs.instances);
		}
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.instances)} { <${iri}> a <${classIriValue}> }`
		);
		if (exists) {
			throw new Error(`A member named "${label}" already exists on this class (${iri})`);
		}

		const escapedLabel = this.escapeString(label);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${iri}> a <${classIriValue}> ; rdfs:label "${escapedLabel}" .`, graphs.instances)} }`
		);
		return { iri };
	}

	/** Updates only `rdfs:label` — the member's IRI never changes, mirroring `renameClass`.
	 *  `namespaceBaseIri` is optional: when omitted, resolved via `findNamespaceOfIndividual` instead
	 *  of assuming `iri` lives in its *class's* declaring/active namespace, which a Concept
	 *  Namespace override (STORY-099/100) or a hand-typed identifier can make a wrong guess — the
	 *  same class of bug that made `deleteIndividual` silently no-op (`DELETE WHERE` against the
	 *  wrong graph matches nothing, no error) while the UI still removed the member optimistically. A
	 *  caller that already knows the namespace for certain (e.g. `insertIndividual`'s own follow-up
	 *  writes, right after minting) may still pass it explicitly to skip the extra lookup. */
	async renameIndividual(iri: string, newLabel: string, namespaceBaseIri?: string): Promise<void> {
		if (!newLabel.trim()) throw new Error('Member name must not be empty');
		this.assertSafeSparqlIri(iri, 'individual IRI');
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? (await this.findNamespaceOfPossiblyUntypedIndividual(iri));
		const graphs = namespaceGraphs(resolvedNamespaceBaseIri);
		const escaped = this.escapeString(newLabel);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.instances)}
			DELETE { <${iri}> rdfs:label ?old }
			INSERT { <${iri}> rdfs:label "${escaped}" }
			WHERE { OPTIONAL { <${iri}> rdfs:label ?old } }
		`);
	}

	/**
	 * Changes an individual's class: rewrites its `rdf:type` in its own instances graph (the type is
	 * inserted even when it had none), and deletes the triples, reified statements and annotations of
	 * `dropPredicateIris` (the values `planClassChange` reports as lost). IRI and `rdfs:label` are
	 * untouched. A synced individual is machine-owned and is refused before anything is written.
	 */
	async changeIndividualClass(
		iri: string,
		newClassIri: string,
		options: { dropPredicateIris?: string[] } = {}
	): Promise<void> {
		const dropPredicateIris = options.dropPredicateIris ?? [];
		this.assertSafeSparqlIri(iri, 'individual IRI');
		this.assertSafeSparqlIri(newClassIri, 'class IRI');
		for (const p of dropPredicateIris) this.assertSafeSparqlIri(p, 'predicate IRI');

		const synced = await this.selectQuery(
			`${PREFIXES} SELECT ?syncSource WHERE { GRAPH ?g { <${iri}> <${SYNC_SOURCE_PREDICATE_IRI}> ?syncSource } } LIMIT 1`
		);
		if (synced.results.bindings.length > 0) {
			throw new Error(`Cannot change the class of a synced individual (${iri})`);
		}

		const graphs = namespaceGraphs(await this.findNamespaceOfPossiblyUntypedIndividual(iri));
		const ops = [
			`DELETE WHERE { ${inGraph(`<${iri}> rdf:type ?oldType .`, graphs.instances)} }`,
			`INSERT DATA { ${inGraph(`<${iri}> a <${newClassIri}> .`, graphs.instances)} }`
		];
		for (const predicateIri of dropPredicateIris) {
			ops.push(`DELETE WHERE { ${inGraph(`<${iri}> <${predicateIri}> ?o .`, graphs.instances)} }`);
			ops.push(`${withGraph(graphs.instances)}
				DELETE { ?stmt ?sp ?so . ?ann ?ap ?ao . }
				WHERE {
					?stmt rdf:subject <${iri}> ; rdf:predicate <${predicateIri}> ; ?sp ?so .
					OPTIONAL { ?ann <${ANNOTATES_PREDICATE_IRI}> ?stmt . ?ann ?ap ?ao }
				}`);
		}
		await this.executeUpdate(`${PREFIXES} ${ops.join(' ;\n')}`);
	}

	/** Removes the member entirely: its `rdf:type` and `rdfs:label` triples, plus (STORY-081) every
	 *  `WorkspaceMembership` row referencing it, across every Workspace, plus (STORY-083) unlinking
	 *  (not deleting) any Note whose `noteLinkedElement` pointed at it. `namespaceBaseIri` is
	 *  optional — see `renameIndividual`'s doc for why an omitted value resolves via
	 *  `findNamespaceOfIndividual` rather than defaulting to a guess: a `DELETE WHERE` against the
	 *  wrong graph matches zero triples and succeeds silently, which previously left a member
	 *  removed from the canvas/UI while its triples stayed in GraphDB untouched. */
	async deleteIndividual(iri: string, namespaceBaseIri?: string): Promise<void> {
		this.assertSafeSparqlIri(iri, 'individual IRI');
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? (await this.findNamespaceOfPossiblyUntypedIndividual(iri));
		const graphs = namespaceGraphs(resolvedNamespaceBaseIri);
		await this.executeUpdate(`
			${PREFIXES}
			DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, graphs.instances)} } ;
			${withGraph(graphs.instances)}
			DELETE { ?stmt ?sp ?so . ?ann ?ap ?ao . }
			WHERE {
				?stmt rdf:subject <${iri}> ; ?sp ?so .
				OPTIONAL { ?ann <${ANNOTATES_PREDICATE_IRI}> ?stmt . ?ann ?ap ?ao }
			} ;
			${this.cascadeDeleteWorkspaceMembershipsClause(iri)} ;
			${this.cascadeUnlinkNotesClause(iri)}
		`);
	}

	/** Every member of `classIriValue`, across every namespace in the repository — not just the one
	 *  declaring `classIriValue` itself. An individual can be minted into a namespace different from
	 *  its class's own declaring namespace (STORY-099/100's Concept Namespace override — a
	 *  hand-typed-identifier member, or a Backstage-synced individual), so scoping this to one
	 *  namespace's instance graph would silently drop such individuals from e.g. `MemberForm`'s
	 *  relation-field typeahead even though their triples are all still present. An unrestricted
	 *  cross-graph `GRAPH ?g {...}` lookup, mirroring `fetchAllIndividualClassRelations`'s own
	 *  cross-namespace posture — deliberately no `FROM` clause: mixing `FROM <g>` with an
	 *  unrestricted `GRAPH ?g {...}` collapses the query's named-graph set to empty per SPARQL 1.1
	 *  semantics, silently zeroing every result. `?g` doubles as each result's `namespaceBaseIri` for
	 *  free — `namespaceGraphs()`'s instance graph is literally the namespace's own base IRI, no
	 *  suffix — so the caller (`MemberForm`'s relation-field typeahead) can disambiguate two
	 *  same-labeled individuals from different namespaces without a second lookup. */
	async fetchIndividualsOfClass(
		classIriValue: string
	): Promise<Array<{ iri: string; label: string; namespaceBaseIri: string }>> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?i ?label ?g WHERE { GRAPH ?g { ?i a <${classIriValue}> . OPTIONAL { ?i rdfs:label ?label } } }
		`);
		return results.results.bindings.map((b) => ({
			iri: b.i.value,
			label: b.label?.value ?? extractLocalName(b.i.value),
			namespaceBaseIri: b.g.value
		}));
	}

	/**
	 * Fragments that remove one fact's reified `rdf:Statement` **and** its `Annotation` nodes
	 * (query-workbench STORY-184: annotations are removed with the fact, the audit trail is
	 * intentionally lost). `template` goes into a `DELETE { ... }`, `where` into the matching `WHERE`;
	 * everything is `OPTIONAL`, so an unreified fact is unaffected. Must run in the fact's own
	 * instances graph (`WITH <graph>`), where statement and annotation nodes live.
	 */
	private factCleanup(subjectIri: string, predicateIri: string, objectTerm: string): { template: string; where: string } {
		return {
			template: '?stmt ?sp ?so . ?ann ?ap ?ao .',
			where: `OPTIONAL {
					?stmt rdf:subject <${subjectIri}> ; rdf:predicate <${predicateIri}> ; rdf:object ${objectTerm} .
					?stmt ?sp ?so .
					OPTIONAL { ?ann <${ANNOTATES_PREDICATE_IRI}> ?stmt . ?ann ?ap ?ao }
				}`
		};
	}

	/** `"value"^^xsd:datatype` — the typed-literal shape every write below needs (STORY-110), matching
	 *  the `"${x}"^^xsd:decimal` pattern already used for note/workspace-membership coordinates. */
	private formatTypedLiteral(datatype: XsdDatatype, value: string): string {
		return `"${this.escapeString(value)}"^^xsd:${datatype}`;
	}

	// -- Literal attribute values on individuals (STORY-110) -------------------------------------
	// Fills the ABox gap `insertIndividual` leaves open: it writes only `rdf:type`/`rdfs:label`, so
	// nothing anywhere previously wrote a literal `owl:DatatypeProperty` value against an individual.
	// Values live in the individual's own `graphs.instances`, alongside its `rdf:type`/`rdfs:label`.

	/**
	 * Current values of `attributes` on `individualIri`, keyed by attribute IRI — a single string for
	 * a `repeatable: false` attribute, an array of strings for a `repeatable: true` one. `attributes`
	 * is the same own+inherited attribute list STORY-109's `mergeAncestorAttributes` produces for the
	 * individual's class (only `iri`/`repeatable` are needed here). `namespaceBaseIri` is optional —
	 * see `renameIndividual`'s doc for why an omitted value resolves via `findNamespaceOfIndividual`
	 * instead of guessing the individual's *class's* namespace, which a Concept Namespace override
	 * can make wrong: a `FROM`-scoped SELECT against the wrong graph silently returns no bindings,
	 * indistinguishable from "this individual genuinely has none of these attributes set".
	 */
	async fetchIndividualAttributeValues(
		individualIri: string,
		attributes: Array<{ iri: string; repeatable: boolean }>,
		namespaceBaseIri?: string
	): Promise<Record<string, string | string[]>> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		for (const attr of attributes) this.assertSafeSparqlIri(attr.iri, 'attribute IRI');
		if (attributes.length === 0) return {};
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? (await this.findNamespaceOfPossiblyUntypedIndividual(individualIri));
		const graphs = namespaceGraphs(resolvedNamespaceBaseIri);
		const repeatableByIri = new Map(attributes.map((a) => [a.iri, a.repeatable]));

		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?p ?value ${fromClause(graphs.instances)} WHERE {
				<${individualIri}> ?p ?value .
				VALUES ?p { ${attributes.map((a) => `<${a.iri}>`).join(' ')} }
			}
		`);

		const out: Record<string, string | string[]> = {};
		for (const b of results.results.bindings) {
			const iri = b.p.value;
			const value = b.value.value;
			if (repeatableByIri.get(iri)) {
				const existing = out[iri];
				if (Array.isArray(existing)) existing.push(value);
				else out[iri] = [value];
			} else {
				out[iri] = value;
			}
		}
		return out;
	}

	/**
	 * Sets (or, when `value` is `null`, clears) a single-valued (`repeatable: false`) attribute's
	 * literal value on an individual — DELETE-then-INSERT to replace (or DELETE-only to clear),
	 * mirroring `renameIndividual`'s shape exactly but for an arbitrary attribute predicate/datatype
	 * instead of the fixed `rdfs:label` one. `namespaceBaseIri` is optional — see `renameIndividual`'s
	 * doc for why an omitted value resolves via `findNamespaceOfIndividual`.
	 */
	async setIndividualAttributeValue(
		individualIri: string,
		attributeIri: string,
		datatype: XsdDatatype,
		value: string | null,
		namespaceBaseIri?: string
	): Promise<void> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		this.assertSafeSparqlIri(attributeIri, 'attribute IRI');
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? (await this.findNamespaceOfPossiblyUntypedIndividual(individualIri));
		const graphs = namespaceGraphs(resolvedNamespaceBaseIri);
		const cleanup = this.factCleanup(individualIri, attributeIri, '?old');

		// Editing keeps the reified statement (and so its annotations) attached by rewriting its
		// `rdf:object`; clearing the value removes the statement and its annotations with the fact.
		// Both use an OPTIONAL statement pattern, so an unreified value is unaffected.
		if (value === null) {
			await this.executeUpdate(`
				${PREFIXES}
				${withGraph(graphs.instances)}
				DELETE { <${individualIri}> <${attributeIri}> ?old . ${cleanup.template} }
				WHERE { OPTIONAL { <${individualIri}> <${attributeIri}> ?old } ${cleanup.where} }
			`);
			return;
		}
		const literal = this.formatTypedLiteral(datatype, value);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.instances)}
			DELETE { <${individualIri}> <${attributeIri}> ?old . ?stmt rdf:object ?old . }
			INSERT { <${individualIri}> <${attributeIri}> ${literal} . ?stmt rdf:object ${literal} . }
			WHERE {
				OPTIONAL { <${individualIri}> <${attributeIri}> ?old }
				OPTIONAL { ?stmt rdf:subject <${individualIri}> ; rdf:predicate <${attributeIri}> ; rdf:object ?old . }
			}
		`);
	}

	/** Adds one value to a repeatable attribute on an individual — mirrors `insertAssertion`'s shape
	 *  but with a typed literal object instead of an IRI object. `namespaceBaseIri` is optional — see
	 *  `renameIndividual`'s doc for why an omitted value resolves via `findNamespaceOfIndividual`. */
	async addIndividualAttributeValue(
		individualIri: string,
		attributeIri: string,
		datatype: XsdDatatype,
		value: string,
		namespaceBaseIri?: string
	): Promise<void> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		this.assertSafeSparqlIri(attributeIri, 'attribute IRI');
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? (await this.findNamespaceOfPossiblyUntypedIndividual(individualIri));
		const graphs = namespaceGraphs(resolvedNamespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${individualIri}> <${attributeIri}> ${this.formatTypedLiteral(datatype, value)} .`, graphs.instances)} }`
		);
	}

	/** Removes one value from a repeatable attribute on an individual — mirrors `deleteAssertion`'s
	 *  shape but with a typed literal object instead of an IRI object. `namespaceBaseIri` is optional
	 *  — see `renameIndividual`'s doc for why an omitted value resolves via
	 *  `findNamespaceOfIndividual`. */
	async removeIndividualAttributeValue(
		individualIri: string,
		attributeIri: string,
		datatype: XsdDatatype,
		value: string,
		namespaceBaseIri?: string
	): Promise<void> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		this.assertSafeSparqlIri(attributeIri, 'attribute IRI');
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? (await this.findNamespaceOfPossiblyUntypedIndividual(individualIri));
		const graphs = namespaceGraphs(resolvedNamespaceBaseIri);
		// Only this value's statement and annotations go; other values of a multi-valued attribute keep theirs.
		const literal = this.formatTypedLiteral(datatype, value);
		const cleanup = this.factCleanup(individualIri, attributeIri, literal);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.instances)}
			DELETE { <${individualIri}> <${attributeIri}> ${literal} . ${cleanup.template} }
			WHERE { ${cleanup.where} }
		`);
	}

	/**
	 * Applies a batch of attribute-value changes to one individual (STORY-111) — each submission is a
	 * single-valued replace/clear (`setIndividualAttributeValue`) or a repeatable add/remove diff
	 * (`addIndividualAttributeValue`/`removeIndividualAttributeValue` per value). `submissions` mirrors
	 * `reconcileAttributeValues`'s (`utils/attribute-values.ts`) return shape structurally — that
	 * module stays GraphDB-free, so the type isn't imported here, just matched. Runs sequentially
	 * (not `Promise.all`'d): a repeatable attribute's own add/remove pair must not race a
	 * single-valued attribute's DELETE-then-INSERT touching the same individual.
	 *
	 * `namespaceBaseIri` is optional — resolved once via `findNamespaceOfIndividual` when omitted
	 * (see `renameIndividual`'s doc) and passed explicitly into every per-attribute call below, so a
	 * batch of N submissions costs one extra lookup, not N.
	 */
	async applyAttributeSubmissions(
		individualIri: string,
		submissions: Array<{
			attributeIri: string;
			datatype: XsdDatatype;
			repeatable: boolean;
			value?: string | null;
			added?: string[];
			removed?: string[];
		}>,
		namespaceBaseIri?: string
	): Promise<void> {
		if (submissions.length === 0) return;
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? (await this.findNamespaceOfPossiblyUntypedIndividual(individualIri));
		for (const s of submissions) {
			if (s.repeatable) {
				for (const v of s.added ?? []) {
					await this.addIndividualAttributeValue(individualIri, s.attributeIri, s.datatype, v, resolvedNamespaceBaseIri);
				}
				for (const v of s.removed ?? []) {
					await this.removeIndividualAttributeValue(individualIri, s.attributeIri, s.datatype, v, resolvedNamespaceBaseIri);
				}
			} else {
				await this.setIndividualAttributeValue(individualIri, s.attributeIri, s.datatype, s.value ?? null, resolvedNamespaceBaseIri);
			}
		}
	}

	/**
	 * Explicit, opt-in migration (STORY-063) for individuals already persisted under STORY-062's old,
	 * buggy `<namespaceBaseIri>/schema#LocalName` IRI form (fixed for newly-created individuals, but
	 * — per CLAUDE.md's write-once IRI rule — never rewritten automatically). Scoped to one namespace
	 * at a time, mirroring every other `namespaceBaseIri`-parameterized method here. `dryRun: true`
	 * (the default) only reports the old→new IRI pairs; nothing is written unless the caller passes
	 * `{ dryRun: false }` explicitly — this must never run as a side effect of app startup or of
	 * STORY-062's deploy, since it mutates existing GraphDB data.
	 *
	 * Affected individuals are identified the same way `splitInstancesFromSchema`/`fetchAllIndividuals`
	 * do (`looksLikeIndividual`), scoped to `graphs.instances` — the graph placement was already
	 * correct pre-STORY-062, only the subject IRI text was wrong, so this only ever touches subject
	 * IRIs, never moves triples between graphs.
	 *
	 * For each affected individual: its own subject-position triples (`rdf:type`, `rdfs:label`, ...)
	 * are rewritten within `graphs.instances`, and any triple anywhere in the repository referencing
	 * the old IRI as an object (e.g. an inbound reference from another individual) is rewritten too,
	 * via a graph-variable `DELETE`/`INSERT`/`WHERE` so it's found regardless of which namespace's
	 * graph it lives in. Idempotent: once an individual's subject IRI no longer starts with the legacy
	 * prefix, it no longer matches the initial scan, so re-running reports (and rewrites) nothing.
	 */
	async migrateIndividualNamespaceIris(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI,
		{ dryRun = true }: { dryRun?: boolean } = {}
	): Promise<{ migrated: Array<{ oldIri: string; newIri: string }> }> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const legacyPrefix = `${graphs.schema}#`;

		const results = await this.selectQuery(
			`${PREFIXES}
			SELECT ?s ?p ?o ${fromClause(graphs.instances)} WHERE {
				?s ?p ?o .
				FILTER(STRSTARTS(STR(?s), "${legacyPrefix}"))
			}`,
			{ infer: false }
		);
		const quads = results.results.bindings.map((b) => bindingToQuad(b));

		const bySubject = new Map<string, Quad[]>();
		for (const q of quads) {
			const list = bySubject.get(q.subject.value) ?? [];
			list.push(q);
			bySubject.set(q.subject.value, list);
		}

		const migrated: Array<{ oldIri: string; newIri: string }> = [];
		for (const [subjectIri, subjectQuads] of bySubject) {
			if (!looksLikeIndividual(subjectQuads, subjectIri)) continue;
			migrated.push({ oldIri: subjectIri, newIri: `${namespaceBaseIri}#${extractLocalName(subjectIri)}` });
		}

		if (dryRun || migrated.length === 0) {
			return { migrated };
		}

		for (const { oldIri, newIri } of migrated) {
			this.assertSafeSparqlIri(oldIri, 'individual IRI');
			this.assertSafeSparqlIri(newIri, 'individual IRI');

			await this.executeUpdate(`
				${PREFIXES}
				${withGraph(graphs.instances)}
				DELETE { <${oldIri}> ?p ?o }
				INSERT { <${newIri}> ?p ?o }
				WHERE { <${oldIri}> ?p ?o }
			`);

			await this.executeUpdate(`
				${PREFIXES}
				DELETE { GRAPH ?g { ?s ?p <${oldIri}> } }
				INSERT { GRAPH ?g { ?s ?p <${newIri}> } }
				WHERE { GRAPH ?g { ?s ?p <${oldIri}> } }
			`);
		}

		return { migrated };
	}

	// -- Attributes (owl:DatatypeProperty + sh:property) ---------------------------------------

	/** True if `iri` is already declared as either an `owl:DatatypeProperty` or `owl:ObjectProperty`
	 *  — checked as one set so a datatype attribute and an object-property relation on the same
	 *  class can't silently collide on the same derived local name. */
	async propertyExists(iri: string, namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<boolean> {
		this.assertSafeSparqlIri(iri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		return this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { { <${iri}> a owl:DatatypeProperty } UNION { <${iri}> a owl:ObjectProperty } }`
		);
	}

	/**
	 * Looks up an existing *generic* relation (STORY-051, `spec/modelling-restrictions/plan.md`) by
	 * label, across **every** registered namespace — an `owl:ObjectProperty` with the given
	 * `rdfs:label` and **no** `rdfs:domain` triple at all, in any namespace's own `/schema` graph. A
	 * specific relation that happens to share the same label never matches (it always has an
	 * `rdfs:domain`). A generic relation's label is therefore effectively a *global* reuse key, not
	 * scoped per namespace: drawing a relation named "represents" from a `backstage:`-namespaced
	 * entity reuses `core:represents` if that's where it already lives, rather than minting a
	 * duplicate `backstage:represents` — a generic relation exists precisely to be reused across
	 * source classes, and there's no principled reason that stops at a namespace boundary. Checks
	 * namespaces one at a time (in `fetchNamespaces()`'s own order) and returns on the first match, so
	 * two namespaces that happen to declare the exact same label resolve to an arbitrary, undocumented
	 * one of the two — an edge case the caller-facing picker (`listGenericObjectProperties`) surfaces
	 * with a namespace prefix so a human can tell them apart before it matters. Used by the relation
	 * edit dialog to offer "reuse existing" vs "create new" (STORY-053), and by
	 * `insertObjectProperty`'s generic mode (STORY-052) to decide whether to declare a new property or
	 * just add another `sh:property` entry to a new source class.
	 */
	async findGenericObjectProperty(name: string): Promise<string | undefined> {
		const namespaces = await this.fetchNamespaces();
		const escapedName = this.escapeString(name);
		for (const ns of namespaces) {
			const graphs = namespaceGraphs(ns.baseIri);
			const results = await this.selectQuery(`
				${PREFIXES} SELECT ?p ${fromClause(graphs.schema)} WHERE {
					?p a owl:ObjectProperty ; rdfs:label "${escapedName}" .
					FILTER NOT EXISTS { ?p rdfs:domain ?d }
				}
				LIMIT 1
			`);
			const iri = results.results.bindings[0]?.p?.value;
			if (iri) return iri;
		}
		return undefined;
	}

	/** Lists every existing generic relation across **every** registered namespace (STORY-051/053,
	 *  widened for cross-namespace reuse — see `findGenericObjectProperty`'s own doc comment) —
	 *  `owl:ObjectProperty` with an `rdfs:label` and no `rdfs:domain` triple, from each namespace's own
	 *  `/schema` graph. For the relation edit dialog's "reuse an existing generic relation"
	 *  autocomplete: restricting this list to the drawing entity's own namespace hid an
	 *  already-declared relation like `core:represents` from a `backstage:`-namespaced entity for no
	 *  principled reason. Each result carries its own `namespaceBaseIri` so the caller can prefix the
	 *  display label to disambiguate (mirroring `SettingsView`'s "Represents predicate" picker) —
	 *  sorted by label, case-insensitively, across the merged set (a per-namespace `ORDER BY` can't
	 *  produce a single ordering once results from several independent queries are merged). */
	async listGenericObjectProperties(): Promise<
		{ iri: string; label: string; namespaceBaseIri: string }[]
	> {
		const namespaces = await this.fetchNamespaces();
		const perNamespace = await Promise.all(
			namespaces.map(async (ns) => {
				const graphs = namespaceGraphs(ns.baseIri);
				const results = await this.selectQuery(`
					${PREFIXES} SELECT ?p ?label ${fromClause(graphs.schema)} WHERE {
						?p a owl:ObjectProperty ; rdfs:label ?label .
						FILTER NOT EXISTS { ?p rdfs:domain ?d }
					}
				`);
				return results.results.bindings.map((b) => ({
					iri: b.p.value,
					label: b.label.value,
					namespaceBaseIri: ns.baseIri
				}));
			})
		);
		return perNamespace
			.flat()
			.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
	}

	/**
	 * Every `owl:ObjectProperty` declared anywhere, across every registered namespace's own
	 * `/schema` graph — unfiltered by whether it has `rdfs:domain`/`rdfs:range` (unlike
	 * `fetchAllObjectProperties`, which requires both) or by whether any `sh:property` shape
	 * currently references it (unlike `fetchGenericObjectPropertyEdges`, which requires a live
	 * shape reference and feeds `FetchedSchema.objectProperties` — the canvas's own "what's actually
	 * wired into a diagram" view, not a registry of every declared property).
	 *
	 * For Settings' "Represents predicate" picker (STORY-104): the predicate configured there need
	 * not be attached to any entity yet — it's picked once, then only ever *written* by the sync
	 * engine — so a property that's declared but currently unused (or a generic relation with no
	 * live `sh:property` reference) must still be selectable, or the picker can permanently lose
	 * track of the very property it's meant to point at.
	 */
	async fetchAllDeclaredObjectProperties(): Promise<
		{ iri: string; label: string; namespaceBaseIri: string }[]
	> {
		const namespaces = await this.fetchNamespaces();
		const perNamespace = await Promise.all(
			namespaces.map(async (ns) => {
				const graphs = namespaceGraphs(ns.baseIri);
				const results = await this.selectQuery(`
					${PREFIXES} SELECT ?p ?label ${fromClause(graphs.schema)} WHERE {
						?p a owl:ObjectProperty .
						OPTIONAL { ?p rdfs:label ?label }
					}
				`);
				return results.results.bindings.map((b) => ({
					iri: b.p.value,
					label: b.label?.value ?? extractLocalName(b.p.value),
					namespaceBaseIri: ns.baseIri
				}));
			})
		);
		return perNamespace
			.flat()
			.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
	}

	/**
	 * Reads `shapeIri`'s `sh:property` entries for `propIri`, if any — its full target-class list,
	 * `sh:name`, and cardinality, collected across *every* independent `sh:property` block whose
	 * `sh:path` matches `propIri` (data-catalog Story 018: one block per target class, each with
	 * its own `sh:class` — no `sh:or` union, no RDF list). An empty `targets` array means this
	 * source class doesn't use `propIri` at all yet (the STORY-052 "not yet on this class" case).
	 * Used by `insertObjectProperty`'s generic-reuse path to decide whether a new target merges
	 * into the existing shape, by `updateObjectProperty`'s generic path to know which target's
	 * block to retarget, and by `deleteObjectProperty` to decide shrink-the-set vs.
	 * remove-the-whole-shape.
	 */
	private async fetchGenericPropertyShapeDetails(
		shapeIri: string,
		propIri: string,
		graphs: NamespaceGraphs
	): Promise<{ targets: string[]; name?: string; minCount?: number; maxCount?: number }> {
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?class ?name ?minCount ?maxCount ${fromClause(graphs.shapes)} WHERE {
				<${shapeIri}> sh:property ?propShape .
				?propShape sh:path <${propIri}> .
				OPTIONAL { ?propShape sh:name ?name }
				OPTIONAL { ?propShape sh:minCount ?minCount }
				OPTIONAL { ?propShape sh:maxCount ?maxCount }
				OPTIONAL { ?propShape sh:class ?class }
			}
		`);
		const bindings = results.results.bindings;
		const targets = [...new Set(bindings.map((b) => b.class?.value).filter((v): v is string => !!v))];
		const first = bindings[0];
		return {
			targets,
			name: first?.name?.value,
			minCount: first?.minCount ? parseInt(first.minCount.value, 10) : undefined,
			maxCount: first?.maxCount ? parseInt(first.maxCount.value, 10) : undefined
		};
	}

	/**
	 * Replaces `shapeIri`'s `sh:property` entries for `propIri` with exactly one independent
	 * `sh:property` block per target class (data-catalog Story 018) — each carrying its own
	 * `sh:path`/`sh:name`/cardinality and a single `sh:class`, never an `sh:or` union. Cardinality
	 * applies *per target class*, not to a combined union: `sh:maxCount 1` on a relation used with
	 * both `core:Bal` and `core:Sd` means "at most 1 `Bal` **and** at most 1 `Sd`" independently.
	 * Deletes the old property-shape subtree first (including any `sh:or` list cells left over from
	 * data predating this fix — forward-fix only, no migration story) rather than trying to edit it
	 * in place: blank-node identity is never relied on elsewhere in this codebase (every lookup
	 * re-traverses `sh:property`/`sh:path`), so a full replace is simpler and safer than patching a
	 * variable-length structure. Also renames the shared property's own `rdfs:label` to `name` — see
	 * `updateObjectProperty`'s own doc comment on why a generic relation's rename is a global rename.
	 */
	private async rewriteGenericPropertyShapeTargets(
		shapeIri: string,
		propIri: string,
		targets: string[],
		name: string,
		required: boolean,
		repeatable: boolean,
		graphs: NamespaceGraphs
	): Promise<void> {
		const escapedName = this.escapeString(name);
		const constraints = [required ? 'sh:minCount 1' : null, !repeatable ? 'sh:maxCount 1' : null]
			.filter((c): c is string => c !== null)
			.map((c) => ` ; ${c}`)
			.join('');
		const propertyBlocks = targets
			.map(
				(t) => `
					<${shapeIri}> sh:property [
						sh:path <${propIri}> ;
						sh:name "${escapedName}"${constraints} ;
						sh:class <${t}>
					] .`
			)
			.join('');

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${propIri}> rdfs:label ?oldLabel }
			INSERT { <${propIri}> rdfs:label "${escapedName}" }
			WHERE { OPTIONAL { <${propIri}> rdfs:label ?oldLabel } } ;
			${withGraph(graphs.shapes)}
			DELETE {
				<${shapeIri}> sh:property ?propShape .
				?propShape ?p ?o .
				?node rdf:first ?item ; rdf:rest ?next .
				?item sh:class ?itemClass .
			}
			WHERE {
				<${shapeIri}> sh:property ?propShape .
				?propShape sh:path <${propIri}> .
				?propShape ?p ?o .
				OPTIONAL {
					?propShape sh:or ?list0 .
					?list0 rdf:rest* ?node .
					?node rdf:first ?item ; rdf:rest ?next .
					OPTIONAL { ?item sh:class ?itemClass }
				}
			} ;
			INSERT DATA {
				GRAPH <${graphs.shapes}> {${propertyBlocks}
				}
			}
		`);
	}

	/** Creates the class's `sh:NodeShape` if it doesn't exist yet, and returns its (deterministic)
	 *  IRI. Lives in the namespace's `/shapes` graph (Decision 1). */
	async ensureNodeShape(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const shapeIri = nodeShapeIri(classIriValue, graphs.shapes);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.shapes)} { <${shapeIri}> a sh:NodeShape }`
		);
		if (!exists) {
			await this.executeUpdate(
				`${PREFIXES} INSERT DATA { ${inGraph(`<${shapeIri}> a sh:NodeShape ; sh:targetClass <${classIriValue}> .`, graphs.shapes)} }`
			);
		}
		return shapeIri;
	}

	/**
	 * Adds an attribute to `classIriValue`: an `owl:DatatypeProperty` declaration (namespace's
	 * `/schema` graph) plus a matching `sh:property` entry (namespace's `/shapes` graph) in the
	 * class's `sh:NodeShape` (created if needed) — one atomic update, two `GRAPH` blocks. The
	 * property IRI is derived from the owning class + name and is stable thereafter — see
	 * `propertyIri`.
	 */
	async insertDatatypeProperty(
		classIriValue: string,
		name: string,
		datatype: XsdDatatype,
		required: boolean,
		repeatable: boolean,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI,
		requiredForSubclasses: boolean = false
	): Promise<{ iri: string }> {
		if (!name.trim()) throw new Error('Attribute name must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);

		const propIri = propertyIri(classIriValue, name, graphs.schema);
		if (await this.propertyExists(propIri, namespaceBaseIri)) {
			throw new Error(`An attribute named "${name}" already exists on this entity (${propIri})`);
		}

		const shapeIri = await this.ensureNodeShape(classIriValue, namespaceBaseIri);
		const escapedName = this.escapeString(name);
		const datatypeIri = xsdIri(datatype);
		const constraints = [
			required ? 'sh:minCount 1' : null,
			!repeatable ? 'sh:maxCount 1' : null,
			requiredForSubclasses ? `<${REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI}> true` : null
		]
			.filter((c): c is string => c !== null)
			.map((c) => ` ; ${c}`)
			.join('');

		await this.executeUpdate(`
			${PREFIXES}
			INSERT DATA {
				GRAPH <${graphs.schema}> {
					<${propIri}> a owl:DatatypeProperty ;
						rdfs:domain <${classIriValue}> ;
						rdfs:range <${datatypeIri}> ;
						rdfs:label "${escapedName}" .
				}
				GRAPH <${graphs.shapes}> {
					<${shapeIri}> sh:property [
						sh:path <${propIri}> ;
						sh:datatype <${datatypeIri}> ;
						sh:name "${escapedName}"${constraints}
					] .
				}
			}
		`);

		return { iri: propIri };
	}

	/**
	 * Updates an existing attribute's label, datatype, and required/repeatable flags, keeping the
	 * `owl:DatatypeProperty` triples (namespace's `/schema` graph) and the `sh:property` shape
	 * entry (namespace's `/shapes` graph) in sync (no drift between the two). The property's IRI
	 * never changes, even when its display name does.
	 */
	async updateDatatypeProperty(
		classIriValue: string,
		propIri: string,
		update: DatatypePropertyUpdate,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		if (!update.name.trim()) throw new Error('Attribute name must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);

		const shapeIri = nodeShapeIri(classIriValue, graphs.shapes);
		const escapedName = this.escapeString(update.name);
		const datatypeIri = xsdIri(update.datatype);
		const minCountInsert = update.required ? '?propShape sh:minCount 1 .' : '';
		const maxCountInsert = !update.repeatable ? '?propShape sh:maxCount 1 .' : '';
		const requiredForSubclassesInsert = update.requiredForSubclasses
			? `?propShape <${REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI}> true .`
			: '';

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${propIri}> rdfs:label ?oldLabel ; rdfs:range ?oldRange . }
			INSERT { <${propIri}> rdfs:label "${escapedName}" ; rdfs:range <${datatypeIri}> . }
			WHERE {
				OPTIONAL { <${propIri}> rdfs:label ?oldLabel }
				OPTIONAL { <${propIri}> rdfs:range ?oldRange }
			} ;
			${withGraph(graphs.shapes)}
			DELETE {
				?propShape sh:datatype ?oldDatatype ;
					sh:name ?oldName ;
					sh:minCount ?oldMinCount ;
					sh:maxCount ?oldMaxCount ;
					<${REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI}> ?oldRequiredForSubclasses .
			}
			INSERT {
				?propShape sh:datatype <${datatypeIri}> ; sh:name "${escapedName}" .
				${minCountInsert}
				${maxCountInsert}
				${requiredForSubclassesInsert}
			}
			WHERE {
				<${shapeIri}> sh:property ?propShape .
				?propShape sh:path <${propIri}> .
				OPTIONAL { ?propShape sh:datatype ?oldDatatype }
				OPTIONAL { ?propShape sh:name ?oldName }
				OPTIONAL { ?propShape sh:minCount ?oldMinCount }
				OPTIONAL { ?propShape sh:maxCount ?oldMaxCount }
				OPTIONAL { ?propShape <${REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI}> ?oldRequiredForSubclasses }
			}
		`);
	}

	/** Removes both the `owl:DatatypeProperty` declaration and its `sh:property` shape entry. */
	async deleteDatatypeProperty(
		propIri: string,
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.deletePropertyTriples(propIri, classIriValue, graphs);
	}

	// -- Relations (owl:ObjectProperty + sh:property with sh:class) ---------------------------

	/**
	 * Looks up which namespace `classIriValue` was declared in, by finding the named graph its own
	 * `owl:Class` triple actually lives in (Decision 8) — a plain cross-graph `GRAPH ?g {...}`
	 * pattern with no `FROM`/`FROM NAMED` restriction, so it searches every graph in the
	 * repository, not just one namespace. Strips the `/schema` suffix (Decision 1) to recover the
	 * namespace's own base IRI. This is what lets `insertObjectProperty`/`updateObjectProperty`/
	 * `deleteObjectProperty` target the *source* class's namespace automatically, with no new
	 * namespace parameter on the relation form.
	 */
	private async findNamespaceOfClass(classIriValue: string): Promise<string> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?g WHERE { GRAPH ?g { <${classIriValue}> a owl:Class } } LIMIT 1`
		);
		const graphIri = results.results.bindings[0]?.g?.value;
		if (!graphIri) {
			throw new Error(`Cannot determine namespace: class not found (${classIriValue})`);
		}
		return graphIri.endsWith('/schema') ? graphIri.slice(0, -'/schema'.length) : graphIri;
	}

	/**
	 * STORY-044: generalizes `findNamespaceOfClass`'s cross-graph `GRAPH ?g {...}` lookup pattern to
	 * an arbitrary subject IRI with any predicate, not just `a owl:Class` — an imported Turtle
	 * file's subjects can be properties or individuals too, not only classes. Strips whichever of
	 * `/schema`/`/shapes` suffix (Decision 1) the matched graph carries to recover the namespace's
	 * base IRI (a bare match with neither suffix means the subject already lives in a namespace's
	 * instances graph, i.e. the base IRI itself). Returns `undefined` — rather than throwing, unlike
	 * `findNamespaceOfClass` — for a subject with no existing triples anywhere: `importTurtle` needs
	 * to tell "not found yet" apart from an error so it can fall back to its own target namespace.
	 */
	private async findNamespaceOfSubject(subjectIri: string): Promise<string | undefined> {
		this.assertSafeSparqlIri(subjectIri, 'subject IRI');
		const results = await this.selectQuery(
			`SELECT ?g WHERE { GRAPH ?g { <${subjectIri}> ?p ?o } } LIMIT 1`
		);
		const graphIri = results.results.bindings[0]?.g?.value;
		if (!graphIri) return undefined;
		if (graphIri.endsWith('/schema')) return graphIri.slice(0, -'/schema'.length);
		if (graphIri.endsWith('/shapes')) return graphIri.slice(0, -'/shapes'.length);
		return graphIri;
	}

	/**
	 * Draws a plain relation edge (STORY-006): an `owl:ObjectProperty` from `sourceClassIri` to
	 * `targetClassIri`, plus a `sh:property` entry (`sh:class` = target) on the source class's
	 * `sh:NodeShape`. Structurally identical to `insertDatatypeProperty`, just with `sh:class`
	 * instead of `sh:datatype` and an IRI range instead of an XSD datatype. Per Decision 8, the
	 * target graph is derived automatically from `sourceClassIri`'s own namespace — a relation
	 * always lives in the source entity's `/schema` (+ `/shapes`) graphs, even when the target
	 * class belongs to a different namespace.
	 *
	 * `options.kind` (STORY-052, `spec/modelling-restrictions/plan.md`) defaults to `'specific'`
	 * (this unchanged behavior). `'generic'` mints (under `sourceClassIri`'s own namespace, same as
	 * ever) or reuses an owner-class-independent property that carries **no** `rdfs:domain`/
	 * `rdfs:range` at all — SHACL's `sh:property`/`sh:class` on each source class's own `NodeShape` is
	 * the only per-class-pair type constraint. The reuse lookup (`findGenericObjectProperty`) now
	 * checks *every* namespace by label, not just `sourceClassIri`'s own, so drawing a second generic
	 * edge with the same name from a *different* source class — even one in a different namespace —
	 * reuses the existing property IRI and only adds a new `sh:property` entry, without re-declaring
	 * `owl:ObjectProperty`/`rdfs:label`. Drawing it again from the *same* source class to the *same*
	 * target is still rejected as a duplicate, matching the existing `propertyExists` semantics; to
	 * a *different* target, a generic relation instead merges the new target into the existing
	 * `sh:property` entry as an `sh:or` union (`rewriteGenericPropertyShapeTargets`).
	 *
	 * A *specific* relation's IRI is minted deterministically from `sourceClassIri` + `name`
	 * (`utils/iri.ts`), so re-declaring one under the same source class and name — most often a
	 * relation the user thought they'd deleted, or is deliberately redefining — always collides with
	 * whatever's already there under that IRI. Rather than rejecting that as a duplicate, this
	 * rewrites the existing `owl:ObjectProperty`/`sh:property` triples in place (new target, label,
	 * cardinality) and returns the same IRI, as long as the existing declaration's own
	 * `rdfs:domain` is this same `sourceClassIri` — a mismatched `rdfs:domain` (only reachable via
	 * hand-edited Turtle) is treated as a genuine naming collision and still rejected.
	 */
	async insertObjectProperty(
		sourceClassIri: string,
		targetClassIri: string,
		name: string,
		required: boolean,
		repeatable: boolean,
		options?: { kind?: 'specific' | 'generic' }
	): Promise<{ iri: string }> {
		if (!name.trim()) throw new Error('Relation name must not be empty');
		this.assertSafeSparqlIri(sourceClassIri, 'source class IRI');
		this.assertSafeSparqlIri(targetClassIri, 'target class IRI');

		const namespaceBaseIri = await this.findNamespaceOfClass(sourceClassIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const escapedName = this.escapeString(name);
		const constraints = [required ? 'sh:minCount 1' : null, !repeatable ? 'sh:maxCount 1' : null]
			.filter((c): c is string => c !== null)
			.map((c) => ` ; ${c}`)
			.join('');

		if (options?.kind === 'generic') {
			const shapeIri = await this.ensureNodeShape(sourceClassIri, namespaceBaseIri);
			const existingIri = await this.findGenericObjectProperty(name);

			if (existingIri) {
				const { targets: currentTargets } = await this.fetchGenericPropertyShapeDetails(
					shapeIri,
					existingIri,
					graphs
				);
				if (currentTargets.includes(targetClassIri)) {
					throw new Error(`A relation named "${name}" already exists on this entity (${existingIri})`);
				}
				if (currentTargets.length > 0) {
					// Already used by this source class with at least one other target: merge the new
					// target in as an `sh:or` union member instead of a second, conflicting `sh:class`
					// (two `sh:class` constraints on the same path would require every value to satisfy
					// both classes at once).
					await this.rewriteGenericPropertyShapeTargets(
						shapeIri,
						existingIri,
						[...currentTargets, targetClassIri],
						name,
						required,
						repeatable,
						graphs
					);
					return { iri: existingIri };
				}
				await this.executeUpdate(`
					${PREFIXES}
					INSERT DATA {
						GRAPH <${graphs.shapes}> {
							<${shapeIri}> sh:property [
								sh:path <${existingIri}> ;
								sh:class <${targetClassIri}> ;
								sh:name "${escapedName}"${constraints}
							] .
						}
					}
				`);
				return { iri: existingIri };
			}

			const genericIri = genericPropertyIri(name, graphs.schema);
			if (await this.propertyExists(genericIri, namespaceBaseIri)) {
				throw new Error(`A relation named "${name}" already exists on this entity (${genericIri})`);
			}
			await this.executeUpdate(`
				${PREFIXES}
				INSERT DATA {
					GRAPH <${graphs.schema}> {
						<${genericIri}> a owl:ObjectProperty ;
							rdfs:label "${escapedName}" .
					}
					GRAPH <${graphs.shapes}> {
						<${shapeIri}> sh:property [
							sh:path <${genericIri}> ;
							sh:class <${targetClassIri}> ;
							sh:name "${escapedName}"${constraints}
						] .
					}
				}
			`);
			return { iri: genericIri };
		}

		const propIri = propertyIri(sourceClassIri, name, graphs.schema);
		const shapeIri = await this.ensureNodeShape(sourceClassIri, namespaceBaseIri);

		if (await this.propertyExists(propIri, namespaceBaseIri)) {
			// Same source class + same name always mints this same deterministic IRI (`utils/iri.ts`),
			// so this is this class's *own* earlier relation of this name, not another entity's
			// collision — most commonly left behind by a delete that didn't fully clean up (see
			// `deleteObjectProperty`'s doc comment), or simply redefining it outright. Either way,
			// re-declaring it here reuses/rewrites those existing triples in place — same end state a
			// clean delete-then-recreate would produce — rather than erroring. A property with this
			// IRI but a *different* `rdfs:domain` (only reachable via hand-edited Turtle, since minting
			// always ties the IRI to `sourceClassIri`) is a genuine naming collision and still refused.
			const ownedByThisClass = await this.askQuery(
				`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${propIri}> rdfs:domain <${sourceClassIri}> }`
			);
			if (!ownedByThisClass) {
				throw new Error(`A relation named "${name}" already exists on this entity (${propIri})`);
			}

			await this.executeUpdate(`
				${PREFIXES}
				${withGraph(graphs.schema)}
				DELETE { <${propIri}> rdfs:range ?oldRange ; rdfs:label ?oldLabel . }
				INSERT {
					<${propIri}> a owl:ObjectProperty ;
						rdfs:domain <${sourceClassIri}> ;
						rdfs:range <${targetClassIri}> ;
						rdfs:label "${escapedName}" .
				}
				WHERE {
					OPTIONAL { <${propIri}> rdfs:range ?oldRange }
					OPTIONAL { <${propIri}> rdfs:label ?oldLabel }
				} ;
				DELETE WHERE {
					${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape sh:path <${propIri}> . ?propShape ?p ?o .`, graphs.shapes)}
				} ;
				INSERT DATA {
					GRAPH <${graphs.shapes}> {
						<${shapeIri}> sh:property [
							sh:path <${propIri}> ;
							sh:class <${targetClassIri}> ;
							sh:name "${escapedName}"${constraints}
						] .
					}
				}
			`);

			return { iri: propIri };
		}

		await this.executeUpdate(`
			${PREFIXES}
			INSERT DATA {
				GRAPH <${graphs.schema}> {
					<${propIri}> a owl:ObjectProperty ;
						rdfs:domain <${sourceClassIri}> ;
						rdfs:range <${targetClassIri}> ;
						rdfs:label "${escapedName}" .
				}
				GRAPH <${graphs.shapes}> {
					<${shapeIri}> sh:property [
						sh:path <${propIri}> ;
						sh:class <${targetClassIri}> ;
						sh:name "${escapedName}"${constraints}
					] .
				}
			}
		`);

		return { iri: propIri };
	}

	/**
	 * Updates an existing relation's label, target class (retarget), and required/repeatable
	 * flags, keeping the `owl:ObjectProperty` triples and the `sh:property` shape entry in sync.
	 * The property's IRI never changes. Targets `sourceClassIri`'s own namespace, derived
	 * automatically (Decision 8) — retargeting to a class in a different namespace does not move
	 * the relation triple itself.
	 *
	 * `options.kind: 'generic'` (STORY-052) updates this edge's `sh:property` blank node (`sh:class`
	 * retarget + cardinality) *and* the shared `owl:ObjectProperty`'s own `rdfs:label` — unlike
	 * `sh:class`/cardinality (per-class-pair, only this edge's own blank node), a rename is a rename
	 * of the *relation*, and the property IRI is the one thing every source class reusing this
	 * generic relation shares; leaving the old `rdfs:label` in place after a rename left it as the
	 * sole thing `findGenericObjectProperty`/`listGenericObjectProperties` (and the canvas edge label
	 * itself, via `fetchGenericObjectPropertyEdges`) ever read, so a rename attempted through this
	 * path used to silently not take anywhere a human could see it. `rdfs:domain`/`rdfs:range` stay
	 * deliberately absent, unchanged from before.
	 *
	 * When this source class's property shape has more than one target (an `sh:or` union — the
	 * same generic relation drawn to several targets from this one class), `options.kind: 'generic'`
	 * also requires `options.oldTargetClassIri`, identifying *which* union member this edit is
	 * retargeting; the rest of the union is left untouched.
	 */
	async updateObjectProperty(
		sourceClassIri: string,
		propIri: string,
		update: ObjectPropertyUpdate,
		options?: { kind?: 'specific' | 'generic'; oldTargetClassIri?: string }
	): Promise<void> {
		if (!update.name.trim()) throw new Error('Relation name must not be empty');
		this.assertSafeSparqlIri(sourceClassIri, 'source class IRI');
		this.assertSafeSparqlIri(propIri, 'property IRI');
		this.assertSafeSparqlIri(update.targetClassIri, 'target class IRI');

		const namespaceBaseIri = await this.findNamespaceOfClass(sourceClassIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const shapeIri = nodeShapeIri(sourceClassIri, graphs.shapes);
		const minCountInsert = update.required ? '?propShape sh:minCount 1 .' : '';
		const maxCountInsert = !update.repeatable ? '?propShape sh:maxCount 1 .' : '';
		const escapedName = this.escapeString(update.name);

		if (options?.kind === 'generic') {
			const details = await this.fetchGenericPropertyShapeDetails(shapeIri, propIri, graphs);
			if (details.targets.length > 1) {
				const oldTarget = options.oldTargetClassIri;
				const newTargets = details.targets.map((t) => (t === oldTarget ? update.targetClassIri : t));
				if (new Set(newTargets).size !== newTargets.length) {
					throw new Error(`A relation named "${details.name ?? propIri}" already exists on this entity (${propIri})`);
				}
				await this.rewriteGenericPropertyShapeTargets(
					shapeIri,
					propIri,
					newTargets,
					update.name,
					update.required,
					update.repeatable,
					graphs
				);
				return;
			}
			await this.executeUpdate(`
				${PREFIXES}
				${withGraph(graphs.schema)}
				DELETE { <${propIri}> rdfs:label ?oldLabel }
				INSERT { <${propIri}> rdfs:label "${escapedName}" }
				WHERE { OPTIONAL { <${propIri}> rdfs:label ?oldLabel } } ;
				${withGraph(graphs.shapes)}
				DELETE {
					?propShape sh:class ?oldClass ;
						sh:minCount ?oldMinCount ;
						sh:maxCount ?oldMaxCount .
				}
				INSERT {
					?propShape sh:class <${update.targetClassIri}> .
					${minCountInsert}
					${maxCountInsert}
				}
				WHERE {
					<${shapeIri}> sh:property ?propShape .
					?propShape sh:path <${propIri}> .
					OPTIONAL { ?propShape sh:class ?oldClass }
					OPTIONAL { ?propShape sh:minCount ?oldMinCount }
					OPTIONAL { ?propShape sh:maxCount ?oldMaxCount }
				}
			`);
			return;
		}

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${propIri}> rdfs:label ?oldLabel ; rdfs:range ?oldRange . }
			INSERT { <${propIri}> rdfs:label "${escapedName}" ; rdfs:range <${update.targetClassIri}> . }
			WHERE {
				OPTIONAL { <${propIri}> rdfs:label ?oldLabel }
				OPTIONAL { <${propIri}> rdfs:range ?oldRange }
			} ;
			${withGraph(graphs.shapes)}
			DELETE {
				?propShape sh:class ?oldClass ;
					sh:name ?oldName ;
					sh:minCount ?oldMinCount ;
					sh:maxCount ?oldMaxCount .
			}
			INSERT {
				?propShape sh:class <${update.targetClassIri}> ; sh:name "${escapedName}" .
				${minCountInsert}
				${maxCountInsert}
			}
			WHERE {
				<${shapeIri}> sh:property ?propShape .
				?propShape sh:path <${propIri}> .
				OPTIONAL { ?propShape sh:class ?oldClass }
				OPTIONAL { ?propShape sh:name ?oldName }
				OPTIONAL { ?propShape sh:minCount ?oldMinCount }
				OPTIONAL { ?propShape sh:maxCount ?oldMaxCount }
			}
		`);
	}

	/**
	 * Removes both the `owl:ObjectProperty` declaration and its `sh:property` shape entry, from
	 * `sourceClassIri`'s own namespace, derived automatically (Decision 8).
	 *
	 * When `targetClassIri` is given, the relation is *generic* (no `rdfs:domain` — see
	 * `deletePropertyTriples`'s own `hasDomain` check), and this source class's property shape
	 * currently targets *more than one* class (an `sh:or` union — the same generic relation drawn
	 * to several targets from this one class), only that one target is dropped from the union; the
	 * shape, the shared `owl:ObjectProperty` declaration, and the other targets are all left
	 * untouched. A *specific* relation (has `rdfs:domain`) is single-owner, single-target by
	 * construction (`updateObjectProperty`'s specific-relation path always rewrites its one
	 * `sh:property` blank node in place rather than adding another) and always falls through to the
	 * whole-shape removal below, regardless of how many `sh:property` blocks `targets` happens to
	 * report — treating a specific relation's multi-target shape as a union to shrink would silently
	 * leave stale, undeletable duplicate blocks (and the `owl:ObjectProperty` declaration itself)
	 * behind instead of fully removing it. Deleting the union's last remaining target also falls
	 * through to the existing whole-shape removal below.
	 */
	async deleteObjectProperty(propIri: string, sourceClassIri: string, targetClassIri?: string): Promise<void> {
		const namespaceBaseIri = await this.findNamespaceOfClass(sourceClassIri);
		const graphs = namespaceGraphs(namespaceBaseIri);

		if (targetClassIri) {
			const hasDomain = await this.askQuery(
				`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${propIri}> rdfs:domain ?d }`
			);
			if (!hasDomain) {
				const shapeIri = nodeShapeIri(sourceClassIri, graphs.shapes);
				const details = await this.fetchGenericPropertyShapeDetails(shapeIri, propIri, graphs);
				if (details.targets.length > 1) {
					const remaining = details.targets.filter((t) => t !== targetClassIri);
					await this.rewriteGenericPropertyShapeTargets(
						shapeIri,
						propIri,
						remaining,
						details.name ?? '',
						(details.minCount ?? 0) >= 1,
						details.maxCount === undefined,
						graphs
					);
					return;
				}
			}
		}

		await this.deletePropertyTriples(propIri, sourceClassIri, graphs);
	}

	// -- Attributed relationships / association classes (STORY-007) ---------------------------

	/**
	 * Creates an association class (e.g. `EmploymentAssignment`) with two or more
	 * `owl:ObjectProperty` links to related entities (e.g. `employee`, `employer`), following the
	 * pattern of `semantic-crm`'s `gcrms:EmploymentAssignment`/`gcrms:AddressAssignment`. The
	 * class itself is created exactly like any other class (`insertClass`); each link reuses
	 * `insertObjectProperty` since a link is structurally just a relation whose source is the new
	 * association class (and whose target graph, per Decision 8, is derived from that class's own
	 * namespace — the one just passed to `insertClass`). Once created, the class's own attributes
	 * (e.g. `jobTitle`, `startDate`) are added the same way as any entity's, via
	 * `insertDatatypeProperty` — no separate code path.
	 */
	async insertAssociationClass(
		name: string,
		description: string | undefined,
		links: AssociationLink[],
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<AssociationClassResult> {
		if (links.length < 2) {
			throw new Error('An attributed relationship needs at least two links to related entities');
		}
		const { iri } = await this.insertClass(name, description, namespaceBaseIri);
		await this.setAssociationClass(iri, true, namespaceBaseIri);

		const createdLinks: AssociationClassResult['links'] = [];
		for (const link of links) {
			const { iri: linkIri } = await this.insertObjectProperty(
				iri,
				link.targetClassIri,
				link.propName,
				link.required,
				!link.maxOne
			);
			createdLinks.push({
				iri: linkIri,
				propName: link.propName,
				targetClassIri: link.targetClassIri,
				required: link.required,
				repeatable: !link.maxOne
			});
		}

		return { iri, links: createdLinks };
	}

	/**
	 * Deletes an association class and everything it owns: its own attributes, its links to
	 * related entities, and its `sh:NodeShape` — all of which are just "own properties" of the
	 * class (`rdfs:domain` = the association class), so this is `deleteClass` unchanged. Kept as
	 * a separate named method for call-site clarity (an association class is conceptually an
	 * attributed relationship, not merely "a class").
	 */
	async deleteAssociationClass(
		iri: string,
		options?: { force?: boolean },
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<DeleteClassResult> {
		return this.deleteClass(iri, options, namespaceBaseIri);
	}

	// -- Inheritance (rdfs:subClassOf) — STORY-008 ---------------------------------------------

	/** All transitive `rdfs:subClassOf` ancestors of `classIriValue`, following only triples
	 *  actually stored in this namespace's `/schema` graph — external vocabulary classes are dead
	 *  ends here since they have no local `owl:Class`/`rdfs:subClassOf` triples of their own, which
	 *  is what keeps this check scoped to local classes without any special-casing. */
	async findAncestors(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(
			`${PREFIXES} SELECT DISTINCT ?ancestor ${fromClause(graphs.schema)} WHERE { <${classIriValue}> rdfs:subClassOf+ ?ancestor }`
		);
		return results.results.bindings.map((b) => b.ancestor.value);
	}

	/** True if adding `subIri rdfs:subClassOf superIri` would close a cycle among local classes. */
	async wouldCreateCycle(
		subIri: string,
		superIri: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<boolean> {
		if (subIri === superIri) return true;
		const ancestors = await this.findAncestors(superIri, namespaceBaseIri);
		return ancestors.includes(subIri);
	}

	/** Inserts `subIri rdfs:subClassOf superIri`, refusing (without writing anything) if it would
	 *  create a cycle among local classes. */
	async insertSubClassOf(
		subIri: string,
		superIri: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ cycleRejected: boolean }> {
		this.assertSafeSparqlIri(subIri, 'subclass IRI');
		this.assertSafeSparqlIri(superIri, 'superclass IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);

		if (await this.wouldCreateCycle(subIri, superIri, namespaceBaseIri)) {
			return { cycleRejected: true };
		}

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${subIri}> rdfs:subClassOf <${superIri}> .`, graphs.schema)} }`
		);
		return { cycleRejected: false };
	}

	/** Removes only the one `rdfs:subClassOf` triple — the classes at either end are untouched. */
	async deleteSubClassOf(
		subIri: string,
		superIri: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(subIri, 'subclass IRI');
		this.assertSafeSparqlIri(superIri, 'superclass IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} DELETE DATA { ${inGraph(`<${subIri}> rdfs:subClassOf <${superIri}> .`, graphs.schema)} }`
		);
	}

	// -- Attributed-relationship marker (STORY-020) --------------------------------------------

	/** Idempotently ensures `<SCHEMA_NAMESPACE>AttributedRelationship a owl:Class` exists — the
	 *  marker every association class is declared `rdfs:subClassOf` (replacing the old link-count
	 *  heuristic, see `canvas-model.ts`). Always lives in the *default* namespace's `/schema` graph
	 *  (this app's own self-describing vocabulary, like `NAMESPACE_CLASS_IRI` — STORY-027), even
	 *  when the association class marked with it lives elsewhere. Safe to call on every load: a
	 *  no-op once the triple exists. */
	async ensureAttributedRelationshipClass(): Promise<void> {
		const exists = await this.classExists(ATTRIBUTED_RELATIONSHIP_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${ATTRIBUTED_RELATIONSHIP_IRI}> a owl:Class ; rdfs:label "AttributedRelationship" .`, graphs.schema)} }`
		);
	}

	/** Marks/unmarks `classIriValue` as an attributed-relationship (association) class by
	 *  inserting/deleting its `rdfs:subClassOf <SCHEMA_NAMESPACE>AttributedRelationship` triple —
	 *  the sole signal `canvas-model.ts` uses to classify a class as an association class. Written
	 *  into `classIriValue`'s own namespace (the subject of the triple), not necessarily the
	 *  default namespace the marker class itself lives in. */
	async setAssociationClass(
		classIriValue: string,
		isAssociation: boolean,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		if (isAssociation) {
			await this.ensureAttributedRelationshipClass();
			await this.insertSubClassOf(classIriValue, ATTRIBUTED_RELATIONSHIP_IRI, namespaceBaseIri);
		} else {
			await this.deleteSubClassOf(classIriValue, ATTRIBUTED_RELATIONSHIP_IRI, namespaceBaseIri);
		}
	}

	// -- Configurable catalog marker class setting (Sprint 5 Story 014) -------------------------
	// Replaces the old hardcoded/auto-created `AuthoritativeEntity` marker class (removed: it
	// collided with a user-created domain class of the same display name in a different namespace,
	// see `plan.md`'s Sprint 5 context) with one explicit GraphDB-backed setting the user points at
	// whichever class they choose — no label-matching, no auto-lookup, no fallback heuristic.

	/** Returns the currently-configured catalog marker class's IRI, or `null` if unset — `SELECT`
	 *  against the single well-known `<APP_SETTINGS_IRI> <AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI>
	 *  ?classIri` triple, always in the default namespace's own `/schema` graph regardless of which
	 *  namespace the configured class itself lives in. */
	async fetchAuthoritativeEntityClassIri(): Promise<string | null> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?classIri ${fromClause(graphs.schema)} WHERE {
				<${APP_SETTINGS_IRI}> <${AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI}> ?classIri
			} LIMIT 1
		`);
		return results.results.bindings[0]?.classIri?.value ?? null;
	}

	/** Sets, replaces, or (passing `null`) clears the configured catalog marker class — mirrors
	 *  `setBackstageKind`'s DELETE/INSERT/WHERE-with-OPTIONAL shape, except the object is a class
	 *  IRI, not a string literal. Does **not** validate that `classIriValue` refers to an existing
	 *  class — a schema author may configure the setting before or after creating the class;
	 *  existence is enforced by Story 015's class picker, not by this write path. */
	async setAuthoritativeEntityClassIri(classIriValue: string | null): Promise<void> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		if (classIriValue === null) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${APP_SETTINGS_IRI}> <${AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${APP_SETTINGS_IRI}> <${AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI}> ?old }
			INSERT { <${APP_SETTINGS_IRI}> <${AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI}> <${classIriValue}> }
			WHERE { OPTIONAL { <${APP_SETTINGS_IRI}> <${AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI}> ?old } }
		`);
	}

	// -- Configurable represents-predicate setting (Backstage-sync STORY-103) -------------------
	// Mirrors the catalog-marker-class setting above exactly, except the configured value is an
	// `owl:ObjectProperty` IRI a synced shadow individual's `represents` link is written with
	// (STORY-105), not a class. Unlike that setting, this one is also read Go-side (the sync engine
	// itself resolves it at sync time) — see `config.Config.RepresentsPredicateSettingIRI()`.

	/** Returns the currently-configured `represents` predicate's IRI, or `null` if unset — `SELECT`
	 *  against the single well-known `<APP_SETTINGS_IRI> <REPRESENTS_PREDICATE_SETTING_IRI> ?predIri`
	 *  triple, always in the default namespace's own `/schema` graph. */
	async fetchRepresentsPredicateIri(): Promise<string | null> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?predIri ${fromClause(graphs.schema)} WHERE {
				<${APP_SETTINGS_IRI}> <${REPRESENTS_PREDICATE_SETTING_IRI}> ?predIri
			} LIMIT 1
		`);
		return results.results.bindings[0]?.predIri?.value ?? null;
	}

	/** Sets, replaces, or (passing `null`) clears the configured `represents` predicate — mirrors
	 *  `setAuthoritativeEntityClassIri`'s DELETE/INSERT/WHERE-with-OPTIONAL shape exactly. Does
	 *  **not** validate that `predicateIri` refers to an existing `owl:ObjectProperty` — existence is
	 *  enforced by Story 104's picker, not by this write path. */
	async setRepresentsPredicateIri(predicateIri: string | null): Promise<void> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		if (predicateIri === null) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${APP_SETTINGS_IRI}> <${REPRESENTS_PREDICATE_SETTING_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}
		this.assertSafeSparqlIri(predicateIri, 'represents predicate IRI');
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${APP_SETTINGS_IRI}> <${REPRESENTS_PREDICATE_SETTING_IRI}> ?old }
			INSERT { <${APP_SETTINGS_IRI}> <${REPRESENTS_PREDICATE_SETTING_IRI}> <${predicateIri}> }
			WHERE { OPTIONAL { <${APP_SETTINGS_IRI}> <${REPRESENTS_PREDICATE_SETTING_IRI}> ?old } }
		`);
	}

	// -- backstageKind annotation (Backstage-mapping Story 003/005) -----------------------------

	/** Idempotently ensures `<BACKSTAGE_KIND_PREDICATE_IRI> a owl:AnnotationProperty` exists,
	 *  mirroring `ensureAttributedRelationshipClass`'s self-describing-vocabulary declaration. Always
	 *  lives in the *default* namespace's `/schema` graph, even when the class carrying the
	 *  annotation lives elsewhere. Safe to call on every write: a no-op once the triple exists. */
	async ensureBackstageKindPredicateDeclared(): Promise<void> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${BACKSTAGE_KIND_PREDICATE_IRI}> a owl:AnnotationProperty }`
		);
		if (exists) return;
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${BACKSTAGE_KIND_PREDICATE_IRI}> a owl:AnnotationProperty ; rdfs:label "backstageKind"`, graphs.schema)} }`
		);
	}

	/** Declares which Backstage `kind` `classIriValue` corresponds to (Story 005) — one class maps
	 *  to at most one kind, so re-setting overwrites rather than accumulating, mirroring
	 *  `renameClass`'s DELETE/INSERT/WHERE-with-OPTIONAL shape. Written into the class's own
	 *  namespace's `/schema` graph (the caller-supplied `namespaceBaseIri`, matching
	 *  `setAssociationClass`'s explicit-namespace convention). */
	async setBackstageKind(
		classIriValue: string,
		kind: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		const trimmedKind = kind.trim();
		if (!trimmedKind) throw new Error('Backstage kind must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		await this.ensureBackstageKindPredicateDeclared();
		const graphs = namespaceGraphs(namespaceBaseIri);
		const escapedKind = this.escapeString(trimmedKind);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${classIriValue}> <${BACKSTAGE_KIND_PREDICATE_IRI}> ?old }
			INSERT { <${classIriValue}> <${BACKSTAGE_KIND_PREDICATE_IRI}> "${escapedKind}" }
			WHERE { OPTIONAL { <${classIriValue}> <${BACKSTAGE_KIND_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Removes `classIriValue`'s `backstageKind` annotation, if any. */
	async clearBackstageKind(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${classIriValue}> <${BACKSTAGE_KIND_PREDICATE_IRI}> ?old`, graphs.schema)} }`
		);
	}

	/** Returns `classIriValue`'s current `backstageKind` annotation, or `null` if unset. */
	async fetchBackstageKind(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string | null> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?kind ${fromClause(graphs.schema)} WHERE {
				<${classIriValue}> <${BACKSTAGE_KIND_PREDICATE_IRI}> ?kind
			} LIMIT 1
		`);
		return results.results.bindings[0]?.kind?.value ?? null;
	}

	/** Story 006's "Create class now": creates a bare `owl:Class` (via `insertClass`, no attributes
	 *  prefilled from Backstage's `metadata`/`spec` fields per the plan's ADR) and tags it with a
	 *  Backstage `kind` in one call, so a class can never end up created-but-forgotten-to-tag.
	 *  Failure semantics: if `setBackstageKind` fails after `insertClass` already succeeded, the
	 *  class exists untagged — the caller sees the thrown error and may retry `setBackstageKind`
	 *  directly against the now-existing class; nothing is rolled back. */
	async insertClassAndSetBackstageKind(
		name: string,
		kind: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ iri: string }> {
		const { iri } = await this.insertClass(name, undefined, namespaceBaseIri);
		await this.setBackstageKind(iri, kind, namespaceBaseIri);
		return { iri };
	}

	// -- rse:namespace annotation (Backstage-sync STORY-099/100) --------------------------------
	// A shadow concept class's own or inherited-from-`backstage:CoreConcept` Namespace, which the
	// sync engine resolves at sync time (`resolveConceptNamespace`, Go-side). This block is the
	// TS-side mirror of that same resolution walk, used only for `EntityForm`'s "currently effective"
	// display — the Go side is the sole source of truth for what a real sync run actually does.

	/** Sets, replaces, or (passing `null`) clears `classIriValue`'s own `rse:namespace` declaration —
	 *  mirrors `setBackstageKind`'s DELETE/INSERT/WHERE-with-OPTIONAL shape, except the object is a
	 *  namespace base IRI, not a string literal. Written into the class's own namespace's `/schema`
	 *  graph (the caller-supplied `namespaceBaseIri`), matching `setBackstageKind`'s convention.
	 *  Clearing falls back to whatever STORY-099's ancestry walk resolves next (typically
	 *  `backstage:CoreConcept`'s own declaration). */
	async updateClassNamespace(
		classIriValue: string,
		namespaceValue: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		if (namespaceValue === null) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${classIriValue}> <${NAMESPACE_PREDICATE_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}
		this.assertSafeSparqlIri(namespaceValue, 'namespace base IRI');
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${classIriValue}> <${NAMESPACE_PREDICATE_IRI}> ?old }
			INSERT { <${classIriValue}> <${NAMESPACE_PREDICATE_IRI}> <${namespaceValue}> }
			WHERE { OPTIONAL { <${classIriValue}> <${NAMESPACE_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Cross-graph lookup of `subjectIri`'s own `rse:namespace` value, if any — an unrestricted
	 *  `GRAPH ?g {...}` pattern (mirrors `findNamespaceOfClass`), since `resolveEffectiveClassNamespace`'s
	 *  ancestry walk visits classes that may live in a different namespace than the one originally
	 *  asked about. */
	private async fetchOwnNamespaceCrossGraph(subjectIri: string): Promise<string | null> {
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?ns WHERE { GRAPH ?g { <${subjectIri}> <${NAMESPACE_PREDICATE_IRI}> ?ns } } LIMIT 1`
		);
		return results.results.bindings[0]?.ns?.value ?? null;
	}

	/** Cross-graph lookup of `subjectIri`'s direct `rdfs:subClassOf` superclasses (not transitive) —
	 *  the single-step primitive `resolveEffectiveClassNamespace`'s breadth-first walk repeats. */
	private async fetchDirectSuperclassesCrossGraph(subjectIri: string): Promise<string[]> {
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?super WHERE { GRAPH ?g { <${subjectIri}> rdfs:subClassOf ?super } }`
		);
		return results.results.bindings.map((b) => b.super.value);
	}

	/** Resolves `classIriValue`'s *effective* Namespace (STORY-099/100): its own `rse:namespace` if
	 *  declared, else the nearest ancestor's (own is always checked before that node's own
	 *  superclasses are fetched, so an override can never lose to an inherited value) — the exact
	 *  same breadth-first, cycle-safe walk `Engine.resolveConceptNamespace` runs Go-side, so the
	 *  form's "own vs inherited" indicator never disagrees with what an actual sync run would resolve.
	 *  Returns `null` when neither `classIriValue` nor any ancestor declares one. */
	async resolveEffectiveClassNamespace(
		classIriValue: string
	): Promise<{ baseIri: string; own: boolean } | null> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const visited = new Set<string>();
		const queue: string[] = [classIriValue];
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (visited.has(current)) continue;
			visited.add(current);

			const ns = await this.fetchOwnNamespaceCrossGraph(current);
			if (ns !== null) {
				return { baseIri: ns, own: current === classIriValue };
			}

			const supers = await this.fetchDirectSuperclassesCrossGraph(current);
			for (const s of supers) {
				if (!visited.has(s)) queue.push(s);
			}
		}
		return null;
	}

	// -- Class-level attribute values (`REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI`) ------------------
	// An attribute an ancestor class marks "required for subclasses" stores its value directly on
	// the *class* resource, in that class's own `/schema` graph — mirrors `updateClassNamespace`'s
	// shape (a class-level annotation) rather than `setIndividualAttributeValue`'s (an ABox value
	// in `/instances`), since this is deliberately never an instance-level value.

	/** Sets (or, when `value` is `null`, clears) a class-level attribute value — DELETE-then-INSERT,
	 *  mirroring `setIndividualAttributeValue`'s shape exactly but targeting the class's own
	 *  `/schema` graph instead of `/instances`. */
	async setClassAttributeValue(
		classIriValue: string,
		attributeIri: string,
		datatype: XsdDatatype,
		value: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		this.assertSafeSparqlIri(attributeIri, 'attribute IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const insertClause =
			value === null
				? ''
				: `INSERT { <${classIriValue}> <${attributeIri}> ${this.formatTypedLiteral(datatype, value)} }`;

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${classIriValue}> <${attributeIri}> ?old }
			${insertClause}
			WHERE { OPTIONAL { <${classIriValue}> <${attributeIri}> ?old } }
		`);
	}

	/** Current class-level values of `attributeIris` on `classIriValue`, keyed by attribute IRI —
	 *  mirrors `fetchIndividualAttributeValues` but single-valued only (a class-level "required for
	 *  subclasses" attribute has no repeatable concept) and scoped to the class's own `/schema`
	 *  graph instead of `/instances`. */
	async fetchClassAttributeValues(
		classIriValue: string,
		attributeIris: string[],
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<Record<string, string>> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		for (const iri of attributeIris) this.assertSafeSparqlIri(iri, 'attribute IRI');
		if (attributeIris.length === 0) return {};
		const graphs = namespaceGraphs(namespaceBaseIri);

		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?p ?value ${fromClause(graphs.schema)} WHERE {
				<${classIriValue}> ?p ?value .
				VALUES ?p { ${attributeIris.map((iri) => `<${iri}>`).join(' ')} }
			}
		`);

		const out: Record<string, string> = {};
		for (const b of results.results.bindings) out[b.p.value] = b.value.value;
		return out;
	}

	// -- rse:sourceField annotation (Backstage-sync STORY-101/102) ------------------------------
	// Maps an already-modeled `owl:DatatypeProperty` onto free-form mapping information (a field
	// path, a JSON pointer, a query, ...) the sync engine (`Engine.resolveSourceFieldMapping`,
	// Go-side) reads at sync time — source-agnostic: Backstage is the first ingestor to consult it,
	// and interprets its own syntax; a future ingestor is free to interpret the same predicate's
	// value however its own source data demands. TS-side authoring only — the Go side's own
	// `sh:property`-attached "must already exist" check (STORY-101) is the sole source of truth for
	// whether a mapping is actually honored on a given sync run.

	/** Sets, replaces, or (passing `null`) clears `propIri`'s `rse:sourceField` mapping information —
	 *  mirrors `updateClassNamespace`'s DELETE/INSERT/WHERE-with-OPTIONAL shape, except the object is
	 *  a plain (possibly multi-line) string literal, not an IRI. Written into the property's own
	 *  namespace's `/schema` graph (the caller-supplied `namespaceBaseIri`). */
	async updateAttributeSourceField(
		propIri: string,
		sourceField: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const trimmed = sourceField?.trim();
		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}
		const escapedPath = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> ?old }
			INSERT { <${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> "${escapedPath}" }
			WHERE { OPTIONAL { <${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Returns `propIri`'s current `rse:sourceField` mapping, or `null` if unset. */
	async fetchAttributeSourceField(
		propIri: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string | null> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?path ${fromClause(graphs.schema)} WHERE {
				<${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> ?path
			} LIMIT 1
		`);
		return results.results.bindings[0]?.path?.value ?? null;
	}

	// -- rse:groupOnOneLine / rse:displayAsChips display markers --------------------------------
	// Purely a display concern for the Identities resource page (`buildPropertyRows`,
	// `utils/resource-page-format.ts`) — never read by the Go sync engine, unlike `rse:sourceField`
	// above. Both flags live on the same `owl:DatatypeProperty` and are always updated/read together
	// since they're offered as one pair of checkboxes in `AttributeForm`.

	/** Sets/clears `propIri`'s `rse:groupOnOneLine`/`rse:displayAsChips` display markers together —
	 *  mirrors `updateAttributeSourceField`'s DELETE/INSERT/WHERE-with-OPTIONAL shape, except each
	 *  flag is only ever asserted as `true`; a `false` value deletes the triple entirely rather than
	 *  asserting `false` (presence, not value, is the signal — same convention as
	 *  `REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI`). Written into the property's own namespace's
	 *  `/schema` graph. */
	async updateAttributeDisplayMarkers(
		propIri: string,
		markers: { groupOnOneLine: boolean; displayAsChips: boolean },
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const groupInsert = markers.groupOnOneLine ? `<${propIri}> <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> true .` : '';
		const chipsInsert = markers.displayAsChips ? `<${propIri}> <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> true .` : '';
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE {
				<${propIri}> <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> ?oldGroup ; <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> ?oldChips .
			}
			INSERT {
				${groupInsert}
				${chipsInsert}
			}
			WHERE {
				OPTIONAL { <${propIri}> <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> ?oldGroup }
				OPTIONAL { <${propIri}> <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> ?oldChips }
			}
		`);
	}

	/** Returns `propIri`'s current `rse:groupOnOneLine`/`rse:displayAsChips` flags, each `false` when
	 *  unset. */
	async fetchAttributeDisplayMarkers(
		propIri: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ groupOnOneLine: boolean; displayAsChips: boolean }> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?groupOnOneLine ?displayAsChips ${fromClause(graphs.schema)} WHERE {
				OPTIONAL { <${propIri}> <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> ?groupOnOneLine }
				OPTIONAL { <${propIri}> <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> ?displayAsChips }
			} LIMIT 1
		`);
		const b = results.results.bindings[0];
		return {
			groupOnOneLine: b?.groupOnOneLine?.value === 'true',
			displayAsChips: b?.displayAsChips?.value === 'true'
		};
	}

	// -- rse:sourceRelation annotation (Backstage-sync STORY-106/107) --------------------------
	// Maps an already-modeled `owl:ObjectProperty` onto free-form relation-type mapping information
	// (an upstream relation `type` string, a query, a role name, ...) the sync engine reads at sync
	// time (`Engine.resolveSourceRelationMapping`, Go-side) and interprets however its own ingestion
	// source's relation graph demands. Not source-specific: Backstage is the first ingestor to read
	// it (its own `relations[].type`, e.g. `ownedBy`/`partOf`/`dependsOn`), same neutrality as
	// `rse:sourceField` above. Distinct from `rse:sourceField` (a property-value mapping, not a
	// relation-type mapping) and from `REPRESENTS_PREDICATE_SETTING_IRI` (a single
	// settings-configured predicate, not a per-property mapping). TS-side authoring only — the Go
	// side's own `sh:property`-attached "must already exist" check (STORY-106) is the sole source of
	// truth for whether a mapping is actually honored on a given sync run.

	/** Sets, replaces, or (passing `null`) clears `propIri`'s `rse:sourceRelation` mapping
	 *  information — mirrors `updateAttributeSourceField`'s DELETE/INSERT/WHERE-with-OPTIONAL shape.
	 *  Written into the property's own namespace's `/schema` graph (the caller-supplied
	 *  `namespaceBaseIri`). */
	async updateRelationSourceType(
		propIri: string,
		sourceType: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const trimmed = sourceType?.trim();
		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}
		const escapedType = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> ?old }
			INSERT { <${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> "${escapedType}" }
			WHERE { OPTIONAL { <${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Returns `propIri`'s current `rse:sourceRelation` mapping, or `null` if unset. */
	async fetchRelationSourceType(
		propIri: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string | null> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?type ${fromClause(graphs.schema)} WHERE {
				<${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> ?type
			} LIMIT 1
		`);
		return results.results.bindings[0]?.type?.value ?? null;
	}

	// -- Reverse relations (STORY-XXX) ------------------------------------------------------------
	// The relation form's "Define reverse relation" checkbox mints a second, ordinary specific
	// relation (via `insertObjectProperty` with source/target swapped) and links it to the first via
	// two predicates: `owl:inverseOf`, written symmetrically on both sides (standard OWL, lets a
	// lookup work from either property), and `rse:generatedReverseOf`, written only on the
	// auto-generated side (app-specific bookkeeping — which half of the pair is "the one nobody
	// explicitly drew," so the canvas can default-hide just that one). Neither the base relation
	// declaration nor its `sh:property` shape entry is special-cased here — `insertObjectProperty`/
	// `updateObjectProperty`/`deleteObjectProperty` handle those exactly as for any other relation;
	// this section only owns the link between the two.

	/** Links `forwardPropIri`/`reversePropIri` as each other's reverse (STORY-XXX): `owl:inverseOf`
	 *  written symmetrically in each property's own namespace's schema graph, plus
	 *  `rse:generatedReverseOf` on the reverse side only. Namespaces resolved independently per side
	 *  (mirrors `insertObjectProperty`'s own per-relation namespace derivation) since a relation can
	 *  cross namespaces. */
	async linkGeneratedReverse(
		forwardPropIri: string,
		forwardSourceClassIri: string,
		reversePropIri: string,
		reverseSourceClassIri: string
	): Promise<void> {
		this.assertSafeSparqlIri(forwardPropIri, 'property IRI');
		this.assertSafeSparqlIri(reversePropIri, 'reverse property IRI');
		const forwardNamespaceBaseIri = await this.findNamespaceOfClass(forwardSourceClassIri);
		const reverseNamespaceBaseIri = await this.findNamespaceOfClass(reverseSourceClassIri);
		const forwardGraphs = namespaceGraphs(forwardNamespaceBaseIri);
		const reverseGraphs = namespaceGraphs(reverseNamespaceBaseIri);
		await this.executeUpdate(`
			${PREFIXES}
			INSERT DATA {
				GRAPH <${forwardGraphs.schema}> { <${forwardPropIri}> owl:inverseOf <${reversePropIri}> . }
				GRAPH <${reverseGraphs.schema}> {
					<${reversePropIri}> owl:inverseOf <${forwardPropIri}> ;
						<${GENERATED_REVERSE_OF_PREDICATE_IRI}> <${forwardPropIri}> .
				}
			}
		`);
	}

	/** Removes the `owl:inverseOf`/`rse:generatedReverseOf` link between `forwardPropIri` and
	 *  `reversePropIri` (STORY-XXX) — always call this before deleting either side of a pair, since
	 *  `deleteObjectProperty` only cleans up the triples it itself wrote and would otherwise leave a
	 *  dangling half-link on the side left standing. Uses `DELETE WHERE` (mirrors
	 *  `updateRelationSourceType`'s own clearing idiom) rather than `DELETE DATA`, so it's a no-op —
	 *  not an error — if the link is already gone on one side. */
	async unlinkGeneratedReverse(
		forwardPropIri: string,
		forwardSourceClassIri: string,
		reversePropIri: string,
		reverseSourceClassIri: string
	): Promise<void> {
		this.assertSafeSparqlIri(forwardPropIri, 'property IRI');
		this.assertSafeSparqlIri(reversePropIri, 'reverse property IRI');
		const forwardNamespaceBaseIri = await this.findNamespaceOfClass(forwardSourceClassIri);
		const reverseNamespaceBaseIri = await this.findNamespaceOfClass(reverseSourceClassIri);
		const forwardGraphs = namespaceGraphs(forwardNamespaceBaseIri);
		const reverseGraphs = namespaceGraphs(reverseNamespaceBaseIri);
		await this.executeUpdate(`
			${PREFIXES}
			DELETE WHERE { ${inGraph(`<${forwardPropIri}> owl:inverseOf <${reversePropIri}>`, forwardGraphs.schema)} };
			DELETE WHERE { ${inGraph(`<${reversePropIri}> owl:inverseOf <${forwardPropIri}>`, reverseGraphs.schema)} };
			DELETE WHERE { ${inGraph(`<${reversePropIri}> <${GENERATED_REVERSE_OF_PREDICATE_IRI}> <${forwardPropIri}>`, reverseGraphs.schema)} }
		`);
	}

	/** Returns `propIri`'s currently-defined reverse relation — its `owl:inverseOf` partner's IRI,
	 *  current name (`rdfs:label`), and `rse:sourceRelation` mapping (STORY-107) if any — or `null`
	 *  if `propIri` has no reverse defined. Works symmetrically (call with either side's IRI). One
	 *  unrestricted cross-graph query (mirrors `fetchLabelsForIris`'s/`findNamespaceOfSubject`'s own
	 *  cross-graph style) since the reverse may live in a different namespace's schema graph than
	 *  `propIri`'s own, when the relation crosses namespaces. */
	async fetchInverseRelation(
		propIri: string
	): Promise<{ iri: string; name: string; sourceRelation: string | null } | null> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?inverse ?label ?sourceType WHERE {
				GRAPH ?g1 { <${propIri}> owl:inverseOf ?inverse }
				OPTIONAL { GRAPH ?g2 { ?inverse rdfs:label ?label } }
				OPTIONAL { GRAPH ?g3 { ?inverse <${SOURCE_RELATION_PREDICATE_IRI}> ?sourceType } }
			} LIMIT 1
		`);
		const binding = results.results.bindings[0];
		if (!binding?.inverse) return null;
		return {
			iri: binding.inverse.value,
			name: binding.label?.value ?? '',
			sourceRelation: binding.sourceType?.value ?? null
		};
	}

	/**
	 * Looks up which namespace `individualIri` was declared in, by finding the named graph its own
	 * `rdf:type` triple actually lives in — a plain cross-graph `GRAPH ?g {...}` pattern, mirroring
	 * `findNamespaceOfClass` but for an ABox individual instead of a TBox class. An individual
	 * normally lives in a namespace's plain instances graph (no `/schema`/`/shapes` suffix), so the
	 * matched graph is usually the base IRI already; the suffix-stripping here is defensive, mirroring
	 * `findNamespaceOfSubject`.
	 */
	async findNamespaceOfIndividual(individualIri: string): Promise<string> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?g WHERE { GRAPH ?g { <${individualIri}> a ?type } } LIMIT 1`
		);
		const graphIri = results.results.bindings[0]?.g?.value;
		if (!graphIri) {
			throw new Error(`Cannot determine namespace: individual not found (${individualIri})`);
		}
		if (graphIri.endsWith('/schema')) return graphIri.slice(0, -'/schema'.length);
		if (graphIri.endsWith('/shapes')) return graphIri.slice(0, -'/shapes'.length);
		return graphIri;
	}

	/** `findNamespaceOfIndividual` for an individual that may have no `rdf:type` yet: falls back to
	 *  the graph holding its `rdfs:label`. Kept separate because the annotation path's shared golden
	 *  vectors script exactly the queries `findNamespaceOfIndividual` makes. */
	private async findNamespaceOfPossiblyUntypedIndividual(individualIri: string): Promise<string> {
		try {
			return await this.findNamespaceOfIndividual(individualIri);
		} catch (error) {
			this.assertSafeSparqlIri(individualIri, 'individual IRI');
			const labelled = await this.selectQuery(
				`${PREFIXES} SELECT ?g WHERE { GRAPH ?g { <${individualIri}> rdfs:label ?l } } LIMIT 1`
			);
			const graphIri = labelled.results.bindings[0]?.g?.value;
			if (!graphIri) throw error;
			return graphIri;
		}
	}

	/** Every individual asserting mastery over `classIri` (a class or an attribute IRI — Story 019
	 *  widened this beyond classes) via any declared property labeled "isMasterFor" — a plain
	 *  cross-graph `GRAPH ?g {...}` lookup with no `FROM`/`FROM NAMED` restriction, mirroring
	 *  `findSubClassReferences`. `"isMasterFor"` is a naming *convention* read off real declared
	 *  properties, not a hardcoded IRI: any generic or domain/range-specific `owl:ObjectProperty` the
	 *  user happens to label "isMasterFor", in any namespace, is honored. Used by Story 008's
	 *  generation engine to compute `prov:wasAttributedTo`/`wasDerivedFrom`; `buildSplitDatasetOps`
	 *  (Story 020) reuses this same method to look up an *attribute's* own override, despite the
	 *  class-scoped name/param kept for its original, still-primary call site. */
	async fetchMasterSystemsOfClass(
		classIri: string
	): Promise<Array<{ iri: string; label: string; namespaceBaseIri: string }>> {
		this.assertSafeSparqlIri(classIri, 'class IRI');
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?s ?label ?g WHERE {
				GRAPH ?g { ?s ?p <${classIri}> }
				GRAPH ?pg { ?p rdfs:label "isMasterFor" }
				OPTIONAL { ?s rdfs:label ?label }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.s.value,
			label: b.label?.value ?? extractLocalName(b.s.value),
			namespaceBaseIri: b.g.value
		}));
	}

	// -- Generalized individual→class relations (data-catalog Story 017) ------------------------
	// Individual-relations are modelled exactly like entity-to-entity relations (STORY-051/052's
	// 'generic'/'specific' split): a name typed by the user first tries to reuse an existing,
	// *properly declared* `owl:ObjectProperty` with that exact `rdfs:label` — generic or
	// domain/range-specific, so a relation already drawn between two classes on canvas (e.g.
	// `gov:systemOfWorkIsMasterFor`) is reused verbatim, never shadowed by a second, undeclared
	// predicate. Only when nothing matches is a fresh *generic* property minted+declared. The one
	// deliberate difference from entity-to-entity relations: no SHACL shape is ever written here —
	// ABox assertions aren't shape-constrained today.

	/** Finds an existing `owl:ObjectProperty` (generic or domain/range-specific) by its exact
	 *  `rdfs:label`, across every namespace — an unrestricted cross-graph `GRAPH ?g` lookup,
	 *  mirroring `fetchMasterSystemsOfClass`'s own pattern. */
	private async findObjectPropertyByLabel(label: string): Promise<string | undefined> {
		const escapedLabel = this.escapeString(label);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?p WHERE {
				GRAPH ?g { ?p a owl:ObjectProperty ; rdfs:label "${escapedLabel}" }
			} LIMIT 1
		`);
		return results.results.bindings[0]?.p.value;
	}

	/** Resolves a user-entered name for any individual-involving relation (an individual→class
	 *  relation, or the Story 019 assertion editor's predicate) to a real, declared
	 *  `owl:ObjectProperty` IRI: reuses an existing property with that exact `rdfs:label` if one
	 *  exists anywhere in the schema; otherwise mints and declares a fresh *generic* one (`a
	 *  owl:ObjectProperty ; rdfs:label`, no `rdfs:domain`/`rdfs:range`, and no `sh:property` shape).
	 *  Never mints a new *specific* property — those are only ever authored via the ordinary
	 *  entity-to-entity relation tool (`insertObjectProperty`). */
	private async resolveOrMintPredicate(label: string, namespaceBaseIri: string): Promise<string> {
		const trimmed = label.trim();
		const existing = await this.findObjectPropertyByLabel(trimmed);
		if (existing) return existing;
		const graphs = namespaceGraphs(namespaceBaseIri);
		const genericIri = genericPropertyIri(trimmed, namespaceBaseIri);
		if (!(await this.propertyExists(genericIri, namespaceBaseIri))) {
			await this.executeUpdate(
				`${PREFIXES} INSERT DATA { ${inGraph(`<${genericIri}> a owl:ObjectProperty ; rdfs:label "${this.escapeString(trimmed)}" .`, graphs.schema)} }`
			);
		}
		return genericIri;
	}

	/** Resolves `relationName` to a declared predicate IRI (`resolveOrMintPredicate`) and asserts
	 *  `<individualIri> <predicateIri> <classIri>` as a plain triple in the individual's own
	 *  namespace's `graphs.instances`. */
	async insertIndividualClassRelation(
		individualIri: string,
		classIri: string,
		relationName: string
	): Promise<{ iri: string }> {
		if (!relationName.trim()) throw new Error('Relation name must not be empty');
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		this.assertSafeSparqlIri(classIri, 'class IRI');
		const namespaceBaseIri = await this.findNamespaceOfPossiblyUntypedIndividual(individualIri);
		const predicateIri = await this.resolveOrMintPredicate(relationName, namespaceBaseIri);
		this.assertSafeSparqlIri(predicateIri, 'relation predicate IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${individualIri}> <${predicateIri}> <${classIri}> .`, graphs.instances)} }`
		);
		return { iri: predicateIri };
	}

	/** Removes exactly the `<individualIri> <predicateIri> <classIri>` triple. */
	async deleteIndividualClassRelation(individualIri: string, predicateIri: string, classIri: string): Promise<void> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		this.assertSafeSparqlIri(predicateIri, 'relation predicate IRI');
		this.assertSafeSparqlIri(classIri, 'class IRI');
		const namespaceBaseIri = await this.findNamespaceOfPossiblyUntypedIndividual(individualIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const cleanup = this.factCleanup(individualIri, predicateIri, `<${classIri}>`);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.instances)}
			DELETE { <${individualIri}> <${predicateIri}> <${classIri}> . ${cleanup.template} }
			WHERE { ${cleanup.where} }
		`);
	}

	/**
	 * Renames and/or retargets an existing individual→class or individual→individual relation in
	 * place (the unified relation-edit modal's "change the relation" fields, mirroring
	 * `updateObjectProperty`'s same-source-different-name/target shape for schema relations).
	 * Resolves `newRelationName` to a predicate IRI exactly like `insertIndividualClassRelation`,
	 * then swaps the ground triple from `<subjectIri> <oldPredicateIri> <oldObjectIri>` to
	 * `<subjectIri> <newPredicateIri> <newObjectIri>` in one update. If that triple was already
	 * reified (`ensureReifiedStatement`), the same update rewrites the existing `rdf:Statement`'s own
	 * `rdf:predicate`/`rdf:object` in place instead of leaving it dangling — this is what lets
	 * assertions already authored against the relation survive a rename/retarget. The `OPTIONAL`
	 * around the statement pattern means the rewrite is a no-op when nothing reifies the old triple
	 * yet (unbound `?stmt` triples are simply omitted from the DELETE/INSERT templates, standard
	 * SPARQL Update behavior).
	 */
	async updateIndividualRelation(
		subjectIri: string,
		oldPredicateIri: string,
		oldObjectIri: string,
		newRelationName: string,
		newObjectIri: string
	): Promise<{ predicateIri: string }> {
		if (!newRelationName.trim()) throw new Error('Relation name must not be empty');
		this.assertSafeSparqlIri(subjectIri, 'subject IRI');
		this.assertSafeSparqlIri(oldPredicateIri, 'old predicate IRI');
		this.assertSafeSparqlIri(oldObjectIri, 'old object IRI');
		this.assertSafeSparqlIri(newObjectIri, 'new object IRI');
		const namespaceBaseIri = await this.findNamespaceOfIndividual(subjectIri);
		const newPredicateIri = await this.resolveOrMintPredicate(newRelationName, namespaceBaseIri);
		this.assertSafeSparqlIri(newPredicateIri, 'relation predicate IRI');
		if (newPredicateIri === oldPredicateIri && newObjectIri === oldObjectIri) {
			return { predicateIri: newPredicateIri };
		}
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.instances)}
			DELETE {
				<${subjectIri}> <${oldPredicateIri}> <${oldObjectIri}> .
				?stmt rdf:predicate <${oldPredicateIri}> ; rdf:object <${oldObjectIri}> .
			}
			INSERT {
				<${subjectIri}> <${newPredicateIri}> <${newObjectIri}> .
				?stmt rdf:predicate <${newPredicateIri}> ; rdf:object <${newObjectIri}> .
			}
			WHERE {
				<${subjectIri}> <${oldPredicateIri}> <${oldObjectIri}> .
				OPTIONAL {
					?stmt rdf:subject <${subjectIri}> ; rdf:predicate <${oldPredicateIri}> ; rdf:object <${oldObjectIri}> .
				}
			}
		`);
		return { predicateIri: newPredicateIri };
	}

	// -- Relation-level assertions / reification (relation-assertions Sprint 4) -----------------
	// Attaching a fact to one *specific* relation-edge instance, per the seed doc's own proposed
	// shape: `<stmt> a rdf:Statement ; rdf:subject <s> ; rdf:predicate <p> ; rdf:object <o>`.
	// Reification is lazy — minted on first assertion against an edge (`ensureReifiedStatement`),
	// never up front for every relation — and lives in the same `graphs.instances` the base ground
	// triple already occupies, found via `findNamespaceOfIndividual` like every other assertion
	// method above.

	/** Looks up the existing `rdf:Statement` reifying `<subjectIri> <predicateIri> <objectIri>`, if
	 *  any (Story 008) — scoped to `namespaceBaseIri`'s own `graphs.instances`, matching where
	 *  `ensureReifiedStatement` writes it. Returns `undefined` when the triple isn't reified yet.
	 *  IRI-only wrapper over `fetchStatementIriForFact`. */
	async fetchStatementIriForTriple(
		subjectIri: string,
		predicateIri: string,
		objectIri: string,
		namespaceBaseIri: string
	): Promise<string | undefined> {
		return this.fetchStatementIriForFact(
			subjectIri,
			predicateIri,
			{ kind: 'iri', iri: objectIri },
			namespaceBaseIri
		);
	}

	/**
	 * Renders a `FactObject` as a SPARQL term, validating every IRI and language tag and escaping
	 * the literal's lexical form — the only place a fact's object is interpolated into a query.
	 */
	private factObjectTerm(object: FactObject): string {
		if (object.kind === 'iri') {
			this.assertSafeSparqlIri(object.iri, 'object IRI');
			return `<${object.iri}>`;
		}
		const lexical = `"${this.escapeString(object.value)}"`;
		if (object.datatype !== undefined && object.lang !== undefined) {
			throw new Error('A literal cannot have both a datatype and a language tag');
		}
		if (object.datatype !== undefined) {
			this.assertSafeSparqlIri(object.datatype, 'datatype IRI');
			return `${lexical}^^<${object.datatype}>`;
		}
		if (object.lang !== undefined) {
			if (!/^[A-Za-z]+(-[A-Za-z0-9]+)*$/.test(object.lang)) {
				throw new Error('Invalid language tag');
			}
			return `${lexical}@${object.lang}`;
		}
		return lexical;
	}

	/** Statement lookup for any fact — IRI or literal object (query-workbench STORY-181). */
	async fetchStatementIriForFact(
		subjectIri: string,
		predicateIri: string,
		object: FactObject,
		namespaceBaseIri: string
	): Promise<string | undefined> {
		this.assertSafeSparqlIri(subjectIri, 'subject IRI');
		this.assertSafeSparqlIri(predicateIri, 'predicate IRI');
		const term = this.factObjectTerm(object);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?stmt WHERE {
				GRAPH <${graphs.instances}> {
					?stmt rdf:subject <${subjectIri}> ; rdf:predicate <${predicateIri}> ; rdf:object ${term} .
				}
			} LIMIT 1
		`);
		return results.results.bindings[0]?.stmt?.value;
	}

	/**
	 * Ensures `<subjectIri> <predicateIri> <objectIri>` (a relation edge's own ground triple, already
	 * written by `insertIndividualClassRelation`/`insertAssertion`) is reified, and returns its
	 * statement IRI (Story 009). IRI-only wrapper over `ensureReifiedFact`.
	 */
	async ensureReifiedStatement(subjectIri: string, predicateIri: string, objectIri: string): Promise<string> {
		return this.ensureReifiedFact(subjectIri, predicateIri, { kind: 'iri', iri: objectIri });
	}

	/**
	 * Ensures a fact (`<subject> <predicate> <object>` with an IRI or literal object) is reified and
	 * returns its statement IRI — reusing an existing reification if there is one, otherwise minting
	 * one (`statementIri`) and writing the four reification quads into the subject's own namespace's
	 * `graphs.instances`. Purely additive metadata: never invents the ground triple itself, which the
	 * caller must already have asserted.
	 */
	async ensureReifiedFact(subjectIri: string, predicateIri: string, object: FactObject): Promise<string> {
		this.assertSafeSparqlIri(subjectIri, 'subject IRI');
		this.assertSafeSparqlIri(predicateIri, 'predicate IRI');
		const term = this.factObjectTerm(object);
		const namespaceBaseIri = await this.findNamespaceOfIndividual(subjectIri);
		const existing = await this.fetchStatementIriForFact(subjectIri, predicateIri, object, namespaceBaseIri);
		if (existing) return existing;
		const timestamp = new Date().toISOString().replace(/[^0-9]/g, '') + (statementCounter++).toString(36);
		const stmt = statementIri(namespaceBaseIri, timestamp);
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${stmt}> a rdf:Statement ; rdf:subject <${subjectIri}> ; rdf:predicate <${predicateIri}> ; rdf:object ${term} .`,
				graphs.instances
			)} }`
		);
		return stmt;
	}

	/**
	 * Every reified `rdf:Statement` across every namespace, labeled from its own subject/predicate/
	 * object (relation-assertions Story 011) — the object typeahead's "Relation instance" kind
	 * (`fetchNameableEntities` below). An unrestricted cross-graph `GRAPH ?g {...}` lookup, mirroring
	 * `fetchMasterSystemsOfClass`'s own pattern, since a reified statement can live in any namespace's
	 * `graphs.instances`. Per the lazy-reification design, this only ever lists relations someone has
	 * already annotated via `ensureReifiedStatement` — a relation with no assertions yet has no
	 * statement IRI to list, which is the accepted tradeoff of minting lazily.
	 */
	async fetchAllReifiedStatements(): Promise<NameableEntity[]> {
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?stmt ?s ?slabel ?p ?plabel ?o ?olabel WHERE {
				GRAPH ?g { ?stmt a rdf:Statement ; rdf:subject ?s ; rdf:predicate ?p ; rdf:object ?o }
				OPTIONAL { GRAPH ?sg { ?s rdfs:label ?slabel } }
				OPTIONAL { GRAPH ?pg { ?p rdfs:label ?plabel } }
				OPTIONAL { GRAPH ?og { ?o rdfs:label ?olabel } }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.stmt.value,
			// A literal object (a reified attribute value) is its own display text, not an IRI to shorten.
			label: `${b.slabel?.value ?? extractLocalName(b.s.value)} ${b.plabel?.value ?? extractLocalName(b.p.value)} ${b.olabel?.value ?? (b.o.type === 'literal' ? b.o.value : extractLocalName(b.o.value))}`,
			kind: 'relationInstance' as const
		}));
	}

	/** Every generalized individual→class relation whose source individual lives in
	 *  `namespaceBaseIri`, across any predicate except `rdf:type`/`rdfs:label`. An object is only
	 *  kept when it's itself declared `a owl:Class` somewhere in the repo — an unrestricted
	 *  cross-graph `GRAPH ?classGraph {...}` lookup so a cross-namespace target (Story 016/017's
	 *  whole point) is found regardless of which namespace's `/schema` graph declares it, mirroring
	 *  `fetchAllIndividuals`'s own "object is a real class" discriminator. Both graph patterns use an
	 *  explicit `GRAPH <...>`/`GRAPH ?var` rather than `fromClause`: a query with any `FROM` but no
	 *  matching `FROM NAMED` makes GraphDB treat the named-graph dataset as empty, which would
	 *  silently make the unrestricted `?classGraph` lookup match nothing. */
	async fetchAllIndividualClassRelations(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedIndividualClassRelation[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?s ?p ?plabel ?class WHERE {
				GRAPH <${graphs.instances}> { ?s ?p ?class }
				GRAPH ?classGraph { ?class a owl:Class }
				FILTER(?p != rdf:type && ?p != rdfs:label)
				OPTIONAL { GRAPH ?pg { ?p rdfs:label ?plabel } }
			}
		`);
		return results.results.bindings.map((b) => ({
			individualIri: b.s.value,
			predicateIri: b.p.value,
			name: b.plabel?.value ?? extractLocalName(b.p.value),
			classIri: b.class.value,
			namespaceBaseIri
		}));
	}

	/** Every generalized individual→individual relation whose source individual lives in
	 *  `namespaceBaseIri` (relation-assertions Sprint 3 Story 007) — the individual-typed-object
	 *  counterpart of `fetchAllIndividualClassRelations`. An object is only kept when it "looks like
	 *  an individual" (mirrors `looksLikeIndividual`/`META_TYPES`: it carries an `rdf:type` triple
	 *  whose object isn't `owl:Class`/`owl:DatatypeProperty`/`owl:ObjectProperty`/`sh:NodeShape`),
	 *  found via the same unrestricted cross-graph `GRAPH ?og {...}` lookup
	 *  `fetchAllIndividualClassRelations` uses for its class check, so a cross-namespace individual
	 *  target is found regardless of which namespace declares it. `SELECT DISTINCT` guards against
	 *  row duplication when the object carries more than one non-meta `rdf:type` (e.g. an inferred
	 *  ancestor class), since `?otype` itself isn't projected. */
	async fetchAllIndividualIndividualRelations(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedIndividualIndividualRelation[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT DISTINCT ?s ?p ?plabel ?o WHERE {
				GRAPH <${graphs.instances}> { ?s ?p ?o }
				GRAPH ?og { ?o a ?otype }
				FILTER(?p != rdf:type && ?p != rdfs:label)
				FILTER(?otype NOT IN (owl:Class, owl:DatatypeProperty, owl:ObjectProperty, sh:NodeShape))
				OPTIONAL { GRAPH ?pg { ?p rdfs:label ?plabel } }
			}
		`);
		return results.results.bindings.map((b) => ({
			individualIri: b.s.value,
			predicateIri: b.p.value,
			name: b.plabel?.value ?? extractLocalName(b.p.value),
			targetIndividualIri: b.o.value,
			namespaceBaseIri
		}));
	}

	// -- Generic instance assertion editor (data-catalog Story 019) -----------------------------
	// Widens Story 017's individual→class relation pattern to an arbitrary object IRI — a class, an
	// attribute (`owl:DatatypeProperty`/`sh:property`), a relation (`owl:ObjectProperty`), or another
	// individual — reusing the same individual-owns-its-own-instances-graph placement
	// (`findNamespaceOfIndividual`) and the same `resolveOrMintPredicate` reuse-or-mint resolution.

	/**
	 * Resolves `predicateLabel` to a declared predicate IRI (`resolveOrMintPredicate`) and asserts
	 * `<individualIri> <predicate> <objectIri>` in the individual's own `graphs.instances`
	 * (data-catalog Story 019) — the object may be any IRI the app can resolve and label (a class, an
	 * attribute, a relation, or another individual), widening Story 017's class-only object type.
	 */
	async insertAssertion(
		individualIri: string,
		predicateLabel: string,
		objectIri: string
	): Promise<{ predicateIri: string }> {
		if (!predicateLabel.trim()) throw new Error('Predicate name must not be empty');
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		this.assertSafeSparqlIri(objectIri, 'object IRI');
		const namespaceBaseIri = await this.findNamespaceOfPossiblyUntypedIndividual(individualIri);
		const predicateIri = await this.resolveOrMintPredicate(predicateLabel, namespaceBaseIri);
		this.assertSafeSparqlIri(predicateIri, 'predicate IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${individualIri}> <${predicateIri}> <${objectIri}> .`, graphs.instances)} }`
		);
		return { predicateIri };
	}

	/** Removes exactly the `<individualIri> <predicateIri> <objectIri>` triple. */
	async deleteAssertion(individualIri: string, predicateIri: string, objectIri: string): Promise<void> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		this.assertSafeSparqlIri(predicateIri, 'predicate IRI');
		this.assertSafeSparqlIri(objectIri, 'object IRI');
		const namespaceBaseIri = await this.findNamespaceOfPossiblyUntypedIndividual(individualIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const cleanup = this.factCleanup(individualIri, predicateIri, `<${objectIri}>`);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.instances)}
			DELETE { <${individualIri}> <${predicateIri}> <${objectIri}> . ${cleanup.template} }
			WHERE { ${cleanup.where} }
		`);
	}

	/**
	 * Every `<predicate, object>` assertion on `individualIri`, excluding `rdf:type`/`rdfs:label`
	 * (data-catalog Story 019) — the generic editor's own CRUD list, an unfiltered-by-target-type
	 * superset of Story 017's narrower individual→class fetch (which remains in place for its own
	 * existing call site). Predicate/object labels are resolved via an unrestricted cross-graph
	 * `GRAPH ?g` lookup, mirroring `fetchAllIndividualClassRelations`'s own pattern, falling back to
	 * the IRI's local name only when nothing declares an `rdfs:label`.
	 *
	 * Also excludes `rdf:subject`/`rdf:predicate`/`rdf:object` (relation-assertions Story 010) — this
	 * method is reused unchanged as the pencil-on-edge relation-assertion form's own CRUD list, scoped
	 * to a reified statement IRI instead of a plain individual IRI. Without this exclusion, a reified
	 * statement's own `rdf:subject`/`rdf:predicate`/`rdf:object` triples would show up as if they were
	 * user-added assertions — deletable through the same "×" button as a real fact, which would corrupt
	 * the reification itself. Harmless no-op for a plain individual, which never carries these
	 * predicates.
	 */
	async fetchAssertionsForIndividual(individualIri: string): Promise<FetchedAssertion[]> {
		this.assertSafeSparqlIri(individualIri, 'individual IRI');
		const namespaceBaseIri = await this.findNamespaceOfPossiblyUntypedIndividual(individualIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?p ?plabel ?o ?olabel WHERE {
				GRAPH <${graphs.instances}> { <${individualIri}> ?p ?o }
				FILTER(?p != rdf:type && ?p != rdfs:label && ?p != rdf:subject && ?p != rdf:predicate && ?p != rdf:object)
				OPTIONAL { GRAPH ?pg { ?p rdfs:label ?plabel } }
				OPTIONAL { GRAPH ?og { ?o rdfs:label ?olabel } }
			}
		`);
		return results.results.bindings.map((b) => ({
			individualIri,
			predicateIri: b.p.value,
			predicateLabel: b.plabel?.value ?? extractLocalName(b.p.value),
			objectIri: b.o.value,
			objectLabel: b.olabel?.value ?? extractLocalName(b.o.value)
		}));
	}

	/**
	 * Aggregating lookup across every nameable thing the app knows how to resolve and display — the
	 * Story 019 object typeahead's data source. Composes `fetchFullSchemaForAllNamespaces` (already
	 * merging every namespace's classes/attributes/relations/individuals) rather than issuing a new
	 * SPARQL query. Deduplicates by IRI: `schema.objectProperties` carries one row per domain a
	 * generic relation is used from (`fetchGenericObjectPropertyEdges`), so the same relation IRI can
	 * otherwise appear more than once and break the typeahead's keyed `{#each ... (o.iri)}`.
	 *
	 * Attribute labels are prefixed with their owning class's own label (`"Application.Name"`, not
	 * bare `"Name"`): `propertyIri` scopes an attribute's IRI to its owning class specifically so two
	 * classes can each have their own same-named attribute without an IRI clash, which means the
	 * bare label alone can't disambiguate them in this flattened, cross-class typeahead list.
	 */
	async fetchNameableEntities(): Promise<NameableEntity[]> {
		const [schema, relationInstances] = await Promise.all([
			this.fetchFullSchemaForAllNamespaces(),
			this.fetchAllReifiedStatements()
		]);
		const classLabelByIri = new Map(schema.classes.map((c) => [c.iri, c.label]));
		const all = [
			...schema.classes.map((c) => ({ iri: c.iri, label: c.label, kind: 'class' as const })),
			...schema.datatypeProperties.map((p) => ({
				iri: p.iri,
				label: classLabelByIri.has(p.domain) ? `${classLabelByIri.get(p.domain)}.${p.label}` : p.label,
				kind: 'attribute' as const
			})),
			...schema.objectProperties.map((p) => ({ iri: p.iri, label: p.label, kind: 'relation' as const })),
			...schema.individuals.map((i) => ({ iri: i.iri, label: i.label, kind: 'individual' as const })),
			...relationInstances
		];
		const byIri = new Map(all.map((e) => [e.iri, e]));
		return [...byIri.values()];
	}

	/**
	 * STORY-080's "Add Element" typeahead data source: `fetchNameableEntities()` narrowed to
	 * `kind ∈ {'class', 'individual'}` — only these are independently addable Workspace members
	 * (research §8). Attributes/relations/relation-instances aren't standalone canvas nodes; external
	 * vocabulary stubs have no `WorkspaceMembership` of their own (`visibility.ts`'s
	 * `isExternalNodeHidden` doc comment).
	 */
	async fetchAddableWorkspaceElements(): Promise<NameableEntity[]> {
		const entities = await this.fetchNameableEntities();
		return entities.filter((e) => e.kind === 'class' || e.kind === 'individual');
	}

	/**
	 * Every labeled `owl:ObjectProperty` usable as a predicate for any individual-involving relation
	 * — the drag-connect individual→class dialog's and the Story 019 assertion editor's predicate
	 * typeahead. Every declared relation is offered, generic *and* domain/range-specific (so an
	 * existing entity-to-entity relation like `gov:systemOfWorkIsMasterFor` is pickable and reused
	 * verbatim), plus every already-used individual→class relation predicate, deduplicated by IRI.
	 * Typing an unlisted name mints a fresh namespace-scoped generic predicate via
	 * `resolveOrMintPredicate`.
	 */
	async fetchRelationPredicateOptions(): Promise<{ iri: string; label: string }[]> {
		const schema = await this.fetchFullSchemaForAllNamespaces();
		const byIri = new Map<string, string>();
		for (const rel of schema.objectProperties) {
			byIri.set(rel.iri, rel.label);
		}
		for (const rel of schema.individualClassRelations) {
			if (!byIri.has(rel.predicateIri)) byIri.set(rel.predicateIri, rel.name);
		}
		return [...byIri.entries()].map(([iri, label]) => ({ iri, label }));
	}

	/**
	 * Resolves a `SystemOfWork` individual's own authority via its `isOperatedBy` edge (data-catalog
	 * Story 020) — an ordinary user-defined generic individual→individual relation authored through
	 * this same Story 019 editor, not a built-in predicate. Looked up by minting `isOperatedBy`'s
	 * predicate IRI under the system's own namespace (mirroring how the relation itself would have
	 * been authored) rather than a label search, since the predicate is namespace-scoped and
	 * deterministic. Returns `null` — never throws — when the system individual can't be found or has
	 * no such edge; this is an optional provenance enrichment, not a mandatory field.
	 *
	 * Public (Sprint 4 Story 012) so `fetchProvenanceReport` below can call it independent of catalog
	 * generation — `generateCatalogForClass`/`buildSplitDatasetOps` remain its other, pre-existing
	 * callers, unaffected by the visibility change.
	 */
	async fetchOperatingAuthority(systemOfWorkIri: string): Promise<string | null> {
		let namespaceBaseIri: string;
		try {
			namespaceBaseIri = await this.findNamespaceOfIndividual(systemOfWorkIri);
		} catch {
			return null;
		}
		const predicateIri = genericPropertyIri('isOperatedBy', namespaceBaseIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?authority WHERE {
				GRAPH <${graphs.instances}> { <${systemOfWorkIri}> <${predicateIri}> ?authority }
			} LIMIT 1
		`);
		return results.results.bindings[0]?.authority?.value ?? null;
	}

	// -- Provenance/contributor report (Sprint 4 Story 012) --------------------------------------
	// A pure read path over data the data-catalog feature already writes (`isMasterFor`/
	// `isOperatedBy` assertions, PROV triples in `graphs.catalog`) — no new RDF vocabulary, no
	// writes. Reuses `fetchMasterSystemsOfClass`/`fetchOperatingAuthority` (the same transitive walk
	// `generateCatalogForClass`/`buildSplitDatasetOps` already use) so a `Backstage`-sourced
	// `SystemOfWork` resolves through the exact same code path as any hand-modeled one — no
	// Backstage-specific branch anywhere in this method.

	/** Labels for a batch of IRIs in one query — `rdfs:label` if declared anywhere (unrestricted
	 *  cross-graph `GRAPH ?g` lookup, mirroring `fetchAllReifiedStatements`' pattern), else the IRI's
	 *  own local name. Empty input short-circuits before issuing a query with an empty `VALUES`
	 *  clause (invalid SPARQL syntax). */
	private async fetchLabelsForIris(iris: string[]): Promise<Map<string, string>> {
		const unique = [...new Set(iris)];
		const labels = new Map<string, string>();
		if (unique.length === 0) return labels;
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?iri ?label WHERE {
				VALUES ?iri { ${unique.map((iri) => `<${iri}>`).join(' ')} }
				OPTIONAL { GRAPH ?g { ?iri rdfs:label ?label } }
			}
		`);
		for (const b of results.results.bindings) {
			labels.set(b.iri.value, b.label?.value ?? extractLocalName(b.iri.value));
		}
		return labels;
	}

	/** The `prov:wasGeneratedBy` → `prov:Activity` timestamp (`endedAtTime`, falling back to
	 *  `startedAtTime`) for a batch of dataset IRIs in `namespaceBaseIri`'s own `graphs.catalog`, in
	 *  one query — `null` (via absence from the returned map) for a dataset that's never been
	 *  generated, which is expected and not an error (Story 012's "no `/catalog` graph data yet" AC). */
	private async fetchDatasetGeneratedAt(
		datasetIris: string[],
		namespaceBaseIri: string
	): Promise<Map<string, string>> {
		const unique = [...new Set(datasetIris)];
		const generatedAt = new Map<string, string>();
		if (unique.length === 0) return generatedAt;
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?dataset ?started ?ended ${fromClause(graphs.catalog)} WHERE {
				VALUES ?dataset { ${unique.map((iri) => `<${iri}>`).join(' ')} }
				?dataset <${PROV.wasGeneratedBy}> ?activity .
				OPTIONAL { ?activity <${PROV.startedAtTime}> ?started }
				OPTIONAL { ?activity <${PROV.endedAtTime}> ?ended }
			}
		`);
		for (const b of results.results.bindings) {
			const value = b.ended?.value ?? b.started?.value;
			if (value) generatedAt.set(b.dataset.value, value);
		}
		return generatedAt;
	}

	/**
	 * Aggregates, per attribute of `classIri`, the resolved `isMasterFor` contributor (its own
	 * attribute-level override if one exists, else the class-level default — Story 020's split-
	 * dataset precedent), the resolved operating authority (`isMasterFor` → `isOperatedBy`), and the
	 * PROV metadata from the last "Generate catalog" run of whichever dataset actually covers that
	 * attribute (its split dataset if overridden, else the class's own parent dataset — mirroring
	 * `buildSplitDatasetOps`' own grouping-by-override-system logic exactly, so this report can never
	 * disagree with what "Generate catalog" itself produced). Story 013's read path — never writes
	 * anything.
	 *
	 * Works correctly (returns partial data, not an error) for a class whose catalog has never been
	 * generated: `fetchDatasetGeneratedAt` simply finds no `prov:wasGeneratedBy` triple for a dataset
	 * IRI that was never minted, leaving `generatedAt: null` on every row.
	 */
	async fetchProvenanceReport(classIri: string): Promise<ProvenanceReport> {
		this.assertSafeSparqlIri(classIri, 'class IRI');
		const namespaceBaseIri = await this.findNamespaceOfClass(classIri);
		const className = extractLocalName(classIri);

		const [classInfo, classMasters, attributes] = await Promise.all([
			this.fetchClassLabelAndComment(classIri, namespaceBaseIri),
			this.fetchMasterSystemsOfClass(classIri),
			this.fetchAllDatatypeProperties(namespaceBaseIri).then((props) =>
				props.filter((p) => p.domain === classIri)
			)
		]);
		const classDefaultMaster = classMasters[0] ?? null;

		const attributeMasters = await Promise.all(
			attributes.map((attr) => this.fetchMasterSystemsOfClass(attr.iri))
		);

		type Resolved = { master: { iri: string; label: string } | null; isAttributeOverride: boolean };
		const resolved: Resolved[] = attributeMasters.map((masters) =>
			masters[0]
				? { master: masters[0], isAttributeOverride: true }
				: { master: classDefaultMaster, isAttributeOverride: false }
		);

		const authorityIris = await Promise.all(
			resolved.map((r) => (r.master ? this.fetchOperatingAuthority(r.master.iri) : Promise.resolve(null)))
		);

		const datasetForAttribute = resolved.map((r) =>
			r.isAttributeOverride && r.master
				? splitDatasetIri(namespaceBaseIri, className, extractLocalName(r.master.iri))
				: datasetIri(namespaceBaseIri, className)
		);
		const [authorityLabels, generatedAtByDataset] = await Promise.all([
			this.fetchLabelsForIris(authorityIris.filter((iri): iri is string => iri !== null)),
			this.fetchDatasetGeneratedAt(datasetForAttribute, namespaceBaseIri)
		]);

		return {
			classIri,
			className: classInfo.label,
			attributes: attributes.map((attr, i) => ({
				attributeIri: attr.iri,
				attributeLabel: attr.label,
				masterIri: resolved[i].master?.iri ?? null,
				masterLabel: resolved[i].master?.label ?? null,
				isAttributeOverride: resolved[i].isAttributeOverride,
				authorityIri: authorityIris[i],
				authorityLabel: authorityIris[i] ? (authorityLabels.get(authorityIris[i]!) ?? null) : null,
				generatedAt: generatedAtByDataset.get(datasetForAttribute[i]) ?? null
			}))
		};
	}

	// -- Catalog generation, edit & save (data-catalog Stories 008/009/010/011/012) -------------
	// One `dcat:Dataset` per `AuthoritativeEntity` subclass, written into `graphs.catalog` of the
	// class's own namespace. `generateCatalogForClass` is the single "Generate catalog" entry point
	// for both first-generation (Story 008) and regeneration (Story 012): on first run it writes the
	// full inferable+placeholder set; on every later run it merges by predicate, touching only the
	// generator-owned fields (identity/title/description/conformsTo/prov chain) and leaving
	// `dct:publisher`/`dct:license`/`dcat:distribution`/`dcat:theme`/`dcat:keyword` — whatever a
	// human already entered — untouched, per the plan's highest-risk-item mitigation. The Catalog
	// tab's own free-form "Save" (`saveCatalogTurtleForClass`) is a *different* operation: a
	// full-scope overwrite of the user's hand-edited draft, exactly mirroring how Schema/Shapes'
	// `saveScopedTurtle` already works — it must never re-derive fields from the schema itself,
	// or every manual edit would be silently reverted on next generate.

	/** Predicates `generateCatalogForClass` owns and re-syncs on every regeneration (Story 012) —
	 *  every other predicate on a dataset subject (`dct:publisher`, `dct:license`,
	 *  `dcat:distribution`, `dcat:theme`, `dcat:keyword`) is never touched by generation. */
	private static readonly GENERATOR_OWNED_DATASET_PREDICATES = [
		RDF.type,
		DCT.identifier,
		DCT.title,
		DCT.description,
		DCT.conformsTo,
		PROV.wasAttributedTo,
		PROV.wasDerivedFrom,
		PROV.wasGeneratedBy
	];

	/** Predicates a split dataset's own regeneration owns and re-syncs (data-catalog Story 020) —
	 *  mirrors `GENERATOR_OWNED_DATASET_PREDICATES`, plus `dct:isPartOf` (the split dataset's own
	 *  generator-derived link back to its parent, unlike the parent dataset which has no such link).
	 *  `dct:publisher`/`dct:license`/`dcat:distribution` are, again, never touched once seeded. */
	private static readonly SPLIT_DATASET_GENERATOR_OWNED_PREDICATES = [
		RDF.type,
		DCT.identifier,
		DCT.title,
		DCT.description,
		DCT.conformsTo,
		DCT.isPartOf,
		PROV.wasAttributedTo,
		PROV.wasDerivedFrom,
		PROV.wasGeneratedBy
	];

	/** Idempotently ensures `<catalogIri> a dcat:Catalog` exists for a namespace — one container
	 *  per namespace, reused across every class's generation run (mirrors
	 *  `ensureAttributedRelationshipClass`'s ASK-then-INSERT shape). */
	async ensureCatalogContainer(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<void> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const catalog = catalogIri(namespaceBaseIri);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.catalog)} { <${catalog}> a <${DCAT.Catalog}> }`
		);
		if (exists) return;
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${catalog}> a <${DCAT.Catalog}> .`, graphs.catalog)} }`
		);
	}

	/** A class's own `rdfs:label`/`rdfs:comment`, the inputs `generateCatalogForClass` derives
	 *  `dct:title`/`dct:description` from. */
	private async fetchClassLabelAndComment(
		classIriValue: string,
		namespaceBaseIri: string
	): Promise<{ label: string; comment: string | null }> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?label ?comment ${fromClause(graphs.schema)} WHERE {
				OPTIONAL { <${classIriValue}> rdfs:label ?label }
				OPTIONAL { <${classIriValue}> rdfs:comment ?comment }
			}
		`);
		const b = results.results.bindings[0];
		return { label: b?.label?.value ?? extractLocalName(classIriValue), comment: b?.comment?.value ?? null };
	}

	/**
	 * Generates (first run) or regenerates (every later run) the DCAT catalog entry for an
	 * `AuthoritativeEntity` subclass (data-catalog Stories 008/012). Computes exactly the inferable
	 * triples — `dcat:Dataset` typing, `dct:identifier`/`dct:title`/`dct:description`/
	 * `dct:conformsTo`, the `prov:wasAttributedTo`/`wasDerivedFrom` pair per `isMasterFor` assertion
	 * (omitted entirely when none exists — optional metadata, not a mandatory placeholder), and a
	 * fresh `prov:wasGeneratedBy` → `prov:Activity` individual on every single run (never reused or
	 * mutated in place, so each run keeps its own provenance record).
	 *
	 * First run only: pre-fills `dct:publisher`/`dct:license` from the namespace's own default when
	 * one is set (otherwise an empty placeholder literal, `""`), and always emits one placeholder
	 * `dcat:Distribution` (`dct:format`/`dcat:mediaType`/`dcat:accessURL` all `""`) — `dcat:theme` is
	 * deliberately never populated (no taxonomy source to infer it from; see Story 008). Every later
	 * run leaves all of that alone: only `GENERATOR_OWNED_DATASET_PREDICATES` is deleted and
	 * reinserted, so a user-entered publisher/license/distribution survives regeneration regardless
	 * of whether the namespace default it may have been seeded from later changes.
	 */
	async generateCatalogForClass(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ datasetIri: string }> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const className = extractLocalName(classIriValue);
		const dataset = datasetIri(namespaceBaseIri, className);
		const catalog = catalogIri(namespaceBaseIri);

		await this.ensureCatalogContainer(namespaceBaseIri);

		const [classInfo, masters, namespaces, exists] = await Promise.all([
			this.fetchClassLabelAndComment(classIriValue, namespaceBaseIri),
			this.fetchMasterSystemsOfClass(classIriValue),
			this.fetchNamespaces(),
			this.askQuery(`${PREFIXES} ASK ${fromClause(graphs.catalog)} { <${dataset}> a <${DCAT.Dataset}> }`)
		]);
		const ns = namespaces.find((n) => n.baseIri === namespaceBaseIri);

		const nowIso = new Date().toISOString();
		const timestamp = nowIso.replace(/[^0-9]/g, '');
		const activity = publicationActivityIri(namespaceBaseIri, className, timestamp);
		const identifier = `${ns?.prefix ? kebabCase(ns.prefix) : 'catalog'}-${kebabCase(className)}`;

		const generatorTriples: string[] = [
			`<${dataset}> a <${DCAT.Dataset}> .`,
			`<${dataset}> <${DCT.identifier}> "${this.escapeString(identifier)}" .`,
			`<${dataset}> <${DCT.title}> "${this.escapeString(classInfo.label)}" .`
		];
		if (classInfo.comment) {
			generatorTriples.push(`<${dataset}> <${DCT.description}> "${this.escapeString(classInfo.comment)}" .`);
		}
		generatorTriples.push(`<${dataset}> <${DCT.conformsTo}> <${classIriValue}> .`);
		for (const master of masters) {
			generatorTriples.push(`<${dataset}> <${PROV.wasAttributedTo}> <${master.iri}> .`);
			generatorTriples.push(`<${dataset}> <${PROV.wasDerivedFrom}> <${master.iri}> .`);
		}
		generatorTriples.push(`<${dataset}> <${PROV.wasGeneratedBy}> <${activity}> .`);
		generatorTriples.push(`<${activity}> a <${PROV.Activity}> .`);
		generatorTriples.push(`<${activity}> <${PROV.startedAtTime}> "${nowIso}"^^xsd:dateTime .`);
		generatorTriples.push(`<${activity}> <${PROV.endedAtTime}> "${nowIso}"^^xsd:dateTime .`);

		const ops: string[] = [];
		if (exists) {
			for (const predicate of SparqlConnector.GENERATOR_OWNED_DATASET_PREDICATES) {
				ops.push(`DELETE WHERE { ${inGraph(`<${dataset}> <${predicate}> ?o .`, graphs.catalog)} }`);
			}
		}
		ops.push(`INSERT DATA { ${inGraph(generatorTriples.join(' '), graphs.catalog)} }`);

		if (!exists) {
			const distribution = distributionIri(namespaceBaseIri, className);
			const publisherTriple = ns?.publisher
				? `<${dataset}> <${DCT.publisher}> "${this.escapeString(ns.publisher)}" .`
				: `<${dataset}> <${DCT.publisher}> "" .`;
			const licenseTriple = ns?.license
				? `<${dataset}> <${DCT.license}> <${ns.license}> .`
				: `<${dataset}> <${DCT.license}> "" .`;
			const placeholderTriples = [
				publisherTriple,
				licenseTriple,
				`<${dataset}> <${DCAT.distribution}> <${distribution}> .`,
				`<${distribution}> a <${DCAT.Distribution}> .`,
				`<${distribution}> <${DCT.format}> "" .`,
				`<${distribution}> <${DCAT.mediaType}> "" .`,
				`<${distribution}> <${DCAT.accessURL}> "" .`,
				`<${catalog}> <${DCAT.dataset}> <${dataset}> .`
			];
			ops.push(`INSERT DATA { ${inGraph(placeholderTriples.join(' '), graphs.catalog)} }`);
		}

		ops.push(
			...(await this.buildSplitDatasetOps(
				classIriValue,
				namespaceBaseIri,
				className,
				classInfo.label,
				dataset,
				nowIso,
				timestamp
			))
		);

		await this.executeUpdate(`${PREFIXES} ${ops.join(' ; ')}`);
		return { datasetIri: dataset };
	}

	/**
	 * Data-catalog Story 020: computes the SPARQL update fragments for every attribute-level
	 * `isMasterFor` override's own split `dcat:Dataset`, appended to `generateCatalogForClass`'s own
	 * `ops`. Attributes sharing a non-default master-system override are grouped into one dataset per
	 * distinct overriding system (not per attribute) — the entity's own default dataset needs no
	 * change to exclude them, since it never enumerates attributes at all (out of scope per the
	 * plan's own ADR). Merge-aware per split dataset, mirroring the parent dataset's own regeneration
	 * shape: an existing split dataset only has `SPLIT_DATASET_GENERATOR_OWNED_PREDICATES` deleted/
	 * reinserted; `dct:publisher`/`dct:license`/`dcat:distribution` are seeded once, on first
	 * creation, and never touched again. A split dataset whose override no longer exists on any
	 * attribute is deleted outright — its attribute(s) fold back into the entity's default dataset,
	 * which already covers them without any change of its own.
	 */
	private async buildSplitDatasetOps(
		classIriValue: string,
		namespaceBaseIri: string,
		className: string,
		classLabel: string,
		parentDataset: string,
		nowIso: string,
		timestamp: string
	): Promise<string[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const attributes = (await this.fetchAllDatatypeProperties(namespaceBaseIri)).filter(
			(p) => p.domain === classIriValue
		);

		const overrideGroups = new Map<string, { iri: string; label: string }>();
		if (attributes.length > 0) {
			const overridesByAttribute = await Promise.all(
				attributes.map((attr) => this.fetchMasterSystemsOfClass(attr.iri))
			);
			for (const masters of overridesByAttribute) {
				const system = masters[0];
				if (system && !overrideGroups.has(system.iri)) {
					overrideGroups.set(system.iri, { iri: system.iri, label: system.label });
				}
			}
		}

		const existingLinks = await this.selectQuery(`
			${PREFIXES} SELECT ?split ${fromClause(graphs.catalog)} WHERE { ?split <${DCT.isPartOf}> <${parentDataset}> }
		`);
		const existingSplitIris = new Set(existingLinks.results.bindings.map((b) => b.split.value));
		const requiredSplitIris = new Set<string>();
		const ops: string[] = [];

		for (const system of overrideGroups.values()) {
			const systemLocalName = extractLocalName(system.iri);
			const splitDataset = splitDatasetIri(namespaceBaseIri, className, systemLocalName);
			requiredSplitIris.add(splitDataset);

			const splitExists =
				existingSplitIris.has(splitDataset) ||
				(await this.askQuery(
					`${PREFIXES} ASK ${fromClause(graphs.catalog)} { <${splitDataset}> a <${DCAT.Dataset}> }`
				));
			const authority = await this.fetchOperatingAuthority(system.iri);
			const splitActivity = publicationActivityIri(namespaceBaseIri, `${className}${systemLocalName}`, timestamp);
			const splitIdentifier = `${kebabCase(className)}-${kebabCase(system.label)}`;

			const splitTriples: string[] = [
				`<${splitDataset}> a <${DCAT.Dataset}> .`,
				`<${splitDataset}> <${DCT.identifier}> "${this.escapeString(splitIdentifier)}" .`,
				`<${splitDataset}> <${DCT.title}> "${this.escapeString(classLabel)} — ${this.escapeString(system.label)}" .`,
				`<${splitDataset}> <${DCT.description}> "Attributes of ${this.escapeString(classLabel)} mastered independently by ${this.escapeString(system.label)}." .`,
				`<${splitDataset}> <${DCT.conformsTo}> <${classIriValue}> .`,
				`<${splitDataset}> <${DCT.isPartOf}> <${parentDataset}> .`,
				`<${splitDataset}> <${PROV.wasAttributedTo}> <${system.iri}> .`,
				`<${splitDataset}> <${PROV.wasDerivedFrom}> <${system.iri}> .`
			];
			if (authority) {
				splitTriples.push(`<${splitDataset}> <${PROV.wasAttributedTo}> <${authority}> .`);
			}
			splitTriples.push(`<${splitDataset}> <${PROV.wasGeneratedBy}> <${splitActivity}> .`);
			splitTriples.push(`<${splitActivity}> a <${PROV.Activity}> .`);
			splitTriples.push(`<${splitActivity}> <${PROV.startedAtTime}> "${nowIso}"^^xsd:dateTime .`);
			splitTriples.push(`<${splitActivity}> <${PROV.endedAtTime}> "${nowIso}"^^xsd:dateTime .`);

			if (splitExists) {
				for (const predicate of SparqlConnector.SPLIT_DATASET_GENERATOR_OWNED_PREDICATES) {
					ops.push(`DELETE WHERE { ${inGraph(`<${splitDataset}> <${predicate}> ?o .`, graphs.catalog)} }`);
				}
			}
			ops.push(`INSERT DATA { ${inGraph(splitTriples.join(' '), graphs.catalog)} }`);

			if (!splitExists) {
				const splitDistribution = splitDistributionIri(namespaceBaseIri, className, systemLocalName);
				const placeholderTriples = [
					`<${splitDataset}> <${DCT.publisher}> "" .`,
					`<${splitDataset}> <${DCT.license}> "" .`,
					`<${splitDataset}> <${DCAT.distribution}> <${splitDistribution}> .`,
					`<${splitDistribution}> a <${DCAT.Distribution}> .`,
					`<${splitDistribution}> <${DCT.format}> "" .`,
					`<${splitDistribution}> <${DCAT.mediaType}> "" .`,
					`<${splitDistribution}> <${DCAT.accessURL}> "" .`
				];
				ops.push(`INSERT DATA { ${inGraph(placeholderTriples.join(' '), graphs.catalog)} }`);
			}
		}

		for (const splitIri of existingSplitIris) {
			if (requiredSplitIris.has(splitIri)) continue;
			ops.push(
				`DELETE WHERE { ${inGraph(`<${splitIri}> <${DCAT.distribution}> ?dist . ?dist ?dp ?do .`, graphs.catalog)} }`
			);
			ops.push(`DELETE WHERE { ${inGraph(`<${splitIri}> ?p ?o .`, graphs.catalog)} }`);
		}

		return ops;
	}

	/** Fetches the current whole `graphs.catalog` content of a namespace as quads — the shared
	 *  building block `fetchCatalogTurtleForClass`/`saveCatalogTurtleForClass` both scope down via
	 *  `selectCatalogScope`. */
	private async fetchCatalogGraphQuads(namespaceBaseIri: string): Promise<Quad[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(
			`SELECT ?s ?p ?o ${fromClause(graphs.catalog)} WHERE { ?s ?p ?o }`,
			{ infer: false }
		);
		return results.results.bindings.map((b) => bindingToQuad(b));
	}

	/** The Catalog tab's read path (Story 009): a class's own generated catalog entry, scoped via
	 *  `selectCatalogScope`, serialized as Turtle. Returns `''` when nothing has been generated yet
	 *  for this class — the Catalog tab shows an empty/prompt state rather than an error. */
	async fetchCatalogTurtleForClass(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const dataset = datasetIri(namespaceBaseIri, extractLocalName(classIriValue));
		const catalogQuads = await this.fetchCatalogGraphQuads(namespaceBaseIri);
		const scoped = selectCatalogScope(catalogQuads, dataset);
		if (scoped.length === 0) return '';
		const [namespaces, externalVocabularies] = await Promise.all([
			this.fetchNamespaces(),
			this.fetchExternalVocabularies()
		]);
		return quadsToTurtle(scoped, buildDisplayPrefixes(namespaces, externalVocabularies));
	}

	/**
	 * The Catalog tab's write path (Stories 009/010): parses `turtleText`, validates it against
	 * `checkCatalogStructural` (syntax + catalog-specific structural checks only — never
	 * `checkStructural`/`checkShaclWellFormedness`, which are OWL/RDFS/SHACL-shaped checks that
	 * don't apply to DCAT/PROV data), and — only if valid — replaces the class's whole catalog scope
	 * (`selectCatalogScope`) with the parsed content, exactly mirroring `saveScopedTurtle`'s
	 * full-scope-overwrite semantics for Schema/Shapes. Unlike `generateCatalogForClass`, this never
	 * re-derives anything from the schema — it persists verbatim whatever the user's draft says.
	 */
	async saveCatalogTurtleForClass(
		classIriValue: string,
		turtleText: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const dataset = datasetIri(namespaceBaseIri, extractLocalName(classIriValue));

		let newQuads: Quad[];
		try {
			newQuads = parseTurtle(turtleText);
		} catch (err) {
			throw new SchemaValidationError([
				{ layer: 'syntax', message: err instanceof Error ? err.message : String(err) }
			]);
		}

		const issues = checkCatalogStructural(newQuads);
		if (issues.length > 0) throw new SchemaValidationError(issues);

		const catalogQuads = await this.fetchCatalogGraphQuads(namespaceBaseIri);
		const oldScope = selectCatalogScope(catalogQuads, dataset);
		const oldSubjects = [...new Set(oldScope.map((q) => q.subject.value))];

		const deleteOps = oldSubjects.map(
			(s) => `DELETE WHERE { ${inGraph(`<${s}> ?p ?o .`, graphs.catalog)} }`
		);
		const insertBody = await quadsToGroundTriples(newQuads);
		const insertOp = insertBody.trim() ? `INSERT DATA { ${inGraph(insertBody, graphs.catalog)} }` : '';
		const ops = [...deleteOps, insertOp].filter(Boolean).join(' ; ');
		if (ops) {
			await this.executeUpdate(`${PREFIXES} ${ops}`);
		}
	}

	/** Sets, replaces, or (passing `null`/empty) removes a class's per-entity `dct:publisher`
	 *  override (data-catalog Story 011) — a plain literal, written directly onto the dataset
	 *  subject, mirroring `updateClassDescription`'s DELETE/INSERT-WHERE shape. Never touched by
	 *  `generateCatalogForClass` regeneration (not in `GENERATOR_OWNED_DATASET_PREDICATES`). */
	async setCatalogPublisher(
		classIriValue: string,
		publisher: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const dataset = datasetIri(namespaceBaseIri, extractLocalName(classIriValue));
		const trimmed = publisher?.trim();
		const value = trimmed ? `"${this.escapeString(trimmed)}"` : '""';

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.catalog)}
			DELETE { <${dataset}> <${DCT.publisher}> ?old }
			INSERT { <${dataset}> <${DCT.publisher}> ${value} }
			WHERE { OPTIONAL { <${dataset}> <${DCT.publisher}> ?old } }
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a class's per-entity `dct:license`
	 *  override (data-catalog Story 011) — a well-formed IRI (validated by the caller/UI via
	 *  `isWellFormedIri`), mirrors `setCatalogPublisher`. */
	async setCatalogLicense(
		classIriValue: string,
		licenseIri: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const dataset = datasetIri(namespaceBaseIri, extractLocalName(classIriValue));
		const trimmed = licenseIri?.trim();
		if (trimmed) this.assertSafeSparqlIri(trimmed, 'license IRI');
		const value = trimmed ? `<${trimmed}>` : '""';

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.catalog)}
			DELETE { <${dataset}> <${DCT.license}> ?old }
			INSERT { <${dataset}> <${DCT.license}> ${value} }
			WHERE { OPTIONAL { <${dataset}> <${DCT.license}> ?old } }
		`);
	}

	/**
	 * Replaces a class's one `dcat:Distribution` block (data-catalog Story 011) —
	 * `dct:format`/`dcat:mediaType`/`dcat:accessURL`, each a well-formed IRI (validated by the
	 * caller/UI) or `null`/empty for "still a placeholder". Targets the deterministic
	 * `distributionIri` node so repeated submissions overwrite the same node's fields rather than
	 * accumulating new distributions. Never touched by regeneration.
	 */
	async setCatalogDistribution(
		classIriValue: string,
		fields: { format: string | null; mediaType: string | null; accessURL: string | null },
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const className = extractLocalName(classIriValue);
		const dataset = datasetIri(namespaceBaseIri, className);
		const distribution = distributionIri(namespaceBaseIri, className);

		const iriOrPlaceholder = (value: string | null, fieldName: string): string => {
			const trimmed = value?.trim();
			if (!trimmed) return '""';
			this.assertSafeSparqlIri(trimmed, fieldName);
			return `<${trimmed}>`;
		};

		const formatValue = iriOrPlaceholder(fields.format, 'distribution format IRI');
		const mediaTypeValue = iriOrPlaceholder(fields.mediaType, 'distribution mediaType IRI');
		const accessURLValue = iriOrPlaceholder(fields.accessURL, 'distribution accessURL IRI');

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.catalog)}
			DELETE {
				<${dataset}> <${DCAT.distribution}> <${distribution}> .
				<${distribution}> ?p ?o .
			}
			INSERT {
				<${dataset}> <${DCAT.distribution}> <${distribution}> .
				<${distribution}> a <${DCAT.Distribution}> .
				<${distribution}> <${DCT.format}> ${formatValue} .
				<${distribution}> <${DCAT.mediaType}> ${mediaTypeValue} .
				<${distribution}> <${DCAT.accessURL}> ${accessURLValue} .
			}
			WHERE { OPTIONAL { <${distribution}> ?p ?o } }
		`);
	}

	// -- Namespace management (STORY-027) -------------------------------------------------------

	/** Idempotently ensures `<SCHEMA_NAMESPACE>Namespace a owl:Class` exists — mirrors
	 *  `ensureAttributedRelationshipClass`'s `ASK`-then-`INSERT DATA` shape. Always lives in the
	 *  default namespace's `/schema` graph, alongside `AttributedRelationship`. */
	async ensureNamespaceClass(): Promise<void> {
		const exists = await this.classExists(NAMESPACE_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${NAMESPACE_CLASS_IRI}> a owl:Class ; rdfs:label "Namespace" .`, graphs.schema)} }`
		);
	}

	/** Every registered namespace: `{baseIri, prefix, description}`, read from the default
	 *  namespace's `/schema` graph. */
	async fetchNamespaces(): Promise<FetchedNamespace[]> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?ns ?prefix ?desc ?color ?publisher ?license ?locked ?defaultHidden ?listedInFilter ${fromClause(graphs.schema)} WHERE {
				?ns a <${NAMESPACE_CLASS_IRI}> .
				OPTIONAL { ?ns <${NAMESPACE_PREFIX_PREDICATE_IRI}> ?prefix }
				OPTIONAL { ?ns rdfs:comment ?desc }
				OPTIONAL { ?ns <${NAMESPACE_COLOR_PREDICATE_IRI}> ?color }
				OPTIONAL { ?ns <${DCT.publisher}> ?publisher }
				OPTIONAL { ?ns <${DCT.license}> ?license }
				OPTIONAL { ?ns <${NAMESPACE_LOCKED_PREDICATE_IRI}> ?locked }
				OPTIONAL { ?ns <${NAMESPACE_DEFAULT_HIDDEN_PREDICATE_IRI}> ?defaultHidden }
				OPTIONAL { ?ns <${NAMESPACE_LISTED_IN_FILTER_PREDICATE_IRI}> ?listedInFilter }
			}
		`);
		return results.results.bindings.map((b) => ({
			baseIri: b.ns.value,
			prefix: b.prefix?.value ?? '',
			description: b.desc?.value ?? null,
			color: b.color?.value ?? null,
			publisher: b.publisher?.value ?? null,
			license: b.license?.value ?? null,
			locked: b.locked?.value === 'true',
			defaultHidden: b.defaultHidden ? b.defaultHidden.value === 'true' : b.ns.value === DEFAULT_NAMESPACE_BASE_IRI,
			listedInFilter: b.listedInFilter ? b.listedInFilter.value === 'true' : true
		}));
	}

	/**
	 * Registers a namespace: `<baseIri> a <SCHEMA_NAMESPACE>Namespace ;
	 * <SCHEMA_NAMESPACE>prefix "<prefix>" ; rdfs:comment "<description>"`, in the default
	 * namespace's `/schema` graph (Decision 4) — `baseIri` itself is the subject of its own
	 * declaration triple, not a separately-minted identifier.
	 */
	async insertNamespace(
		prefix: string,
		baseIri: string,
		description?: string,
		color?: string,
		publisher?: string,
		license?: string
	): Promise<{ baseIri: string }> {
		if (!prefix.trim()) throw new Error('Namespace prefix must not be empty');
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		await this.ensureNamespaceClass();

		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${baseIri}> a <${NAMESPACE_CLASS_IRI}> }`
		);
		if (exists) {
			throw new Error(`A namespace with base IRI "${baseIri}" already exists`);
		}

		const escapedPrefix = this.escapeString(prefix.trim());
		const trimmedDescription = description?.trim();
		const commentTriple = trimmedDescription
			? ` ; rdfs:comment "${this.escapeString(trimmedDescription)}"`
			: '';
		const trimmedColor = color?.trim();
		const colorTriple = trimmedColor
			? ` ; <${NAMESPACE_COLOR_PREDICATE_IRI}> "${this.escapeString(trimmedColor)}"`
			: '';
		const trimmedPublisher = publisher?.trim();
		const publisherTriple = trimmedPublisher
			? ` ; <${DCT.publisher}> "${this.escapeString(trimmedPublisher)}"`
			: '';
		const trimmedLicense = license?.trim();
		if (trimmedLicense) this.assertSafeSparqlIri(trimmedLicense, 'license IRI');
		const licenseTriple = trimmedLicense ? ` ; <${DCT.license}> <${trimmedLicense}>` : '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${baseIri}> a <${NAMESPACE_CLASS_IRI}> ; <${NAMESPACE_PREFIX_PREDICATE_IRI}> "${escapedPrefix}"${commentTriple}${colorTriple}${publisherTriple}${licenseTriple} .`,
				graphs.schema
			)} }`
		);
		return { baseIri };
	}

	/** Sets, replaces, or (passing `null`/empty) removes a namespace's `rdfs:comment` — mirrors
	 *  `updateClassDescription`. */
	async updateNamespaceDescription(baseIri: string, description: string | null): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const trimmed = description?.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${baseIri}> rdfs:comment ?old`, graphs.schema)} }`
			);
			return;
		}

		const escaped = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${baseIri}> rdfs:comment ?old }
			INSERT { <${baseIri}> rdfs:comment "${escaped}" }
			WHERE { OPTIONAL { <${baseIri}> rdfs:comment ?old } }
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a namespace's default color (STORY-042) —
	 *  mirrors `updateNamespaceDescription`. */
	async updateNamespaceColor(baseIri: string, color: string | null): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const trimmed = color?.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${baseIri}> <${NAMESPACE_COLOR_PREDICATE_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}

		const escaped = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${baseIri}> <${NAMESPACE_COLOR_PREDICATE_IRI}> ?old }
			INSERT { <${baseIri}> <${NAMESPACE_COLOR_PREDICATE_IRI}> "${escaped}" }
			WHERE { OPTIONAL { <${baseIri}> <${NAMESPACE_COLOR_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a namespace's default `dct:publisher`
	 *  (data-catalog Story 011) — a plain literal, mirrors `updateNamespaceDescription`. Reuses the
	 *  `DCT.publisher` predicate directly on the namespace's own declaration subject rather than a
	 *  new app-authored predicate, per the story's "join that same subject/graph as two more
	 *  optional properties" decision. */
	async updateNamespacePublisher(baseIri: string, publisher: string | null): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const trimmed = publisher?.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${baseIri}> <${DCT.publisher}> ?old`, graphs.schema)} }`
			);
			return;
		}

		const escaped = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${baseIri}> <${DCT.publisher}> ?old }
			INSERT { <${baseIri}> <${DCT.publisher}> "${escaped}" }
			WHERE { OPTIONAL { <${baseIri}> <${DCT.publisher}> ?old } }
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a namespace's default `dct:license`
	 *  (data-catalog Story 011) — a well-formed IRI (validated by the caller/UI, see
	 *  `isWellFormedIri`), mirrors `updateNamespacePublisher`. */
	async updateNamespaceLicense(baseIri: string, licenseIri: string | null): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const trimmed = licenseIri?.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${baseIri}> <${DCT.license}> ?old`, graphs.schema)} }`
			);
			return;
		}

		this.assertSafeSparqlIri(trimmed, 'license IRI');
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${baseIri}> <${DCT.license}> ?old }
			INSERT { <${baseIri}> <${DCT.license}> <${trimmed}> }
			WHERE { OPTIONAL { <${baseIri}> <${DCT.license}> ?old } }
		`);
	}

	/** Sets or clears a namespace's `locked` flag (STORY-095) — mirrors `updateNamespaceColor`'s
	 *  shape, but always writes an explicit `xsd:boolean` (never removes the triple entirely, since
	 *  "unlocked" is itself a meaningful, always-present value here, unlike the optional color/
	 *  publisher/license fields). */
	async updateNamespaceLocked(baseIri: string, locked: boolean): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${baseIri}> <${NAMESPACE_LOCKED_PREDICATE_IRI}> ?old }
			INSERT { <${baseIri}> <${NAMESPACE_LOCKED_PREDICATE_IRI}> ${locked} }
			WHERE { OPTIONAL { <${baseIri}> <${NAMESPACE_LOCKED_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Sets or clears a namespace's `defaultHidden` flag (STORY-096) — mirrors
	 *  `updateNamespaceLocked`'s always-explicit-boolean shape. */
	async updateNamespaceDefaultHidden(baseIri: string, hidden: boolean): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${baseIri}> <${NAMESPACE_DEFAULT_HIDDEN_PREDICATE_IRI}> ?old }
			INSERT { <${baseIri}> <${NAMESPACE_DEFAULT_HIDDEN_PREDICATE_IRI}> ${hidden} }
			WHERE { OPTIONAL { <${baseIri}> <${NAMESPACE_DEFAULT_HIDDEN_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Sets or clears a namespace's `listedInFilter` flag (STORY-097) — mirrors
	 *  `updateNamespaceLocked`'s always-explicit-boolean shape. */
	async updateNamespaceListedInFilter(baseIri: string, listed: boolean): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${baseIri}> <${NAMESPACE_LISTED_IN_FILTER_PREDICATE_IRI}> ?old }
			INSERT { <${baseIri}> <${NAMESPACE_LISTED_IN_FILTER_PREDICATE_IRI}> ${listed} }
			WHERE { OPTIONAL { <${baseIri}> <${NAMESPACE_LISTED_IN_FILTER_PREDICATE_IRI}> ?old } }
		`);
	}

	/**
	 * Deletes a namespace: refused (returning the total triple count across its three graphs)
	 * unless `{ force: true }` is passed, mirroring `deleteClass`'s `{force?}` pattern (Decision
	 * 5). `force: true` drops all three of the namespace's graphs (`<base>`, `<base>/schema`,
	 * `<base>/shapes`) and its own declaration triple — the two are checked/dropped independently
	 * (deleting the declaration triple never depends on whether the data graphs are empty).
	 *
	 * `locked` (STORY-095) is a separate, unconditional gate checked *before* any of the above —
	 * `force` never overrides it (plan.md ADR: "Locked is an absolute block"). The only way to
	 * delete a locked namespace is to clear the flag via `updateNamespaceLocked` first.
	 */
	async deleteNamespace(
		baseIri: string,
		options?: { force?: boolean }
	): Promise<{ deleted: boolean; entryCount: number; locked?: boolean }> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(baseIri);
		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

		const isLocked = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(defaultGraphs.schema)} { <${baseIri}> <${NAMESPACE_LOCKED_PREDICATE_IRI}> true }`
		);
		if (isLocked) {
			return { deleted: false, entryCount: 0, locked: true };
		}

		const countResult = await this.selectQuery(
			`SELECT (COUNT(*) AS ?c) ${fromClause(graphs.instances, graphs.schema, graphs.shapes)} WHERE { ?s ?p ?o }`
		);
		const entryCount = parseInt(countResult.results.bindings[0]?.c.value ?? '0', 10);

		if (entryCount > 0 && !options?.force) {
			return { deleted: false, entryCount };
		}

		if (entryCount > 0) {
			// STORY-081: cleans up every WorkspaceMembership row referencing a class or individual the
			// DROP GRAPHs below are about to remove — joined into the same update, ahead of them, since
			// it depends on the classes/individuals still existing to match against.
			const workspaceCleanup = `
				DELETE { ${inGraph('?m ?p ?o .', defaultGraphs.schema)} }
				WHERE {
					{ ${inGraph('?el a owl:Class .', graphs.schema)} }
					UNION
					{ ${inGraph('?el ?p2 ?o2 .', graphs.instances)} }
					${inGraph(`?m <${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?el ; ?p ?o .`, defaultGraphs.schema)}
				}
			`;
			// STORY-083: parallel cleanup, but an *unlink* (not a delete) — every Note's
			// `noteLinkedElement` pointing at a class/individual this namespace's DROP GRAPHs are about
			// to remove is cleared, leaving the Note itself (and its text/color/position) untouched.
			const noteUnlinkCleanup = `
					DELETE { ${inGraph(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?el .`, defaultGraphs.schema)} }
					WHERE {
						{ ${inGraph('?el a owl:Class .', graphs.schema)} }
						UNION
						{ ${inGraph('?el ?p2 ?o2 .', graphs.instances)} }
						${inGraph(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?el .`, defaultGraphs.schema)}
					}
				`;
			await this.executeUpdate(
				`${PREFIXES} ${workspaceCleanup} ; ${noteUnlinkCleanup} ; ` +
					[graphs.instances, graphs.schema, graphs.shapes].map((g) => `DROP GRAPH <${g}>`).join(' ; ')
			);
		}

		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${baseIri}> ?p ?o .`, defaultGraphs.schema)} }`
		);
		return { deleted: true, entryCount: 0 };
	}

	// -- Workspace management (STORY-072) -------------------------------------------------------

	/** Idempotently ensures `<WORKSPACE_CLASS_IRI> a owl:Class` exists — mirrors
	 *  `ensureNamespaceClass()`'s `ASK`-then-`INSERT DATA` shape. Always lives in the default
	 *  namespace's `/schema` graph, alongside `Namespace`/`AttributedRelationship`. */
	async ensureWorkspaceClass(): Promise<void> {
		const exists = await this.classExists(WORKSPACE_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${WORKSPACE_CLASS_IRI}> a owl:Class ; rdfs:label "Workspace" .`, graphs.schema)} }`
		);
	}

	/** Every registered Workspace, read from the default namespace's `/schema` graph regardless of
	 *  any other namespace's graphs or a Workspace's own `defaultNamespace` value. */
	async fetchWorkspaces(): Promise<FetchedWorkspace[]> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?ws ?label ?defaultNs ${fromClause(graphs.schema)} WHERE {
				?ws a <${WORKSPACE_CLASS_IRI}> .
				OPTIONAL { ?ws rdfs:label ?label }
				OPTIONAL { ?ws <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> ?defaultNs }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.ws.value,
			label: b.label?.value ?? '',
			defaultNamespaceBaseIri: b.defaultNs?.value ?? null
		}));
	}

	/**
	 * Registers a Workspace: `<workspaceIri(name)> a <WORKSPACE_CLASS_IRI> ; rdfs:label "<name>"
	 * [; <WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI> <defaultNamespaceBaseIri>]`, always in the
	 * default namespace's `/schema` graph (Decision 4) regardless of `defaultNamespaceBaseIri`.
	 * Returns the minted IRI.
	 */
	async insertWorkspace(name: string, defaultNamespaceBaseIri?: string): Promise<string> {
		if (!name.trim()) throw new Error('Workspace name must not be empty');
		await this.ensureWorkspaceClass();

		const iri = workspaceIri(name);
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> a <${WORKSPACE_CLASS_IRI}> }`
		);
		if (exists) {
			throw new Error(`A workspace named "${name}" already exists (${iri})`);
		}

		const escapedLabel = this.escapeString(name.trim());
		const trimmedDefaultNs = defaultNamespaceBaseIri?.trim();
		if (trimmedDefaultNs) this.assertSafeSparqlIri(trimmedDefaultNs, 'default namespace base IRI');
		const defaultNsTriple = trimmedDefaultNs
			? ` ; <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> <${trimmedDefaultNs}>`
			: '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${iri}> a <${WORKSPACE_CLASS_IRI}> ; rdfs:label "${escapedLabel}"${defaultNsTriple} .`,
				graphs.schema
			)} }`
		);
		return iri;
	}

	/**
	 * Idempotent upsert primitive for workspace import (STORY-091): inserts the Workspace
	 * declaration at the caller-given `iri` only if it doesn't already exist; if it does, returns
	 * without error and without touching the existing `rdfs:label`/default namespace. Mirrors
	 * `insertWorkspace`'s `INSERT DATA` body exactly, replacing its throw-on-exists with a no-op —
	 * unlike `insertWorkspace`, `iri` is caller-supplied (the bundle's own IRI), not minted via
	 * `workspaceIri(name)`, since import must merge into a specific already-known Workspace subject.
	 */
	async ensureWorkspace(iri: string, label: string, defaultNamespaceBaseIri?: string): Promise<void> {
		this.assertSafeSparqlIri(iri, 'workspace IRI');
		await this.ensureWorkspaceClass();

		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> a <${WORKSPACE_CLASS_IRI}> }`
		);
		if (exists) return;

		const escapedLabel = this.escapeString(label.trim());
		const trimmedDefaultNs = defaultNamespaceBaseIri?.trim();
		if (trimmedDefaultNs) this.assertSafeSparqlIri(trimmedDefaultNs, 'default namespace base IRI');
		const defaultNsTriple = trimmedDefaultNs
			? ` ; <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> <${trimmedDefaultNs}>`
			: '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${iri}> a <${WORKSPACE_CLASS_IRI}> ; rdfs:label "${escapedLabel}"${defaultNsTriple} .`,
				graphs.schema
			)} }`
		);
	}

	/** Updates only `rdfs:label` — the workspace's own IRI never changes, mirroring `renameClass`/
	 *  `renameNamespace`-shaped methods (CLAUDE.md's IRI convention). */
	async renameWorkspace(workspaceIriValue: string, newName: string): Promise<void> {
		if (!newName.trim()) throw new Error('Workspace name must not be empty');
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const escaped = this.escapeString(newName);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${workspaceIriValue}> rdfs:label ?old }
			INSERT { <${workspaceIriValue}> rdfs:label "${escaped}" }
			WHERE { OPTIONAL { <${workspaceIriValue}> rdfs:label ?old } }
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a Workspace's optional default namespace —
	 *  a UI pre-fill convenience only (Decision 4), mirrors `updateNamespaceColor`. */
	async updateWorkspaceDefaultNamespace(
		workspaceIriValue: string,
		namespaceBaseIri: string | null
	): Promise<void> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const trimmed = namespaceBaseIri?.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${workspaceIriValue}> <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}

		this.assertSafeSparqlIri(trimmed, 'default namespace base IRI');
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${workspaceIriValue}> <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> ?old }
			INSERT { <${workspaceIriValue}> <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> <${trimmed}> }
			WHERE { OPTIONAL { <${workspaceIriValue}> <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> ?old } }
		`);
	}

	/**
	 * Deletes a Workspace: its own triples, every `WorkspaceMembership` row referencing it
	 * (`?m <WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI> <workspaceIri>`), and (STORY-083) every
	 * Note belonging to it (`?n <NOTE_WORKSPACE_PREDICATE_IRI> <workspaceIri>`) — unlike an element
	 * (which merely loses one membership row and lives on elsewhere), a Note has nowhere else to
	 * exist once its owning Workspace is gone, so it's deleted outright, not just unlinked. No
	 * `{force?}` flag needed, unlike `deleteNamespace`/`deleteClass`, since nothing else references a
	 * Workspace transitively; deleting it only ever orphans its own membership rows and Notes,
	 * cleaned up here. The "block deleting the last remaining Workspace" rule is a caller-side check
	 * (STORY-079's management UI), not enforced by this method.
	 */
	async deleteWorkspace(workspaceIriValue: string): Promise<void> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(`
			${PREFIXES}
			DELETE WHERE { ${inGraph(`?m <${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> . ?m ?p ?o .`, graphs.schema)} } ;
			DELETE WHERE { ${inGraph(`?n <${NOTE_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> . ?n ?p ?o .`, graphs.schema)} } ;
			DELETE WHERE { ${inGraph(`<${workspaceIriValue}> ?p ?o .`, graphs.schema)} }
		`);
	}

	// -- SavedQuery management (STORY-087) -------------------------------------------------------

	/** Idempotently ensures `<SAVED_QUERY_CLASS_IRI> a owl:Class` exists — mirrors
	 *  `ensureWorkspaceClass()`'s `ASK`-then-`INSERT DATA` shape. Always lives in the default
	 *  namespace's `/schema` graph, alongside `Namespace`/`Workspace`. */
	async ensureSavedQueryClass(): Promise<void> {
		const exists = await this.classExists(SAVED_QUERY_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${SAVED_QUERY_CLASS_IRI}> a owl:Class ; rdfs:label "SavedQuery" .`, graphs.schema)} }`
		);
	}

	/** Every registered SavedQuery, read from the default namespace's `/schema` graph regardless of
	 *  which namespace is currently active in the UI. */
	async fetchSavedQueries(): Promise<FetchedSavedQuery[]> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?sq ?label ?text ?description ?model ?createdBy ?createdAt ?published ${fromClause(graphs.schema)} WHERE {
				?sq a <${SAVED_QUERY_CLASS_IRI}> .
				OPTIONAL { ?sq rdfs:label ?label }
				OPTIONAL { ?sq <${SAVED_QUERY_TEXT_PREDICATE_IRI}> ?text }
				OPTIONAL { ?sq rdfs:comment ?description }
				OPTIONAL { ?sq <${SAVED_QUERY_MODEL_PREDICATE_IRI}> ?model }
				OPTIONAL { ?sq <${SAVED_QUERY_CREATED_BY_PREDICATE_IRI}> ?createdBy }
				OPTIONAL { ?sq <${SAVED_QUERY_CREATED_AT_PREDICATE_IRI}> ?createdAt }
				OPTIONAL { ?sq <${SAVED_QUERY_PUBLISHED_PREDICATE_IRI}> ?published }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.sq.value,
			label: b.label?.value ?? '',
			sparqlText: b.text?.value ?? '',
			description: b.description?.value ?? '',
			queryModel: b.model?.value,
			createdBy: b.createdBy?.value,
			createdAt: b.createdAt?.value,
			published: b.published?.value === 'true' || b.published?.value === '1'
		}));
	}

	/**
	 * Registers a SavedQuery: `<savedQueryIri(name)> a <SAVED_QUERY_CLASS_IRI> ; rdfs:label "<name>"
	 * ; <SAVED_QUERY_TEXT_PREDICATE_IRI> "<sparqlText>" [; rdfs:comment "<description>"]`, always in
	 * the default namespace's `/schema` graph (Decision 4). Returns the minted IRI.
	 */
	async insertSavedQuery(
		name: string,
		sparqlText: string,
		description?: string,
		workbench?: SavedQueryWorkbenchFields
	): Promise<string> {
		if (!name.trim()) throw new Error('Saved query name must not be empty');
		if (!sparqlText.trim()) throw new Error('Saved query text must not be empty');
		await this.ensureSavedQueryClass();

		const iri = savedQueryIri(name);
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> a <${SAVED_QUERY_CLASS_IRI}> }`
		);
		if (exists) {
			throw new Error(`A saved query named "${name}" already exists (${iri})`);
		}

		const escapedLabel = this.escapeString(name.trim());
		const escapedText = this.escapeString(sparqlText);
		const trimmedDescription = description?.trim();
		const descriptionTriple = trimmedDescription
			? ` ; rdfs:comment "${this.escapeString(trimmedDescription)}"`
			: '';

		// Model, author and the reserved `published=false` flag go into the same INSERT DATA as the
		// declaration, so a workbench query is never half-written.
		const workbenchTriples = workbench
			? ` ; <${SAVED_QUERY_MODEL_PREDICATE_IRI}> "${this.escapeString(workbench.queryModelJson)}"` +
				` ; <${SAVED_QUERY_CREATED_BY_PREDICATE_IRI}> "${this.escapeString(workbench.createdBy)}"` +
				` ; <${SAVED_QUERY_CREATED_AT_PREDICATE_IRI}> "${this.escapeString(workbench.createdAt ?? new Date().toISOString())}"^^xsd:dateTime` +
				` ; <${SAVED_QUERY_PUBLISHED_PREDICATE_IRI}> "false"^^xsd:boolean`
			: '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${iri}> a <${SAVED_QUERY_CLASS_IRI}> ; rdfs:label "${escapedLabel}" ; <${SAVED_QUERY_TEXT_PREDICATE_IRI}> "${escapedText}"${descriptionTriple}${workbenchTriples} .`,
				graphs.schema
			)} }`
		);
		return iri;
	}

	// -- Shared queries / short links (object-browser STORY-261) ---------------------------------

	/** Idempotently declares `SharedQuery` in the default namespace's `/schema` graph. */
	async ensureSharedQueryClass(): Promise<void> {
		if (await this.classExists(SHARED_QUERY_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI)) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${SHARED_QUERY_CLASS_IRI}> a owl:Class ; rdfs:label "SharedQuery" .`, graphs.schema)} }`
		);
	}

	/** Stores a model under `id`. Returns `false` (writing nothing) when the id is already taken so the
	 *  caller can retry with a fresh one. The node IRI is derived from the validated id only. */
	async insertSharedQuery(
		id: string,
		modelJson: string,
		createdBy?: string,
		createdAt: string = new Date().toISOString()
	): Promise<boolean> {
		if (!isShortId(id)) throw new Error('Invalid share id');
		await this.ensureSharedQueryClass();
		const iri = sharedQueryIri(id);
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		if (await this.askQuery(`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> ?p ?o }`)) return false;
		const by = createdBy ? ` ; <${SAVED_QUERY_CREATED_BY_PREDICATE_IRI}> "${this.escapeString(createdBy)}"` : '';
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${iri}> a <${SHARED_QUERY_CLASS_IRI}> ; <${SAVED_QUERY_MODEL_PREDICATE_IRI}> "${this.escapeString(modelJson)}"${by} ; <${SAVED_QUERY_CREATED_AT_PREDICATE_IRI}> "${this.escapeString(createdAt)}"^^xsd:dateTime .`,
				graphs.schema
			)} }`
		);
		return true;
	}

	/** The stored model JSON for `id`, or `null` for a malformed or unknown id (a malformed id never queries). */
	async fetchSharedQuery(id: string): Promise<string | null> {
		if (!isShortId(id)) return null;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const res = await this.selectQuery(
			`${PREFIXES} SELECT ?model ${fromClause(graphs.schema)} WHERE { <${sharedQueryIri(id)}> a <${SHARED_QUERY_CLASS_IRI}> ; <${SAVED_QUERY_MODEL_PREDICATE_IRI}> ?model }`
		);
		return res.results.bindings[0]?.model?.value ?? null;
	}

	/** Updates only `rdfs:label` — the saved query's own IRI never changes, mirroring
	 *  `renameWorkspace` (CLAUDE.md's IRI convention). */
	async renameSavedQuery(savedQueryIriValue: string, newName: string): Promise<void> {
		if (!newName.trim()) throw new Error('Saved query name must not be empty');
		this.assertSafeSparqlIri(savedQueryIriValue, 'saved query IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const escaped = this.escapeString(newName);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${savedQueryIriValue}> rdfs:label ?old }
			INSERT { <${savedQueryIriValue}> rdfs:label "${escaped}" }
			WHERE { OPTIONAL { <${savedQueryIriValue}> rdfs:label ?old } }
		`);
	}

	/** Replaces a SavedQuery's `sparqlText` — an empty string is rejected, mirroring `insertSavedQuery`'s
	 *  validation (a saved query's text is never optional once it exists). */
	async updateSavedQueryText(savedQueryIriValue: string, sparqlText: string): Promise<void> {
		if (!sparqlText.trim()) throw new Error('Saved query text must not be empty');
		this.assertSafeSparqlIri(savedQueryIriValue, 'saved query IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const escaped = this.escapeString(sparqlText);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${savedQueryIriValue}> <${SAVED_QUERY_TEXT_PREDICATE_IRI}> ?old }
			INSERT { <${savedQueryIriValue}> <${SAVED_QUERY_TEXT_PREDICATE_IRI}> "${escaped}" }
			WHERE { OPTIONAL { <${savedQueryIriValue}> <${SAVED_QUERY_TEXT_PREDICATE_IRI}> ?old } }
		`);
	}

	/**
	 * Replaces a workbench SavedQuery's model and its compiled `sparqlText` in one Modify operation
	 * (STORY-178), so the two can never disagree.
	 */
	async updateSavedQueryModel(
		savedQueryIriValue: string,
		queryModelJson: string,
		sparqlText: string
	): Promise<void> {
		if (!sparqlText.trim()) throw new Error('Saved query text must not be empty');
		this.assertSafeSparqlIri(savedQueryIriValue, 'saved query IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const model = this.escapeString(queryModelJson);
		const text = this.escapeString(sparqlText);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE {
				<${savedQueryIriValue}> <${SAVED_QUERY_MODEL_PREDICATE_IRI}> ?oldModel .
				<${savedQueryIriValue}> <${SAVED_QUERY_TEXT_PREDICATE_IRI}> ?oldText .
			}
			INSERT {
				<${savedQueryIriValue}> <${SAVED_QUERY_MODEL_PREDICATE_IRI}> "${model}" .
				<${savedQueryIriValue}> <${SAVED_QUERY_TEXT_PREDICATE_IRI}> "${text}" .
			}
			WHERE {
				OPTIONAL { <${savedQueryIriValue}> <${SAVED_QUERY_MODEL_PREDICATE_IRI}> ?oldModel }
				OPTIONAL { <${savedQueryIriValue}> <${SAVED_QUERY_TEXT_PREDICATE_IRI}> ?oldText }
			}
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a SavedQuery's optional `rdfs:comment`
	 *  description, mirroring `updateWorkspaceDefaultNamespace`'s set/replace/clear shape. */
	async updateSavedQueryDescription(
		savedQueryIriValue: string,
		description: string | null
	): Promise<void> {
		this.assertSafeSparqlIri(savedQueryIriValue, 'saved query IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const trimmed = description?.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${savedQueryIriValue}> rdfs:comment ?old`, graphs.schema)} }`
			);
			return;
		}

		const escaped = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${savedQueryIriValue}> rdfs:comment ?old }
			INSERT { <${savedQueryIriValue}> rdfs:comment "${escaped}" }
			WHERE { OPTIONAL { <${savedQueryIriValue}> rdfs:comment ?old } }
		`);
	}

	/**
	 * Deletes a SavedQuery's own triples. No `{force?}` flag and no cascading cleanup elsewhere:
	 * unlike `deleteWorkspace`/`deleteClass`/`deleteNamespace`, nothing else in the graph ever
	 * references a SavedQuery by IRI — deleting one is always unconditionally safe (research §8).
	 */
	async deleteSavedQuery(savedQueryIriValue: string): Promise<void> {
		this.assertSafeSparqlIri(savedQueryIriValue, 'saved query IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${savedQueryIriValue}> ?p ?o .`, graphs.schema)} }`
		);
	}

	// -- WorkspaceMembership CRUD & position storage (STORY-073) --------------------------------

	/** Idempotently ensures `<WORKSPACE_MEMBERSHIP_CLASS_IRI> a owl:Class` exists — same
	 *  self-registration shape as `ensureWorkspaceClass`/`ensureNamespaceClass`. */
	async ensureWorkspaceMembershipClass(): Promise<void> {
		const exists = await this.classExists(WORKSPACE_MEMBERSHIP_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${WORKSPACE_MEMBERSHIP_CLASS_IRI}> a owl:Class ; rdfs:label "WorkspaceMembership" .`, graphs.schema)} }`
		);
	}

	/** Every `{elementIri, x, y}` membership row for `workspaceIriValue`, none from any other
	 *  Workspace. Feeds both `GraphDbLayoutStore` (STORY-074) and the canvas visibility filter
	 *  (STORY-076). */
	async fetchWorkspaceMembers(
		workspaceIriValue: string
	): Promise<{ elementIri: string; x: number; y: number }[]> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?element ?x ?y ${fromClause(graphs.schema)} WHERE {
				?m a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ;
					<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ;
					<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?element ;
					<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> ?x ;
					<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> ?y .
			}
		`);
		return results.results.bindings.map((b) => ({
			elementIri: b.element.value,
			x: parseFloat(b.x.value),
			y: parseFloat(b.y.value)
		}));
	}

	/**
	 * Links an existing element to a Workspace at `(x, y)` — mints via
	 * `workspaceMembershipIri(workspaceIriValue, elementIri)`, `ASK`-exists-guard (idempotent
	 * no-op if the membership already exists, so "Add Element" selecting an already-present node
	 * never errors). Never mints a new `owl:Class`/`owl:NamedIndividual` resource itself — the
	 * caller (STORY-080) is responsible for only ever passing an IRI that already exists.
	 */
	async addWorkspaceMember(workspaceIriValue: string, elementIri: string, x: number, y: number): Promise<void> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		this.assertSafeSparqlIri(elementIri, 'element IRI');
		await this.ensureWorkspaceMembershipClass();

		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const membershipIri = await this.resolveMembershipIri(workspaceIriValue, elementIri);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${membershipIri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ; ` +
				`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}> }`
		);
		if (exists) return;

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${membershipIri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ; ` +
					`<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ; ` +
					`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}> ; ` +
					`<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "${x}"^^xsd:decimal ; ` +
					`<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "${y}"^^xsd:decimal .`,
				graphs.schema
			)} }`
		);
	}

	/** Removes exactly one `(workspace, element)` membership subject's triples — leaves the element
	 *  itself and its membership in every other Workspace untouched. */
	async removeWorkspaceMember(workspaceIriValue: string, elementIri: string): Promise<void> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		this.assertSafeSparqlIri(elementIri, 'element IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		// Matched by (workspace, element) rather than a computed subject, so it removes the right row
		// whichever of the two membership IRI forms (`resolveMembershipIri`) it was minted under.
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(
				`?m <${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ; ` +
					`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}> ; ?p ?o .`,
				graphs.schema
			)} }`
		);
	}

	/**
	 * The membership subject for one `(workspace, element)` pair. Subjects are minted from local names
	 * only (`workspaceMembershipIri`), so two same-named classes in different namespaces would share
	 * one — the second add used to be a silent no-op, and a later position update overwrote the first
	 * one's `element`. Resolution: the subject (either form) that already points at this element, else
	 * the legacy subject if free, else the hash-disambiguated one.
	 */
	private async resolveMembershipIri(workspaceIriValue: string, elementIri: string): Promise<string> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const legacy = workspaceMembershipIri(workspaceIriValue, elementIri);
		const hashed = workspaceMembershipIriDisambiguated(workspaceIriValue, elementIri);
		const ownedBy = (iri: string) =>
			this.askQuery(
				`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ; ` +
					`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}> }`
			);
		if (await ownedBy(hashed)) return hashed;
		if (await ownedBy(legacy)) return legacy;
		const legacyTaken = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${legacy}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> }`
		);
		return legacyTaken ? hashed : legacy;
	}

	/** Upserts the full membership row's `x`/`y` (plus its `a`/`workspace`/`element` link triples,
	 *  re-asserting them idempotently rather than assuming they're already there) — an external
	 *  vocabulary stub can be dragged (and is visible) without ever going through `addWorkspaceMember`
	 *  first (`visibility.ts`'s external-node gate doesn't require `WorkspaceMembership`), so a plain
	 *  x/y-only `DELETE`/`INSERT` here used to write orphaned x/y triples under a membership IRI with
	 *  no `a`/`workspace`/`element` triples — invisible to `fetchWorkspaceMembers`'s query, which
	 *  requires all five, so the position silently failed to survive a reload. Re-asserting the full
	 *  row every time makes this method safe to call whether or not `addWorkspaceMember` ran first.
	 *  The connector method itself is a plain async call; `GraphDbLayoutStore` (STORY-074) is
	 *  responsible for debouncing calls into it. */
	async updateWorkspaceMemberPosition(
		workspaceIriValue: string,
		elementIri: string,
		x: number,
		y: number
	): Promise<void> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		this.assertSafeSparqlIri(elementIri, 'element IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const membershipIri = await this.resolveMembershipIri(workspaceIriValue, elementIri);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE {
				<${membershipIri}> a ?oldType ;
					<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> ?oldWorkspace ;
					<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?oldElement ;
					<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> ?oldX ;
					<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> ?oldY
			}
			INSERT {
				<${membershipIri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ;
					<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ;
					<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}> ;
					<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "${x}"^^xsd:decimal ;
					<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "${y}"^^xsd:decimal
			}
			WHERE {
				OPTIONAL { <${membershipIri}> a ?oldType }
				OPTIONAL { <${membershipIri}> <${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> ?oldWorkspace }
				OPTIONAL { <${membershipIri}> <${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?oldElement }
				OPTIONAL { <${membershipIri}> <${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> ?oldX }
				OPTIONAL { <${membershipIri}> <${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> ?oldY }
			}
		`);
	}

	// -- Annotation vocabulary (query-workbench STORY-180) --------------------------------------

	/**
	 * Idempotently declares `Annotation` and `AnnotationLabel` (default namespace's `/schema` graph, like
	 * `ensureNoteClass`) and seeds the label members (default namespace's instances graph) that are not
	 * there yet — one `INSERT DATA` for everything missing, nothing at all on a second call.
	 */
	async ensureAnnotationClasses(): Promise<void> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const [hasAnnotation, hasLabel] = await Promise.all([
			this.classExists(ANNOTATION_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI),
			this.classExists(ANNOTATION_LABEL_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI)
		]);
		const existing = await this.selectQuery(`
			${PREFIXES}
			SELECT ?m ${fromClause(graphs.instances)} WHERE { ?m a <${ANNOTATION_LABEL_CLASS_IRI}> }
		`);
		const existingIris = new Set(existing.results.bindings.map((b) => b.m.value));

		const triples: string[] = [];
		if (!hasAnnotation) triples.push(inGraph(`<${ANNOTATION_CLASS_IRI}> a owl:Class ; rdfs:label "Annotation" .`, graphs.schema));
		if (!hasLabel) {
			triples.push(inGraph(`<${ANNOTATION_LABEL_CLASS_IRI}> a owl:Class ; rdfs:label "AnnotationLabel" .`, graphs.schema));
		}
		const members = SEED_ANNOTATION_LABELS.map((name) => ({
			name,
			iri: individualIri(ANNOTATION_LABEL_CLASS_IRI, name, graphs.instances)
		})).filter((m) => !existingIris.has(m.iri));
		if (members.length > 0) {
			const body = members
				.map((m) => `<${m.iri}> a <${ANNOTATION_LABEL_CLASS_IRI}> ; rdfs:label "${this.escapeString(m.name)}" .`)
				.join(' ');
			triples.push(inGraph(body, graphs.instances));
		}
		if (triples.length === 0) return;
		await this.executeUpdate(`${PREFIXES} INSERT DATA { ${triples.join(' ')} }`);
	}

	// -- Annotation CRUD (query-workbench STORY-182) ---------------------------------------------
	// `annotatedBy`/`annotatedAt` are plain parameters here: this layer never reads identity. The only
	// caller allowed to supply them is the server route (STORY-183), which stamps them itself.

	/**
	 * Adds one annotation (free text or an `AnnotationLabel` member) to a fact: ensures the vocabulary,
	 * reifies the fact (`ensureReifiedFact`) and inserts a fresh `Annotation` node into the statement's
	 * own instances graph. Validation (text length, label membership, author/timestamp) happens before
	 * any update. Returns the annotation's IRI.
	 */
	async addAnnotation(
		fact: FactKey,
		annotation: AnnotationInput,
		meta: { annotatedBy: string; annotatedAt: string }
	): Promise<string> {
		this.assertSafeSparqlIri(fact.subjectIri, 'subject IRI');
		this.assertSafeSparqlIri(fact.predicateIri, 'predicate IRI');
		if (!meta.annotatedBy.trim()) throw new Error('annotatedBy must not be empty');
		if (Number.isNaN(Date.parse(meta.annotatedAt))) throw new Error('annotatedAt must be an ISO timestamp');

		let valueTerm: string;
		if (annotation.type === 'text') {
			const text = annotation.text.trim();
			if (!text) throw new Error('Annotation text must not be empty');
			if (text.length > ANNOTATION_MAX_TEXT_LENGTH) {
				throw new Error(`Annotation text must be at most ${ANNOTATION_MAX_TEXT_LENGTH} characters`);
			}
			valueTerm = `"${this.escapeString(text)}"`;
		} else {
			this.assertSafeSparqlIri(annotation.labelIri, 'annotation label IRI');
			valueTerm = `<${annotation.labelIri}>`;
		}
		// Validate the fact object's term shape up front too (throws on unsafe IRIs / language tags).
		this.factObjectTerm(fact.object);

		await this.ensureAnnotationClasses();
		if (annotation.type === 'label') {
			const isMember = await this.askQuery(
				`${PREFIXES} ASK { GRAPH ?g { <${annotation.labelIri}> a <${ANNOTATION_LABEL_CLASS_IRI}> } }`
			);
			if (!isMember) throw new Error('The given IRI is not an annotation label');
		}

		const statement = await this.ensureReifiedFact(fact.subjectIri, fact.predicateIri, fact.object);
		const namespaceBaseIri = await this.findNamespaceOfIndividual(fact.subjectIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const iri = annotationIri(statement);
		this.assertSafeSparqlIri(iri, 'annotation IRI');
		const triples =
			`<${iri}> a <${ANNOTATION_CLASS_IRI}> ; <${ANNOTATES_PREDICATE_IRI}> <${statement}> ; ` +
			`<${ANNOTATION_TYPE_PREDICATE_IRI}> "${annotation.type}" ; <${ANNOTATION_VALUE_PREDICATE_IRI}> ${valueTerm} ; ` +
			`<${ANNOTATED_BY_PREDICATE_IRI}> "${this.escapeString(meta.annotatedBy)}" ; ` +
			`<${ANNOTATED_AT_PREDICATE_IRI}> "${this.escapeString(meta.annotatedAt)}"^^xsd:dateTime .`;
		await this.executeUpdate(`${PREFIXES} INSERT DATA { ${inGraph(triples, graphs.instances)} }`);
		return iri;
	}

	/**
	 * Annotations for a page of facts in **one** query (a `VALUES (?s ?p ?o)` join), keyed by
	 * `factKeyString`. Every requested fact is present in the result, with `[]` when unannotated.
	 */
	async fetchAnnotationsForFacts(facts: FactKey[]): Promise<Map<string, FetchedAnnotation[]>> {
		const result = new Map<string, FetchedAnnotation[]>();
		if (facts.length === 0) return result;

		const rows: string[] = [];
		for (const f of facts) {
			this.assertSafeSparqlIri(f.subjectIri, 'subject IRI');
			this.assertSafeSparqlIri(f.predicateIri, 'predicate IRI');
			const term = this.factObjectTerm(f.object);
			result.set(factKeyString(f), []);
			rows.push(`(<${f.subjectIri}> <${f.predicateIri}> ${term})`);
		}

		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?s ?p ?o ?ann ?type ?value ?by ?at ?labelText WHERE {
				VALUES (?s ?p ?o) { ${rows.join(' ')} }
				GRAPH ?g {
					?stmt rdf:subject ?s ; rdf:predicate ?p ; rdf:object ?o .
					?ann <${ANNOTATES_PREDICATE_IRI}> ?stmt ;
						<${ANNOTATION_TYPE_PREDICATE_IRI}> ?type ;
						<${ANNOTATION_VALUE_PREDICATE_IRI}> ?value ;
						<${ANNOTATED_BY_PREDICATE_IRI}> ?by ;
						<${ANNOTATED_AT_PREDICATE_IRI}> ?at .
				}
				OPTIONAL { GRAPH ?lg { ?value rdfs:label ?labelText } }
			}
			ORDER BY ?at ?ann
		`);

		const seen = new Set<string>();
		for (const b of results.results.bindings) {
			const object: FactObject =
				b.o.type === 'uri'
					? { kind: 'iri', iri: b.o.value }
					: { kind: 'literal', value: b.o.value, datatype: b.o.datatype, lang: b.o['xml:lang'] };
			const key = factKeyString({ subjectIri: b.s.value, predicateIri: b.p.value, object });
			const list = result.get(key);
			if (!list) continue;
			const dedupe = `${key}\u0002${b.ann.value}`;
			if (seen.has(dedupe)) continue;
			seen.add(dedupe);
			const type = b.type.value === 'label' ? 'label' : 'text';
			list.push({
				iri: b.ann.value,
				type,
				...(type === 'text' ? { text: b.value.value } : { labelIri: b.value.value }),
				...(type === 'label' && b.labelText ? { labelText: b.labelText.value } : {}),
				annotatedBy: b.by.value,
				annotatedAt: b.at.value
			});
		}
		return result;
	}

	/** The enumerated annotation labels (members of `AnnotationLabel`), for the UI dropdown. */
	async fetchAnnotationLabels(): Promise<{ iri: string; label: string }[]> {
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT DISTINCT ?m ?label WHERE {
				GRAPH ?g { ?m a <${ANNOTATION_LABEL_CLASS_IRI}> . OPTIONAL { ?m rdfs:label ?label } }
			}
			ORDER BY ?label
		`);
		return results.results.bindings.map((b) => ({
			iri: b.m.value,
			label: b.label?.value ?? extractLocalName(b.m.value)
		}));
	}

	/**
	 * Removes exactly one `Annotation` node's triples. The reified statement and ground triple are
	 * untouched (the statement may carry relation-assertions) and nothing cascades; a non-annotation
	 * IRI matches nothing, so this can never delete anything else.
	 */
	async deleteAnnotation(annotationIriValue: string): Promise<void> {
		this.assertSafeSparqlIri(annotationIriValue, 'annotation IRI');
		await this.executeUpdate(`
			${PREFIXES}
			DELETE { GRAPH ?g { <${annotationIriValue}> ?p ?o } }
			WHERE { GRAPH ?g { <${annotationIriValue}> a <${ANNOTATION_CLASS_IRI}> ; ?p ?o } }
		`);
	}

	// -- Note (sticky note) CRUD (STORY-083) -----------------------------------------------------

	/** Idempotently ensures `<NOTE_CLASS_IRI> a owl:Class` exists — same self-registration shape as
	 *  `ensureWorkspaceClass`/`ensureWorkspaceMembershipClass`. */
	async ensureNoteClass(): Promise<void> {
		const exists = await this.classExists(NOTE_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${NOTE_CLASS_IRI}> a owl:Class ; rdfs:label "Note" .`, graphs.schema)} }`
		);
	}

	/** Every Note belonging to `workspaceIriValue`, none from any other Workspace — read from the
	 *  default namespace's `/schema` graph (Decision 4). */
	async fetchNotesForWorkspace(workspaceIriValue: string): Promise<FetchedNote[]> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?n ?text ?color ?x ?y ?linked ${fromClause(graphs.schema)} WHERE {
				?n a <${NOTE_CLASS_IRI}> ;
					<${NOTE_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ;
					<${NOTE_COLOR_PREDICATE_IRI}> ?color ;
					<${NOTE_X_PREDICATE_IRI}> ?x ;
					<${NOTE_Y_PREDICATE_IRI}> ?y .
				OPTIONAL { ?n <${NOTE_TEXT_PREDICATE_IRI}> ?text }
				OPTIONAL { ?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?linked }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.n.value,
			text: b.text?.value ?? '',
			color: b.color.value,
			x: parseFloat(b.x.value),
			y: parseFloat(b.y.value),
			linkedElementIri: b.linked?.value ?? null
		}));
	}

	/**
	 * Creates a blank (or pre-filled) Note in `workspaceIriValue` at `(x, y)` — mints via
	 * `noteIri(workspaceIriValue, Date.now().toString())`. No `ASK`-exists guard needed (unlike
	 * `insertWorkspace`/`addWorkspaceMember`) — the IRI is timestamp-unique by construction, there's
	 * no "already exists" case to be idempotent against.
	 */
	async insertNote(
		workspaceIriValue: string,
		x: number,
		y: number,
		color: string,
		text?: string,
		linkedElementIri?: string
	): Promise<{ iri: string }> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		if (linkedElementIri) this.assertSafeSparqlIri(linkedElementIri, 'linked element IRI');
		await this.ensureNoteClass();

		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const iri = noteIri(workspaceIriValue, Date.now().toString());
		const trimmedText = text?.trim();
		const textTriple = trimmedText ? ` ; <${NOTE_TEXT_PREDICATE_IRI}> "${this.escapeString(trimmedText)}"` : '';
		const linkedTriple = linkedElementIri ? ` ; <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${linkedElementIri}>` : '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${iri}> a <${NOTE_CLASS_IRI}> ; ` +
					`<${NOTE_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ; ` +
					`<${NOTE_COLOR_PREDICATE_IRI}> "${this.escapeString(color)}" ; ` +
					`<${NOTE_X_PREDICATE_IRI}> "${x}"^^xsd:decimal ; ` +
					`<${NOTE_Y_PREDICATE_IRI}> "${y}"^^xsd:decimal${textTriple}${linkedTriple} .`,
				graphs.schema
			)} }`
		);
		return { iri };
	}

	/**
	 * Idempotent upsert primitive for workspace import (STORY-091): inserts a Note at the caller-given
	 * `iri` only if that exact IRI doesn't already exist — distinct from `insertNote`, which always
	 * mints a fresh timestamp-based IRI and is unchanged by this story. Import needs this instead
	 * because a bundled Note's `iri` isn't content-deterministic (`research.md` §4.3 step 6): keying
	 * the exists-guard on the bundle's own literal IRI is what makes re-importing the same file
	 * idempotent even though `noteIri` itself carries no such guarantee in general.
	 */
	async ensureNoteAtIri(
		iri: string,
		workspaceIriValue: string,
		x: number,
		y: number,
		color: string,
		text?: string,
		linkedElementIri?: string
	): Promise<void> {
		this.assertSafeSparqlIri(iri, 'note IRI');
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		if (linkedElementIri) this.assertSafeSparqlIri(linkedElementIri, 'linked element IRI');
		await this.ensureNoteClass();

		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> a <${NOTE_CLASS_IRI}> }`
		);
		if (exists) return;

		const trimmedText = text?.trim();
		const textTriple = trimmedText ? ` ; <${NOTE_TEXT_PREDICATE_IRI}> "${this.escapeString(trimmedText)}"` : '';
		const linkedTriple = linkedElementIri ? ` ; <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${linkedElementIri}>` : '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${iri}> a <${NOTE_CLASS_IRI}> ; ` +
					`<${NOTE_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ; ` +
					`<${NOTE_COLOR_PREDICATE_IRI}> "${this.escapeString(color)}" ; ` +
					`<${NOTE_X_PREDICATE_IRI}> "${x}"^^xsd:decimal ; ` +
					`<${NOTE_Y_PREDICATE_IRI}> "${y}"^^xsd:decimal${textTriple}${linkedTriple} .`,
				graphs.schema
			)} }`
		);
	}

	/** Sets, replaces, or (passing empty/blank) removes a Note's `noteText` — a blank sticky note is
	 *  still a note, so empty text is valid and simply omits the triple rather than storing `""`. */
	async updateNoteText(noteIriValue: string, text: string): Promise<void> {
		this.assertSafeSparqlIri(noteIriValue, 'note IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const trimmed = text.trim();

		if (!trimmed) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${noteIriValue}> <${NOTE_TEXT_PREDICATE_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}

		const escaped = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${noteIriValue}> <${NOTE_TEXT_PREDICATE_IRI}> ?old }
			INSERT { <${noteIriValue}> <${NOTE_TEXT_PREDICATE_IRI}> "${escaped}" }
			WHERE { OPTIONAL { <${noteIriValue}> <${NOTE_TEXT_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Replaces a Note's `noteColor` — mirrors `updateNamespaceColor`'s DELETE/INSERT shape (a Note
	 *  always has *some* color, so unlike the namespace case there's no "clear to unset" path here). */
	async updateNoteColor(noteIriValue: string, color: string): Promise<void> {
		this.assertSafeSparqlIri(noteIriValue, 'note IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const escaped = this.escapeString(color);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${noteIriValue}> <${NOTE_COLOR_PREDICATE_IRI}> ?old }
			INSERT { <${noteIriValue}> <${NOTE_COLOR_PREDICATE_IRI}> "${escaped}" }
			WHERE { OPTIONAL { <${noteIriValue}> <${NOTE_COLOR_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Updates `x`/`y` on a Note without touching its other triples — mirrors
	 *  `updateWorkspaceMemberPosition` exactly (including: this method itself is a plain async call,
	 *  debouncing is the caller's/store's job, not this method's). */
	async updateNotePosition(noteIriValue: string, x: number, y: number): Promise<void> {
		this.assertSafeSparqlIri(noteIriValue, 'note IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${noteIriValue}> <${NOTE_X_PREDICATE_IRI}> ?oldX ; <${NOTE_Y_PREDICATE_IRI}> ?oldY }
			INSERT { <${noteIriValue}> <${NOTE_X_PREDICATE_IRI}> "${x}"^^xsd:decimal ; <${NOTE_Y_PREDICATE_IRI}> "${y}"^^xsd:decimal }
			WHERE {
				OPTIONAL { <${noteIriValue}> <${NOTE_X_PREDICATE_IRI}> ?oldX }
				OPTIONAL { <${noteIriValue}> <${NOTE_Y_PREDICATE_IRI}> ?oldY }
			}
		`);
	}

	/** Sets, replaces, or (passing `null`) removes a Note's optional `noteLinkedElement` — mirrors
	 *  `updateWorkspaceDefaultNamespace`'s set/replace/clear shape. */
	async updateNoteLinkedElement(noteIriValue: string, elementIri: string | null): Promise<void> {
		this.assertSafeSparqlIri(noteIriValue, 'note IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

		if (!elementIri) {
			await this.executeUpdate(
				`${PREFIXES} DELETE WHERE { ${inGraph(`<${noteIriValue}> <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?old`, graphs.schema)} }`
			);
			return;
		}

		this.assertSafeSparqlIri(elementIri, 'linked element IRI');
		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.schema)}
			DELETE { <${noteIriValue}> <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?old }
			INSERT { <${noteIriValue}> <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${elementIri}> }
			WHERE { OPTIONAL { <${noteIriValue}> <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?old } }
		`);
	}

	/** Deletes exactly this Note subject's triples. No refuse-then-force guard needed (CLAUDE.md's
	 *  convention only applies where deletion could orphan *another* resource's reference) — nothing
	 *  ever references a Note by IRI except the Note's own triples, so deleting one is always safe
	 *  and unconditional. */
	async deleteNote(noteIriValue: string): Promise<void> {
		this.assertSafeSparqlIri(noteIriValue, 'note IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${noteIriValue}> ?p ?o .`, graphs.schema)} }`
		);
	}

	// -- External vocabulary management (STORY-046) ---------------------------------------------

	/** Idempotently ensures `<SCHEMA_NAMESPACE>ExternalVocabulary a owl:Class` exists — mirrors
	 *  `ensureNamespaceClass`'s `ASK`-then-`INSERT DATA` shape. Always lives in the default
	 *  namespace's `/schema` graph, alongside `Namespace`/`AttributedRelationship`. */
	async ensureExternalVocabularyClass(): Promise<void> {
		const exists = await this.classExists(EXTERNAL_VOCABULARY_CLASS_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${EXTERNAL_VOCABULARY_CLASS_IRI}> a owl:Class ; rdfs:label "ExternalVocabulary" .`, graphs.schema)} }`
		);
	}

	/** Every registered external vocabulary, merged with the three built-in `EXTERNAL_PREFIXES`
	 *  defaults (`foaf`/`schema`/`skos`) so those keep resolving with no migration step. */
	async fetchExternalVocabularies(): Promise<FetchedExternalVocabulary[]> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?v ?prefix ${fromClause(graphs.schema)} WHERE {
				?v a <${EXTERNAL_VOCABULARY_CLASS_IRI}> .
				OPTIONAL { ?v <${NAMESPACE_PREFIX_PREDICATE_IRI}> ?prefix }
			}
		`);
		const registered: FetchedExternalVocabulary[] = results.results.bindings.map((b) => ({
			baseIri: b.v.value,
			prefix: b.prefix?.value ?? '',
			builtIn: false
		}));
		const builtIns: FetchedExternalVocabulary[] = Object.entries(EXTERNAL_PREFIXES).map(
			([prefix, baseIri]) => ({ prefix, baseIri, builtIn: true })
		);
		return [...builtIns, ...registered];
	}

	/**
	 * Registers an external vocabulary: `<baseIri> a <SCHEMA_NAMESPACE>ExternalVocabulary ;
	 * <SCHEMA_NAMESPACE>prefix "<prefix>"`, in the default namespace's `/schema` graph — same spot
	 * as `Namespace`/`AttributedRelationship`, reusing `NAMESPACE_PREFIX_PREDICATE_IRI` rather than
	 * a second prefix predicate. Unlike `insertNamespace`, no graphs are minted for this base IRI —
	 * it's only ever referenced, never written to.
	 */
	async insertExternalVocabulary(prefix: string, baseIri: string): Promise<{ baseIri: string }> {
		if (!prefix.trim()) throw new Error('Vocabulary prefix must not be empty');
		this.assertSafeSparqlIri(baseIri, 'vocabulary base IRI');
		await this.ensureExternalVocabularyClass();

		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${baseIri}> a <${EXTERNAL_VOCABULARY_CLASS_IRI}> }`
		);
		if (exists) {
			throw new Error(`A vocabulary with base IRI "${baseIri}" already exists`);
		}

		const trimmedPrefix = prefix.trim();
		const escapedPrefix = this.escapeString(trimmedPrefix);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${baseIri}> a <${EXTERNAL_VOCABULARY_CLASS_IRI}> ; <${NAMESPACE_PREFIX_PREDICATE_IRI}> "${escapedPrefix}" .`,
				graphs.schema
			)} }`
		);
		return { baseIri };
	}

	/** Removes an external vocabulary's registration triple unconditionally — no non-empty check
	 *  (unlike `deleteNamespace`), since the vocabulary owns no graphs of its own: nothing else in
	 *  this app's data is scoped under its base IRI. Refuses built-in defaults (not stored in
	 *  GraphDB, so there's nothing to delete) — callers should check `FetchedExternalVocabulary.builtIn`
	 *  before offering delete in the UI. */
	async deleteExternalVocabulary(baseIri: string): Promise<void> {
		this.assertSafeSparqlIri(baseIri, 'vocabulary base IRI');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${baseIri}> ?p ?o .`, graphs.schema)} }`
		);
	}

	// -- Default namespace migration (STORY-028) --------------------------------------------------

	/** Fetches every asserted triple in the legacy, pre-migration mixed graph (`SCHEMA_GRAPH`) —
	 *  same query shape as `fetchWholeGraphQuads`, but scoped to that one single legacy graph
	 *  instead of a namespace's three graphs. Only ever used by `ensureDefaultNamespaceMigrated`'s
	 *  one-time copy step. */
	private async fetchLegacySchemaGraphQuads(): Promise<Quad[]> {
		const results = await this.selectQuery(
			`SELECT ?s ?p ?o ${fromClause(SCHEMA_GRAPH)} WHERE { ?s ?p ?o . ${VOCAB_FILTER('?s')} }`,
			{ infer: false }
		);
		return results.results.bindings.map((b) => bindingToQuad(b));
	}

	/**
	 * One-time, idempotent migration of the default namespace's legacy mixed graph (`SCHEMA_GRAPH`,
	 * holding schema/shapes/individual triples together — issue #1) onto the three-graph layout
	 * (`namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI)`), per `research.md` §12 Decision 3. Follows
	 * `ensureAttributedRelationshipClass`'s `ASK`-then-act shape (here, `fetchNamespaces()`-lookup-
	 * then-act): if the default namespace is already registered, this is a no-op.
	 *
	 * Otherwise, copies (never deletes) `SCHEMA_GRAPH`'s triples into the three new graphs by
	 * reusing `buildScopeInsertOp` — the exact classification `saveScopedTurtle` already uses
	 * (`partitionQuads` for schema-vs-shapes, then `splitInstancesFromSchema` to pull individuals
	 * out of the schema bucket via STORY-019's `looksLikeIndividual` rule) — then registers the
	 * default namespace as an ordinary, editable `Namespace` row (prefix `rse`, matching `turtle.ts`'s
	 * existing `DISPLAY_PREFIXES.rse` for this same namespace; no description). `SCHEMA_GRAPH`
	 * itself is never touched: a fresh install with nothing in it just skips straight to
	 * registration, and a migration retried after the copy step but before registration succeeds
	 * just re-inserts the same ground triples — harmless in a triple store.
	 */
	async ensureDefaultNamespaceMigrated(): Promise<void> {
		const namespaces = await this.fetchNamespaces();
		if (namespaces.some((ns) => ns.baseIri === DEFAULT_NAMESPACE_BASE_IRI)) return;

		const legacyQuads = await this.fetchLegacySchemaGraphQuads();
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const insertOp = await this.buildScopeInsertOp(legacyQuads, graphs);
		if (insertOp) {
			await this.executeUpdate(`${PREFIXES} ${insertOp}`);
		}

		await this.insertNamespace('rse', DEFAULT_NAMESPACE_BASE_IRI);
	}

	// -- Default Workspace migration and backfill (STORY-075) --------------------------------------

	/** Every element IRI that already has a `WorkspaceMembership` row in **any** Workspace — not
	 *  scoped to the Default workspace, since a partially-migrated repository (e.g. an element
	 *  someone already placed in a non-Default Workspace by hand) must not be double-membered by the
	 *  backfill. */
	private async fetchWorkspaceMembershipElementIris(): Promise<Set<string>> {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?element ${fromClause(graphs.schema)} WHERE {
				?m a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ;
					<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?element .
			}
		`);
		return new Set(results.results.bindings.map((b) => b.element.value));
	}

	/**
	 * Backfills a `WorkspaceMembership` row (auto-grid position, `gridPosition` per the plan's ADR —
	 * not a read of each browser's `localStorage` layout) for every pre-existing
	 * `owl:Class`/`owl:NamedIndividual` element, across every namespace, that has no
	 * `WorkspaceMembership` row anywhere yet. Each `addWorkspaceMember` call is independently safe
	 * under concurrent backfill passes (deterministic `workspaceMembershipIri`), so this never needs
	 * its own lock — only the completion-marker triple written at the end, which lets every later
	 * `ensureDefaultWorkspace()` call skip straight to a single `ASK`.
	 */
	private async backfillDefaultWorkspaceMembership(defaultWorkspaceIri: string): Promise<void> {
		await this.ensureWorkspaceMembershipClass();
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

		const [schema, alreadyMember] = await Promise.all([
			this.fetchFullSchemaForAllNamespaces(),
			this.fetchWorkspaceMembershipElementIris()
		]);
		const elementsToBackfill = [
			...schema.classes.map((c) => c.iri),
			...schema.individuals.map((i) => i.iri)
		].filter((iri) => !alreadyMember.has(iri));

		for (const [index, elementIri] of elementsToBackfill.entries()) {
			const pos = gridPosition(index);
			await this.addWorkspaceMember(defaultWorkspaceIri, elementIri, pos.x, pos.y);
		}

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${defaultWorkspaceIri}> <${WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI}> true .`,
				graphs.schema
			)} }`
		);
	}

	/**
	 * Idempotently ensures a "Default" Workspace exists and every pre-existing element (from before
	 * Workspaces existed) is a member of it, then returns its IRI. Wired into the same client-side
	 * `loadSchemaFromGraphDB`/`onMount` trigger as `ensureDefaultNamespaceMigrated()` — fires on
	 * every page load by every tab/user, not once per deploy (this app has no server-side startup
	 * hook), so correctness rests on `workspaceIri('Default')`'s determinism and the backfill's
	 * per-element idempotency, not on a lock (`spec/views/plan.md`'s risk assessment).
	 *
	 * The overwhelmingly common case — every load after the first successful migration — is a single
	 * `ASK` against the completion marker, mirroring `ensureDefaultNamespaceMigrated()`'s own
	 * "safe to retry" contract: a call that throws partway leaves no marker behind, so the next load
	 * retries from scratch.
	 */
	async ensureDefaultWorkspace(): Promise<string> {
		const iri = workspaceIri('Default');
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

		const backfillComplete = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> <${WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI}> true }`
		);
		if (backfillComplete) return iri;

		await this.ensureWorkspaceClass();
		const workspaceExists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${iri}> a <${WORKSPACE_CLASS_IRI}> }`
		);
		if (!workspaceExists) {
			await this.executeUpdate(
				`${PREFIXES} INSERT DATA { ${inGraph(
					`<${iri}> a <${WORKSPACE_CLASS_IRI}> ; rdfs:label "Default" .`,
					graphs.schema
				)} }`
			);
		}

		await this.backfillDefaultWorkspaceMembership(iri);
		return iri;
	}

	// -- Full-schema fetch (STORY-009) -----------------------------------------------------------

	async fetchAllClasses(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<FetchedClass[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?c ?label ?comment ${fromClause(graphs.schema)} WHERE {
				?c a owl:Class .
				${VOCAB_FILTER('?c')}
				OPTIONAL { ?c rdfs:label ?label }
				OPTIONAL { ?c rdfs:comment ?comment }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.c.value,
			label: b.label?.value ?? extractLocalName(b.c.value),
			comment: b.comment?.value ?? null,
			namespaceBaseIri
		}));
	}

	async fetchAllDatatypeProperties(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedPropertyBase[]> {
		return this.fetchPropertiesByType('owl:DatatypeProperty', namespaceBaseIri);
	}

	async fetchAllObjectProperties(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedPropertyBase[]> {
		return this.fetchPropertiesByType('owl:ObjectProperty', namespaceBaseIri);
	}

	/** Every `sh:property` entry across every `sh:NodeShape`, keyed by `sh:path` for joining against
	 *  the property lists above (see `fetchFullSchema`). */
	async fetchAllShapesAndProperties(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedShapeConstraint[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?path ?minCount ?maxCount ?requiredForSubclasses ${fromClause(graphs.shapes)} WHERE {
				?shape a sh:NodeShape ; sh:property ?ps .
				?ps sh:path ?path .
				OPTIONAL { ?ps sh:minCount ?minCount }
				OPTIONAL { ?ps sh:maxCount ?maxCount }
				OPTIONAL { ?ps <${REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI}> ?requiredForSubclasses }
			}
		`);
		return results.results.bindings.map((b) => ({
			path: b.path.value,
			minCount: b.minCount ? parseInt(b.minCount.value, 10) : undefined,
			maxCount: b.maxCount ? parseInt(b.maxCount.value, 10) : undefined,
			requiredForSubclasses: b.requiredForSubclasses?.value === 'true'
		}));
	}

	/**
	 * Class IRIs whose own `sh:NodeShape` constrains `sh:path rdfs:label` with `sh:minCount >= 1`
	 * (STORY-112). `rdfs:label` is never declared `a owl:DatatypeProperty`, so this constraint is
	 * invisible to `fetchAllShapesAndProperties`'s path-keyed join (joined back to a *datatype
	 * property* by `sh:path`, which `rdfs:label` never is) — this query keeps the `sh:targetClass`
	 * link instead, since `buildCanvasModel`'s ancestor walk needs to know *which* class(es) declare
	 * it, not just that some shape somewhere does.
	 */
	async fetchLabelRequiredClasses(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<string[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?class ?minCount ${fromClause(graphs.shapes)} WHERE {
				?shape a sh:NodeShape ; sh:targetClass ?class ; sh:property ?ps .
				?ps sh:path rdfs:label .
				OPTIONAL { ?ps sh:minCount ?minCount }
			}
		`);
		return results.results.bindings
			.filter((b) => b.minCount !== undefined && parseInt(b.minCount.value, 10) >= 1)
			.map((b) => b.class.value);
	}

	/** `sh:in` value lists declared on a class's `sh:property` shapes (query-workbench STORY-174). */
	async fetchInConstraints(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<FetchedInConstraint[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?class ?path ?value ${fromClause(graphs.shapes)} WHERE {
				?shape sh:targetClass ?class ; sh:property ?ps .
				?ps sh:path ?path ; sh:in/rdf:rest*/rdf:first ?value .
			}
		`);
		const byKey = new Map<string, FetchedInConstraint>();
		for (const b of results.results.bindings) {
			const key = `${b.class.value}\u0000${b.path.value}`;
			let c = byKey.get(key);
			if (!c) {
				c = { classIri: b.class.value, propertyIri: b.path.value, values: [] };
				byKey.set(key, c);
			}
			c.values.push({ value: b.value.value, isIri: b.value.type === 'uri' });
		}
		return [...byKey.values()];
	}

	async fetchAllSubClassOf(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedSubClassOf[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?sub ?super ${fromClause(graphs.schema)} WHERE {
				?sub rdfs:subClassOf ?super .
				${VOCAB_FILTER('?sub')}
				${VOCAB_FILTER('?super')}
			}`
		);
		return results.results.bindings.map((b) => ({
			sub: b.sub.value,
			super: b.super.value,
			namespaceBaseIri
		}));
	}

	/**
	 * Every enumerated individual in the graph (STORY-019): a subject whose `rdf:type` object is
	 * itself a declared local `owl:Class` — the `?type a owl:Class` join is what excludes classes
	 * (typed `owl:Class`), properties (typed `owl:DatatypeProperty`/`owl:ObjectProperty`), and
	 * shapes (typed `sh:NodeShape`) from this result, since none of those meta-types are themselves
	 * asserted `a owl:Class` anywhere in this app's data. An individual's own `?i a ?type` triple is
	 * scoped to the namespace's own instance graph via an explicit `GRAPH <graphs.instances> {...}`
	 * block, but `?type a owl:Class` is checked via an unrestricted `GRAPH ?classGraph {...}` across
	 * every graph in the repository, not just this namespace's own `/schema` — the same
	 * cross-namespace posture `fetchAllIndividualClassRelations` already uses (STORY-099's Concept
	 * Namespace can mint an individual under a namespace different from the one that declares its
	 * class, e.g. a hand-typed-identifier member or a Backstage-synced individual whose `represents`
	 * target lives in `core`'s own namespace) — scoping the class check to only `graphs.schema` would
	 * silently drop any such individual from this result even though its triples are all still present.
	 *
	 * Deliberately **no `FROM` clause anywhere in this query** — mixing `FROM <g>` with an unrestricted
	 * `GRAPH ?var {...}` doesn't do what it looks like it does: per SPARQL 1.1 dataset semantics, any
	 * `FROM` clause (with no matching `FROM NAMED`) collapses the query's *named*-graph set to empty,
	 * so `GRAPH ?classGraph {...}` would then match nothing at all — silently, no error, just zero
	 * rows. `fetchAllIndividualClassRelations`'s pattern (every triple pattern inside an explicit
	 * `GRAPH <uri>`/`GRAPH ?var` block, never a bare pattern or a `FROM`) is the one that actually
	 * works, relying on GraphDB's own default dataset (every graph is both default and named when the
	 * query has no `FROM`/`FROM NAMED` at all) — this query now follows that same shape.
	 *
	 * `NOTE_CLASS_IRI`/`WORKSPACE_CLASS_IRI` are also self-declared `a owl:Class` (see
	 * `ensureNoteClassDeclared`/`ensureWorkspaceClassDeclared`), so without excluding them here every
	 * Note/Workspace individual would otherwise match this join too — surfacing in Instances view as
	 * a duplicate `IndividualNodeSpec` alongside the `'note'`-typed canvas node
	 * `applyNoteNodesAndEdges` already renders for the same IRI (Svelte's `each_key_duplicate`).
	 */
	async fetchAllIndividuals(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedIndividual[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?i ?type ?label ?syncSource ?syncStatus WHERE {
				GRAPH <${graphs.instances}> {
					?i a ?type .
					OPTIONAL { ?i rdfs:label ?label }
					OPTIONAL { ?i <${SYNC_SOURCE_PREDICATE_IRI}> ?syncSource }
					OPTIONAL { ?i <${SYNC_STATUS_PREDICATE_IRI}> ?syncStatus }
				}
				GRAPH ?classGraph { ?type a owl:Class }
				FILTER(?type NOT IN (${NON_INDIVIDUAL_TYPES}))
				${VOCAB_FILTER('?i')}
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.i.value,
			classIri: b.type.value,
			label: b.label?.value ?? extractLocalName(b.i.value),
			namespaceBaseIri,
			syncSource: b.syncSource?.value ?? null,
			syncStatus: b.syncStatus?.value ?? null
		}));
	}

	/**
	 * Labelled subjects in the namespace's instances graph that carry no `rdf:type`. Typed nodes
	 * (Notes, Workspaces, annotations, reified statements, individuals typed with a non-class IRI)
	 * are excluded by the missing-type rule itself; vocabulary IRIs and blank nodes are filtered out
	 * explicitly. No `FROM`, matching `fetchAllIndividuals`.
	 */
	async fetchUntypedIndividuals(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedUntypedIndividual[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?i ?label WHERE {
				GRAPH <${graphs.instances}> {
					?i rdfs:label ?label .
					FILTER NOT EXISTS { ?i rdf:type ?t }
					FILTER(!isBlank(?i))
					FILTER(?i != <${namespaceBaseIri}>)
					${VOCAB_FILTER('?i')}
				}
			}
			ORDER BY ?label ?i
			LIMIT ${UNCLASSIFIED_CANVAS_CAP}
		`);
		// One entry per IRI: a subject with several labels yields several rows, and a duplicate IRI
		// would be a duplicate canvas node id.
		const byIri = new Map<string, FetchedUntypedIndividual>();
		for (const b of results.results.bindings) {
			if (!byIri.has(b.i.value)) byIri.set(b.i.value, { iri: b.i.value, label: b.label.value, namespaceBaseIri });
		}
		return [...byIri.values()];
	}

	/** How many Unclassified individuals a namespace has — the same set `fetchUntypedIndividuals` caps. */
	async fetchUntypedIndividualCount(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<number> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT (COUNT(DISTINCT ?i) AS ?n) WHERE {
				GRAPH <${graphs.instances}> {
					?i rdfs:label ?label .
					FILTER NOT EXISTS { ?i rdf:type ?t }
					FILTER(!isBlank(?i))
					FILTER(?i != <${namespaceBaseIri}>)
					${VOCAB_FILTER('?i')}
				}
			}
		`);
		return Number(results.results.bindings[0]?.n?.value ?? 0);
	}

	/**
	 * Fetches everything needed to reconstruct the canvas (STORY-009): all classes, all
	 * datatype/object properties merged with their `sh:property` cardinality constraints, all
	 * `rdfs:subClassOf` triples, and all enumerated individuals (STORY-019) — all scoped to one
	 * namespace's three graphs. Pure canvas-model reconstruction from this data lives in
	 * `canvas-model.ts`, kept separate so it's testable without a running GraphDB.
	 */
	async fetchFullSchema(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<FetchedSchema> {
		const [
			classes,
			datatypeRaw,
			objectRaw,
			constraints,
			subClassOf,
			individuals,
			untypedIndividuals,
			untypedTotal,
			genericObjectProperties,
			individualClassRelations,
			individualIndividualRelations,
			labelRequiredClassIris,
			shapeInConstraints
		] = await Promise.all([
			this.fetchAllClasses(namespaceBaseIri),
			this.fetchAllDatatypeProperties(namespaceBaseIri),
			this.fetchAllObjectProperties(namespaceBaseIri),
			this.fetchAllShapesAndProperties(namespaceBaseIri),
			this.fetchAllSubClassOf(namespaceBaseIri),
			this.fetchAllIndividuals(namespaceBaseIri),
			this.fetchUntypedIndividuals(namespaceBaseIri),
			this.fetchUntypedIndividualCount(namespaceBaseIri),
			this.fetchGenericObjectPropertyEdges(namespaceBaseIri),
			this.fetchAllIndividualClassRelations(namespaceBaseIri),
			this.fetchAllIndividualIndividualRelations(namespaceBaseIri),
			this.fetchLabelRequiredClasses(namespaceBaseIri),
			this.fetchInConstraints(namespaceBaseIri)
		]);

		const constraintByPath = new Map(constraints.map((c) => [c.path, c]));
		const mergeCardinality = (props: FetchedPropertyBase[]): FetchedProperty[] =>
			props.map((p) => {
				const constraint = constraintByPath.get(p.iri);
				return {
					...p,
					required: (constraint?.minCount ?? 0) >= 1,
					repeatable: constraint?.maxCount === undefined,
					minCount: constraint?.minCount,
					maxCount: constraint?.maxCount,
					requiredForSubclasses: constraint?.requiredForSubclasses ?? false
				};
			});

		return {
			classes,
			datatypeProperties: mergeCardinality(datatypeRaw),
			objectProperties: [
				...mergeCardinality(objectRaw).map((p) => ({ ...p, relationKind: 'specific' as const })),
				...genericObjectProperties
			],
			subClassOf,
			individuals,
			untypedIndividuals,
			untypedTotal,
			individualClassRelations,
			individualIndividualRelations,
			labelRequiredClassIris,
			shapeInConstraints
		};
	}

	/**
	 * Fetches and merges every registered namespace's full schema into one (STORY-034, Decision 6)
	 * — the canvas always shows everything after a reload; STORY-033's client-side filter is what
	 * narrows the view from there. Each namespace's `fetchFullSchema` call already tags its own
	 * records with `namespaceBaseIri`, so a plain concatenation is enough to keep them distinguishable.
	 */
	async fetchFullSchemaForAllNamespaces(): Promise<FetchedSchema> {
		const namespaces = await this.fetchNamespaces();
		const schemas = await Promise.all(namespaces.map((ns) => this.fetchFullSchema(ns.baseIri)));
		return {
			classes: schemas.flatMap((s) => s.classes),
			datatypeProperties: schemas.flatMap((s) => s.datatypeProperties),
			objectProperties: schemas.flatMap((s) => s.objectProperties),
			subClassOf: schemas.flatMap((s) => s.subClassOf),
			individuals: schemas.flatMap((s) => s.individuals),
			// A namespace's own base IRI is its declaration subject, never an individual; and the same
			// IRI must not become two canvas nodes.
			untypedIndividuals: [
				...new Map(
					schemas
						.flatMap((s) => s.untypedIndividuals ?? [])
						.filter((u) => !namespaces.some((n) => n.baseIri === u.iri))
						.map((u) => [u.iri, u] as const)
				).values()
			]
				.sort((a, b) => a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri))
				.slice(0, UNCLASSIFIED_CANVAS_CAP),
			untypedTotal: schemas.reduce((sum, s) => sum + (s.untypedTotal ?? 0), 0),
			individualClassRelations: schemas.flatMap((s) => s.individualClassRelations),
			individualIndividualRelations: schemas.flatMap((s) => s.individualIndividualRelations),
			labelRequiredClassIris: schemas.flatMap((s) => s.labelRequiredClassIris ?? []),
			shapeInConstraints: schemas.flatMap((s) => s.shapeInConstraints ?? [])
		};
	}

	// -- Identity browsing (STORY-115/116/117, `spec/browse-identity/plan.md`) ------------------

	/**
	 * Paginated, faceted individual search (STORY-115) — port of `semantic-crm`'s
	 * `searchSubjectsWithMetadata`, simplified to a single `rdfs:label` match (v1 needs no
	 * configurable predicate list, research.md §7 row 4) and adapted for this app's multi-namespace,
	 * schema/instance-split data model.
	 *
	 * Deliberately unscoped to one namespace, unlike `fetchAllIndividuals` — this is a cross-namespace
	 * browse/search surface, so every triple pattern lives inside an unrestricted `GRAPH ?ig {...}`/
	 * `GRAPH ?classGraph {...}` block (never a bare pattern, never mixed with a `FROM` clause — see
	 * `fetchAllIndividuals`'s own doc comment for why that combination silently zeroes every result).
	 * `?ig` is the individual's own instances graph, which — per `namespaceGraphs()` — *is* that
	 * namespace's base IRI, so it doubles directly as the `namespaceBaseIri` facet/output field with no
	 * extra lookup needed.
	 *
	 * Individual-vs-schema-construct filtering reuses the exact `?type a owl:Class` cross-graph join
	 * `fetchAllIndividuals` already uses, plus its `Note`/`Workspace` exclusion and `VOCAB_FILTER`, so
	 * classes/properties/shapes (and Notes/Workspaces) never leak into results — none of that exists in
	 * the ported `semantic-crm` original, which has no schema/instance split to begin with.
	 *
	 * Pagination fetches one row past `limit` and trims it off to compute `hasMore`, closing the gap
	 * `semantic-crm`'s flat `LIMIT 100` cap left open (research.md §8).
	 */
	async searchIndividuals(params: IndividualSearchParams = {}): Promise<IndividualSearchPage> {
		const { query, classIri: classIriFilter, classIris: classIrisFilter, namespaceBaseIri, syncSource, syncStatus } =
			params;
		const unclassifiedOnly = params.unclassified === true;
		const limit = Math.max(1, Math.floor(params.limit ?? 50));
		const offset = Math.max(0, Math.floor(params.offset ?? 0));
		const matchAll = params.matchAllStringProperties === true;

		if (matchAll && (query?.length ?? 0) < MIN_ALL_STRINGS_SEARCH_LENGTH) {
			return { results: [], hasMore: false };
		}

		if (classIriFilter) this.assertSafeSparqlIri(classIriFilter, 'class IRI');
		classIrisFilter?.forEach((c) => this.assertSafeSparqlIri(c, 'class IRI'));
		if (namespaceBaseIri) this.assertSafeSparqlIri(namespaceBaseIri, 'namespace base IRI');

		const filters: string[] = [];
		if (unclassifiedOnly) {
			// no class filter applies to an individual that has no class
		} else if (classIrisFilter && classIrisFilter.length > 0) {
			filters.push(`FILTER(?type IN (${classIrisFilter.map((c) => `<${c}>`).join(', ')}))`);
		} else if (classIriFilter) {
			filters.push(`FILTER(?type = <${classIriFilter}>)`);
		}
		if (namespaceBaseIri) filters.push(`FILTER(?ig = <${namespaceBaseIri}>)`);
		if (syncSource !== undefined) {
			filters.push(`FILTER(BOUND(?syncSource) && STR(?syncSource) = "${this.escapeString(syncSource)}")`);
		}
		if (syncStatus !== undefined) {
			filters.push(`FILTER(BOUND(?syncStatus) && STR(?syncStatus) = "${this.escapeString(syncStatus)}")`);
		}
		if (query && !matchAll) {
			filters.push(
				`FILTER(BOUND(?label) && CONTAINS(LCASE(STR(?label)), LCASE("${this.escapeString(query)}")))`
			);
		}
		if (matchAll) filters.push('FILTER(?type != rdf:Statement)');
		const keyset = unclassifiedOnly ? params.after : undefined;
		if (keyset) {
			const l = this.escapeString(keyset.label);
			filters.push(
				`FILTER(STR(?label) > "${l}" || (STR(?label) = "${l}" && STR(?i) > "${this.escapeString(keyset.iri)}"))`
			);
		}

		// Unclassified individuals: labelled subjects with no `rdf:type` in their graph. Only returned when
		// asked for explicitly; `?i != ?ig` drops a namespace's own declaration subject.
		const includeUntyped = unclassifiedOnly;
		const includeTyped = !unclassifiedOnly;
		const untypedBlock = unclassifiedBlock();

		const matchPattern = matchAll
			? `?i ?mp ?mv .
					FILTER(isLiteral(?mv) && CONTAINS(LCASE(STR(?mv)), LCASE("${this.escapeString(query!)}")))`
			: '';
		const selectVars = matchAll
			? `?i ?type ?label ?ig ?syncSource ?syncStatus (SAMPLE(?mp) AS ?matchedProperty) (SAMPLE(?mv) AS ?matchedValue)`
			: '?i ?type ?label ?ig ?syncSource ?syncStatus';
		const groupBy = matchAll ? 'GROUP BY ?i ?type ?label ?ig ?syncSource ?syncStatus' : '';

		const typedBlock = `{
					GRAPH ?ig {
						?i a ?type .
						${matchPattern}
						OPTIONAL { ?i rdfs:label ?label }
						OPTIONAL { ?i <${SYNC_SOURCE_PREDICATE_IRI}> ?syncSource }
						OPTIONAL { ?i <${SYNC_STATUS_PREDICATE_IRI}> ?syncStatus }
					}
					GRAPH ?classGraph { ?type a owl:Class }
					FILTER(?type NOT IN (${NON_INDIVIDUAL_TYPES}))
					${VOCAB_FILTER('?i')}
				}`;

		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ${selectVars} WHERE {
				${[typedBlock, untypedBlock].filter((_, n) => (n === 0 ? includeTyped : includeUntyped)).join(' UNION ')}
				${filters.join('\n\t\t\t\t')}
			}
			${groupBy}
			ORDER BY ${unclassifiedOnly ? 'STR(?label) STR(?i)' : '?label ?i'}
			LIMIT ${limit + 1}
			${keyset ? '' : `OFFSET ${offset}`}
		`);

		const rows: IndividualSearchResult[] = results.results.bindings.map((b) => ({
			iri: b.i.value,
			classIri: b.type?.value ?? '',
			label: b.label?.value ?? extractLocalName(b.i.value),
			namespaceBaseIri: b.ig.value,
			syncSource: b.syncSource?.value ?? null,
			syncStatus: b.syncStatus?.value ?? null,
			...(matchAll && b.matchedProperty && b.matchedValue
				? { matchedPropertyIri: b.matchedProperty.value, matchedValue: b.matchedValue.value }
				: {})
		}));

		const hasMore = rows.length > limit;
		return { results: hasMore ? rows.slice(0, limit) : rows, hasMore };
	}

	/** How many Unclassified individuals match the namespace and label-text filters (all namespaces by
	 *  default) — the total behind the Identities page's Unclassified list. */
	async countUnclassified(params: { query?: string; namespaceBaseIri?: string } = {}): Promise<number> {
		const { query, namespaceBaseIri } = params;
		if (namespaceBaseIri) this.assertSafeSparqlIri(namespaceBaseIri, 'namespace base IRI');
		const filters: string[] = [];
		if (namespaceBaseIri) filters.push(`FILTER(?ig = <${namespaceBaseIri}>)`);
		if (query) {
			filters.push(`FILTER(CONTAINS(LCASE(STR(?label)), LCASE("${this.escapeString(query)}")))`);
		}
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT (COUNT(DISTINCT ?i) AS ?n) WHERE {
				${unclassifiedBlock()}
				${filters.join('\n\t\t\t\t')}
			}
		`);
		return Number(results.results.bindings[0]?.n?.value ?? 0);
	}

	/** The pattern selecting the Unclassified individuals a bulk run applies to: the shared Unclassified
	 *  block, the namespace/text/explicit-IRI filters, and never a synced individual. */
	private bulkUnclassifiedPattern(filter: BulkUnclassifiedFilter): string {
		const { query, namespaceBaseIri, iris } = filter;
		if (namespaceBaseIri) this.assertSafeSparqlIri(namespaceBaseIri, 'namespace base IRI');
		iris?.forEach((i) => this.assertSafeSparqlIri(i, 'individual IRI'));
		const parts = [unclassifiedBlock()];
		if (iris) parts.push(`VALUES ?i { ${iris.map((i) => `<${i}>`).join(' ')} }`);
		if (namespaceBaseIri) parts.push(`FILTER(?ig = <${namespaceBaseIri}>)`);
		if (query) parts.push(`FILTER(CONTAINS(LCASE(STR(?label)), LCASE("${this.escapeString(query)}")))`);
		parts.push(`FILTER NOT EXISTS { ?i <${SYNC_SOURCE_PREDICATE_IRI}> ?syncSource }`);
		return parts.join('\n\t\t\t\t');
	}

	private async countBulkUnclassified(filter: BulkUnclassifiedFilter): Promise<number> {
		if (filter.iris && filter.iris.length === 0) return 0;
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT (COUNT(DISTINCT ?i) AS ?n) WHERE { ${this.bulkUnclassifiedPattern(filter)} }
		`);
		return Number(results.results.bindings[0]?.n?.value ?? 0);
	}

	/**
	 * Gives every Unclassified individual matching `filter` the class `classIri`, `chunkSize` at a time
	 * (a single update over hundreds of thousands of rows would time out). Re-runnable: individuals that
	 * already got the class stop matching, so a cancelled or failed run is finished by running it again.
	 * Stops early when a chunk makes no progress, so it can never loop forever. Synced individuals and
	 * namespace declaration subjects never match.
	 */
	async assignClassToUnclassified(
		filter: BulkUnclassifiedFilter,
		classIri: string,
		options: {
			chunkSize?: number;
			signal?: AbortSignal;
			onProgress?: (progress: { assigned: number; total: number }) => void;
		} = {}
	): Promise<{ assigned: number; cancelled: boolean }> {
		this.assertSafeSparqlIri(classIri, 'class IRI');
		const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? 5000));
		const pattern = this.bulkUnclassifiedPattern(filter);

		let remaining = await this.countBulkUnclassified(filter);
		const total = remaining;
		let assigned = 0;
		while (remaining > 0) {
			if (options.signal?.aborted) return { assigned, cancelled: true };
			await this.executeUpdate(`${PREFIXES}
				INSERT { GRAPH ?ig { ?i a <${classIri}> } }
				WHERE { SELECT DISTINCT ?i ?ig WHERE { ${pattern} } ORDER BY ?i LIMIT ${chunkSize} }`);
			const after = await this.countBulkUnclassified(filter);
			if (after >= remaining) break;
			assigned += remaining - after;
			remaining = after;
			options.onProgress?.({ assigned, total });
		}
		return { assigned, cancelled: options.signal?.aborted === true && remaining > 0 };
	}

	/** Undo for an explicit selection: removes `classIri` from `iris`, only where it is still that class
	 *  (an individual re-classed since keeps its newer class). Capped, because the caller keeps the IRIs. */
	async unassignClassFromIndividuals(iris: string[], classIri: string): Promise<void> {
		if (iris.length > BULK_UNDO_LIMIT) {
			throw new Error(`Undo is limited to ${BULK_UNDO_LIMIT.toLocaleString('en-US')} individuals`);
		}
		this.assertSafeSparqlIri(classIri, 'class IRI');
		iris.forEach((i) => this.assertSafeSparqlIri(i, 'individual IRI'));
		if (iris.length === 0) return;
		await this.executeUpdate(`${PREFIXES}
			DELETE { GRAPH ?ig { ?i a <${classIri}> } }
			WHERE { VALUES ?i { ${iris.map((i) => `<${i}>`).join(' ')} } GRAPH ?ig { ?i a <${classIri}> } }`);
	}

	/**
	 * Facet counts for the all-strings search (query-workbench STORY-186): how many distinct matching
	 * individuals fall under each class and each namespace, over the *entire* match set — never
	 * limited by a result page. Uses the same graph structure, exclusions and term escaping as
	 * `searchIndividuals({ matchAllStringProperties: true })`. Two small `COUNT ... GROUP BY` queries
	 * (rather than one grouped by both) so a multi-typed individual isn't double-counted per namespace.
	 */
	async searchIndividualFacetCounts(params: { query: string }): Promise<IndividualFacetCounts> {
		const { query } = params;
		if ((query?.length ?? 0) < MIN_ALL_STRINGS_SEARCH_LENGTH) return { byClass: [], byNamespace: [] };
		const term = this.escapeString(query);

		const build = (groupVar: '?type' | '?ig') => `
			${PREFIXES}
			SELECT ${groupVar} (COUNT(DISTINCT ?i) AS ?count) WHERE {
				GRAPH ?ig {
					?i a ?type .
					?i ?mp ?mv .
					FILTER(isLiteral(?mv) && CONTAINS(LCASE(STR(?mv)), LCASE("${term}")))
				}
				GRAPH ?classGraph { ?type a owl:Class }
				FILTER(?type NOT IN (${NON_INDIVIDUAL_TYPES}))
				FILTER(?type != rdf:Statement)
				${VOCAB_FILTER('?i')}
			}
			GROUP BY ${groupVar}
			ORDER BY DESC(?count)
		`;

		const [byClass, byNamespace] = await Promise.all([
			this.selectQuery(build('?type')),
			this.selectQuery(build('?ig'))
		]);
		return {
			byClass: byClass.results.bindings.map((b) => ({
				classIri: b.type.value,
				count: Number(b.count.value)
			})),
			byNamespace: byNamespace.results.bindings.map((b) => ({
				namespaceBaseIri: b.ig.value,
				count: Number(b.count.value)
			}))
		};
	}

	/**
	 * "Everything about this one IRI" (STORY-116) — port of `semantic-crm`'s `fetchTriplesForSubject`
	 * (outgoing) + `fetchIncomingTriplesForObject` (incoming), merged into one call. Unlike
	 * `fetchIndividualAttributeValues`, this needs no prior knowledge of the individual's class's
	 * declared attribute list — it reads whatever triples actually exist on the IRI, which matters for
	 * inspecting a synced individual that carries data outside its class's declared shape.
	 *
	 * No `GRAPH`/`FROM` rewrite needed (research.md §8): both ported queries are already
	 * namespace-agnostic, so an individual and its class can each live in a different namespace
	 * (STORY-099) without any change here. No individual-vs-schema-construct filter either — unlike
	 * `searchIndividuals`/`fetchIdentityNeighborhood`, this method is explicitly scoped to one
	 * already-known IRI, so there's no unscoped result set for a class/property to leak into.
	 */
	async fetchResourcePage(iri: string): Promise<ResourcePage> {
		this.assertSafeSparqlIri(iri, 'resource IRI');

		const { outgoing: outgoingQuery, incoming: incomingQuery } = this.resourcePageQueries(iri);
		const [outgoingResults, incomingResults] = await Promise.all([
			this.selectQuery(outgoingQuery),
			this.selectQuery(incomingQuery)
		]);

		const outgoing: ResourcePageTriple[] = outgoingResults.results.bindings.map((b) => ({
			predicateIri: b.p.value,
			predicateLabel: b.pLabel?.value ?? extractLocalName(b.p.value),
			object: b.o.value,
			objectType: b.o.type === 'uri' ? ('uri' as const) : ('literal' as const),
			objectDatatype: b.o.type === 'uri' ? undefined : b.o.datatype,
			objectLabel: b.o.type === 'uri' ? b.oLabel?.value : undefined,
			predicateGroupOnOneLine: b.pGroupOnOneLine?.value === 'true',
			predicateDisplayAsChips: b.pDisplayAsChips?.value === 'true'
		}));

		const incoming: ResourcePageIncomingTriple[] = incomingResults.results.bindings.map((b) => ({
			subjectIri: b.s.value,
			subjectLabel: b.sLabel?.value ?? extractLocalName(b.s.value),
			predicateIri: b.p.value,
			predicateLabel: b.pLabel?.value ?? extractLocalName(b.p.value)
		}));

		return { iri, outgoing, incoming };
	}

	/** The two SELECT strings `fetchResourcePage` actually runs for `iri` — one FILTER-free triple
	 *  pattern each, issued as two parallel requests rather than the single UNION query below, since
	 *  there's no need to pay for a UNION's extra planning when the caller can just await both. */
	private resourcePageQueries(iri: string): { outgoing: string; incoming: string } {
		return {
			outgoing: `
				${PREFIXES}
				SELECT ?p ?o ?pLabel ?oLabel ?pGroupOnOneLine ?pDisplayAsChips WHERE {
					<${iri}> ?p ?o .
					OPTIONAL { ?p rdfs:label ?pLabel }
					OPTIONAL { ?o rdfs:label ?oLabel }
					OPTIONAL { ?p <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> ?pGroupOnOneLine }
					OPTIONAL { ?p <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> ?pDisplayAsChips }
				}
			`,
			incoming: `
				${PREFIXES}
				SELECT ?s ?p ?sLabel ?pLabel WHERE {
					?s ?p <${iri}> .
					OPTIONAL { ?s rdfs:label ?sLabel }
					OPTIONAL { ?p rdfs:label ?pLabel }
				}
			`
		};
	}

	/** STORY-119 follow-up: the "Copy query" action on the Identities resource page. Originally handed
	 *  the user `resourcePageQueries`'s two literal SELECTs concatenated with comment headers — but a
	 *  SPARQL query box (GraphDB's workbench included) accepts exactly one query per run, so that blob
	 *  couldn't actually be pasted and executed; it just looked like one string. This instead UNIONs
	 *  the two triple patterns into one query, sharing `?p`/`?pLabel` and folding "the other resource"
	 *  (object when outgoing, subject when incoming) into `?other`/`?otherLabel`, with `?direction`
	 *  telling the two apart in the results — a single paste-and-run query producing every row the
	 *  page shows for `iri`, at the cost of no longer being `fetchResourcePage`'s own literal strings. */
	buildResourcePageQuery(iri: string): string {
		this.assertSafeSparqlIri(iri, 'resource IRI');
		return `
			${PREFIXES}
			SELECT ?direction ?p ?pLabel ?other ?otherLabel WHERE {
				{
					BIND("outgoing" AS ?direction)
					<${iri}> ?p ?other .
					OPTIONAL { ?p rdfs:label ?pLabel }
					OPTIONAL { ?other rdfs:label ?otherLabel }
				}
				UNION
				{
					BIND("incoming" AS ?direction)
					?other ?p <${iri}> .
					OPTIONAL { ?other rdfs:label ?otherLabel }
					OPTIONAL { ?p rdfs:label ?pLabel }
				}
			}
		`.trim();
	}

	/**
	 * The Identities resource page's "Delete" action (STORY-119 follow-up) — removes an identity
	 * entirely: every triple `fetchResourcePage` would show for it, both directions. Deliberately a
	 * separate method from `deleteIndividual` (the schema canvas's "Manage Members" delete) rather
	 * than a shared one:
	 *
	 * - `deleteIndividual` only strips outgoing triples (`<iri> ?p ?o`) plus its own
	 *   `WorkspaceMembership`/Note-link cascades — canvas concepts this read-only, `Workspace`-free
	 *   view has no use for, and correctly never touches.
	 * - This method additionally strips every *incoming* triple (`?s ?p <iri>` — another individual's
	 *   relation pointing at this one), cross-graph (`GRAPH ?g {...}`, no `FROM` restriction, same
	 *   idiom `migrateIndividualsToNamespace`'s own cross-graph reference rewrite uses) since the
	 *   pointing individual can live in any namespace, not just this identity's own. Leaving those
	 *   behind would surface as a dangling "Incoming" link pointing at a since-deleted resource — the
	 *   exact case the confirmation dialog's "delete the corresponding triples (identity, properties,
	 *   links)" wording promises.
	 *
	 * Runs `deleteIndividual` first (its own cascades still apply if this identity happens to also be
	 * a canvas Workspace member/Note target), then a second cross-graph incoming-triple sweep.
	 */
	async deleteIdentity(iri: string, namespaceBaseIri?: string): Promise<void> {
		this.assertSafeSparqlIri(iri, 'individual IRI');
		await this.deleteIndividual(iri, namespaceBaseIri);
		await this.executeUpdate(`${PREFIXES} DELETE WHERE { GRAPH ?g { ?s ?p <${iri}> } }`);
	}

	/** Structural/ontology predicates excluded from `fetchIdentityNeighborhood` edges (STORY-117) —
	 *  the same starting exclusion set `semantic-crm`'s `fetchLinkedEntities` uses. SKOS has no
	 *  existing constant in this file (unlike `RDF`/`RDFS`, imported from `./turtle`), so its two
	 *  relevant IRIs are spelled out directly here rather than adding a SKOS namespace object for two
	 *  call sites. */
	private static readonly NEIGHBORHOOD_STRUCTURAL_PREDICATES = [
		RDF.type,
		RDFS.subClassOf,
		'http://www.w3.org/2004/02/skos/core#broader',
		'http://www.w3.org/2004/02/skos/core#inScheme',
		'http://www.w3.org/2004/02/skos/core#topConceptOf'
	];

	/**
	 * Small, on-demand local neighborhood (STORY-117) — port of `semantic-crm`'s `fetchLinkedEntities`,
	 * `VALUES`-seeded and fetching both outgoing and incoming edges of every seed IRI in one call. v1
	 * only ever expands one hop per call (`depth` beyond 1 is not implemented — research.md §7 row 3 /
	 * STORY-117's own description defer that to a future call-it-repeatedly UX, mirroring
	 * `semantic-crm`'s own `handleNodeExpand`); `depth <= 0` short-circuits to an empty graph, matching
	 * the ported original's own `depth === 0` guard.
	 *
	 * Individual-vs-schema-construct filtering (new, not in the ported original, research.md §8): both
	 * the seed lookup and the edge lookup require each endpoint to carry an `rdf:type` that is itself a
	 * declared `owl:Class` (the same cross-graph join `fetchAllIndividuals` uses), plus the same
	 * `Note`/`Workspace` exclusion and `VOCAB_FILTER` — so a structural edge can never pull a
	 * class/property/shape into the neighborhood as a node. `LIMIT 500` on the edge query mirrors the
	 * ported original's own cap, so one highly-connected node can't return an unbounded neighborhood.
	 */
	async fetchIdentityNeighborhood(seedIris: string[], depth: number = 1): Promise<NeighborhoodGraph> {
		if (depth <= 0 || seedIris.length === 0) {
			return { nodes: [], links: [] };
		}
		seedIris.forEach((iri) => this.assertSafeSparqlIri(iri, 'seed IRI'));

		const valuesClause = seedIris.map((iri) => `<${iri}>`).join(' ');
		const predicateExclusion = SparqlConnector.NEIGHBORHOOD_STRUCTURAL_PREDICATES.map(
			(p) => `?predicate != <${p}>`
		).join(' && ');

		const [seedResults, linkResults] = await Promise.all([
			this.selectQuery(`
				${PREFIXES}
				SELECT ?i ?type ?label ?ig WHERE {
					VALUES ?i { ${valuesClause} }
					GRAPH ?ig {
						?i a ?type .
						OPTIONAL { ?i rdfs:label ?label }
					}
					GRAPH ?classGraph { ?type a owl:Class }
					FILTER(?type NOT IN (${NON_INDIVIDUAL_TYPES}))
				}
			`),
			this.selectQuery(`
				${PREFIXES}
				SELECT DISTINCT ?source ?predicate ?target ?sourceLabel ?targetLabel ?predicateLabel ?sourceType ?targetType ?sourceTypeGraph ?targetTypeGraph WHERE {
					{
						VALUES ?source { ${valuesClause} }
						GRAPH ?sg { ?source ?predicate ?target . }
						FILTER(isIRI(?target))
					}
					UNION
					{
						VALUES ?target { ${valuesClause} }
						GRAPH ?tg { ?source ?predicate ?target . }
						FILTER(isIRI(?source))
					}
					FILTER(${predicateExclusion})
					GRAPH ?sourceTypeGraph { ?source a ?sourceType }
					GRAPH ?sourceClassGraph { ?sourceType a owl:Class }
					GRAPH ?targetTypeGraph { ?target a ?targetType }
					GRAPH ?targetClassGraph { ?targetType a owl:Class }
					FILTER(?sourceType NOT IN (${NON_INDIVIDUAL_TYPES}))
					FILTER(?targetType NOT IN (${NON_INDIVIDUAL_TYPES}))
					${VOCAB_FILTER('?source')}
					${VOCAB_FILTER('?target')}
					OPTIONAL { ?source rdfs:label ?sourceLabel }
					OPTIONAL { ?target rdfs:label ?targetLabel }
					OPTIONAL { ?predicate rdfs:label ?predicateLabel }
				}
				LIMIT 500
			`)
		]);

		const nodeMap = new Map<string, NeighborhoodNode>();
		for (const b of seedResults.results.bindings) {
			nodeMap.set(b.i.value, {
				iri: b.i.value,
				label: b.label?.value ?? extractLocalName(b.i.value),
				classIri: b.type.value,
				namespaceBaseIri: b.ig.value
			});
		}

		const links: NeighborhoodLink[] = [];
		for (const b of linkResults.results.bindings) {
			const sourceIri = b.source.value;
			const targetIri = b.target.value;
			if (!nodeMap.has(sourceIri)) {
				nodeMap.set(sourceIri, {
					iri: sourceIri,
					label: b.sourceLabel?.value ?? extractLocalName(sourceIri),
					classIri: b.sourceType.value,
					namespaceBaseIri: b.sourceTypeGraph.value
				});
			}
			if (!nodeMap.has(targetIri)) {
				nodeMap.set(targetIri, {
					iri: targetIri,
					label: b.targetLabel?.value ?? extractLocalName(targetIri),
					classIri: b.targetType.value,
					namespaceBaseIri: b.targetTypeGraph.value
				});
			}
			links.push({
				source: sourceIri,
				target: targetIri,
				predicateIri: b.predicate.value,
				predicateLabel: b.predicateLabel?.value ?? extractLocalName(b.predicate.value)
			});
		}

		return { nodes: Array.from(nodeMap.values()), links };
	}

	// -- Raw triples view (STORY-011) + manual edit & validation (STORY-012/013) ----------------

	/** Fetches every triple in one namespace's three graphs as quads, in one round-trip — the
	 *  basis for both the whole-graph Turtle view and the "old scope" computation on save. Runs
	 *  with `infer: false`: this is a view/edit of the *asserted* graph, so GraphDB's reasoner
	 *  materializations (e.g. reflexive `rdfs:subClassOf` on every class under an RDFS/OWL ruleset)
	 *  must not appear as if they were real triples — they'd otherwise round-trip into the editor
	 *  and even trip `checkStructural`'s cycle detector on an unrelated class's save. Also excludes
	 *  GraphDB's built-in vocabulary axioms via the same subject filter as
	 *  `fetchAllClasses`/`fetchAllSubClassOf`. */
	async fetchWholeGraphQuads(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<Quad[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(
			`SELECT ?s ?p ?o ${fromClause(graphs.instances, graphs.schema, graphs.shapes)} WHERE { ?s ?p ?o . ${VOCAB_FILTER('?s')} }`,
			{ infer: false }
		);
		return results.results.bindings.map((b) => bindingToQuad(b));
	}

	/** Fetches one named graph's own triples, tagged with that graph's IRI (STORY-036) — the
	 *  per-graph building block `fetchAllQuadsForExport` calls once per registered namespace's
	 *  three graphs, since a merged `FROM` query (as `fetchWholeGraphQuads` uses) loses which graph
	 *  each result row came from. */
	private async fetchGraphQuads(graph: string): Promise<Quad[]> {
		const results = await this.selectQuery(
			`SELECT ?s ?p ?o ${fromClause(graph)} WHERE { ?s ?p ?o . ${VOCAB_FILTER('?s')} }`,
			{ infer: false }
		);
		return results.results.bindings.map((b) => bindingToQuad(b, graph));
	}

	/**
	 * STORY-036: every registered namespace's instance/schema/shapes graph triples, each quad
	 * graph-tagged with its originating graph IRI — the "Export quads" settings menu action's data
	 * source. Bounded to registered namespaces only (`research.md` §12 Decision 9), never a raw
	 * repository-wide `GRAPH ?g {}` scan.
	 */
	async fetchAllQuadsForExport(): Promise<Quad[]> {
		const namespaces = await this.fetchNamespaces();
		const quadLists = await Promise.all(
			namespaces.flatMap((ns) => {
				const graphs = namespaceGraphs(ns.baseIri);
				return [graphs.instances, graphs.schema, graphs.shapes].map((graph) =>
					this.fetchGraphQuads(graph)
				);
			})
		);
		return quadLists.flat();
	}

	/** STORY-011: the whole schema graph, serialized as Turtle. Prefixes cover every registered
	 *  namespace (STORY-048's `buildDisplayPrefixes`) plus every registered external vocabulary
	 *  (STORY-050), not just the default `rse`/`rse_sh` pair, so e.g. `core:BusinessProcess` and
	 *  `gist:System` both display and round-trip on save without a hand-written `@prefix`. */
	async fetchAllTriplesAsTurtle(namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<string> {
		const [quads, namespaces, externalVocabularies] = await Promise.all([
			this.fetchWholeGraphQuads(namespaceBaseIri),
			this.fetchNamespaces(),
			this.fetchExternalVocabularies()
		]);
		return quadsToTurtle(quads, buildDisplayPrefixes(namespaces, externalVocabularies));
	}

	/** STORY-011: triples scoped to one selected entity/relation (see `selectScope` in `turtle.ts`
	 *  for the exact scoping rule), serialized as Turtle. Prefixes cover every registered namespace
	 *  and external vocabulary (see `fetchAllTriplesAsTurtle`). */
	async fetchTriplesForResourceAsTurtle(
		iri: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string> {
		this.assertSafeSparqlIri(iri, 'resource IRI');
		const [allQuads, namespaces, externalVocabularies] = await Promise.all([
			this.fetchWholeGraphQuads(namespaceBaseIri),
			this.fetchNamespaces(),
			this.fetchExternalVocabularies()
		]);
		return quadsToTurtle(selectScope(allQuads, iri), buildDisplayPrefixes(namespaces, externalVocabularies));
	}

	/**
	 * Story 001: a class's own scope only ever sees *incoming* individual relations asserted within
	 * its own namespace's graphs (`selectScopeUnfiltered`'s `isClass` branch) — an individual's
	 * assertion lives in *its own* namespace's instances graph (`insertAssertion`'s
	 * `findNamespaceOfIndividual`), not the target class's, so a cross-namespace relation like
	 * `gov:itam gov:isMasterFor core:Application` would never even reach `selectScope` when viewing
	 * `core:Application` (whose own scope only fetches `core`'s three graphs). This fetches every
	 * *other* registered namespace's whole graph and reuses `filterIncomingRelationQuads` against
	 * each one independently (each namespace's own quads are self-sufficient to validate its own
	 * predicates as declared `owl:ObjectProperty`/`owl:DatatypeProperty` triples, so no merging is
	 * needed before filtering) — returning only the matched ground triples, ready to append directly
	 * to an already-computed same-namespace scope. Returns `[]` when `classIri` isn't actually a
	 * class in `ownAllQuads` (the common case — most `selectScope` calls target an individual,
	 * property, or the whole graph) or there are no other registered namespaces to check.
	 */
	private async fetchCrossNamespaceIncomingRelationQuads(
		classIri: string,
		ownAllQuads: Quad[],
		ownNamespaceBaseIri: string,
		namespaces: FetchedNamespace[]
	): Promise<Quad[]> {
		const isClass = ownAllQuads.some((q) => q.subject.value === classIri && isRdfType(q, OWL.Class));
		if (!isClass) return [];
		const otherNamespaces = namespaces.filter((ns) => ns.baseIri !== ownNamespaceBaseIri);
		if (otherNamespaces.length === 0) return [];

		const targets = classIncomingRelationTargets(ownAllQuads, classIri);
		const quadLists = await Promise.all(
			otherNamespaces.map(async (ns) => {
				const nsQuads = await this.fetchWholeGraphQuads(ns.baseIri);
				return filterIncomingRelationQuads(nsQuads, targets);
			})
		);
		return quadLists.flat();
	}

	/**
	 * STORY-018: both tabs' Turtle for the current scope (whole graph or one selected
	 * entity/relation), computed from a single whole-graph fetch — Schema tab via
	 * STORY-014/015's `partitionQuads` + `groupSchemaQuads`, Shapes tab via STORY-014/016's
	 * `partitionQuads` + `nestBlankNodes` (never a bare top-level `_:b0` statement). Prefixes cover
	 * every registered namespace and external vocabulary (see `fetchAllTriplesAsTurtle`). When `iri`
	 * is a class, also merges in cross-namespace incoming relations (Story 001,
	 * `fetchCrossNamespaceIncomingRelationQuads`) — appended after same-namespace scoping rather than
	 * fed back into `selectScope`, since re-validating them against the combined pool would drop them
	 * again (their predicate's own `owl:ObjectProperty`/`owl:DatatypeProperty` declaration lives only
	 * in their own namespace, not `iri`'s).
	 */
	async fetchScopedTurtlePair(
		iri: string | null,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ schema: string; shapes: string }> {
		if (iri !== null) this.assertSafeSparqlIri(iri, 'resource IRI');
		const [allQuads, namespaces, externalVocabularies] = await Promise.all([
			this.fetchWholeGraphQuads(namespaceBaseIri),
			this.fetchNamespaces(),
			this.fetchExternalVocabularies()
		]);
		const crossNamespaceQuads =
			iri !== null
				? await this.fetchCrossNamespaceIncomingRelationQuads(iri, allQuads, namespaceBaseIri, namespaces)
				: [];
		const prefixes = buildDisplayPrefixes(namespaces, externalVocabularies);
		const { schema: crossSchema, shapes: crossShapes } = partitionQuads(crossNamespaceQuads);
		const schema = await quadsToTurtle(
			groupSchemaQuads([...selectScope(allQuads, iri, 'schema'), ...crossSchema]),
			prefixes
		);
		const shapes = nestBlankNodes([...selectScope(allQuads, iri, 'shapes'), ...crossShapes], prefixes);
		return { schema, shapes };
	}

	/**
	 * STORY-082: the read-only Workspace-scoped Triples view's Turtle — the union of every
	 * `WorkspaceMembership.element`'s own `selectScope`, across whichever namespaces those members
	 * happen to live in. Grouped by owning namespace (via `fetchFullSchemaForAllNamespaces`'s own
	 * `namespaceBaseIri` field on each class/individual, avoiding a per-member lookup round-trip) so
	 * each namespace's whole graph is fetched exactly once and every member within it is scoped
	 * against that *same* round-trip's quads — `selectScope`'s own contract requires this, since blank
	 * node labels (`sh:property` shapes) are only guaranteed consistent within one query's result set.
	 * Each namespace group is serialized independently via the same `groupSchemaQuads`/`nestBlankNodes`/
	 * `buildDisplayPrefixes` pipeline `fetchScopedTurtlePair` uses, then the resulting Turtle *text*
	 * blocks are concatenated — never merging raw quads across namespace groups, which would risk two
	 * different namespaces' independently-minted blank nodes colliding under the same label. A stale
	 * membership row (its element deleted without STORY-081's cascade cleanup somehow running) is
	 * silently skipped rather than erroring, since it names no known class/individual to look up.
	 */
	async fetchScopedTurtleForWorkspace(workspaceIriValue: string): Promise<{ schema: string; shapes: string }> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		const [members, schema, namespaces, externalVocabularies] = await Promise.all([
			this.fetchWorkspaceMembers(workspaceIriValue),
			this.fetchFullSchemaForAllNamespaces(),
			this.fetchNamespaces(),
			this.fetchExternalVocabularies()
		]);

		const namespaceByIri = new Map<string, string>();
		for (const c of schema.classes) namespaceByIri.set(c.iri, c.namespaceBaseIri);
		for (const i of schema.individuals) namespaceByIri.set(i.iri, i.namespaceBaseIri);

		const memberIrisByNamespace = new Map<string, string[]>();
		for (const { elementIri } of members) {
			const namespaceBaseIri = namespaceByIri.get(elementIri);
			if (!namespaceBaseIri) continue;
			const list = memberIrisByNamespace.get(namespaceBaseIri) ?? [];
			list.push(elementIri);
			memberIrisByNamespace.set(namespaceBaseIri, list);
		}

		const prefixes = buildDisplayPrefixes(namespaces, externalVocabularies);
		const schemaParts: string[] = [];
		const shapesParts: string[] = [];
		for (const [namespaceBaseIri, memberIris] of memberIrisByNamespace) {
			const allQuads = await this.fetchWholeGraphQuads(namespaceBaseIri);
			const schemaQuads = dedupeQuads(memberIris.flatMap((iri) => selectScope(allQuads, iri, 'schema')));
			const shapesQuads = dedupeQuads(memberIris.flatMap((iri) => selectScope(allQuads, iri, 'shapes')));
			schemaParts.push(await quadsToTurtle(groupSchemaQuads(schemaQuads), prefixes));
			shapesParts.push(nestBlankNodes(shapesQuads, prefixes));
		}
		return { schema: schemaParts.join('\n'), shapes: shapesParts.join('\n') };
	}

	/** Hand-formats a Workspace's own declaration triple, mirroring `insertWorkspace`'s `INSERT DATA`
	 *  body exactly (STORY-090) — spelled out with full `<IRI>` predicates rather than the `rdfs:`
	 *  prefix, since this text is appended directly into the bundle rather than run as a SPARQL
	 *  update. */
	private buildWorkspaceDeclTurtle(workspace: FetchedWorkspace): string {
		const label = this.escapeString(workspace.label);
		const defaultNsTriple = workspace.defaultNamespaceBaseIri
			? ` ; <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> <${workspace.defaultNamespaceBaseIri}>`
			: '';
		return `<${workspace.iri}> <${RDF.type}> <${WORKSPACE_CLASS_IRI}> ; <${RDFS.label}> "${label}"${defaultNsTriple} .\n`;
	}

	/** Hand-formats one `WorkspaceMembership` row's triples, mirroring `addWorkspaceMember`'s
	 *  `INSERT DATA` body exactly (STORY-090). */
	private buildMembershipTurtle(workspaceIriValue: string, elementIri: string, x: number, y: number): string {
		const membershipIri = workspaceMembershipIri(workspaceIriValue, elementIri);
		return (
			`<${membershipIri}> <${RDF.type}> <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ; ` +
			`<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ; ` +
			`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}> ; ` +
			`<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "${x}"^^<${XSD_NAMESPACE}decimal> ; ` +
			`<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "${y}"^^<${XSD_NAMESPACE}decimal> .\n`
		);
	}

	/** Hand-formats one Note's triples, mirroring `insertNote`'s `INSERT DATA` body exactly
	 *  (STORY-090). */
	private buildNoteTurtle(workspaceIriValue: string, note: FetchedNote): string {
		const color = this.escapeString(note.color);
		const textTriple = note.text ? ` ; <${NOTE_TEXT_PREDICATE_IRI}> "${this.escapeString(note.text)}"` : '';
		const linkedTriple = note.linkedElementIri
			? ` ; <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${note.linkedElementIri}>`
			: '';
		return (
			`<${note.iri}> <${RDF.type}> <${NOTE_CLASS_IRI}> ; ` +
			`<${NOTE_WORKSPACE_PREDICATE_IRI}> <${workspaceIriValue}> ; ` +
			`<${NOTE_COLOR_PREDICATE_IRI}> "${color}" ; ` +
			`<${NOTE_X_PREDICATE_IRI}> "${note.x}"^^<${XSD_NAMESPACE}decimal> ; ` +
			`<${NOTE_Y_PREDICATE_IRI}> "${note.y}"^^<${XSD_NAMESPACE}decimal>${textTriple}${linkedTriple} .\n`
		);
	}

	/** Hand-formats one namespace's own declaration triple, mirroring `insertNamespace`'s
	 *  `INSERT DATA` body exactly (STORY-090). */
	private buildNamespaceDeclTurtle(namespace: FetchedNamespace): string {
		const prefix = this.escapeString(namespace.prefix);
		const commentTriple = namespace.description
			? ` ; <${RDFS.comment}> "${this.escapeString(namespace.description)}"`
			: '';
		const colorTriple = namespace.color
			? ` ; <${NAMESPACE_COLOR_PREDICATE_IRI}> "${this.escapeString(namespace.color)}"`
			: '';
		const publisherTriple = namespace.publisher
			? ` ; <${DCT.publisher}> "${this.escapeString(namespace.publisher)}"`
			: '';
		const licenseTriple = namespace.license ? ` ; <${DCT.license}> <${namespace.license}>` : '';
		return (
			`<${namespace.baseIri}> <${RDF.type}> <${NAMESPACE_CLASS_IRI}> ; ` +
			`<${NAMESPACE_PREFIX_PREDICATE_IRI}> "${prefix}"${commentTriple}${colorTriple}${publisherTriple}${licenseTriple} .\n`
		);
	}

	/**
	 * STORY-090: assembles a Workspace into one self-contained `.ttl` bundle — its own declaration,
	 * every `WorkspaceMembership` row, every `Note`, every member's own schema+shapes triples (the
	 * same per-namespace `selectScope` union `fetchScopedTurtleForWorkspace` already computes),
	 * STORY-089's external-dependency-closure classes' own schema+shapes triples, and the `Namespace`
	 * declaration of every namespace touched by either — so the result can be handed to a colleague
	 * running an entirely separate GraphDB repository and merged in via `importWorkspaceBundle`
	 * (STORY-092) without dangling references.
	 *
	 * The dependency closure (STORY-089) is resolved independently per member namespace group: a
	 * namespace's own `declaredClassIris` are derived from that same namespace's already-fetched
	 * `allQuads`, so a closure hit is always a class/property declared in the *same* namespace as the
	 * member that referenced it (e.g. a workspace member's `rdfs:subClassOf` pointing at a
	 * non-member superclass in its own namespace) — this is the common case research.md's export
	 * scenario describes; a reference crossing into a *different* namespace entirely is out of scope
	 * for this closure pass (`declaredClassIris` never matches across namespaces), same limitation
	 * `fetchScopedTurtleForWorkspace` already has for cross-namespace incoming relations.
	 */
	async exportWorkspaceBundle(workspaceIriValue: string): Promise<WorkspaceExportBundle> {
		this.assertSafeSparqlIri(workspaceIriValue, 'workspace IRI');
		const [workspaces, members, notes, schema, namespaces, externalVocabularies] = await Promise.all([
			this.fetchWorkspaces(),
			this.fetchWorkspaceMembers(workspaceIriValue),
			this.fetchNotesForWorkspace(workspaceIriValue),
			this.fetchFullSchemaForAllNamespaces(),
			this.fetchNamespaces(),
			this.fetchExternalVocabularies()
		]);

		const workspace = workspaces.find((w) => w.iri === workspaceIriValue);
		if (!workspace) throw new Error(`Workspace not found: ${workspaceIriValue}`);

		const namespaceByIri = new Map<string, string>();
		for (const c of schema.classes) namespaceByIri.set(c.iri, c.namespaceBaseIri);
		for (const i of schema.individuals) namespaceByIri.set(i.iri, i.namespaceBaseIri);

		const memberIrisByNamespace = new Map<string, string[]>();
		for (const { elementIri } of members) {
			const namespaceBaseIri = namespaceByIri.get(elementIri);
			if (!namespaceBaseIri) continue;
			const list = memberIrisByNamespace.get(namespaceBaseIri) ?? [];
			list.push(elementIri);
			memberIrisByNamespace.set(namespaceBaseIri, list);
		}

		const prefixes = buildDisplayPrefixes(namespaces, externalVocabularies);
		const schemaParts: string[] = [];
		const shapesParts: string[] = [];
		let truncatedDependencyCount = 0;

		for (const [namespaceBaseIri, memberIris] of memberIrisByNamespace) {
			const allQuads = await this.fetchWholeGraphQuads(namespaceBaseIri);
			const declaredClassIris = new Set(
				allQuads
					.filter(
						(q) =>
							isRdfType(q, OWL.Class) || isRdfType(q, OWL.DatatypeProperty) || isRdfType(q, OWL.ObjectProperty)
					)
					.map((q) => q.subject.value)
			);
			const closure = resolveExternalDependencyClosure(
				allQuads,
				memberIris,
				declaredClassIris,
				EXTERNAL_DEPENDENCY_CLOSURE_CAP
			);
			if (closure.size >= EXTERNAL_DEPENDENCY_CLOSURE_CAP) {
				const fullClosure = resolveExternalDependencyClosure(
					allQuads,
					memberIris,
					declaredClassIris,
					Number.MAX_SAFE_INTEGER
				);
				truncatedDependencyCount += fullClosure.size - closure.size;
			}

			const scopedIris = [...memberIris, ...closure];
			const schemaQuads = dedupeQuads(scopedIris.flatMap((iri) => selectScope(allQuads, iri, 'schema')));
			const shapesQuads = dedupeQuads(scopedIris.flatMap((iri) => selectScope(allQuads, iri, 'shapes')));
			schemaParts.push(await quadsToTurtle(groupSchemaQuads(schemaQuads), prefixes));
			shapesParts.push(nestBlankNodes(shapesQuads, prefixes));
		}

		const touchedNamespaces = new Set(memberIrisByNamespace.keys());
		const namespaceDeclBlock = namespaces
			.filter((ns) => touchedNamespaces.has(ns.baseIri))
			.map((ns) => this.buildNamespaceDeclTurtle(ns))
			.join('');
		const workspaceBlock = this.buildWorkspaceDeclTurtle(workspace);
		const membershipBlock = members
			.map((m) => this.buildMembershipTurtle(workspaceIriValue, m.elementIri, m.x, m.y))
			.join('');
		const noteBlock = notes.map((n) => this.buildNoteTurtle(workspaceIriValue, n)).join('');

		const turtle = [...schemaParts, ...shapesParts, namespaceDeclBlock, workspaceBlock, membershipBlock, noteBlock]
			.filter((part) => part.trim().length > 0)
			.join('\n');

		return { turtle, truncatedDependencyCount };
	}

	/**
	 * STORY-012/013: parses `turtleText` as the new content for `iri`'s scope (or the whole graph,
	 * if `iri` is `null`), validates it (syntax, then SHACL well-formedness + OWL/RDFS structural
	 * checks against the graph as it would look post-edit), and — only if every check passes —
	 * atomically replaces the old scope's triples with the new ones. Nothing reaches GraphDB on a
	 * validation failure (`SchemaValidationError`, thrown before any update is sent).
	 *
	 * "Diff" here is replace-scope, not a minimal per-triple patch: the *entire* previous scope
	 * (including any nested `sh:property` blank nodes) is deleted via `DELETE WHERE` pattern
	 * matching, and the entire new scope is inserted via `INSERT DATA`. This sidesteps blank-node
	 * identity matching across independent SPARQL round-trips (not guaranteed stable across
	 * queries), while still producing one atomic update — matching the story's own "replace-scope
	 * semantics" framing of the diff. New quads are classified into the namespace's
	 * instances/schema/shapes graphs the same way `partitionQuads`/individual-detection classify
	 * everywhere else (STORY-026), so a Turtle edit that adds a class, an attribute, and an
	 * individual all in one save still lands each triple in its correct graph.
	 *
	 * STORY-012's AC asks, at minimum, for a warning if the edit leaves another property's
	 * `rdfs:domain`/`rdfs:range` dangling (e.g. the edit deletes a class something else still
	 * points at). `checkStructural` runs against the *whole* post-edit graph, not just the edited
	 * scope, so it already catches every such case as a hard validation failure — a strictly
	 * stronger guarantee than a warning, so there's no separate warning path here.
	 */
	async saveScopedTurtle(
		iri: string | null,
		turtleText: string,
		partition: Partition = 'all',
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		if (iri !== null) this.assertSafeSparqlIri(iri, 'resource IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);

		const allQuadsBefore = await this.fetchWholeGraphQuads(namespaceBaseIri);
		// Unfiltered scope, used only to determine scope *structure* (is this a class? does it have
		// a domain?) — `buildScopeDeleteOps` needs that even when `partition` has filtered away the
		// very quad (e.g. the `owl:Class` triple) that structure would otherwise be read from.
		const fullScopeQuads = selectScope(allQuadsBefore, iri);
		const oldScopeQuads = selectScope(allQuadsBefore, iri, partition);
		const oldScopeKeys = new Set(oldScopeQuads.map(quadKey));
		const restOfGraph = allQuadsBefore.filter((q) => !oldScopeKeys.has(quadKey(q)));

		let newQuads: Quad[];
		try {
			newQuads = parseTurtle(turtleText);
		} catch (err) {
			throw new SchemaValidationError([
				{ layer: 'syntax', message: err instanceof Error ? err.message : String(err) }
			]);
		}

		const mergedGraph = [...restOfGraph, ...newQuads];
		const declaredClasses = new Set(
			mergedGraph.filter((q) => isRdfType(q, OWL.Class)).map((q) => q.subject.value)
		);

		const authoritativeEntityClassIri = await this.fetchAuthoritativeEntityClassIri();
		const issues = [
			...checkShaclWellFormedness(newQuads, declaredClasses),
			...checkStructural(mergedGraph, authoritativeEntityClassIri)
		];
		// Backstage-mapping Story 005: `severity: 'warning'` issues (e.g. a `backstageKind`'d class
		// missing catalog-marker ancestry) are surfaced but must not block the save.
		const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
		if (blockingIssues.length > 0) throw new SchemaValidationError(blockingIssues);

		const deleteOps = this.buildScopeDeleteOps(iri, fullScopeQuads, partition, graphs);
		const insertOp = await this.buildScopeInsertOp(newQuads, graphs);
		const ops = [...deleteOps, insertOp].filter(Boolean).join(' ; ');
		if (ops) {
			await this.executeUpdate(`${PREFIXES} ${ops}`);
		}
	}

	/**
	 * STORY-044: imports a `.ttl` file's triples by merging them into the graph — unlike
	 * `saveScopedTurtle`, this never issues a `DELETE`, so nothing pre-existing can be lost.
	 *
	 * 1. Parses `text` (a syntax error aborts immediately, same `SchemaValidationError` shape as
	 *    `saveScopedTurtle`).
	 * 2. Resolves each unique named-node subject's owning namespace via `findNamespaceOfSubject`,
	 *    falling back to `namespaceBaseIri` (the caller-specified/active namespace) for subjects
	 *    with no existing triples anywhere — i.e. genuinely new classes/properties/individuals.
	 *    Blank-node subjects (`sh:property` shapes) have no cross-query identity of their own, so
	 *    they inherit whichever namespace the (possibly transitively blank) subject that references
	 *    them as an object resolved to — an orphaned blank node with no referencer also falls back
	 *    to `namespaceBaseIri`.
	 * 3. Fetches the current whole-graph content of every namespace touched by step 2 (just once
	 *    per namespace, not per subject) and classifies each parsed quad against it: an exact
	 *    subject+predicate+object match is a duplicate (skipped); a same subject+predicate match
	 *    with a different object is a conflict (skipped, never overwritten); anything else is a
	 *    clean insert.
	 * 4. Validates the clean-insert quads merged into their namespaces' existing content with the
	 *    same `checkShaclWellFormedness`/`checkStructural` gate manual Turtle edits use — a failure
	 *    aborts with zero writes, before anything reaches GraphDB.
	 * 5. Writes the clean-insert quads via `buildScopeInsertOp`, grouped per resolved namespace, as
	 *    one atomic update.
	 */
	async importTurtle(
		text: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<ImportSummary> {
		let newQuads: Quad[];
		try {
			newQuads = parseTurtle(text);
		} catch (err) {
			throw new SchemaValidationError([
				{ layer: 'syntax', message: err instanceof Error ? err.message : String(err) }
			]);
		}

		const namedSubjectIris = [
			...new Set(
				newQuads.filter((q) => q.subject.termType === 'NamedNode').map((q) => q.subject.value)
			)
		];
		const resolvedNamedSubjects = await Promise.all(
			namedSubjectIris.map(async (subjectIri) => {
				const found = await this.findNamespaceOfSubject(subjectIri);
				return [subjectIri, found ?? namespaceBaseIri] as const;
			})
		);
		const subjectNamespace = new Map<string, string>(resolvedNamedSubjects);

		// Blank-node subjects inherit the namespace of whoever references them as an object —
		// recursing through chains of blank nodes, if any — since a fresh parse's blank node labels
		// have no identity in the store to look up directly (see doc comment above).
		function resolveBlankNamespace(blankValue: string, seen: Set<string>): string {
			if (seen.has(blankValue)) return namespaceBaseIri;
			seen.add(blankValue);
			const referencing = newQuads.find(
				(q) => q.object.termType === 'BlankNode' && q.object.value === blankValue
			);
			if (!referencing) return namespaceBaseIri;
			if (referencing.subject.termType === 'BlankNode') {
				return resolveBlankNamespace(referencing.subject.value, seen);
			}
			return subjectNamespace.get(referencing.subject.value) ?? namespaceBaseIri;
		}
		const blankSubjectValues = [
			...new Set(newQuads.filter((q) => q.subject.termType === 'BlankNode').map((q) => q.subject.value))
		];
		const blankNamespace = new Map<string, string>(
			blankSubjectValues.map((b) => [b, resolveBlankNamespace(b, new Set())])
		);

		function namespaceOfSubject(subject: Quad['subject']): string {
			return subject.termType === 'BlankNode'
				? (blankNamespace.get(subject.value) ?? namespaceBaseIri)
				: (subjectNamespace.get(subject.value) ?? namespaceBaseIri);
		}

		const involvedNamespaces = new Set<string>([
			...subjectNamespace.values(),
			...blankNamespace.values(),
			namespaceBaseIri
		]);
		const existingByNamespace = new Map<string, Quad[]>(
			await Promise.all(
				[...involvedNamespaces].map(
					async (ns) => [ns, await this.fetchWholeGraphQuads(ns)] as const
				)
			)
		);
		const existingQuads = [...existingByNamespace.values()].flat();
		const existingQuadKeys = new Set(existingQuads.map(quadKey));
		const existingSubjectPredicates = new Set(
			existingQuads.map((q) => `${q.subject.termType}|${q.subject.value}|${q.predicate.value}`)
		);

		const inserted: Quad[] = [];
		const insertedInfo: ImportedTripleInfo[] = [];
		const duplicates: ImportedTripleInfo[] = [];
		const conflicts: ImportedTripleInfo[] = [];
		for (const q of newQuads) {
			const info: ImportedTripleInfo = { subject: q.subject.value, predicate: q.predicate.value };
			if (existingQuadKeys.has(quadKey(q))) {
				duplicates.push(info);
				continue;
			}
			const subjectPredicateKey = `${q.subject.termType}|${q.subject.value}|${q.predicate.value}`;
			if (existingSubjectPredicates.has(subjectPredicateKey)) {
				conflicts.push(info);
				continue;
			}
			inserted.push(q);
			insertedInfo.push(info);
		}

		const mergedGraph = [...existingQuads, ...inserted];
		const declaredClasses = new Set(
			mergedGraph.filter((q) => isRdfType(q, OWL.Class)).map((q) => q.subject.value)
		);
		const authoritativeEntityClassIri = await this.fetchAuthoritativeEntityClassIri();
		const issues = [
			...checkShaclWellFormedness(inserted, declaredClasses),
			...checkStructural(mergedGraph, authoritativeEntityClassIri)
		];
		// Backstage-mapping Story 005: `severity: 'warning'` issues must not block the import.
		const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
		if (blockingIssues.length > 0) throw new SchemaValidationError(blockingIssues);

		const insertedByNamespace = new Map<string, Quad[]>();
		for (const q of inserted) {
			const ns = namespaceOfSubject(q.subject);
			const list = insertedByNamespace.get(ns) ?? [];
			list.push(q);
			insertedByNamespace.set(ns, list);
		}
		const insertOps = await Promise.all(
			[...insertedByNamespace.entries()].map(([ns, quads]) =>
				this.buildScopeInsertOp(quads, namespaceGraphs(ns))
			)
		);
		const ops = insertOps.filter(Boolean).join(' ; ');
		if (ops) {
			await this.executeUpdate(`${PREFIXES} ${ops}`);
		}

		return { inserted: insertedInfo, duplicates, conflicts };
	}

	/**
	 * STORY-092: imports a bundle produced by `exportWorkspaceBundle` (STORY-090) and merges it into
	 * the graph, per `research.md` §4.3:
	 *
	 * 1. Parses `text`, then partitions the quads by which vocabulary type their subject carries:
	 *    `Workspace`/`WorkspaceMembership`/`Note`/`Namespace` go to their own bucket regardless of the
	 *    caller's active namespace; everything else ("rest") is ordinary schema/shapes content.
	 * 2. Registers any namespace referenced in the Namespace bucket that the target doesn't already
	 *    have, **before** the rest bucket is merged — the ordering is load-bearing, since a
	 *    newly-introduced class's own namespace must already exist for `importTurtle`'s per-subject
	 *    `findNamespaceOfSubject` resolution to land it in the right graph instead of falling back to
	 *    the caller's active namespace.
	 * 3. Merges the rest bucket through the existing, **unmodified** `importTurtle` — same
	 *    duplicate/conflict classification and validation gate it already runs. A validation failure
	 *    here aborts the whole import (this method never reaches steps 4–6) with zero
	 *    Workspace/Membership/Note writes; namespace registration from step 2 is a durable
	 *    prerequisite step, not part of what step 3 might roll back, so it's the one write that can
	 *    precede a subsequent failure — an accepted trade-off (plan.md's Epic A risk assessment),
	 *    since re-importing after fixing the bundle just finds that namespace already registered.
	 * 4. `Workspace` bucket via STORY-091's `ensureWorkspace` per declaration found.
	 * 5. `WorkspaceMembership` bucket via STORY-091's (confirmed-idempotent) `addWorkspaceMember` per
	 *    row, using the bundle's own `x`/`y` — never overwrites an existing position.
	 * 6. `Note` bucket via STORY-091's `ensureNoteAtIri` per note, keyed on the bundle's own literal
	 *    IRI (not re-minted) — what makes re-importing the same file idempotent for Notes too.
	 */
	async importWorkspaceBundle(text: string): Promise<WorkspaceImportSummary> {
		let allQuads: Quad[];
		try {
			allQuads = parseTurtle(text);
		} catch (err) {
			throw new SchemaValidationError([
				{ layer: 'syntax', message: err instanceof Error ? err.message : String(err) }
			]);
		}

		const specialTypeIris = new Set<string>([
			WORKSPACE_CLASS_IRI,
			WORKSPACE_MEMBERSHIP_CLASS_IRI,
			NOTE_CLASS_IRI,
			NAMESPACE_CLASS_IRI
		]);
		const subjectType = new Map<string, string>();
		for (const q of allQuads) {
			if (
				q.predicate.value === RDF.type &&
				q.subject.termType === 'NamedNode' &&
				q.object.termType === 'NamedNode' &&
				specialTypeIris.has(q.object.value)
			) {
				subjectType.set(q.subject.value, q.object.value);
			}
		}

		const workspaceQuads: Quad[] = [];
		const membershipQuads: Quad[] = [];
		const noteQuads: Quad[] = [];
		const namespaceQuads: Quad[] = [];
		const restQuads: Quad[] = [];
		for (const q of allQuads) {
			const type = q.subject.termType === 'NamedNode' ? subjectType.get(q.subject.value) : undefined;
			if (type === WORKSPACE_CLASS_IRI) workspaceQuads.push(q);
			else if (type === WORKSPACE_MEMBERSHIP_CLASS_IRI) membershipQuads.push(q);
			else if (type === NOTE_CLASS_IRI) noteQuads.push(q);
			else if (type === NAMESPACE_CLASS_IRI) namespaceQuads.push(q);
			else restQuads.push(q);
		}

		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

		// Step 2: register namespaces first — load-bearing ordering, see doc comment above.
		let namespacesInserted = 0;
		let namespacesAlreadyPresent = 0;
		for (const [baseIri, quads] of groupQuadsBySubject(namespaceQuads)) {
			const exists = await this.askQuery(
				`${PREFIXES} ASK ${fromClause(defaultGraphs.schema)} { <${baseIri}> a <${NAMESPACE_CLASS_IRI}> }`
			);
			if (exists) {
				namespacesAlreadyPresent++;
				continue;
			}
			const prefix = findLiteral(quads, NAMESPACE_PREFIX_PREDICATE_IRI) ?? '';
			await this.insertNamespace(
				prefix,
				baseIri,
				findLiteral(quads, RDFS.comment),
				findLiteral(quads, NAMESPACE_COLOR_PREDICATE_IRI),
				findLiteral(quads, DCT.publisher),
				findNamedNode(quads, DCT.license)
			);
			namespacesInserted++;
		}

		// Step 3: ordinary schema/shapes content through the existing, unmodified importTurtle — but
		// split into one call per namespace the content actually belongs to, rather than one call for
		// the whole rest bucket. A brand-new namespace (just registered in step 2, above) has no
		// existing graph content yet, so `importTurtle`'s own per-subject `findNamespaceOfSubject`
		// cross-graph lookup would find nothing for a genuinely new class and fall back to whatever
		// single `namespaceBaseIri` default this call passed — silently misfiling it into the caller's
		// active namespace instead of the one it was actually exported from (plan.md's flagged risk).
		// Grouping every subject by which registered namespace's own `<base>/schema#`/`/instances#`/
		// `/shapes#` prefix its IRI structurally starts with sidesteps that: `classIri`/`propertyIri`/
		// `individualIri` (`iri.ts`) always mint under exactly one namespace's graphs, so the IRI alone
		// already encodes its owning namespace, independent of whether any triple for it exists yet
		// anywhere — then each group's own namespace is passed as `importTurtle`'s fallback default,
		// so its brand-new subjects land in the right graph. A thrown `SchemaValidationError` on any
		// group's call propagates immediately, aborting before any Workspace/Membership/Note write.
		let schemaSummary: ImportSummary = { inserted: [], duplicates: [], conflicts: [] };
		if (restQuads.length > 0) {
			const candidateNamespaces = [
				...new Set([
					...groupQuadsBySubject(namespaceQuads).keys(),
					...(await this.fetchNamespaces()).map((ns) => ns.baseIri)
				])
			];
			const candidateGraphs = candidateNamespaces.map((ns) => ({ ns, graphs: namespaceGraphs(ns) }));
			const resolveGroupNamespace = (iriValue: string): string | undefined =>
				candidateGraphs.find(
					({ graphs }) =>
						iriValue.startsWith(`${graphs.schema}#`) ||
						iriValue.startsWith(`${graphs.instances}#`) ||
						iriValue.startsWith(`${graphs.shapes}#`)
				)?.ns;
			const resolveBlankGroupNamespace = (blankValue: string, seen: Set<string>): string | undefined => {
				if (seen.has(blankValue)) return undefined;
				seen.add(blankValue);
				const referencing = restQuads.find(
					(q) => q.object.termType === 'BlankNode' && q.object.value === blankValue
				);
				if (!referencing) return undefined;
				return referencing.subject.termType === 'BlankNode'
					? resolveBlankGroupNamespace(referencing.subject.value, seen)
					: resolveGroupNamespace(referencing.subject.value);
			};

			const restByNamespace = new Map<string, Quad[]>();
			for (const q of restQuads) {
				const ns =
					(q.subject.termType === 'NamedNode'
						? resolveGroupNamespace(q.subject.value)
						: resolveBlankGroupNamespace(q.subject.value, new Set())) ?? DEFAULT_NAMESPACE_BASE_IRI;
				const list = restByNamespace.get(ns) ?? [];
				list.push(q);
				restByNamespace.set(ns, list);
			}

			for (const [ns, quads] of restByNamespace) {
				const groupSummary = await this.importTurtle(await quadsToTurtle(quads), ns);
				schemaSummary = {
					inserted: [...schemaSummary.inserted, ...groupSummary.inserted],
					duplicates: [...schemaSummary.duplicates, ...groupSummary.duplicates],
					conflicts: [...schemaSummary.conflicts, ...groupSummary.conflicts]
				};
			}
		}

		// Step 4: Workspace bucket.
		let workspacesInserted = 0;
		let workspacesAlreadyPresent = 0;
		for (const [iri, quads] of groupQuadsBySubject(workspaceQuads)) {
			const existed = await this.askQuery(
				`${PREFIXES} ASK ${fromClause(defaultGraphs.schema)} { <${iri}> a <${WORKSPACE_CLASS_IRI}> }`
			);
			await this.ensureWorkspace(
				iri,
				findLiteral(quads, RDFS.label) ?? '',
				findNamedNode(quads, WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI)
			);
			if (existed) workspacesAlreadyPresent++;
			else workspacesInserted++;
		}

		// Step 5: WorkspaceMembership bucket.
		let membershipsInserted = 0;
		let membershipsAlreadyPresent = 0;
		for (const [membershipIriValue, quads] of groupQuadsBySubject(membershipQuads)) {
			const workspaceIriValue = findNamedNode(quads, WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI);
			const elementIri = findNamedNode(quads, WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI);
			if (!workspaceIriValue || !elementIri) continue;
			const x = parseFloat(findLiteral(quads, WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI) ?? '0');
			const y = parseFloat(findLiteral(quads, WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI) ?? '0');
			const existed = await this.askQuery(
				`${PREFIXES} ASK ${fromClause(defaultGraphs.schema)} { <${membershipIriValue}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> }`
			);
			await this.addWorkspaceMember(workspaceIriValue, elementIri, x, y);
			if (existed) membershipsAlreadyPresent++;
			else membershipsInserted++;
		}

		// Step 6: Note bucket.
		let notesInserted = 0;
		let notesAlreadyPresent = 0;
		for (const [noteIriValue, quads] of groupQuadsBySubject(noteQuads)) {
			const workspaceIriValue = findNamedNode(quads, NOTE_WORKSPACE_PREDICATE_IRI);
			if (!workspaceIriValue) continue;
			const x = parseFloat(findLiteral(quads, NOTE_X_PREDICATE_IRI) ?? '0');
			const y = parseFloat(findLiteral(quads, NOTE_Y_PREDICATE_IRI) ?? '0');
			const color = findLiteral(quads, NOTE_COLOR_PREDICATE_IRI) ?? '';
			const existed = await this.askQuery(
				`${PREFIXES} ASK ${fromClause(defaultGraphs.schema)} { <${noteIriValue}> a <${NOTE_CLASS_IRI}> }`
			);
			await this.ensureNoteAtIri(
				noteIriValue,
				workspaceIriValue,
				x,
				y,
				color,
				findLiteral(quads, NOTE_TEXT_PREDICATE_IRI),
				findNamedNode(quads, NOTE_LINKED_ELEMENT_PREDICATE_IRI)
			);
			if (existed) notesAlreadyPresent++;
			else notesInserted++;
		}

		return {
			schema: schemaSummary,
			namespaces: { inserted: namespacesInserted, alreadyPresent: namespacesAlreadyPresent },
			workspaces: { inserted: workspacesInserted, alreadyPresent: workspacesAlreadyPresent },
			memberships: { inserted: membershipsInserted, alreadyPresent: membershipsAlreadyPresent },
			notes: { inserted: notesInserted, alreadyPresent: notesAlreadyPresent }
		};
	}

	/** Classifies `newQuads` into the namespace's three graphs (`partitionQuads` for
	 *  schema-vs-shapes-vs-reified-instances, then `splitInstancesFromSchema` to additionally pull
	 *  plain individuals out of the schema bucket) and builds one `INSERT DATA` with one `GRAPH`
	 *  block per non-empty bucket. `partitionQuads`'s own `instances` bucket (relation-assertions
	 *  Story 004) covers reified-statement quads typed/predicated with `rdf:Statement`/
	 *  `rdf:subject`/`rdf:predicate`/`rdf:object`; merged with `splitInstancesFromSchema`'s
	 *  individual-detection so a manual Turtle edit that includes both lands each in
	 *  `graphs.instances`, not silently dropped. */
	private async buildScopeInsertOp(newQuads: Quad[], graphs: NamespaceGraphs): Promise<string> {
		const {
			schema: schemaAndInstances,
			shapes: shapeQuads,
			instances: reifiedInstanceQuads
		} = partitionQuads(newQuads);
		const { instances: instanceQuads, schema: schemaQuads } = splitInstancesFromSchema(schemaAndInstances);

		const [instancesBody, schemaBody, shapesBody] = await Promise.all([
			quadsToGroundTriples([...instanceQuads, ...reifiedInstanceQuads]),
			quadsToGroundTriples(schemaQuads),
			quadsToGroundTriples(shapeQuads)
		]);

		const graphBlocks = [
			instancesBody.trim() ? `GRAPH <${graphs.instances}> { ${instancesBody} }` : '',
			schemaBody.trim() ? `GRAPH <${graphs.schema}> { ${schemaBody} }` : '',
			shapesBody.trim() ? `GRAPH <${graphs.shapes}> { ${shapesBody} }` : ''
		].filter(Boolean);

		return graphBlocks.length > 0 ? `INSERT DATA { ${graphBlocks.join(' ')} }` : '';
	}

	/** Builds the `DELETE WHERE` operation(s) that clear `iri`'s old scope — see `saveScopedTurtle`.
	 *  `scopeQuads` is always the *unfiltered* (`'all'`-partition) scope selection, since the ops
	 *  below are derived from scope *structure* (is this a class? does it have a shape?), which
	 *  `partition` must not hide even when only a subset of the resulting ops is actually returned
	 *  (STORY-017). */
	private buildScopeDeleteOps(
		iri: string | null,
		scopeQuads: Quad[],
		partition: Partition,
		graphs: NamespaceGraphs
	): string[] {
		if (iri === null) {
			// Each of the namespace's three graphs is now physically separate (Decision 1), so the
			// old single-graph `FILTER(!isBlank(?s) || !STRSTARTS(...SHAPES_NAMESPACE...))` dance that
			// used to distinguish schema from shapes content *within* one mixed graph is no longer
			// needed — clearing "schema" or "shapes" is just clearing that one graph outright. `WITH`
			// (not a `GRAPH` block) is used so `VOCAB_FILTER`'s `FILTER` — not accepted inside the
			// `DELETE WHERE { ... }` shorthand's plain `QuadPattern` grammar — can still apply.
			const graphsToClear =
				partition === 'schema'
					? [graphs.schema]
					: partition === 'shapes'
						? [graphs.shapes]
						: [graphs.instances, graphs.schema, graphs.shapes];
			return graphsToClear.map(
				(g) => `${withGraph(g)} DELETE { ?s ?p ?o } WHERE { ?s ?p ?o . ${VOCAB_FILTER('?s')} }`
			);
		}

		const isClass = scopeQuads.some((q) => isRdfType(q, OWL.Class) && q.subject.value === iri);
		if (isClass) {
			const shapeIri = nodeShapeIri(iri, graphs.shapes);
			const shapesOps = [
				`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`, graphs.shapes)} }`,
				`DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`, graphs.shapes)} }`
			];
			const schemaOps = [`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, graphs.schema)} }`];
			if (partition === 'schema') return schemaOps;
			if (partition === 'shapes') return shapesOps;
			return [...shapesOps, ...schemaOps];
		}

		// Not a class: either a property (has `rdfs:domain`, lives in `/schema`) or an individual
		// (typed with a non-meta `rdf:type`, lives in the plain instance graph) — see
		// `looksLikeIndividual`.
		const ownGraph = looksLikeIndividual(scopeQuads, iri) ? graphs.instances : graphs.schema;
		const schemaOps = [`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, ownGraph)} }`];
		const domainQuad = scopeQuads.find(
			(q) => q.subject.value === iri && q.predicate.value === RDFS.domain
		);
		const shapesOps: string[] = [];
		if (domainQuad) {
			const shapeIri = nodeShapeIri(domainQuad.object.value, graphs.shapes);
			shapesOps.push(
				`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape sh:path <${iri}> . ?propShape ?p ?o .`, graphs.shapes)} }`
			);
		}
		if (partition === 'schema') return schemaOps;
		if (partition === 'shapes') return shapesOps;
		return [...schemaOps, ...shapesOps];
	}


	// -- Internals ------------------------------------------------------------------------------

	private async fetchPropertiesByType(
		owlType: 'owl:DatatypeProperty' | 'owl:ObjectProperty',
		namespaceBaseIri: string
	): Promise<FetchedPropertyBase[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?p ?label ?domain ?range ?reverseOf ${fromClause(graphs.schema)} WHERE {
				?p a ${owlType} ; rdfs:domain ?domain ; rdfs:range ?range .
				OPTIONAL { ?p rdfs:label ?label }
				OPTIONAL { ?p <${GENERATED_REVERSE_OF_PREDICATE_IRI}> ?reverseOf }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.p.value,
			label: b.label?.value ?? extractLocalName(b.p.value),
			domain: b.domain.value,
			range: b.range.value,
			namespaceBaseIri,
			generatedReverseOf: b.reverseOf?.value
		}));
	}

	/**
	 * STORY-054: `fetchPropertiesByType('owl:ObjectProperty', ...)` requires `rdfs:domain`/
	 * `rdfs:range` as part of its query pattern, so a generic relation (STORY-051/052, no
	 * `rdfs:domain`/`rdfs:range` at all) is invisible to it and would silently vanish from the
	 * canvas on reload. This is the shapes-graph-driven equivalent: for every `sh:NodeShape` (source
	 * class = its `sh:targetClass`) and each of its `sh:property [ sh:path <p> ; sh:class <target> ]`
	 * entries where `<p>` has no `rdfs:domain` triple, emits one edge `(source, predicate = p, target)`
	 * — one row per (source class, generic relation) pair, so the same property reused from two
	 * different source classes yields two rows here, each with its own cardinality straight from
	 * that class's own `sh:property` blank node (not merged via the shared `constraintByPath` map in
	 * `fetchFullSchema`, which is keyed by `sh:path` alone and would collide for a shared property).
	 *
	 * Requires `?p a owl:ObjectProperty` explicitly (matching `findGenericObjectProperty`/
	 * `listGenericObjectProperties`'s own pattern) rather than inferring existence purely from a
	 * surviving `sh:property`/`sh:path` reference: a property manually deleted from `/schema` (or
	 * removed by some other path) while an `sh:property` blank node elsewhere still points at its IRI
	 * would otherwise "ghost" back into `objectProperties` — surfacing in pickers like Settings'
	 * "Represents predicate" with a fallback `extractLocalName` label, even though nothing declares
	 * it as a property anymore.
	 *
	 * That existence check spans *every* registered namespace's own `/schema` graph, not just
	 * `namespaceBaseIri`'s own — a generic relation's `owl:ObjectProperty` declaration lives under
	 * whichever namespace first minted it (`insertObjectProperty`'s generic path, keyed off the
	 * *first* source class it was drawn from), while `sh:property`/`sh:path` entries reusing it from
	 * a source class in a *different* namespace live in that other namespace's own `/shapes` graph
	 * (`findGenericObjectProperty`'s cross-namespace reuse, STORY-051/053's `spec/modelling-restrictions
	 * /plan.md`). Scoping the `?p a owl:ObjectProperty` check to only `namespaceBaseIri`'s own
	 * `/schema` graph would make every such cross-namespace reuse (e.g. `core:represents` drawn from a
	 * `backstage:`-namespaced entity) invisible to this query — silently vanishing from the canvas
	 * even though `insertObjectProperty` successfully wrote it (and a retry then reports it as an
	 * already-existing duplicate).
	 */
	private async fetchGenericObjectPropertyEdges(
		namespaceBaseIri: string
	): Promise<FetchedObjectProperty[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const namespaces = await this.fetchNamespaces();
		const allSchemaGraphs = namespaces.map((ns) => namespaceGraphs(ns.baseIri).schema);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?p ?label ?domain ?range ?minCount ?maxCount ${fromClause(graphs.shapes, ...allSchemaGraphs)} WHERE {
				?shape sh:targetClass ?domain ; sh:property ?ps .
				?ps sh:path ?p .
				?p a owl:ObjectProperty .
				{ ?ps sh:class ?range }
				UNION
				{ ?ps sh:or/rdf:rest*/rdf:first/sh:class ?range }
				FILTER NOT EXISTS { ?p rdfs:domain ?anyDomain }
				OPTIONAL { ?p rdfs:label ?label }
				OPTIONAL { ?ps sh:minCount ?minCount }
				OPTIONAL { ?ps sh:maxCount ?maxCount }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.p.value,
			label: b.label?.value ?? extractLocalName(b.p.value),
			domain: b.domain.value,
			range: b.range.value,
			namespaceBaseIri,
			required: b.minCount !== undefined && parseInt(b.minCount.value, 10) >= 1,
			repeatable: b.maxCount === undefined,
			minCount: b.minCount !== undefined ? parseInt(b.minCount.value, 10) : undefined,
			maxCount: b.maxCount !== undefined ? parseInt(b.maxCount.value, 10) : undefined,
			relationKind: 'generic' as const
		}));
	}

	/**
	 * Shared by `deleteDatatypeProperty`/`deleteObjectProperty` (and `deleteClass`'s own-property
	 * cascade): removes `classIriValue`'s `sh:property` entry for `propIri` (namespace's `/shapes`
	 * graph) and, for a single-owner property (any attribute, or a *specific* relation — always has
	 * `rdfs:domain`), also removes the `owl:*Property` declaration itself (namespace's `/schema`
	 * graph), since `classIriValue` is its only owner.
	 *
	 * STORY-056: a *generic* relation (STORY-051/052, no `rdfs:domain`) can be shared across several
	 * classes' `NodeShape`s, so deleting one class's use of it must not delete the property everyone
	 * else is still using. Before removing the declaration, checks whether any `sh:NodeShape` other
	 * than `classIriValue`'s own still has a `sh:property` with this `sh:path` — if so, only this
	 * class's `sh:property` entry is removed and the shared declaration is left untouched; the
	 * declaration is only removed once this was the last remaining reference (mirroring
	 * `deleteClass`/`deleteNamespace`'s refuse-then-force cascading-delete pattern, except this case
	 * needs no explicit `force` — it's a "last reference" cleanup, not a refusal).
	 */
	private async deletePropertyTriples(
		propIri: string,
		classIriValue: string,
		graphs: NamespaceGraphs
	): Promise<void> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const shapeIri = nodeShapeIri(classIriValue, graphs.shapes);

		const hasDomain = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${propIri}> rdfs:domain ?d }`
		);
		if (!hasDomain) {
			const usedElsewhere = await this.askQuery(`
				${PREFIXES} ASK ${fromClause(graphs.shapes)} {
					?otherShape sh:property [ sh:path <${propIri}> ] .
					FILTER(?otherShape != <${shapeIri}>)
				}
			`);
			if (usedElsewhere) {
				await this.executeUpdate(`
					${PREFIXES}
					DELETE WHERE {
						${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape sh:path <${propIri}> . ?propShape ?p ?o .`, graphs.shapes)}
					}
				`);
				return;
			}
		}

		await this.executeUpdate(`
			${PREFIXES}
			DELETE WHERE {
				${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape sh:path <${propIri}> . ?propShape ?p ?o .`, graphs.shapes)}
			} ;
			DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`, graphs.schema)} }
		`);
	}

	private async executeQuery<T>(query: string, options?: { infer?: boolean }): Promise<T> {
		const response = await fetch(this.apiUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, ...(options?.infer === false ? { infer: false } : {}) })
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(
				errorData.message || `SPARQL query failed: ${response.status} ${response.statusText}`
			);
		}

		return await response.json();
	}

	/**
	 * Escapes a value for interpolation into a single-line `"..."` SPARQL string literal
	 * (STRING_LITERAL_QUOTE). That production excludes raw `"`, `\`, and newline/carriage-return
	 * bytes outright — any caller whose value can contain one (free-text descriptions, multi-line
	 * `sourceField` paths, a saved query's own multi-line `sparqlText`, ...) must have it turned into
	 * the corresponding two-character ECHAR (`\"`, `\\`, `\n`, `\r`) here, not at the call site: an
	 * unescaped newline reaching GraphDB fails as a lexical error mid-literal, one query-string away
	 * from the actual cause. `\\` must be escaped first so the backslashes this method itself inserts
	 * for the other characters are never re-escaped.
	 */
	private escapeString(str: string): string {
		return escapeSparqlString(str);
	}

	/**
	 * Rejects any value containing a character excluded from the SPARQL 1.1 IRIREF grammar
	 * production, closing the injection primitive at its root instead of trying to escape it
	 * after the fact (see `semantic-crm`'s `sparql-connector.ts`, which uses the same check).
	 */
	private assertSafeSparqlIri(value: string, fieldName: string = 'IRI'): void {
		assertSafeSparqlIri(value, fieldName);
	}
}

// Singleton instance
export const sparqlConnector = new SparqlConnector();
