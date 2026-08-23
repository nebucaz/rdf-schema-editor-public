import {
	classIri,
	propertyIri,
	individualIri,
	nodeShapeIri,
	xsdIri,
	extractLocalName,
	SHAPES_NAMESPACE,
	ATTRIBUTED_RELATIONSHIP_IRI,
	type XsdDatatype
} from '$lib/utils/iri';
import { SCHEMA_GRAPH } from '$lib/config';
import {
	parseTurtle,
	quadsToTurtle,
	quadsToGroundTriples,
	selectScope,
	groupSchemaQuads,
	nestBlankNodes,
	bindingToQuad,
	quadKey,
	isRdfType,
	OWL,
	RDFS,
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

// -- Full-schema fetch (STORY-009: reconstructing the canvas from GraphDB) --------------------

export interface FetchedClass {
	iri: string;
	label: string;
	comment: string | null;
}

/** A property declaration with domain/range but no cardinality yet — see `FetchedProperty`. */
export interface FetchedPropertyBase {
	iri: string;
	label: string;
	domain: string;
	range: string;
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
}

/** An enumerated class member (STORY-019) — e.g. `core:RelationType`'s `nutzt`/`verbucht`. */
export interface FetchedIndividual {
	iri: string;
	label: string;
	classIri: string;
}

export interface FetchedSchema {
	classes: FetchedClass[];
	datatypeProperties: FetchedProperty[];
	objectProperties: FetchedProperty[];
	subClassOf: FetchedSubClassOf[];
	individuals: FetchedIndividual[];
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

/** `FROM <graph>` clause fragment, merging the configured named graph (issue #1) into a SELECT/ASK
 *  query's default graph so plain (ungraphed) triple patterns in `WHERE` see its triples. */
const FROM_GRAPH = `FROM <${SCHEMA_GRAPH}>`;

/** `WITH <graph>` clause fragment, scoping a full `DELETE {} INSERT {} WHERE {}` Modify operation's
 *  delete/insert templates *and* its `WHERE` pattern to the configured named graph in one go. Must
 *  be repeated on every `;`-separated Modify operation — `WITH` applies to a single operation only. */
const WITH_GRAPH = `WITH <${SCHEMA_GRAPH}>`;

/** Wraps an `INSERT DATA`/`DELETE DATA`/`DELETE WHERE` triple pattern in an explicit `GRAPH` block —
 *  those update forms have no `WITH`/`USING` graph selection, so the graph must be named inline. */
function inGraph(triples: string): string {
	return `GRAPH <${SCHEMA_GRAPH}> { ${triples} }`;
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

/**
 * Thin client for the server-proxied SPARQL routes (`/api/sparql`, `/api/sparql/update`).
 * Mirrors `semantic-crm`'s `sparql-connector.ts` approach: no RDF/SPARQL client library,
 * just hand-written query strings and SPARQL-JSON parsing. Beyond the raw select/ask/update
 * primitives, this also carries the domain-specific class/attribute/shape methods later canvas
 * stories (STORY-004 onward) build on, following the same everything-in-one-connector shape
 * `semantic-crm` uses.
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

	async classExists(iri: string): Promise<boolean> {
		this.assertSafeSparqlIri(iri, 'class IRI');
		return this.askQuery(`${PREFIXES} ASK ${FROM_GRAPH} { <${iri}> a owl:Class }`);
	}

	/** Derives the class IRI from `name` (stable for the class's lifetime) and creates it. */
	async insertClass(name: string, description?: string): Promise<{ iri: string }> {
		if (!name.trim()) throw new Error('Class name must not be empty');
		const iri = classIri(name);
		if (await this.classExists(iri)) {
			throw new Error(`A class named "${name}" already exists (${iri})`);
		}

		const labelTriple = `rdfs:label "${this.escapeString(name)}"`;
		const trimmedDescription = description?.trim();
		const commentTriple = trimmedDescription
			? ` ; rdfs:comment "${this.escapeString(trimmedDescription)}"`
			: '';

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${iri}> a owl:Class ; ${labelTriple}${commentTriple} .`)} }`
		);
		return { iri };
	}

	/** Updates only `rdfs:label` — the class's IRI is fixed at creation and never changes. */
	async renameClass(iri: string, newName: string): Promise<void> {
		if (!newName.trim()) throw new Error('Class name must not be empty');
		this.assertSafeSparqlIri(iri, 'class IRI');
		const escaped = this.escapeString(newName);

		await this.executeUpdate(`
			${PREFIXES}
			${WITH_GRAPH}
			DELETE { <${iri}> rdfs:label ?old }
			INSERT { <${iri}> rdfs:label "${escaped}" }
			WHERE { OPTIONAL { <${iri}> rdfs:label ?old } }
		`);
	}

	/** Sets, replaces, or (passing `null`/empty) removes a class's `rdfs:comment`. */
	async updateClassDescription(iri: string, description: string | null): Promise<void> {
		this.assertSafeSparqlIri(iri, 'class IRI');
		const trimmed = description?.trim();

		if (!trimmed) {
			await this.executeUpdate(`${PREFIXES} DELETE WHERE { ${inGraph(`<${iri}> rdfs:comment ?old`)} }`);
			return;
		}

		const escaped = this.escapeString(trimmed);
		await this.executeUpdate(`
			${PREFIXES}
			${WITH_GRAPH}
			DELETE { <${iri}> rdfs:comment ?old }
			INSERT { <${iri}> rdfs:comment "${escaped}" }
			WHERE { OPTIONAL { <${iri}> rdfs:comment ?old } }
		`);
	}

	/** Properties this class owns (its own attributes): anything with `rdfs:domain` = this class. */
	async findOwnProperties(classIriValue: string): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?p ${FROM_GRAPH} WHERE { ?p rdfs:domain <${classIriValue}> }`
		);
		return results.results.bindings.map((b) => b.p.value);
	}

	/** Properties belonging to *other* classes whose `rdfs:range` points at this class. */
	async findExternalReferences(classIriValue: string): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?p ${FROM_GRAPH} WHERE { ?p rdfs:range <${classIriValue}> }`
		);
		return results.results.bindings.map((b) => b.p.value);
	}

	/**
	 * Deletes a class: its own `owl:Class`/`rdfs:label`/`rdfs:comment` triples, its own attributes
	 * (cascade, via `deleteDatatypeProperty`), and its `sh:NodeShape`. If another class's property
	 * has `rdfs:range` pointing at this class, deletion is refused (returns `externalReferences`
	 * instead of deleting) unless `{ force: true }` is passed — silently leaving a dangling range
	 * reference is not acceptable, but an explicit, warned deletion is.
	 */
	async deleteClass(iri: string, options?: { force?: boolean }): Promise<DeleteClassResult> {
		this.assertSafeSparqlIri(iri, 'class IRI');

		const externalReferences = await this.findExternalReferences(iri);
		if (externalReferences.length > 0 && !options?.force) {
			return { deleted: false, externalReferences };
		}

		const ownProperties = await this.findOwnProperties(iri);
		for (const propIri of ownProperties) {
			await this.deleteDatatypeProperty(propIri, iri);
		}

		const shapeIri = nodeShapeIri(iri);
		await this.executeUpdate(`
			${PREFIXES}
			DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`)} } ;
			DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`)} } ;
			DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`)} } ;
			DELETE WHERE { ${inGraph(`?individual a <${iri}> . ?individual ?p ?o .`)} }
		`);

		return { deleted: true, externalReferences: [] };
	}

	// -- Individuals / enumerated class members (STORY-019) ------------------------------------

	/**
	 * Adds an enumerated member to `classIriValue` (e.g. `core:RelationType`'s `nutzt`): a bare
	 * `<iri> a <classIriValue> ; rdfs:label "..."` pair, no `sh:*` triples — always available per
	 * class, no separate "is this an enumeration" flag (Decision 3, `plan.md`). The IRI is derived
	 * from the owning class + label (`individualIri`) and is stable thereafter.
	 */
	async insertIndividual(classIriValue: string, label: string): Promise<{ iri: string }> {
		if (!label.trim()) throw new Error('Member name must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');

		const iri = individualIri(classIriValue, label);
		const exists = await this.askQuery(`${PREFIXES} ASK ${FROM_GRAPH} { <${iri}> a <${classIriValue}> }`);
		if (exists) {
			throw new Error(`A member named "${label}" already exists on this class (${iri})`);
		}

		const escapedLabel = this.escapeString(label);
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${iri}> a <${classIriValue}> ; rdfs:label "${escapedLabel}" .`)} }`
		);
		return { iri };
	}

	/** Updates only `rdfs:label` — the member's IRI never changes, mirroring `renameClass`. */
	async renameIndividual(iri: string, newLabel: string): Promise<void> {
		if (!newLabel.trim()) throw new Error('Member name must not be empty');
		this.assertSafeSparqlIri(iri, 'individual IRI');
		const escaped = this.escapeString(newLabel);

		await this.executeUpdate(`
			${PREFIXES}
			${WITH_GRAPH}
			DELETE { <${iri}> rdfs:label ?old }
			INSERT { <${iri}> rdfs:label "${escaped}" }
			WHERE { OPTIONAL { <${iri}> rdfs:label ?old } }
		`);
	}

	/** Removes the member entirely: its `rdf:type` and `rdfs:label` triples. */
	async deleteIndividual(iri: string): Promise<void> {
		this.assertSafeSparqlIri(iri, 'individual IRI');
		await this.executeUpdate(`${PREFIXES} DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`)} }`);
	}

	/** Every member of `classIriValue` — structurally a smaller sibling of `fetchAllClasses`. */
	async fetchIndividualsOfClass(classIriValue: string): Promise<Array<{ iri: string; label: string }>> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?i ?label ${FROM_GRAPH} WHERE { ?i a <${classIriValue}> . OPTIONAL { ?i rdfs:label ?label } }
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
	async propertyExists(iri: string): Promise<boolean> {
		this.assertSafeSparqlIri(iri, 'property IRI');
		return this.askQuery(
			`${PREFIXES} ASK ${FROM_GRAPH} { { <${iri}> a owl:DatatypeProperty } UNION { <${iri}> a owl:ObjectProperty } }`
		);
	}

	/** Creates the class's `sh:NodeShape` if it doesn't exist yet, and returns its (deterministic) IRI. */
	async ensureNodeShape(classIriValue: string): Promise<string> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const shapeIri = nodeShapeIri(classIriValue);
		const exists = await this.askQuery(`${PREFIXES} ASK ${FROM_GRAPH} { <${shapeIri}> a sh:NodeShape }`);
		if (!exists) {
			await this.executeUpdate(
				`${PREFIXES} INSERT DATA { ${inGraph(`<${shapeIri}> a sh:NodeShape ; sh:targetClass <${classIriValue}> .`)} }`
			);
		}
		return shapeIri;
	}

	/**
	 * Adds an attribute to `classIriValue`: an `owl:DatatypeProperty` declaration plus a matching
	 * `sh:property` entry in the class's `sh:NodeShape` (created if needed). The property IRI is
	 * derived from the owning class + name and is stable thereafter — see `propertyIri`.
	 */
	async insertDatatypeProperty(
		classIriValue: string,
		name: string,
		datatype: XsdDatatype,
		required: boolean,
		repeatable: boolean
	): Promise<{ iri: string }> {
		if (!name.trim()) throw new Error('Attribute name must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');

		const propIri = propertyIri(classIriValue, name);
		if (await this.propertyExists(propIri)) {
			throw new Error(`An attribute named "${name}" already exists on this entity (${propIri})`);
		}

		const shapeIri = await this.ensureNodeShape(classIriValue);
		const escapedName = this.escapeString(name);
		const datatypeIri = xsdIri(datatype);
		const constraints = [required ? 'sh:minCount 1' : null, !repeatable ? 'sh:maxCount 1' : null]
			.filter((c): c is string => c !== null)
			.map((c) => ` ; ${c}`)
			.join('');

		await this.executeUpdate(`
			${PREFIXES}
			INSERT DATA {
				GRAPH <${SCHEMA_GRAPH}> {
					<${propIri}> a owl:DatatypeProperty ;
						rdfs:domain <${classIriValue}> ;
						rdfs:range <${datatypeIri}> ;
						rdfs:label "${escapedName}" .
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
	 * `owl:DatatypeProperty` triples and the `sh:property` shape entry in sync (no drift between
	 * the two). The property's IRI never changes, even when its display name does.
	 */
	async updateDatatypeProperty(
		classIriValue: string,
		propIri: string,
		update: DatatypePropertyUpdate
	): Promise<void> {
		if (!update.name.trim()) throw new Error('Attribute name must not be empty');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		this.assertSafeSparqlIri(propIri, 'property IRI');

		const shapeIri = nodeShapeIri(classIriValue);
		const escapedName = this.escapeString(update.name);
		const datatypeIri = xsdIri(update.datatype);
		const minCountInsert = update.required ? '?propShape sh:minCount 1 .' : '';
		const maxCountInsert = !update.repeatable ? '?propShape sh:maxCount 1 .' : '';

		await this.executeUpdate(`
			${PREFIXES}
			${WITH_GRAPH}
			DELETE { <${propIri}> rdfs:label ?oldLabel ; rdfs:range ?oldRange . }
			INSERT { <${propIri}> rdfs:label "${escapedName}" ; rdfs:range <${datatypeIri}> . }
			WHERE {
				OPTIONAL { <${propIri}> rdfs:label ?oldLabel }
				OPTIONAL { <${propIri}> rdfs:range ?oldRange }
			} ;
			${WITH_GRAPH}
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
	async deleteDatatypeProperty(propIri: string, classIriValue: string): Promise<void> {
		await this.deletePropertyTriples(propIri, classIriValue);
	}

	// -- Relations (owl:ObjectProperty + sh:property with sh:class) ---------------------------

	/**
	 * Draws a plain relation edge (STORY-006): an `owl:ObjectProperty` from `sourceClassIri` to
	 * `targetClassIri`, plus a `sh:property` entry (`sh:class` = target) on the source class's
	 * `sh:NodeShape`. Structurally identical to `insertDatatypeProperty`, just with `sh:class`
	 * instead of `sh:datatype` and an IRI range instead of an XSD datatype.
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

		const propIri = propertyIri(sourceClassIri, name);
		if (await this.propertyExists(propIri)) {
			throw new Error(`A relation named "${name}" already exists on this entity (${propIri})`);
		}

		const shapeIri = await this.ensureNodeShape(sourceClassIri);
		const escapedName = this.escapeString(name);
		const constraints = [required ? 'sh:minCount 1' : null, !repeatable ? 'sh:maxCount 1' : null]
			.filter((c): c is string => c !== null)
			.map((c) => ` ; ${c}`)
			.join('');

		await this.executeUpdate(`
			${PREFIXES}
			INSERT DATA {
				GRAPH <${SCHEMA_GRAPH}> {
					<${propIri}> a owl:ObjectProperty ;
						rdfs:domain <${sourceClassIri}> ;
						rdfs:range <${targetClassIri}> ;
						rdfs:label "${escapedName}" .
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
	 * The property's IRI never changes.
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

		const shapeIri = nodeShapeIri(sourceClassIri);
		const escapedName = this.escapeString(update.name);
		const minCountInsert = update.required ? '?propShape sh:minCount 1 .' : '';
		const maxCountInsert = !update.repeatable ? '?propShape sh:maxCount 1 .' : '';

		await this.executeUpdate(`
			${PREFIXES}
			${WITH_GRAPH}
			DELETE { <${propIri}> rdfs:label ?oldLabel ; rdfs:range ?oldRange . }
			INSERT { <${propIri}> rdfs:label "${escapedName}" ; rdfs:range <${update.targetClassIri}> . }
			WHERE {
				OPTIONAL { <${propIri}> rdfs:label ?oldLabel }
				OPTIONAL { <${propIri}> rdfs:range ?oldRange }
			} ;
			${WITH_GRAPH}
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

	/** Removes both the `owl:ObjectProperty` declaration and its `sh:property` shape entry. */
	async deleteObjectProperty(propIri: string, sourceClassIri: string): Promise<void> {
		await this.deletePropertyTriples(propIri, sourceClassIri);
	}

	// -- Attributed relationships / association classes (STORY-007) ---------------------------

	/**
	 * Creates an association class (e.g. `EmploymentAssignment`) with two or more
	 * `owl:ObjectProperty` links to related entities (e.g. `employee`, `employer`), following the
	 * pattern of `semantic-crm`'s `gcrms:EmploymentAssignment`/`gcrms:AddressAssignment`. The
	 * class itself is created exactly like any other class (`insertClass`); each link reuses
	 * `insertObjectProperty` since a link is structurally just a relation whose source is the new
	 * association class. Once created, the class's own attributes (e.g. `jobTitle`, `startDate`)
	 * are added the same way as any entity's, via `insertDatatypeProperty` — no separate code path.
	 */
	async insertAssociationClass(
		name: string,
		description: string | undefined,
		links: AssociationLink[]
	): Promise<AssociationClassResult> {
		if (links.length < 2) {
			throw new Error('An attributed relationship needs at least two links to related entities');
		}
		const { iri } = await this.insertClass(name, description);
		await this.setAssociationClass(iri, true);

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
	async deleteAssociationClass(iri: string, options?: { force?: boolean }): Promise<DeleteClassResult> {
		return this.deleteClass(iri, options);
	}

	// -- Inheritance (rdfs:subClassOf) — STORY-008 ---------------------------------------------

	/** All transitive `rdfs:subClassOf` ancestors of `classIriValue`, following only triples
	 *  actually stored in this graph — external vocabulary classes are dead ends here since they
	 *  have no local `owl:Class`/`rdfs:subClassOf` triples of their own, which is what keeps this
	 *  check scoped to local classes without any special-casing. */
	async findAncestors(classIriValue: string): Promise<string[]> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const results = await this.selectQuery(
			`${PREFIXES} SELECT DISTINCT ?ancestor ${FROM_GRAPH} WHERE { <${classIriValue}> rdfs:subClassOf+ ?ancestor }`
		);
		return results.results.bindings.map((b) => b.ancestor.value);
	}

	/** True if adding `subIri rdfs:subClassOf superIri` would close a cycle among local classes. */
	async wouldCreateCycle(subIri: string, superIri: string): Promise<boolean> {
		if (subIri === superIri) return true;
		const ancestors = await this.findAncestors(superIri);
		return ancestors.includes(subIri);
	}

	/** Inserts `subIri rdfs:subClassOf superIri`, refusing (without writing anything) if it would
	 *  create a cycle among local classes. */
	async insertSubClassOf(subIri: string, superIri: string): Promise<{ cycleRejected: boolean }> {
		this.assertSafeSparqlIri(subIri, 'subclass IRI');
		this.assertSafeSparqlIri(superIri, 'superclass IRI');

		if (await this.wouldCreateCycle(subIri, superIri)) {
			return { cycleRejected: true };
		}

		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${subIri}> rdfs:subClassOf <${superIri}> .`)} }`
		);
		return { cycleRejected: false };
	}

	/** Removes only the one `rdfs:subClassOf` triple — the classes at either end are untouched. */
	async deleteSubClassOf(subIri: string, superIri: string): Promise<void> {
		this.assertSafeSparqlIri(subIri, 'subclass IRI');
		this.assertSafeSparqlIri(superIri, 'superclass IRI');
		await this.executeUpdate(
			`${PREFIXES} DELETE DATA { ${inGraph(`<${subIri}> rdfs:subClassOf <${superIri}> .`)} }`
		);
	}

	// -- Attributed-relationship marker (STORY-020) --------------------------------------------

	/** Idempotently ensures `<SCHEMA_NAMESPACE>AttributedRelationship a owl:Class` exists — the
	 *  marker every association class is declared `rdfs:subClassOf` (replacing the old link-count
	 *  heuristic, see `canvas-model.ts`). Safe to call on every load: a no-op once the triple exists. */
	async ensureAttributedRelationshipClass(): Promise<void> {
		const exists = await this.classExists(ATTRIBUTED_RELATIONSHIP_IRI);
		if (exists) return;
		await this.executeUpdate(
			`${PREFIXES} INSERT DATA { ${inGraph(`<${ATTRIBUTED_RELATIONSHIP_IRI}> a owl:Class ; rdfs:label "AttributedRelationship" .`)} }`
		);
	}

	/** Marks/unmarks `classIriValue` as an attributed-relationship (association) class by
	 *  inserting/deleting its `rdfs:subClassOf <SCHEMA_NAMESPACE>AttributedRelationship` triple —
	 *  the sole signal `canvas-model.ts` uses to classify a class as an association class. */
	async setAssociationClass(classIriValue: string, isAssociation: boolean): Promise<void> {
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		if (isAssociation) {
			await this.ensureAttributedRelationshipClass();
			await this.insertSubClassOf(classIriValue, ATTRIBUTED_RELATIONSHIP_IRI);
		} else {
			await this.deleteSubClassOf(classIriValue, ATTRIBUTED_RELATIONSHIP_IRI);
		}
	}

	// -- Full-schema fetch (STORY-009) -----------------------------------------------------------

	async fetchAllClasses(): Promise<FetchedClass[]> {
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?c ?label ?comment ${FROM_GRAPH} WHERE {
				?c a owl:Class .
				${VOCAB_FILTER('?c')}
				OPTIONAL { ?c rdfs:label ?label }
				OPTIONAL { ?c rdfs:comment ?comment }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.c.value,
			label: b.label?.value ?? extractLocalName(b.c.value),
			comment: b.comment?.value ?? null
		}));
	}

	async fetchAllDatatypeProperties(): Promise<FetchedPropertyBase[]> {
		return this.fetchPropertiesByType('owl:DatatypeProperty');
	}

	async fetchAllObjectProperties(): Promise<FetchedPropertyBase[]> {
		return this.fetchPropertiesByType('owl:ObjectProperty');
	}

	/** Every `sh:property` entry across every `sh:NodeShape`, keyed by `sh:path` for joining against
	 *  the property lists above (see `fetchFullSchema`). */
	async fetchAllShapesAndProperties(): Promise<FetchedShapeConstraint[]> {
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?path ?minCount ?maxCount ${FROM_GRAPH} WHERE {
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

	async fetchAllSubClassOf(): Promise<FetchedSubClassOf[]> {
		const results = await this.selectQuery(
			`${PREFIXES} SELECT ?sub ?super ${FROM_GRAPH} WHERE {
				?sub rdfs:subClassOf ?super .
				${VOCAB_FILTER('?sub')}
				${VOCAB_FILTER('?super')}
			}`
		);
		return results.results.bindings.map((b) => ({ sub: b.sub.value, super: b.super.value }));
	}

	/**
	 * Every enumerated individual in the graph (STORY-019): a subject whose `rdf:type` object is
	 * itself a declared local `owl:Class` — the `?type a owl:Class` join is what excludes classes
	 * (typed `owl:Class`), properties (typed `owl:DatatypeProperty`/`owl:ObjectProperty`), and
	 * shapes (typed `sh:NodeShape`) from this result, since none of those meta-types are themselves
	 * asserted `a owl:Class` anywhere in this app's data.
	 */
	async fetchAllIndividuals(): Promise<FetchedIndividual[]> {
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?i ?type ?label ${FROM_GRAPH} WHERE {
				?i a ?type .
				?type a owl:Class .
				${VOCAB_FILTER('?i')}
				OPTIONAL { ?i rdfs:label ?label }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.i.value,
			classIri: b.type.value,
			label: b.label?.value ?? extractLocalName(b.i.value)
		}));
	}

	/**
	 * Fetches everything needed to reconstruct the canvas (STORY-009): all classes, all
	 * datatype/object properties merged with their `sh:property` cardinality constraints, all
	 * `rdfs:subClassOf` triples, and all enumerated individuals (STORY-019). Pure canvas-model
	 * reconstruction from this data lives in `canvas-model.ts`, kept separate so it's testable
	 * without a running GraphDB.
	 */
	async fetchFullSchema(): Promise<FetchedSchema> {
		const [classes, datatypeRaw, objectRaw, constraints, subClassOf, individuals] = await Promise.all([
			this.fetchAllClasses(),
			this.fetchAllDatatypeProperties(),
			this.fetchAllObjectProperties(),
			this.fetchAllShapesAndProperties(),
			this.fetchAllSubClassOf(),
			this.fetchAllIndividuals()
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

	// -- Raw triples view (STORY-011) + manual edit & validation (STORY-012/013) ----------------

	/** Fetches every triple in the graph as quads, in one round-trip — the basis for both the
	 *  whole-graph Turtle view and the "old scope" computation on save. Runs with `infer: false`:
	 *  this is a view/edit of the *asserted* graph, so GraphDB's reasoner materializations (e.g.
	 *  reflexive `rdfs:subClassOf` on every class under an RDFS/OWL ruleset) must not appear as if
	 *  they were real triples — they'd otherwise round-trip into the editor and even trip
	 *  `checkStructural`'s cycle detector on an unrelated class's save. Also excludes GraphDB's
	 *  built-in vocabulary axioms via the same subject filter as `fetchAllClasses`/
	 *  `fetchAllSubClassOf`. */
	async fetchWholeGraphQuads(): Promise<Quad[]> {
		const results = await this.selectQuery(
			`SELECT ?s ?p ?o ${FROM_GRAPH} WHERE { ?s ?p ?o . ${VOCAB_FILTER('?s')} }`,
			{ infer: false }
		);
		return results.results.bindings.map(bindingToQuad);
	}

	/** STORY-011: the whole schema graph, serialized as Turtle. */
	async fetchAllTriplesAsTurtle(): Promise<string> {
		const quads = await this.fetchWholeGraphQuads();
		return quadsToTurtle(quads);
	}

	/** STORY-011: triples scoped to one selected entity/relation (see `selectScope` in `turtle.ts`
	 *  for the exact scoping rule), serialized as Turtle. */
	async fetchTriplesForResourceAsTurtle(iri: string): Promise<string> {
		this.assertSafeSparqlIri(iri, 'resource IRI');
		const allQuads = await this.fetchWholeGraphQuads();
		return quadsToTurtle(selectScope(allQuads, iri));
	}

	/**
	 * STORY-018: both tabs' Turtle for the current scope (whole graph or one selected
	 * entity/relation), computed from a single whole-graph fetch — Schema tab via
	 * STORY-014/015's `partitionQuads` + `groupSchemaQuads`, Shapes tab via STORY-014/016's
	 * `partitionQuads` + `nestBlankNodes` (never a bare top-level `_:b0` statement).
	 */
	async fetchScopedTurtlePair(iri: string | null): Promise<{ schema: string; shapes: string }> {
		if (iri !== null) this.assertSafeSparqlIri(iri, 'resource IRI');
		const allQuads = await this.fetchWholeGraphQuads();
		const schema = await quadsToTurtle(groupSchemaQuads(selectScope(allQuads, iri, 'schema')));
		const shapes = nestBlankNodes(selectScope(allQuads, iri, 'shapes'));
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
	 * semantics" framing of the diff.
	 *
	 * STORY-012's AC asks, at minimum, for a warning if the edit leaves another property's
	 * `rdfs:domain`/`rdfs:range` dangling (e.g. the edit deletes a class something else still
	 * points at). `checkStructural` runs against the *whole* post-edit graph, not just the edited
	 * scope, so it already catches every such case as a hard validation failure — a strictly
	 * stronger guarantee than a warning, so there's no separate warning path here.
	 */
	async saveScopedTurtle(iri: string | null, turtleText: string, partition: Partition = 'all'): Promise<void> {
		if (iri !== null) this.assertSafeSparqlIri(iri, 'resource IRI');

		const allQuadsBefore = await this.fetchWholeGraphQuads();
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

		const deleteOps = this.buildScopeDeleteOps(iri, fullScopeQuads, partition);
		const insertBody = await quadsToGroundTriples(newQuads);
		const insertOp = insertBody.trim() ? `INSERT DATA { ${inGraph(insertBody)} }` : '';
		const ops = [...deleteOps, insertOp].filter(Boolean).join(' ; ');
		if (ops) {
			await this.executeUpdate(`${PREFIXES} ${ops}`);
		}
	}

	/** Builds the `DELETE WHERE` operation(s) that clear `iri`'s old scope — see `saveScopedTurtle`.
	 *  `scopeQuads` is always the *unfiltered* (`'all'`-partition) scope selection, since the ops
	 *  below are derived from scope *structure* (is this a class? does it have a shape?), which
	 *  `partition` must not hide even when only a subset of the resulting ops is actually returned
	 *  (STORY-017). */
	private buildScopeDeleteOps(iri: string | null, scopeQuads: Quad[], partition: Partition): string[] {
		if (iri === null) {
			// The `DELETE WHERE { ... }` shorthand's pattern is a plain `QuadPattern` per the SPARQL
			// 1.1 Update grammar — it does not accept `FILTER` at all (confirmed against the real
			// GraphDB instance: "MALFORMED QUERY" pointing at the first `FILTER` token). Any op that
			// needs a FILTER must use the full `DELETE { ... } WHERE { ... }` form instead — which is
			// also why these use `WITH <graph>` rather than an inline `GRAPH` block: `WITH` scopes the
			// `FILTER`-bearing `WHERE` clause too, not just the delete template.
			if (partition === 'all')
				return [`${WITH_GRAPH} DELETE { ?s ?p ?o } WHERE { ?s ?p ?o . ${VOCAB_FILTER('?s')} }`];
			if (partition === 'schema') {
				return [
					`${WITH_GRAPH} DELETE { ?s ?p ?o } WHERE { ?s ?p ?o . ${VOCAB_FILTER('?s')} FILTER(!isBlank(?s)) FILTER(!STRSTARTS(STR(?s), "${SHAPES_NAMESPACE}")) FILTER(!STRSTARTS(STR(?p), "${SH_NS}")) }`
				];
			}
			return [
				`${WITH_GRAPH} DELETE { ?s ?p ?o } WHERE { ?s ?p ?o . FILTER(isBlank(?s) || STRSTARTS(STR(?s), "${SHAPES_NAMESPACE}") || STRSTARTS(STR(?p), "${SH_NS}")) }`
			];
		}

		const isClass = scopeQuads.some((q) => isRdfType(q, OWL.Class) && q.subject.value === iri);
		if (isClass) {
			const shapeIri = nodeShapeIri(iri);
			const shapesOps = [
				`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`)} }`,
				`DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`)} }`
			];
			const schemaOps = [`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`)} }`];
			if (partition === 'schema') return schemaOps;
			if (partition === 'shapes') return shapesOps;
			return [...shapesOps, ...schemaOps];
		}

		const schemaOps = [`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`)} }`];
		const domainQuad = scopeQuads.find(
			(q) => q.subject.value === iri && q.predicate.value === RDFS.domain
		);
		const shapesOps: string[] = [];
		if (domainQuad) {
			const shapeIri = nodeShapeIri(domainQuad.object.value);
			shapesOps.push(
				`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape sh:path <${iri}> . ?propShape ?p ?o .`)} }`
			);
		}
		if (partition === 'schema') return schemaOps;
		if (partition === 'shapes') return shapesOps;
		return [...schemaOps, ...shapesOps];
	}


	// -- Internals ------------------------------------------------------------------------------

	private async fetchPropertiesByType(owlType: 'owl:DatatypeProperty' | 'owl:ObjectProperty'): Promise<FetchedPropertyBase[]> {
		const results = await this.selectQuery(`
			${PREFIXES}
			SELECT ?p ?label ?domain ?range ${FROM_GRAPH} WHERE {
				?p a ${owlType} ; rdfs:domain ?domain ; rdfs:range ?range .
				OPTIONAL { ?p rdfs:label ?label }
			}
		`);
		return results.results.bindings.map((b) => ({
			iri: b.p.value,
			label: b.label?.value ?? extractLocalName(b.p.value),
			domain: b.domain.value,
			range: b.range.value
		}));
	}

	/** Shared by `deleteDatatypeProperty`/`deleteObjectProperty`: the delete logic doesn't care
	 *  which `owl:*Property` kind it is, only that it's matched via `sh:path` on the owning
	 *  class's shape and then removed entirely, along with its `owl:*Property` declaration. */
	private async deletePropertyTriples(propIri: string, classIriValue: string): Promise<void> {
		this.assertSafeSparqlIri(propIri, 'property IRI');
		this.assertSafeSparqlIri(classIriValue, 'class IRI');
		const shapeIri = nodeShapeIri(classIriValue);

		await this.executeUpdate(`
			${PREFIXES}
			DELETE WHERE {
				${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape sh:path <${propIri}> . ?propShape ?p ?o .`)}
			} ;
			DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`)} }
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
