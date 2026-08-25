import {
	classIri,
	propertyIri,
	individualIri,
	nodeShapeIri,
	xsdIri,
	extractLocalName,
	SHAPES_NAMESPACE,
	ATTRIBUTED_RELATIONSHIP_IRI,
	NAMESPACE_CLASS_IRI,
	NAMESPACE_PREFIX_PREDICATE_IRI,
	NAMESPACE_COLOR_PREDICATE_IRI,
	EXTERNAL_VOCABULARY_CLASS_IRI,
	EXTERNAL_PREFIXES,
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
	RDF,
	OWL,
	RDFS,
	SH,
	SH_NS,
	type Quad,
	type Partition
} from './turtle';
import { checkShaclWellFormedness, checkStructural, SchemaValidationError } from './validation';

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
}

export interface FetchedSchema {
	classes: FetchedClass[];
	datatypeProperties: FetchedProperty[];
	objectProperties: FetchedProperty[];
	subClassOf: FetchedSubClassOf[];
	individuals: FetchedIndividual[];
}

// -- Namespace management (STORY-027) -----------------------------------------------------------

export interface FetchedNamespace {
	baseIri: string;
	prefix: string;
	description: string | null;
	/** Optional default color (STORY-042) for entities/relations in this namespace with no
	 *  per-node color override. */
	color: string | null;
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

	/** Properties this class owns (its own attributes): anything with `rdfs:domain` = this class. */
	async findOwnProperties(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?p ${fromClause(graphs.schema)} WHERE { ?p rdfs:domain <${classIriValue}> }`
		);
		return results.results.bindings.map((b) => b.p.value);
	}

	/** Properties belonging to *other* classes whose `rdfs:range` points at this class. */
	async findExternalReferences(
		classIriValue: string,
		namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
	): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?p ${fromClause(graphs.schema)} WHERE { ?p rdfs:range <${classIriValue}> }`
		);
		return results.results.bindings.map((b) => b.p.value);
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

		const iri = individualIri(classIriValue, label, graphs.schema);
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

