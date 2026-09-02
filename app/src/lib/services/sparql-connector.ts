import {
	classIri,
	propertyIri,
	genericPropertyIri,
	individualIri,
	nodeShapeIri,
	xsdIri,
	extractLocalName,
	SHAPES_NAMESPACE,
	ATTRIBUTED_RELATIONSHIP_IRI,
	AUTHORITATIVE_ENTITY_IRI,
	BACKSTAGE_KIND_PREDICATE_IRI,
	SYNC_SOURCE_PREDICATE_IRI,
	SYNC_STATUS_PREDICATE_IRI,
	NAMESPACE_CLASS_IRI,
	NAMESPACE_PREFIX_PREDICATE_IRI,
	NAMESPACE_COLOR_PREDICATE_IRI,
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
	SAVED_QUERY_CLASS_IRI,
	SAVED_QUERY_TEXT_PREDICATE_IRI,
	savedQueryIri,
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
}

/** `domain`/`range`, plus cardinality merged in from the owning class's `sh:property` entry. */
export interface FetchedProperty extends FetchedPropertyBase {
	required: boolean;
	repeatable: boolean;
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

export interface FetchedSchema {
	classes: FetchedClass[];
	datatypeProperties: FetchedProperty[];
	objectProperties: FetchedObjectProperty[];
	subClassOf: FetchedSubClassOf[];
	individuals: FetchedIndividual[];
	individualClassRelations: FetchedIndividualClassRelation[];
	individualIndividualRelations: FetchedIndividualIndividualRelation[];
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

/** Characters excluded from the SPARQL 1.1 IRIREF grammar production — see `assertSafeSparqlIri`. */
const UNSAFE_SPARQL_IRI_CHARS = /[<>"{}|^`\\\x00-\x20]/;

function isSafeSparqlIri(value: string): boolean {
	return !UNSAFE_SPARQL_IRI_CHARS.test(value);
}

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
	 * from the owning class + label (`individualIri`) and is stable thereafter. Stored in the
	 * namespace's plain instance graph (`<base>`, no suffix — Decision 1).
	 */
	async insertIndividual(
		classIriValue: string,
		label: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ iri: string }> {
		if (!label.trim()) throw new Error('Member name must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);

		const iri = individualIri(classIriValue, label, graphs.instances);
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

	/** Updates only `rdfs:label` — the member's IRI never changes, mirroring `renameClass`. */
	async renameIndividual(
		iri: string,
		newLabel: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		if (!newLabel.trim()) throw new Error('Member name must not be empty');
		this.assertSafeSparqlIri(iri, 'individual IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const escaped = this.escapeString(newLabel);

		await this.executeUpdate(`
			${PREFIXES}
			${withGraph(graphs.instances)}
			DELETE { <${iri}> rdfs:label ?old }
			INSERT { <${iri}> rdfs:label "${escaped}" }
			WHERE { OPTIONAL { <${iri}> rdfs:label ?old } }
		`);
	}

	/** Removes the member entirely: its `rdf:type` and `rdfs:label` triples, plus (STORY-081) every
	 *  `WorkspaceMembership` row referencing it, across every Workspace, plus (STORY-083) unlinking
	 *  (not deleting) any Note whose `noteLinkedElement` pointed at it. */
	async deleteIndividual(iri: string, namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<void> {
		this.assertSafeSparqlIri(iri, 'individual IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(`
			${PREFIXES}
			DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, graphs.instances)} } ;
			${this.cascadeDeleteWorkspaceMembershipsClause(iri)} ;
			${this.cascadeUnlinkNotesClause(iri)}
		`);
	}

	/** Every member of `classIriValue` — structurally a smaller sibling of `fetchAllClasses`. */
	async fetchIndividualsOfClass(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<Array<{ iri: string; label: string }>> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?i ?label ${fromClause(graphs.instances)} WHERE { ?i a <${classIriValue}> . OPTIONAL { ?i rdfs:label ?label } }
		`);
		return results.results.bindings.map((b) => ({
			iri: b.i.value,
			label: b.label?.value ?? extractLocalName(b.i.value)
		}));
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
	 * label — an `owl:ObjectProperty` with the given `rdfs:label` and **no** `rdfs:domain` triple at
	 * all. A specific relation that happens to share the same label never matches (it always has an
	 * `rdfs:domain`). Used by the relation edit dialog to offer "reuse existing" vs "create new"
	 * (STORY-053), and by `insertObjectProperty`'s generic mode (STORY-052) to decide whether to
	 * declare a new property or just add another `sh:property` entry to a new source class.
	 */
	async findGenericObjectProperty(
		name: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string | undefined> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const escapedName = this.escapeString(name);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?p ${fromClause(graphs.schema)} WHERE {
				?p a owl:ObjectProperty ; rdfs:label "${escapedName}" .
				FILTER NOT EXISTS { ?p rdfs:domain ?d }
			}
			LIMIT 1
		`);
		return results.results.bindings[0]?.p?.value;
	}

	/** Lists every existing generic relation (STORY-051/053) in a namespace — `owl:ObjectProperty`
	 *  with an `rdfs:label` and no `rdfs:domain` triple — for the relation edit dialog's "reuse an
	 *  existing generic relation" autocomplete. */
	async listGenericObjectProperties(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<{ iri: string; label: string }[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?p ?label ${fromClause(graphs.schema)} WHERE {
				?p a owl:ObjectProperty ; rdfs:label ?label .
				FILTER NOT EXISTS { ?p rdfs:domain ?d }
			}
		`);
		return results.results.bindings.map((b) => ({ iri: b.p.value, label: b.label.value }));
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
	 * variable-length structure.
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
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
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
		const constraints = [required ? 'sh:minCount 1' : null, !repeatable ? 'sh:maxCount 1' : null]
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
					sh:maxCount ?oldMaxCount .
			}
			INSERT {
				?propShape sh:datatype <${datatypeIri}> ; sh:name "${escapedName}" .
				${minCountInsert}
				${maxCountInsert}
			}
			WHERE {
				<${shapeIri}> sh:property ?propShape .
				?propShape sh:path <${propIri}> .
				OPTIONAL { ?propShape sh:datatype ?oldDatatype }
				OPTIONAL { ?propShape sh:name ?oldName }
				OPTIONAL { ?propShape sh:minCount ?oldMinCount }
				OPTIONAL { ?propShape sh:maxCount ?oldMaxCount }
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
	 * (this unchanged behavior). `'generic'` mints/reuses a namespace-scoped, owner-class-independent
	 * property (`genericPropertyIri`) that carries **no** `rdfs:domain`/`rdfs:range` at all — SHACL's
	 * `sh:property`/`sh:class` on each source class's own `NodeShape` is the only per-class-pair type
	 * constraint. Drawing a second generic edge with the same name from a *different* source class
	 * reuses the existing property IRI and only adds a new `sh:property` entry, without re-declaring
	 * `owl:ObjectProperty`/`rdfs:label`. Drawing it again from the *same* source class to the *same*
	 * target is still rejected as a duplicate, matching the existing `propertyExists` semantics; to
	 * a *different* target, a generic relation instead merges the new target into the existing
	 * `sh:property` entry as an `sh:or` union (`rewriteGenericPropertyShapeTargets`) — a specific
	 * relation still rejects same-source-class reuse outright, since its `rdfs:domain`/`rdfs:range`
	 * are per-(source,target) by construction.
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
			const existingIri = await this.findGenericObjectProperty(name, namespaceBaseIri);

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
		if (await this.propertyExists(propIri, namespaceBaseIri)) {
			throw new Error(`A relation named "${name}" already exists on this entity (${propIri})`);
		}

		const shapeIri = await this.ensureNodeShape(sourceClassIri, namespaceBaseIri);

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
	 * `options.kind: 'generic'` (STORY-052) updates only this edge's `sh:property` blank node
	 * (`sh:class` retarget + cardinality) — the shared `owl:ObjectProperty` declaration (`rdfs:label`,
	 * and its deliberate absence of `rdfs:domain`/`rdfs:range`) is untouched, since other source
	 * classes' `NodeShape`s may still be relying on it unchanged. Renaming a generic relation's own
	 * name is not supported through this path.
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
					details.name ?? update.name,
					update.required,
					update.repeatable,
					graphs
				);
				return;
			}
			await this.executeUpdate(`
				${PREFIXES}
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

		const escapedName = this.escapeString(update.name);

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
	 * When `targetClassIri` is given and this source class's property shape currently targets
	 * *more than one* class (an `sh:or` union — the same generic relation drawn to several targets
	 * from this one class), only that one target is dropped from the union; the shape, the shared
	 * `owl:ObjectProperty` declaration, and the other targets are all left untouched. Deleting the
	 * union's last remaining target falls through to the existing whole-shape removal below.
	 */
	async deleteObjectProperty(propIri: string, sourceClassIri: string, targetClassIri?: string): Promise<void> {
		const namespaceBaseIri = await this.findNamespaceOfClass(sourceClassIri);
		const graphs = namespaceGraphs(namespaceBaseIri);

		if (targetClassIri) {
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

	// -- AuthoritativeEntity marker (data-catalog Story 003) ------------------------------------

	/** Idempotently ensures `<SCHEMA_NAMESPACE>AuthoritativeEntity a owl:Class` exists — the
	 *  marker a class is declared `rdfs:subClassOf` to opt into DCAT catalog generation
	 *  (`canvas-model.ts`'s `isAuthoritativeEntity`), mirroring
	 *  `ensureAttributedRelationshipClass` exactly. Always lives in the *default* namespace's
	 *  `/schema` graph, even when the class carrying the marker lives elsewhere. Safe to call on
	 *  every load: a no-op once the triple exists. */
	async ensureAuthoritativeEntityClass(): Promise<void> {
		const exists = await this.classExists(AUTHORITATIVE_ENTITY_IRI, DEFAULT_NAMESPACE_BASE_IRI);
		if (exists) return;
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${AUTHORITATIVE_ENTITY_IRI}> a owl:Class ; rdfs:label "AuthoritativeEntity" .`, graphs.schema)} }`
		);
	}

	/** Marks/unmarks `classIriValue` as an `AuthoritativeEntity` by inserting/deleting its
	 *  `rdfs:subClassOf <SCHEMA_NAMESPACE>AuthoritativeEntity` triple — the sole signal
	 *  `canvas-model.ts` uses to classify a class as catalog-eligible. Mirrors
	 *  `setAssociationClass` exactly. Written into `classIriValue`'s own namespace (the subject of
	 *  the triple), not necessarily the default namespace the marker class itself lives in. */
	async setAuthoritativeEntity(
		classIriValue: string,
		isAuthoritative: boolean,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		if (isAuthoritative) {
			await this.ensureAuthoritativeEntityClass();
			await this.insertSubClassOf(classIriValue, AUTHORITATIVE_ENTITY_IRI, namespaceBaseIri);
		} else {
			await this.deleteSubClassOf(classIriValue, AUTHORITATIVE_ENTITY_IRI, namespaceBaseIri);
		}
	}

	// -- backstageKind annotation (Backstage-mapping Story 003/005) -----------------------------

	/** Idempotently ensures `<BACKSTAGE_KIND_PREDICATE_IRI> a owl:AnnotationProperty` exists,
	 *  mirroring `ensureAuthoritativeEntityClass`'s self-describing-vocabulary declaration. Always
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
	 *  `setAuthoritativeEntity`'s explicit-namespace convention). */
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

	/**
	 * Looks up which namespace `individualIri` was declared in, by finding the named graph its own
	 * `rdf:type` triple actually lives in — a plain cross-graph `GRAPH ?g {...}` pattern, mirroring
	 * `findNamespaceOfClass` but for an ABox individual instead of a TBox class. An individual
	 * normally lives in a namespace's plain instances graph (no `/schema`/`/shapes` suffix), so the
	 * matched graph is usually the base IRI already; the suffix-stripping here is defensive, mirroring
	 * `findNamespaceOfSubject`.
	 */
	private async findNamespaceOfIndividual(individualIri: string): Promise<string> {
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
		const namespaceBaseIri = await this.findNamespaceOfIndividual(individualIri);
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
		const namespaceBaseIri = await this.findNamespaceOfIndividual(individualIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${individualIri}> <${predicateIri}> <${classIri}> .`, graphs.instances)} }`
		);
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
	 *  `ensureReifiedStatement` writes it. Returns `undefined` when the triple isn't reified yet. */
	async fetchStatementIriForTriple(
		subjectIri: string,
		predicateIri: string,
		objectIri: string,
		namespaceBaseIri: string
	): Promise<string | undefined> {
		this.assertSafeSparqlIri(subjectIri, 'subject IRI');
		this.assertSafeSparqlIri(predicateIri, 'predicate IRI');
		this.assertSafeSparqlIri(objectIri, 'object IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES} SELECT ?stmt WHERE {
				GRAPH <${graphs.instances}> {
					?stmt rdf:subject <${subjectIri}> ; rdf:predicate <${predicateIri}> ; rdf:object <${objectIri}> .
				}
			} LIMIT 1
		`);
		return results.results.bindings[0]?.stmt?.value;
	}

	/**
	 * Ensures `<subjectIri> <predicateIri> <objectIri>` (a relation edge's own ground triple, already
	 * written by `insertIndividualClassRelation`/`insertAssertion`) is reified, and returns its
	 * statement IRI (Story 009) — reuses an existing reification (Story 008's
	 * `fetchStatementIriForTriple`) if one already exists, otherwise mints one (`statementIri`) and
	 * writes the four reification quads into the subject's own namespace's `graphs.instances`. Purely
	 * additive metadata: never invents the ground triple itself, which the caller must already have
	 * asserted.
	 */
	async ensureReifiedStatement(subjectIri: string, predicateIri: string, objectIri: string): Promise<string> {
		this.assertSafeSparqlIri(subjectIri, 'subject IRI');
		this.assertSafeSparqlIri(predicateIri, 'predicate IRI');
		this.assertSafeSparqlIri(objectIri, 'object IRI');
		const namespaceBaseIri = await this.findNamespaceOfIndividual(subjectIri);
		const existing = await this.fetchStatementIriForTriple(subjectIri, predicateIri, objectIri, namespaceBaseIri);
		if (existing) return existing;
		const timestamp = new Date().toISOString().replace(/[^0-9]/g, '');
		const stmt = statementIri(namespaceBaseIri, timestamp);
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${stmt}> a rdf:Statement ; rdf:subject <${subjectIri}> ; rdf:predicate <${predicateIri}> ; rdf:object <${objectIri}> .`,
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
			label: `${b.slabel?.value ?? extractLocalName(b.s.value)} ${b.plabel?.value ?? extractLocalName(b.p.value)} ${b.olabel?.value ?? extractLocalName(b.o.value)}`,
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
		const namespaceBaseIri = await this.findNamespaceOfIndividual(individualIri);
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
		const namespaceBaseIri = await this.findNamespaceOfIndividual(individualIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${individualIri}> <${predicateIri}> <${objectIri}> .`, graphs.instances)} }`
		);
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
		const namespaceBaseIri = await this.findNamespaceOfIndividual(individualIri);
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
	 */
	private async fetchOperatingAuthority(systemOfWorkIri: string): Promise<string | null> {
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
	 *  `ensureAuthoritativeEntityClass`'s ASK-then-INSERT shape). */
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
			SELECT ?ns ?prefix ?desc ?color ?publisher ?license ${fromClause(graphs.schema)} WHERE {
				?ns a <${NAMESPACE_CLASS_IRI}> .
				OPTIONAL { ?ns <${NAMESPACE_PREFIX_PREDICATE_IRI}> ?prefix }
				OPTIONAL { ?ns rdfs:comment ?desc }
				OPTIONAL { ?ns <${NAMESPACE_COLOR_PREDICATE_IRI}> ?color }
				OPTIONAL { ?ns <${DCT.publisher}> ?publisher }
				OPTIONAL { ?ns <${DCT.license}> ?license }
			}
		`);
		return results.results.bindings.map((b) => ({
			baseIri: b.ns.value,
			prefix: b.prefix?.value ?? '',
			description: b.desc?.value ?? null,
			color: b.color?.value ?? null,
			publisher: b.publisher?.value ?? null,
			license: b.license?.value ?? null
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

	/**
	 * Deletes a namespace: refused (returning the total triple count across its three graphs)
	 * unless `{ force: true }` is passed, mirroring `deleteClass`'s `{force?}` pattern (Decision
	 * 5). `force: true` drops all three of the namespace's graphs (`<base>`, `<base>/schema`,
	 * `<base>/shapes`) and its own declaration triple — the two are checked/dropped independently
	 * (deleting the declaration triple never depends on whether the data graphs are empty).
	 */
	async deleteNamespace(
		baseIri: string,
		options?: { force?: boolean }
	): Promise<{ deleted: boolean; entryCount: number }> {
		this.assertSafeSparqlIri(baseIri, 'namespace base IRI');
		const graphs = namespaceGraphs(baseIri);
		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

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
			SELECT ?sq ?label ?text ?description ${fromClause(graphs.schema)} WHERE {
				?sq a <${SAVED_QUERY_CLASS_IRI}> .
				OPTIONAL { ?sq rdfs:label ?label }
				OPTIONAL { ?sq <${SAVED_QUERY_TEXT_PREDICATE_IRI}> ?text }
				OPTIONAL { ?sq rdfs:comment ?description }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.sq.value,
			label: b.label?.value ?? '',
			sparqlText: b.text?.value ?? '',
			description: b.description?.value ?? ''
		}));
	}

	/**
	 * Registers a SavedQuery: `<savedQueryIri(name)> a <SAVED_QUERY_CLASS_IRI> ; rdfs:label "<name>"
	 * ; <SAVED_QUERY_TEXT_PREDICATE_IRI> "<sparqlText>" [; rdfs:comment "<description>"]`, always in
	 * the default namespace's `/schema` graph (Decision 4). Returns the minted IRI.
	 */
	async insertSavedQuery(name: string, sparqlText: string, description?: string): Promise<string> {
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

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${iri}> a <${SAVED_QUERY_CLASS_IRI}> ; rdfs:label "${escapedLabel}" ; <${SAVED_QUERY_TEXT_PREDICATE_IRI}> "${escapedText}"${descriptionTriple} .`,
				graphs.schema
			)} }`
		);
		return iri;
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
		const membershipIri = workspaceMembershipIri(workspaceIriValue, elementIri);
		const exists = await this.askQuery(
			`${PREFIXES} ASK ${fromClause(graphs.schema)} { <${membershipIri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> }`
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
		const membershipIri = workspaceMembershipIri(workspaceIriValue, elementIri);
		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${membershipIri}> ?p ?o .`, graphs.schema)} }`
		);
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
		const membershipIri = workspaceMembershipIri(workspaceIriValue, elementIri);
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
			SELECT ?path ?minCount ?maxCount ${fromClause(graphs.shapes)} WHERE {
				?shape a sh:NodeShape ; sh:property ?ps .
				?ps sh:path ?path .
				OPTIONAL { ?ps sh:minCount ?minCount }
				OPTIONAL { ?ps sh:maxCount ?maxCount }
			}
		`);
		return results.results.bindings.map((b) => ({
			path: b.path.value,
			minCount: b.minCount ? parseInt(b.minCount.value, 10) : undefined,
			maxCount: b.maxCount ? parseInt(b.maxCount.value, 10) : undefined
		}));
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
	 * asserted `a owl:Class` anywhere in this app's data. An individual's own `?i a ?type` triple
	 * lives in the namespace's instance graph, but `?type a owl:Class` lives in its `/schema`
	 * graph, so both are merged into this one query via two `FROM` clauses.
	 */
	async fetchAllIndividuals(
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<FetchedIndividual[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?i ?type ?label ?syncSource ?syncStatus ${fromClause(graphs.instances, graphs.schema)} WHERE {
				?i a ?type .
				?type a owl:Class .
				${VOCAB_FILTER('?i')}
				OPTIONAL { ?i rdfs:label ?label }
				OPTIONAL { ?i <${SYNC_SOURCE_PREDICATE_IRI}> ?syncSource }
				OPTIONAL { ?i <${SYNC_STATUS_PREDICATE_IRI}> ?syncStatus }
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
			genericObjectProperties,
			individualClassRelations,
			individualIndividualRelations
		] = await Promise.all([
			this.fetchAllClasses(namespaceBaseIri),
			this.fetchAllDatatypeProperties(namespaceBaseIri),
			this.fetchAllObjectProperties(namespaceBaseIri),
			this.fetchAllShapesAndProperties(namespaceBaseIri),
			this.fetchAllSubClassOf(namespaceBaseIri),
			this.fetchAllIndividuals(namespaceBaseIri),
			this.fetchGenericObjectPropertyEdges(namespaceBaseIri),
			this.fetchAllIndividualClassRelations(namespaceBaseIri),
			this.fetchAllIndividualIndividualRelations(namespaceBaseIri)
		]);

		const constraintByPath = new Map(constraints.map((c) => [c.path, c]));
		const mergeCardinality = (props: FetchedPropertyBase[]): FetchedProperty[] =>
			props.map((p) => {
				const constraint = constraintByPath.get(p.iri);
				return {
					...p,
					required: (constraint?.minCount ?? 0) >= 1,
					repeatable: constraint?.maxCount === undefined
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
			individualClassRelations,
			individualIndividualRelations
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
			individualClassRelations: schemas.flatMap((s) => s.individualClassRelations),
			individualIndividualRelations: schemas.flatMap((s) => s.individualIndividualRelations)
		};
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
	 * graph-tagged with its originating graph IRI — the "Export quads" hamburger menu action's data
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

		const issues = [
			...checkShaclWellFormedness(newQuads, declaredClasses),
			...checkStructural(mergedGraph)
		];
		// Backstage-mapping Story 005: `severity: 'warning'` issues (e.g. a `backstageKind`'d class
		// missing `AuthoritativeEntity` ancestry) are surfaced but must not block the save.
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
		const issues = [
			...checkShaclWellFormedness(inserted, declaredClasses),
			...checkStructural(mergedGraph)
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
			SELECT ?p ?label ?domain ?range ${fromClause(graphs.schema)} WHERE {
				?p a ${owlType} ; rdfs:domain ?domain ; rdfs:range ?range .
				OPTIONAL { ?p rdfs:label ?label }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.p.value,
			label: b.label?.value ?? extractLocalName(b.p.value),
			domain: b.domain.value,
			range: b.range.value,
			namespaceBaseIri
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
	 */
	private async fetchGenericObjectPropertyEdges(
		namespaceBaseIri: string
	): Promise<FetchedObjectProperty[]> {
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?p ?label ?domain ?range ?minCount ?maxCount ${fromClause(graphs.schema, graphs.shapes)} WHERE {
				?shape sh:targetClass ?domain ; sh:property ?ps .
				?ps sh:path ?p .
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

	private escapeString(str: string): string {
		return str.replace(/["\\]/g, '\\$&');
	}

	/**
	 * Rejects any value containing a character excluded from the SPARQL 1.1 IRIREF grammar
	 * production, closing the injection primitive at its root instead of trying to escape it
	 * after the fact (see `semantic-crm`'s `sparql-connector.ts`, which uses the same check).
	 */
	private assertSafeSparqlIri(value: string, fieldName: string = 'IRI'): void {
		if (!isSafeSparqlIri(value)) {
			throw new Error(`Invalid ${fieldName}: contains characters not allowed in a SPARQL IRI`);
		}
	}
}

// Singleton instance
export const sparqlConnector = new SparqlConnector();