	/** Removes the member entirely: its `rdf:type` and `rdfs:label` triples. */
	async deleteIndividual(iri: string, namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): Promise<void> {
		this.assertSafeSparqlIri(iri, 'individual IRI');
		const graphs = namespaceGraphs(namespaceBaseIri);
		await this.executeUpdate(`${PREFIXES} DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, graphs.instances)} }`);
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
	 */
	async insertObjectProperty(
		sourceClassIri: string,
		targetClassIri: string,
		name: string,
		required: boolean,
		repeatable: boolean
	): Promise<{ iri: string }> {
		if (!name.trim()) throw new Error('Relation name must not be empty');
		this.assertSafeSparqlIri(sourceClassIri, 'source class IRI');
		this.assertSafeSparqlIri(targetClassIri, 'target class IRI');

		const namespaceBaseIri = await this.findNamespaceOfClass(sourceClassIri);
		const graphs = namespaceGraphs(namespaceBaseIri);

		const propIri = propertyIri(sourceClassIri, name, graphs.schema);
		if (await this.propertyExists(propIri, namespaceBaseIri)) {
			throw new Error(`A relation named "${name}" already exists on this entity (${propIri})`);
		}

		const shapeIri = await this.ensureNodeShape(sourceClassIri, namespaceBaseIri);
		const escapedName = this.escapeString(name);
		const constraints = [required ? 'sh:minCount 1' : null, !repeatable ? 'sh:maxCount 1' : null]
			.filter((c): c is string => c !== null)
			.map((c) => ` ; ${c}`)
			.join('');

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
	 */
	async updateObjectProperty(
		sourceClassIri: string,
		propIri: string,
		update: ObjectPropertyUpdate
	): Promise<void> {
		if (!update.name.trim()) throw new Error('Relation name must not be empty');
		this.assertSafeSparqlIri(sourceClassIri, 'source class IRI');
		this.assertSafeSparqlIri(propIri, 'property IRI');
		this.assertSafeSparqlIri(update.targetClassIri, 'target class IRI');

		const namespaceBaseIri = await this.findNamespaceOfClass(sourceClassIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
		const shapeIri = nodeShapeIri(sourceClassIri, graphs.shapes);
		const escapedName = this.escapeString(update.name);
		const minCountInsert = update.required ? '?propShape sh:minCount 1 .' : '';
		const maxCountInsert = !update.repeatable ? '?propShape sh:maxCount 1 .' : '';

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

	/** Removes both the `owl:ObjectProperty` declaration and its `sh:property` shape entry, from
	 *  `sourceClassIri`'s own namespace, derived automatically (Decision 8). */
	async deleteObjectProperty(propIri: string, sourceClassIri: string): Promise<void> {
		const namespaceBaseIri = await this.findNamespaceOfClass(sourceClassIri);
		const graphs = namespaceGraphs(namespaceBaseIri);
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
			SELECT ?ns ?prefix ?desc ?color ${fromClause(graphs.schema)} WHERE {
				?ns a <${NAMESPACE_CLASS_IRI}> .
				OPTIONAL { ?ns <${NAMESPACE_PREFIX_PREDICATE_IRI}> ?prefix }
				OPTIONAL { ?ns rdfs:comment ?desc }
				OPTIONAL { ?ns <${NAMESPACE_COLOR_PREDICATE_IRI}> ?color }
			}
		`);
		return results.results.bindings.map((b) => ({
			baseIri: b.ns.value,
			prefix: b.prefix?.value ?? '',
			description: b.desc?.value ?? null,
			color: b.color?.value ?? null
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
		color?: string
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

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(
				`<${baseIri}> a <${NAMESPACE_CLASS_IRI}> ; <${NAMESPACE_PREFIX_PREDICATE_IRI}> "${escapedPrefix}"${commentTriple}${colorTriple} .`,
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
			await this.executeUpdate(
				[graphs.instances, graphs.schema, graphs.shapes].map((g) => `DROP GRAPH <${g}>`).join(' ; ')
			);
		}

		await this.executeUpdate(
			`${PREFIXES} DELETE WHERE { ${inGraph(`<${baseIri}> ?p ?o .`, defaultGraphs.schema)} }`
		);
		return { deleted: true, entryCount: 0 };
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
			SELECT ?i ?type ?label ${fromClause(graphs.instances, graphs.schema)} WHERE {
				?i a ?type .
				?type a owl:Class .
				${VOCAB_FILTER('?i')}
				OPTIONAL { ?i rdfs:label ?label }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.i.value,
			classIri: b.type.value,
			label: b.label?.value ?? extractLocalName(b.i.value),
			namespaceBaseIri
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
		const [classes, datatypeRaw, objectRaw, constraints, subClassOf, individuals] = await Promise.all([
			this.fetchAllClasses(namespaceBaseIri),
			this.fetchAllDatatypeProperties(namespaceBaseIri),
			this.fetchAllObjectProperties(namespaceBaseIri),
			this.fetchAllShapesAndProperties(namespaceBaseIri),
			this.fetchAllSubClassOf(namespaceBaseIri),
			this.fetchAllIndividuals(namespaceBaseIri)
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
			objectProperties: mergeCardinality(objectRaw),
			subClassOf,
			individuals
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
			individuals: schemas.flatMap((s) => s.individuals)
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
	 *  (STORY-050), not just the default `rse`/`rse-sh` pair, so e.g. `core:BusinessProcess` and
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
	 * STORY-018: both tabs' Turtle for the current scope (whole graph or one selected
	 * entity/relation), computed from a single whole-graph fetch — Schema tab via
	 * STORY-014/015's `partitionQuads` + `groupSchemaQuads`, Shapes tab via STORY-014/016's
	 * `partitionQuads` + `nestBlankNodes` (never a bare top-level `_:b0` statement). Prefixes cover
	 * every registered namespace and external vocabulary (see `fetchAllTriplesAsTurtle`).
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
		const prefixes = buildDisplayPrefixes(namespaces, externalVocabularies);
		const schema = await quadsToTurtle(groupSchemaQuads(selectScope(allQuads, iri, 'schema')), prefixes);
		const shapes = nestBlankNodes(selectScope(allQuads, iri, 'shapes'), prefixes);
		return { schema, shapes };
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
		if (issues.length > 0) throw new SchemaValidationError(issues);

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
		if (issues.length > 0) throw new SchemaValidationError(issues);

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
	 *  schema-vs-shapes, then `splitInstancesFromSchema` to pull individuals out of the schema
	 *  bucket) and builds one `INSERT DATA` with one `GRAPH` block per non-empty bucket. */
	private async buildScopeInsertOp(newQuads: Quad[], graphs: NamespaceGraphs): Promise<string> {
		const { schema: schemaAndInstances, shapes: shapeQuads } = partitionQuads(newQuads);
		const { instances: instanceQuads, schema: schemaQuads } = splitInstancesFromSchema(schemaAndInstances);

		const [instancesBody, schemaBody, shapesBody] = await Promise.all([
			quadsToGroundTriples(instanceQuads),
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

	/** Shared by `deleteDatatypeProperty`/`deleteObjectProperty`: the delete logic doesn't care
	 *  which `owl:*Property` kind it is, only that it's matched via `sh:path` on the owning
	 *  class's shape (namespace's `/shapes` graph) and then removed entirely, along with its
	 *  `owl:*Property` declaration (namespace's `/schema` graph). */
	private async deletePropertyTriples(
		propIri: string,
		classIriValue: string,
		graphs: NamespaceGraphs
	): Promise<void> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const shapeIri = nodeShapeIri(classIriValue, graphs.shapes);

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
