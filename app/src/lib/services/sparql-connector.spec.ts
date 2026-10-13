import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	SparqlConnector,
	factKeyString,
	ANNOTATION_MAX_TEXT_LENGTH,
	type SparqlBinding
} from './sparql-connector';
import {
	classIri,
	propertyIri,
	genericPropertyIri,
	individualIri,
	nodeShapeIri,
	extractLocalName,
	SCHEMA_NAMESPACE,
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
	SAVED_QUERY_MODEL_PREDICATE_IRI,
	SAVED_QUERY_CREATED_BY_PREDICATE_IRI,
	SAVED_QUERY_CREATED_AT_PREDICATE_IRI,
	SAVED_QUERY_PUBLISHED_PREDICATE_IRI,
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
	BACKSTAGE_KIND_PREDICATE_IRI,
	NAMESPACE_PREDICATE_IRI,
	SOURCE_FIELD_PREDICATE_IRI,
	SOURCE_RELATION_PREDICATE_IRI,
	GENERATED_REVERSE_OF_PREDICATE_IRI,
	GROUP_ON_ONE_LINE_PREDICATE_IRI,
	DISPLAY_AS_CHIPS_PREDICATE_IRI,
	catalogIri,
	datasetIri,
	distributionIri,
	splitDatasetIri,
	SYNC_SOURCE_PREDICATE_IRI,
	SYNC_STATUS_PREDICATE_IRI
} from '../utils/iri';
import { DEFAULT_NAMESPACE_BASE_IRI, SCHEMA_GRAPH, namespaceGraphs } from '../config';
import { RDF, RDFS, OWL, SH, DCAT, DCT, PROV, parseTurtle } from './turtle';
import { SchemaValidationError } from './validation';

/** The default (pre-existing, `.env`-seeded) namespace's three storage graphs (STORY-025/026) —
 *  every method below defaults to this namespace when no `namespaceBaseIri` is passed explicitly,
 *  so these are the graphs its generated SPARQL should target. */
const DEFAULT_GRAPHS = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

/** Wraps triples the same way `sparql-connector.ts`'s `inGraph` does, so assertions on generated
 *  `INSERT DATA`/`DELETE DATA`/`DELETE WHERE` bodies stay in sync with the named-graph wrapping
 *  (STORY-026: every graph is now an explicit parameter, not one module-level constant). */
function inGraph(triples: string, graph: string): string {
	return `GRAPH <${graph}> { ${triples} }`;
}

describe('SparqlConnector', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends a SELECT query to the configured endpoint and parses the response', async () => {
		const body = { head: { vars: ['s'] }, results: { bindings: [{ s: { type: 'uri', value: 'urn:x' } }] } };
		fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.selectQuery('SELECT ?s WHERE { ?s ?p ?o }');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/sparql',
			expect.objectContaining({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: 'SELECT ?s WHERE { ?s ?p ?o }' })
			})
		);
		expect(result).toEqual(body);
	});

	it('sends an ASK query and returns the boolean result', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ head: {}, boolean: true }), { status: 200 }));

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.askQuery('ASK { ?s ?p ?o }');

		expect(result).toBe(true);
	});

	it('sends an update to the /update sub-route', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

		const connector = new SparqlConnector('/api/sparql');
		await connector.executeUpdate('INSERT DATA { <urn:a> <urn:b> <urn:c> }');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/sparql/update',
			expect.objectContaining({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ update: 'INSERT DATA { <urn:a> <urn:b> <urn:c> }' })
			})
		);
	});

	it('propagates an error message on a non-200 query response', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ message: 'malformed query' }), { status: 400, statusText: 'Bad Request' })
		);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.selectQuery('not sparql')).rejects.toThrow('malformed query');
	});

	it('propagates a fallback error message on a non-200 update response with no JSON body', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 502, statusText: 'Bad Gateway' }));

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.executeUpdate('INSERT DATA { <urn:a> <urn:b> <urn:c> }')).rejects.toThrow(
			'SPARQL update failed: 502 Bad Gateway'
		);
	});
});

/**
 * Stateful fetch mock for the domain methods below: inspects each outgoing request and answers
 * ASK/SELECT queries based on the fixture, while recording every SPARQL Update body verbatim so
 * tests can assert on the generated triples. Call order isn't assumed — each method issues its
 * ASK/SELECT calls in whatever order it needs, so responses are matched by query content instead
 * of by call index.
 *
 * `classGraph` additionally answers `insertObjectProperty`/`updateObjectProperty`/
 * `deleteObjectProperty`'s internal `findNamespaceOfClass` lookup (a bare `GRAPH ?g { <iri> a
 * owl:Class }` query, STORY-026 Decision 8) — mapping a class IRI to the graph its `owl:Class`
 * triple lives in. Classes not listed default to the default namespace's own `/schema` graph,
 * matching every other method's default namespace, so the existing single-namespace tests below
 * don't need to know about this at all.
 */
function mockGraphFetch(
	fixture: {
		classExists?: boolean;
		propertyExists?: boolean;
		shapeExists?: boolean;
		annotationPropertyExists?: boolean;
		ownProperties?: string[];
		externalReferences?: string[];
		ancestors?: string[];
		classGraph?: Record<string, string>;
		backstageKind?: string;
		/** STORY-102: the property IRI's current `rse:sourceField` mapping, for
		 *  `fetchAttributeSourceField`. */
		sourceField?: string;
		/** STORY-125 follow-up: the property IRI's current `rse:groupOnOneLine`/`rse:displayAsChips`
		 *  markers, for `fetchAttributeDisplayMarkers`. */
		displayMarkers?: { groupOnOneLine?: boolean; displayAsChips?: boolean };
		/** STORY-107: the property IRI's current `rse:sourceRelation` mapping, for
		 *  `fetchRelationSourceType`. */
		sourceType?: string;
		/** STORY-XXX: the `owl:inverseOf` partner returned by `fetchInverseRelation`, or `undefined`
		 *  when no reverse is defined. */
		inverseRelation?: { iri: string; label?: string; sourceType?: string };
		authoritativeEntityClassIri?: string;
		/** STORY-103: the configured `rse:representsPredicate` setting value, for
		 *  `fetchRepresentsPredicateIri`. */
		representsPredicateIri?: string;
		/** STORY-100: subject IRI -> its own `rse:namespace` value, for
		 *  `resolveEffectiveClassNamespace`'s per-node own-declaration lookup. */
		ownNamespace?: Record<string, string>;
		/** STORY-100: subject IRI -> its direct `rdfs:subClassOf` superclasses, for
		 *  `resolveEffectiveClassNamespace`'s breadth-first ancestry walk. */
		superClasses?: Record<string, string[]>;
	} = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('SELECT ?ns WHERE')) {
			const match = q.match(/<([^>]+)> <[^>]+> \?ns/);
			const subjectIri = match?.[1];
			const value = subjectIri ? fixture.ownNamespace?.[subjectIri] : undefined;
			const bindings = value ? [{ ns: { type: 'uri', value } }] : [];
			return new Response(JSON.stringify({ head: { vars: ['ns'] }, results: { bindings } }), { status: 200 });
		}
		if (q.includes('SELECT ?super WHERE')) {
			const match = q.match(/<([^>]+)> rdfs:subClassOf \?super/);
			const subjectIri = match?.[1];
			const supers = (subjectIri ? fixture.superClasses?.[subjectIri] : undefined) ?? [];
			const bindings = supers.map((s) => ({ super: { type: 'uri', value: s } }));
			return new Response(JSON.stringify({ head: { vars: ['super'] }, results: { bindings } }), { status: 200 });
		}
		if (q.includes('owl:inverseOf') && q.includes('?label')) {
			// fetchInverseRelation's own query — checked before the generic `GRAPH ?g` branch below,
			// since its `GRAPH ?g1`/`?g2`/`?g3` variables would otherwise (wrongly) match that branch's
			// substring check.
			const bindings = fixture.inverseRelation
				? [
						{
							inverse: { type: 'uri', value: fixture.inverseRelation.iri },
							...(fixture.inverseRelation.label !== undefined
								? { label: { type: 'literal', value: fixture.inverseRelation.label } }
								: {}),
							...(fixture.inverseRelation.sourceType !== undefined
								? { sourceType: { type: 'literal', value: fixture.inverseRelation.sourceType } }
								: {})
						}
					]
				: [];
			return new Response(
				JSON.stringify({ head: { vars: ['inverse', 'label', 'sourceType'] }, results: { bindings } }),
				{ status: 200 }
			);
		}
		if (q.includes('GRAPH ?g')) {
			const match = q.match(/GRAPH \?g \{ <([^>]+)> a owl:Class \}/);
			const classIriValue = match?.[1];
			const graph = (classIriValue && fixture.classGraph?.[classIriValue]) ?? DEFAULT_GRAPHS.schema;
			return new Response(
				JSON.stringify({
					head: { vars: ['g'] },
					results: { bindings: [{ g: { type: 'uri', value: graph } }] }
				}),
				{ status: 200 }
			);
		}
		if (q.includes('ASK')) {
			if (q.includes('owl:Class')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.classExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('owl:DatatypeProperty')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.propertyExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('sh:NodeShape')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.shapeExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('owl:AnnotationProperty')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.annotationPropertyExists ?? false }), {
					status: 200
				});
			}
			return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
		}
		if (q.includes('backstageKind')) {
			const bindings = fixture.backstageKind ? [{ kind: { type: 'literal', value: fixture.backstageKind } }] : [];
			return new Response(JSON.stringify({ head: { vars: ['kind'] }, results: { bindings } }), {
				status: 200
			});
		}
		if (q.includes('sourceRelation')) {
			const bindings = fixture.sourceType ? [{ type: { type: 'literal', value: fixture.sourceType } }] : [];
			return new Response(JSON.stringify({ head: { vars: ['type'] }, results: { bindings } }), {
				status: 200
			});
		}
		if (q.includes('sourceField')) {
			const bindings = fixture.sourceField ? [{ path: { type: 'literal', value: fixture.sourceField } }] : [];
			return new Response(JSON.stringify({ head: { vars: ['path'] }, results: { bindings } }), {
				status: 200
			});
		}
		if (q.includes('groupOnOneLine')) {
			const binding: Record<string, { type: string; value: string }> = {};
			if (fixture.displayMarkers?.groupOnOneLine) binding.groupOnOneLine = { type: 'literal', value: 'true' };
			if (fixture.displayMarkers?.displayAsChips) binding.displayAsChips = { type: 'literal', value: 'true' };
			return new Response(
				JSON.stringify({ head: { vars: ['groupOnOneLine', 'displayAsChips'] }, results: { bindings: [binding] } }),
				{ status: 200 }
			);
		}
		if (q.includes('authoritativeEntityClass')) {
			const bindings = fixture.authoritativeEntityClassIri
				? [{ classIri: { type: 'uri', value: fixture.authoritativeEntityClassIri } }]
				: [];
			return new Response(JSON.stringify({ head: { vars: ['classIri'] }, results: { bindings } }), {
				status: 200
			});
		}
		if (q.includes('representsPredicate')) {
			const bindings = fixture.representsPredicateIri
				? [{ predIri: { type: 'uri', value: fixture.representsPredicateIri } }]
				: [];
			return new Response(JSON.stringify({ head: { vars: ['predIri'] }, results: { bindings } }), {
				status: 200
			});
		}
		if (q.includes('rdfs:domain')) {
			const bindings = (fixture.ownProperties ?? []).map((p) => ({ p: { type: 'uri', value: p } }));
			return new Response(JSON.stringify({ head: { vars: ['p'] }, results: { bindings } }), {
				status: 200
			});
		}
		if (q.includes('rdfs:subClassOf+')) {
			const bindings = (fixture.ancestors ?? []).map((a) => ({ ancestor: { type: 'uri', value: a } }));
			return new Response(JSON.stringify({ head: { vars: ['ancestor'] }, results: { bindings } }), {
				status: 200
			});
		}
		if (q.includes('rdfs:range')) {
			const bindings = (fixture.externalReferences ?? []).map((p) => ({ p: { type: 'uri', value: p } }));
			return new Response(JSON.stringify({ head: { vars: ['p'] }, results: { bindings } }), {
				status: 200
			});
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector — class CRUD (STORY-004)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertClass derives the IRI from the name and writes an owl:Class with label + comment', async () => {
		const { fn, updates } = mockGraphFetch({ classExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertClass('Person', 'A person in the graph');

		expect(result.iri).toBe(classIri('Person'));
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${classIri('Person')}> a owl:Class`);
		expect(updates[0]).toContain('rdfs:label "Person"');
		expect(updates[0]).toContain('rdfs:comment "A person in the graph"');
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('insertClass rejects a duplicate class name', async () => {
		const { fn } = mockGraphFetch({ classExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertClass('Person')).rejects.toThrow(/already exists/);
	});

	it('insertClass rejects an empty name without making any request', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertClass('   ')).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('renameClass only touches rdfs:label, leaving the IRI untouched', async () => {
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const iri = classIri('Person');
		const connector = new SparqlConnector('/api/sparql');
		await connector.renameClass(iri, 'Individual');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE');
		expect(updates[0]).toContain(`<${iri}> rdfs:label ?old`);
		expect(updates[0]).toContain(`INSERT { <${iri}> rdfs:label "Individual"`);
	});

	it('deleteClass with no external references deletes the class and its own properties', async () => {
		const iri = classIri('Person');
		const ownProp = propertyIri(iri, 'nickname');
		const { fn, updates } = mockGraphFetch({ ownProperties: [ownProp], externalReferences: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteClass(iri);

		expect(result).toEqual({ deleted: true, externalReferences: [], subClassReferences: [] });
		// one update for the cascaded own-property delete, one for the class/shape delete
		expect(updates).toHaveLength(2);
		expect(updates.some((u) => u.includes(`<${ownProp}>`))).toBe(true);
		expect(updates.some((u) => u.includes(`<${iri}> ?p ?o`))).toBe(true);
	});

	it('deleteClass refuses to delete when another class references it, without writing anything', async () => {
		const iri = classIri('Person');
		const externalProp = `${SCHEMA_NAMESPACE}companyEmployee`;
		const { fn, updates } = mockGraphFetch({ externalReferences: [externalProp] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteClass(iri);

		expect(result).toEqual({ deleted: false, externalReferences: [externalProp], subClassReferences: [] });
		expect(updates).toHaveLength(0);
	});

	it('deleteClass with force:true deletes despite external references', async () => {
		const iri = classIri('Person');
		const externalProp = `${SCHEMA_NAMESPACE}companyEmployee`;
		const { fn, updates } = mockGraphFetch({ externalReferences: [externalProp] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteClass(iri, { force: true });

		expect(result.deleted).toBe(true);
		expect(updates.length).toBeGreaterThan(0);
	});
});

describe('SparqlConnector — attribute CRUD (STORY-005)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertDatatypeProperty creates the shape if needed and writes both triple sets', async () => {
		const iri = classIri('Person');
		const { fn, updates } = mockGraphFetch({ propertyExists: false, shapeExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertDatatypeProperty(iri, 'birth date', 'date', true, false);

		const expectedPropIri = propertyIri(iri, 'birth date');
		expect(result.iri).toBe(expectedPropIri);

		// one update to create the missing NodeShape, one to insert the property + sh:property
		expect(updates).toHaveLength(2);
		const shapeIri = nodeShapeIri(iri);
		expect(updates[0]).toContain(`<${shapeIri}> a sh:NodeShape`);
		expect(updates[0]).toContain(`sh:targetClass <${iri}>`);

		expect(updates[1]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
		expect(updates[1]).toContain(`<${expectedPropIri}> a owl:DatatypeProperty`);
		expect(updates[1]).toContain(`rdfs:domain <${iri}>`);
		expect(updates[1]).toContain('rdfs:range <http://www.w3.org/2001/XMLSchema#date>');
		expect(updates[1]).toContain('rdfs:label "birth date"');
		expect(updates[1]).toContain(`GRAPH <${DEFAULT_GRAPHS.shapes}>`);
		expect(updates[1]).toContain(`sh:path <${expectedPropIri}>`);
		expect(updates[1]).toContain('sh:minCount 1');
		expect(updates[1]).toContain('sh:maxCount 1');
	});

	it('insertDatatypeProperty omits minCount/maxCount for an optional, repeatable attribute', async () => {
		const iri = classIri('Person');
		const { fn, updates } = mockGraphFetch({ propertyExists: false, shapeExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.insertDatatypeProperty(iri, 'nickname', 'string', false, true);

		expect(updates).toHaveLength(1); // shape already exists, no shape-creation update
		expect(updates[0]).not.toContain('sh:minCount');
		expect(updates[0]).not.toContain('sh:maxCount');
	});

	it('insertDatatypeProperty rejects a duplicate attribute on the same entity', async () => {
		const iri = classIri('Person');
		const { fn } = mockGraphFetch({ propertyExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertDatatypeProperty(iri, 'nickname', 'string', false, false)).rejects.toThrow(
			/already exists/
		);
	});

	it('updateDatatypeProperty keeps the owl:DatatypeProperty and sh:property entry in sync', async () => {
		const iri = classIri('Person');
		const propIri = propertyIri(iri, 'nickname');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateDatatypeProperty(iri, propIri, {
			name: 'Nickname',
			datatype: 'string',
			required: true,
			repeatable: false
		});

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${propIri}> rdfs:label "Nickname"`);
		expect(updates[0]).toContain('rdfs:range <http://www.w3.org/2001/XMLSchema#string>');
		expect(updates[0]).toContain(`sh:path <${propIri}>`);
		expect(updates[0]).toContain('sh:minCount 1');
		expect(updates[0]).toContain('sh:maxCount 1');
	});

	it('insertDatatypeProperty writes REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI true when requiredForSubclasses is set', async () => {
		const iri = classIri('CoreConcept');
		const { fn, updates } = mockGraphFetch({ propertyExists: false, shapeExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.insertDatatypeProperty(iri, 'bAttr', 'string', false, true, undefined, true);

		expect(updates[0]).toContain(`<${SCHEMA_NAMESPACE}requiredForSubclasses> true`);
	});

	it('updateDatatypeProperty swaps the REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI flag like minCount/maxCount', async () => {
		const iri = classIri('CoreConcept');
		const propIri = propertyIri(iri, 'bAttr');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateDatatypeProperty(iri, propIri, {
			name: 'bAttr',
			datatype: 'string',
			required: false,
			repeatable: true,
			requiredForSubclasses: true
		});

		expect(updates[0]).toContain(`?propShape <${SCHEMA_NAMESPACE}requiredForSubclasses> ?oldRequiredForSubclasses`);
		expect(updates[0]).toContain(`<${SCHEMA_NAMESPACE}requiredForSubclasses> true`);
	});

	it('deleteDatatypeProperty removes both the property and its shape entry', async () => {
		const iri = classIri('Person');
		const propIri = propertyIri(iri, 'nickname');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteDatatypeProperty(propIri, iri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`sh:path <${propIri}>`);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});
});

describe('SparqlConnector — relation edges (STORY-006)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertObjectProperty writes an owl:ObjectProperty and a sh:class shape entry', async () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const { fn, updates } = mockGraphFetch({ propertyExists: false, shapeExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(person, car, 'owns', false, true);

		const expectedIri = propertyIri(person, 'owns');
		expect(result.iri).toBe(expectedIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
		expect(updates[0]).toContain(`<${expectedIri}> a owl:ObjectProperty`);
		expect(updates[0]).toContain(`rdfs:domain <${person}>`);
		expect(updates[0]).toContain(`rdfs:range <${car}>`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.shapes}>`);
		expect(updates[0]).toContain(`sh:class <${car}>`);
		expect(updates[0]).not.toContain('sh:minCount');
		expect(updates[0]).not.toContain('sh:maxCount');
	});

	it('insertObjectProperty rejects a duplicate relation name on the same entity', async () => {
		const { fn } = mockGraphFetch({ propertyExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertObjectProperty(classIri('Person'), classIri('Car'), 'owns', false, false)
		).rejects.toThrow(/already exists/);
	});

	it('updateObjectProperty can retarget the relation to a different entity', async () => {
		const person = classIri('Person');
		const propIri = propertyIri(person, 'owns');
		const newTarget = classIri('Motorcycle');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateObjectProperty(person, propIri, {
			name: 'owns',
			targetClassIri: newTarget,
			required: false,
			repeatable: true
		});

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${propIri}> rdfs:label "owns"`);
		expect(updates[0]).toContain(`rdfs:range <${newTarget}>`);
		expect(updates[0]).toContain(`sh:class <${newTarget}>`);
	});

	it('deleteObjectProperty removes both the property and its shape entry', async () => {
		const person = classIri('Person');
		const propIri = propertyIri(person, 'owns');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(propIri, person);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`sh:path <${propIri}>`);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});
});

describe('SparqlConnector — redefining a specific relation reuses its own leftover triples', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** `insertObjectProperty`'s specific-relation path mints a deterministic IRI from
	 *  (sourceClassIri, name), so re-declaring one under the same source class always collides with
	 *  whatever's already at that IRI — most often triples a delete left behind. Mocks
	 *  `findNamespaceOfClass`'s `GRAPH ?g` lookup, `propertyExists`'s
	 *  `owl:DatatypeProperty`/`owl:ObjectProperty` ASK, `ensureNodeShape`'s `sh:NodeShape` ASK, and
	 *  the new "is the existing declaration's own `rdfs:domain` this same source class" ASK. */
	function mockRedefineFetch(fixture: { propertyExists: boolean; ownedByThisClass?: boolean }) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: DEFAULT_GRAPHS.schema } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('rdfs:domain <')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.ownedByThisClass ?? false }), {
					status: 200
				});
			}
			if (q.includes('owl:DatatypeProperty') || q.includes('owl:ObjectProperty')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.propertyExists }), { status: 200 });
			}
			if (q.includes('sh:NodeShape')) {
				return new Response(JSON.stringify({ head: {}, boolean: true }), { status: 200 });
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('rewrites the existing owl:ObjectProperty/sh:property triples in place instead of erroring, when the leftover declaration is this same source class\'s own', async () => {
		const api = classIri('Api');
		const system = classIri('System');
		const expectedIri = propertyIri(api, 'isPartOf');
		const { fn, updates } = mockRedefineFetch({ propertyExists: true, ownedByThisClass: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(api, system, 'isPartOf', false, true);

		expect(result.iri).toBe(expectedIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${expectedIri}> a owl:ObjectProperty`);
		expect(updates[0]).toContain(`rdfs:domain <${api}>`);
		expect(updates[0]).toContain(`rdfs:range <${system}>`);
		expect(updates[0]).toContain(`sh:class <${system}>`);
		expect(updates[0]).toContain(`<${nodeShapeIri(api)}> sh:property ?propShape . ?propShape sh:path <${expectedIri}>`);
		expect(updates[0]).toContain('DELETE WHERE {');
		expect(updates[0]).toContain('INSERT DATA {');
	});

	it('still rejects the collision when the existing declaration at that IRI belongs to a different rdfs:domain', async () => {
		const api = classIri('Api');
		const system = classIri('System');
		const { fn } = mockRedefineFetch({ propertyExists: true, ownedByThisClass: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertObjectProperty(api, system, 'isPartOf', false, true)).rejects.toThrow(
			/already exists/
		);
	});
});

describe('SparqlConnector — generic relations (STORY-052)', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** Dedicated fixture-driven mock for the generic-relation flow: `findNamespaceOfClass`'s
	 *  `GRAPH ?g` lookup, `findGenericObjectProperty`'s `FILTER NOT EXISTS { ?p rdfs:domain ?d }`
	 *  lookup, the "already used from this source class" `sh:property [ sh:path ... ]` ASK,
	 *  `ensureNodeShape`'s `sh:NodeShape` ASK, and `propertyExists`'s `owl:DatatypeProperty`/
	 *  `owl:ObjectProperty` ASK. Kept separate from `mockGraphFetch` above: that helper's
	 *  `q.includes('rdfs:domain')` branch (for `findOwnProperties`) would otherwise misroute
	 *  `findGenericObjectProperty`'s query, which also contains the substring `rdfs:domain` as part
	 *  of its `FILTER NOT EXISTS` clause. */
	function mockGenericFetch(
		fixture: {
			existingGenericIri?: string;
			/** Current target class(es) already on this source class's property shape for the
			 *  existing generic relation, if any — answers `fetchGenericPropertyShapeDetails`'s query.
			 *  Empty/omitted means this source class doesn't use the relation yet. */
			currentTargets?: string[];
			currentName?: string;
			currentMinCount?: number;
			currentMaxCount?: number;
			propertyExists?: boolean;
			shapeExists?: boolean;
			classGraph?: Record<string, string>;
			/** Every registered namespace `findGenericObjectProperty`/`listGenericObjectProperties`
			 *  should walk, for tests exercising cross-namespace reuse — defaults to a single-namespace
			 *  world (just the default namespace). */
			namespaces?: string[];
			/** The namespace `existingGenericIri` is actually declared in — defaults to the default
			 *  namespace. When it differs from the source class's own namespace (`classGraph`), the
			 *  `FILTER NOT EXISTS` branch below only answers a match for *that* namespace's own
			 *  `/schema` graph, exactly like a real per-namespace SPARQL query would, so a cross-
			 *  namespace reuse test can't accidentally "find" the relation via the wrong namespace. */
			existingGenericNamespaceBaseIri?: string;
		} = {}
	) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('SELECT ?ns ?prefix')) {
				// `fetchNamespaces()` — `findGenericObjectProperty`/`listGenericObjectProperties` now
				// walk every registered namespace; this fixture's tests all model a single-namespace
				// world by default, so one row (the default namespace) is enough to exercise that walk.
				const namespaces = fixture.namespaces ?? [DEFAULT_NAMESPACE_BASE_IRI];
				return new Response(
					JSON.stringify({
						head: { vars: ['ns', 'prefix'] },
						results: { bindings: namespaces.map((ns) => ({ ns: { type: 'uri', value: ns } })) }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('GRAPH ?g')) {
				const match = q.match(/GRAPH \?g \{ <([^>]+)> a owl:Class \}/);
				const classIriValue = match?.[1];
				const graph = (classIriValue && fixture.classGraph?.[classIriValue]) ?? DEFAULT_GRAPHS.schema;
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: graph } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('FILTER NOT EXISTS')) {
				const existingGenericGraph = namespaceGraphs(
					fixture.existingGenericNamespaceBaseIri ?? DEFAULT_NAMESPACE_BASE_IRI
				).schema;
				const matchesQueriedNamespace = q.includes(`FROM <${existingGenericGraph}>`);
				const bindings =
					fixture.existingGenericIri && matchesQueriedNamespace
						? [{ p: { type: 'uri', value: fixture.existingGenericIri } }]
						: [];
				return new Response(JSON.stringify({ head: { vars: ['p'] }, results: { bindings } }), {
					status: 200
				});
			}
			if (q.includes('SELECT ?class ?name ?minCount ?maxCount')) {
				const targets = fixture.currentTargets ?? [];
				const bindings = targets.map((t) => ({
					class: { type: 'uri', value: t },
					...(fixture.currentName ? { name: { type: 'literal', value: fixture.currentName } } : {}),
					...(fixture.currentMinCount !== undefined
						? { minCount: { type: 'literal', value: String(fixture.currentMinCount) } }
						: {}),
					...(fixture.currentMaxCount !== undefined
						? { maxCount: { type: 'literal', value: String(fixture.currentMaxCount) } }
						: {})
				}));
				return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });
			}
			if (q.includes('ASK') && q.includes('sh:NodeShape')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.shapeExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('ASK') && q.includes('owl:DatatypeProperty')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.propertyExists ?? false }), {
					status: 200
				});
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('findGenericObjectProperty returns the matching property IRI when one exists', async () => {
		const existingIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const { fn } = mockGenericFetch({ existingGenericIri: existingIri });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.findGenericObjectProperty('uses')).resolves.toBe(existingIri);
	});

	it('findGenericObjectProperty returns undefined when no generic property matches the label (e.g. only a specific relation shares it)', async () => {
		const { fn } = mockGenericFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.findGenericObjectProperty('owns')).resolves.toBeUndefined();
	});

	it('creates a new generic relation with no rdfs:domain/rdfs:range', async () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const { fn, updates } = mockGenericFetch({ shapeExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(person, car, 'uses', false, true, {
			kind: 'generic'
		});

		const expectedIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		expect(result.iri).toBe(expectedIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${expectedIri}> a owl:ObjectProperty`);
		expect(updates[0]).not.toContain('rdfs:domain');
		expect(updates[0]).not.toContain('rdfs:range');
		expect(updates[0]).toContain(`sh:class <${car}>`);
	});

	it('reuses an existing generic relation from a different source class, adding only a new sh:property entry', async () => {
		const project = classIri('Project');
		const tool = classIri('Tool');
		const existingIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const { fn, updates } = mockGenericFetch({
			existingGenericIri: existingIri,
			currentTargets: [],
			shapeExists: true
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(project, tool, 'uses', false, true, {
			kind: 'generic'
		});

		expect(result.iri).toBe(existingIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).not.toContain('owl:ObjectProperty');
		expect(updates[0]).not.toContain('rdfs:label');
		expect(updates[0]).toContain(`sh:path <${existingIri}>`);
		expect(updates[0]).toContain(`sh:class <${tool}>`);
	});

	it('reuses an existing generic relation declared in a *different* namespace than the drawing source class, instead of minting a duplicate under the source\'s own namespace', async () => {
		const coreBase = 'http://example.org/core';
		const backstageBase = 'http://example.org/backstage';
		const coreGraphs = namespaceGraphs(coreBase);
		const component = classIri('Component'); // lives in `backstageBase`, per `classGraph` below
		const application = classIri('Application');
		const existingIri = genericPropertyIri('represents', coreGraphs.schema);
		const { fn, updates } = mockGenericFetch({
			namespaces: [DEFAULT_NAMESPACE_BASE_IRI, coreBase, backstageBase],
			existingGenericIri: existingIri,
			existingGenericNamespaceBaseIri: coreBase,
			currentTargets: [],
			shapeExists: true,
			classGraph: { [component]: namespaceGraphs(backstageBase).schema }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(component, application, 'represents', false, true, {
			kind: 'generic'
		});

		// Reused `core:represents` by IRI — no new `owl:ObjectProperty`/`rdfs:label` declared under
		// `backstage`'s own namespace, just a new `sh:property` entry on the source class's shape.
		expect(result.iri).toBe(existingIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).not.toContain('owl:ObjectProperty');
		expect(updates[0]).not.toContain('rdfs:label');
		expect(updates[0]).toContain(`sh:path <${existingIri}>`);
		expect(updates[0]).toContain(`sh:class <${application}>`);
	});

	it('rejects reusing a generic relation with the same name *and* target from the same source class (an exact duplicate edge)', async () => {
		const project = classIri('Project');
		const ingredient = classIri('Ingredient');
		const existingIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const { fn } = mockGenericFetch({
			existingGenericIri: existingIri,
			currentTargets: [ingredient],
			shapeExists: true
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertObjectProperty(project, ingredient, 'uses', false, true, {
				kind: 'generic'
			})
		).rejects.toThrow(/already exists/);
	});

	it("merges a second, different target into the same source class's existing generic-relation property shape as an independent sh:property block (no sh:or, data-catalog Story 018)", async () => {
		const project = classIri('Project');
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const existingIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const shapeIri = nodeShapeIri(project, DEFAULT_GRAPHS.shapes);
		const { fn, updates } = mockGenericFetch({
			existingGenericIri: existingIri,
			currentTargets: [tool],
			currentName: 'uses',
			shapeExists: true
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(project, ingredient, 'uses', false, true, {
			kind: 'generic'
		});

		expect(result.iri).toBe(existingIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`sh:path <${existingIri}>`);
		expect(updates[0]).toContain(`sh:class <${tool}>`);
		expect(updates[0]).toContain(`sh:class <${ingredient}>`);
		// Two independent `sh:property [ ... ]` blocks on the shape, one per target class — the
		// freshly-written INSERT never uses sh:or, even though the DELETE/WHERE half still mentions
		// it to clean up any legacy sh:or-shaped data (forward-fix only, no migration).
		const insertSection = updates[0].slice(updates[0].indexOf('INSERT DATA'));
		expect(insertSection).not.toContain('sh:or');
		expect(insertSection.split(`<${shapeIri}> sh:property [`).length - 1).toBe(2);
		expect(updates[0]).toContain('DELETE');
	});

	it('fetchGenericPropertyShapeDetails reads targets by matching every sh:property entry\'s own sh:class directly, without traversing sh:or (data-catalog Story 018)', async () => {
		const project = classIri('Project');
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const existingIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const { fn } = mockGenericFetch({
			existingGenericIri: existingIri,
			currentTargets: [tool, ingredient],
			currentName: 'uses',
			shapeExists: true
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		// Exercises the private fetchGenericPropertyShapeDetails read path indirectly: the
		// duplicate-target rejection only fires once both existing targets have been read back.
		await expect(
			connector.insertObjectProperty(project, tool, 'uses', false, true, { kind: 'generic' })
		).rejects.toThrow(/already exists/);

		const readQuery = fn.mock.calls
			.map(([, opts]) => JSON.parse((opts as { body: string }).body).query as string | undefined)
			.find((q) => q?.includes('SELECT ?class ?name ?minCount ?maxCount'));
		expect(readQuery).toBeDefined();
		expect(readQuery).not.toContain('sh:or');
		expect(readQuery).toContain('?propShape sh:class ?class');
	});

	it('updateObjectProperty on a generic relation retargets sh:class and keeps rdfs:domain/rdfs:range absent, never re-declaring them', async () => {
		const project = classIri('Project');
		const propIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const newTarget = classIri('Ingredient');
		const { fn, updates } = mockGenericFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateObjectProperty(
			project,
			propIri,
			{ name: 'uses', targetClassIri: newTarget, required: false, repeatable: true },
			{ kind: 'generic' }
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).not.toContain('rdfs:domain');
		expect(updates[0]).not.toContain('rdfs:range');
		expect(updates[0]).toContain(`sh:class <${newTarget}>`);
	});

	it('updateObjectProperty on a generic relation with several targets (independent sh:property blocks, data-catalog Story 018) retargets only the given old target, leaving the others untouched', async () => {
		const project = classIri('Project');
		const propIri = genericPropertyIri('supports', DEFAULT_GRAPHS.schema);
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const recipe = classIri('Recipe');
		const shapeIri = nodeShapeIri(project, DEFAULT_GRAPHS.shapes);
		const { fn, updates } = mockGenericFetch({
			currentTargets: [tool, ingredient],
			currentName: 'supports'
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateObjectProperty(
			project,
			propIri,
			{ name: 'supports', targetClassIri: recipe, required: false, repeatable: true },
			{ kind: 'generic', oldTargetClassIri: ingredient }
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`sh:class <${tool}>`);
		expect(updates[0]).toContain(`sh:class <${recipe}>`);
		expect(updates[0]).not.toContain(`sh:class <${ingredient}>`);
		const insertSection = updates[0].slice(updates[0].indexOf('INSERT DATA'));
		expect(insertSection).not.toContain('sh:or');
		expect(insertSection.split(`<${shapeIri}> sh:property [`).length - 1).toBe(2);
	});

	it('updateObjectProperty on a generic relation renames the shared owl:ObjectProperty\'s own rdfs:label — a rename is global, since the property is shared', async () => {
		const project = classIri('Project');
		const propIri = genericPropertyIri('testLal', DEFAULT_GRAPHS.schema);
		const target = classIri('Ingredient');
		const { fn, updates } = mockGenericFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateObjectProperty(
			project,
			propIri,
			{ name: 'represents', targetClassIri: target, required: false, repeatable: true },
			{ kind: 'generic' }
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`WITH <${DEFAULT_GRAPHS.schema}>`);
		expect(updates[0]).toContain(`DELETE { <${propIri}> rdfs:label ?oldLabel }`);
		expect(updates[0]).toContain(`INSERT { <${propIri}> rdfs:label "represents" }`);
		expect(updates[0]).not.toContain('rdfs:domain');
		expect(updates[0]).not.toContain('rdfs:range');
	});

	it('updateObjectProperty on a multi-target generic relation also renames the shared rdfs:label, not just the retargeted sh:property block', async () => {
		const project = classIri('Project');
		const propIri = genericPropertyIri('testLal', DEFAULT_GRAPHS.schema);
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const recipe = classIri('Recipe');
		const { fn, updates } = mockGenericFetch({ currentTargets: [tool, ingredient], currentName: 'testLal' });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateObjectProperty(
			project,
			propIri,
			{ name: 'represents', targetClassIri: recipe, required: false, repeatable: true },
			{ kind: 'generic', oldTargetClassIri: ingredient }
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`DELETE { <${propIri}> rdfs:label ?oldLabel }`);
		expect(updates[0]).toContain(`INSERT { <${propIri}> rdfs:label "represents" }`);
		expect(updates[0]).toContain('sh:name "represents"');
	});

	it('listGenericObjectProperties returns label+iri+namespaceBaseIri triples for properties with no rdfs:domain', async () => {
		const usesIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('SELECT ?ns ?prefix')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns'] },
						results: { bindings: [{ ns: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI } }] }
					}),
					{ status: 200 }
				);
			}
			return new Response(
				JSON.stringify({
					head: { vars: ['p', 'label'] },
					results: {
						bindings: [
							{ p: { type: 'uri', value: usesIri }, label: { type: 'literal', value: 'uses' } }
						]
					}
				}),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.listGenericObjectProperties();

		expect(result).toEqual([{ iri: usesIri, label: 'uses', namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }]);
	});

	it('listGenericObjectProperties merges every registered namespace and sorts the combined list by label, case-insensitively', async () => {
		const coreBase = 'http://example.org/core';
		const coreGraphs = namespaceGraphs(coreBase);
		const usesIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const representsIri = genericPropertyIri('Represents', coreGraphs.schema);
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('SELECT ?ns ?prefix')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns'] },
						results: {
							bindings: [
								{ ns: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI } },
								{ ns: { type: 'uri', value: coreBase } }
							]
						}
					}),
					{ status: 200 }
				);
			}
			// One `owl:ObjectProperty` per namespace's own `/schema` graph — the default namespace's
			// "uses" sorts after `core`'s "Represents" only once case is ignored.
			const isCoreGraph = q.includes(`FROM <${coreGraphs.schema}>`);
			const bindings = isCoreGraph
				? [{ p: { type: 'uri', value: representsIri }, label: { type: 'literal', value: 'Represents' } }]
				: [{ p: { type: 'uri', value: usesIri }, label: { type: 'literal', value: 'uses' } }];
			return new Response(JSON.stringify({ head: { vars: ['p', 'label'] }, results: { bindings } }), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.listGenericObjectProperties();

		expect(result).toEqual([
			{ iri: representsIri, label: 'Represents', namespaceBaseIri: coreBase },
			{ iri: usesIri, label: 'uses', namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }
		]);
	});

	it('fetchAllDeclaredObjectProperties returns a declared owl:ObjectProperty with no rdfs:domain/range and no sh:property usage — invisible to both fetchAllObjectProperties and fetchGenericObjectPropertyEdges', async () => {
		const representsIri = genericPropertyIri('represents', DEFAULT_GRAPHS.schema);
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('SELECT ?ns ?prefix')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns'] },
						results: { bindings: [{ ns: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI } }] }
					}),
					{ status: 200 }
				);
			}
			return new Response(
				JSON.stringify({
					head: { vars: ['p', 'label'] },
					results: {
						bindings: [
							{ p: { type: 'uri', value: representsIri }, label: { type: 'literal', value: 'represents' } }
						]
					}
				}),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchAllDeclaredObjectProperties();

		expect(result).toEqual([
			{ iri: representsIri, label: 'represents', namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }
		]);
	});

	it('fetchAllDeclaredObjectProperties falls back to the IRI local name when rdfs:label is missing', async () => {
		const noLabelIri = genericPropertyIri('noLabel', DEFAULT_GRAPHS.schema);
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('SELECT ?ns ?prefix')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns'] },
						results: { bindings: [{ ns: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI } }] }
					}),
					{ status: 200 }
				);
			}
			return new Response(
				JSON.stringify({
					head: { vars: ['p'] },
					results: { bindings: [{ p: { type: 'uri', value: noLabelIri } }] }
				}),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchAllDeclaredObjectProperties();

		expect(result).toEqual([
			{ iri: noLabelIri, label: 'noLabel', namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }
		]);
	});

	it('specific-relation insertObjectProperty is unchanged when no kind option is passed', async () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const { fn, updates } = mockGenericFetch({ propertyExists: false, shapeExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(person, car, 'owns', false, true);

		const expectedIri = propertyIri(person, 'owns');
		expect(result.iri).toBe(expectedIri);
		expect(updates[0]).toContain(`rdfs:domain <${person}>`);
		expect(updates[0]).toContain(`rdfs:range <${car}>`);
	});
});

describe('SparqlConnector — cross-namespace relations (STORY-026 Decision 8)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertObjectProperty derives its target graph from the source class\'s own namespace, not the target\'s', async () => {
		const govBase = 'http://example.org/gov';
		const coreBase = 'http://example.org/core';
		const govGraphs = namespaceGraphs(govBase);
		const coreGraphs = namespaceGraphs(coreBase);

		const source = classIri('AuthoritativeSystem', govGraphs.schema);
		const target = classIri('Concept', coreGraphs.schema);

		const { fn, updates } = mockGraphFetch({
			propertyExists: false,
			shapeExists: true,
			classGraph: { [source]: govGraphs.schema, [target]: coreGraphs.schema }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertObjectProperty(source, target, 'references', false, true);

		const expectedIri = propertyIri(source, 'references', govGraphs.schema);
		expect(result.iri).toBe(expectedIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${govGraphs.schema}>`);
		expect(updates[0]).toContain(`GRAPH <${govGraphs.shapes}>`);
		expect(updates[0]).not.toContain(`<${coreGraphs.schema}>`);
		expect(updates[0]).not.toContain(`<${coreGraphs.shapes}>`);
		expect(updates[0]).toContain(`rdfs:range <${target}>`);
	});

	it('updateObjectProperty/deleteObjectProperty also derive the graph from the (still-source) class', async () => {
		const govBase = 'http://example.org/gov';
		const govGraphs = namespaceGraphs(govBase);
		const source = classIri('AuthoritativeSystem', govGraphs.schema);
		const propIri = propertyIri(source, 'references', govGraphs.schema);

		const { fn, updates } = mockGraphFetch({ classGraph: { [source]: govGraphs.schema } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(propIri, source);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`, govGraphs.schema)} }`
		);
	});
});

describe('SparqlConnector — attributed relationships (STORY-007)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertAssociationClass creates the class and an owl:ObjectProperty link per entry', async () => {
		const { fn, updates } = mockGraphFetch({ classExists: false, propertyExists: false, shapeExists: false });
		vi.stubGlobal('fetch', fn);

		const person = classIri('Person');
		const company = classIri('Company');
		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertAssociationClass('EmploymentAssignment', undefined, [
			{ propName: 'employee', targetClassIri: person, required: true, maxOne: true },
			{ propName: 'employer', targetClassIri: company, required: true, maxOne: true }
		]);

		const assocIri = classIri('EmploymentAssignment');
		expect(result.iri).toBe(assocIri);
		expect(result.links).toHaveLength(2);
		expect(result.links[0]).toMatchObject({ propName: 'employee', targetClassIri: person });
		expect(result.links[1]).toMatchObject({ propName: 'employer', targetClassIri: company });

		// insertClass (1) + marker class + subClassOf (2,3) + ensureNodeShape x2 (shape didn't exist yet) + insertObjectProperty x2
		expect(updates.some((u) => u.includes(`<${assocIri}> a owl:Class`))).toBe(true);
		expect(
			updates.some((u) => u.includes(`<${assocIri}> rdfs:subClassOf <${SCHEMA_NAMESPACE}AttributedRelationship>`))
		).toBe(true);
		const employeeIri = propertyIri(assocIri, 'employee');
		const employerIri = propertyIri(assocIri, 'employer');
		expect(updates.some((u) => u.includes(`<${employeeIri}> a owl:ObjectProperty`) && u.includes('sh:minCount 1') && u.includes('sh:maxCount 1'))).toBe(true);
		expect(updates.some((u) => u.includes(`<${employerIri}> a owl:ObjectProperty`))).toBe(true);
	});

	it('insertAssociationClass rejects fewer than two links', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertAssociationClass('SoloLink', undefined, [
				{ propName: 'only', targetClassIri: classIri('Person'), required: true, maxOne: true }
			])
		).rejects.toThrow(/at least two links/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('deleteAssociationClass delegates to deleteClass (cascades attributes/links/shape)', async () => {
		const assocIri = classIri('EmploymentAssignment');
		const employeeIri = propertyIri(assocIri, 'employee');
		const { fn, updates } = mockGraphFetch({ ownProperties: [employeeIri], externalReferences: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteAssociationClass(assocIri);

		expect(result).toEqual({ deleted: true, externalReferences: [], subClassReferences: [] });
		expect(updates.some((u) => u.includes(`<${employeeIri}>`))).toBe(true);
		expect(updates.some((u) => u.includes(`<${assocIri}> ?p ?o`))).toBe(true);
	});
});

describe('SparqlConnector — attributed-relationship marker (STORY-020)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const markerIri = `${SCHEMA_NAMESPACE}AttributedRelationship`;

	it('ensureAttributedRelationshipClass creates the marker class only if missing', async () => {
		const { fn, updates } = mockGraphFetch({ classExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureAttributedRelationshipClass();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${markerIri}> a owl:Class`);
	});

	it('ensureAttributedRelationshipClass is a no-op when the marker class already exists', async () => {
		const { fn, updates } = mockGraphFetch({ classExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureAttributedRelationshipClass();

		expect(updates).toHaveLength(0);
	});

	it('setAssociationClass(true) ensures the marker class and writes the subClassOf triple', async () => {
		const { fn, updates } = mockGraphFetch({ classExists: true, ancestors: [] });
		vi.stubGlobal('fetch', fn);

		const assocIri = classIri('EmploymentAssignment');
		const connector = new SparqlConnector('/api/sparql');
		await connector.setAssociationClass(assocIri, true);

		expect(updates).toEqual([expect.stringContaining(`<${assocIri}> rdfs:subClassOf <${markerIri}>`)]);
	});

	it('setAssociationClass(false) deletes the subClassOf triple without touching the marker class', async () => {
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const assocIri = classIri('EmploymentAssignment');
		const connector = new SparqlConnector('/api/sparql');
		await connector.setAssociationClass(assocIri, false);

		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE DATA { ${inGraph(`<${assocIri}> rdfs:subClassOf <${markerIri}> .`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});
});

describe('SparqlConnector — configurable catalog marker class setting (Sprint 5 Story 014)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const settingsIri = `${SCHEMA_NAMESPACE}AppSettings`;
	const settingPredicateIri = `${SCHEMA_NAMESPACE}authoritativeEntityClass`;

	it('fetchAuthoritativeEntityClassIri returns null when unset', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		expect(await connector.fetchAuthoritativeEntityClassIri()).toBeNull();
	});

	it('setAuthoritativeEntityClassIri writes the setting triple, then fetchAuthoritativeEntityClassIri round-trips it', async () => {
		const markerIri = classIri('GovCatalogMarker');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setAuthoritativeEntityClassIri(markerIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`DELETE { <${settingsIri}> <${settingPredicateIri}> ?old }`);
		expect(updates[0]).toContain(`INSERT { <${settingsIri}> <${settingPredicateIri}> <${markerIri}> }`);

		const { fn: fetchFn } = mockGraphFetch({ authoritativeEntityClassIri: markerIri });
		vi.stubGlobal('fetch', fetchFn);
		expect(await connector.fetchAuthoritativeEntityClassIri()).toBe(markerIri);
	});

	it('setAuthoritativeEntityClassIri overwrites a previously-configured marker class', async () => {
		const newMarkerIri = classIri('OtherCatalogMarker');
		const { fn, updates } = mockGraphFetch({ authoritativeEntityClassIri: classIri('GovCatalogMarker') });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setAuthoritativeEntityClassIri(newMarkerIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`INSERT { <${settingsIri}> <${settingPredicateIri}> <${newMarkerIri}> }`);
	});

	it('setAuthoritativeEntityClassIri(null) clears the setting', async () => {
		const { fn, updates } = mockGraphFetch({ authoritativeEntityClassIri: classIri('GovCatalogMarker') });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setAuthoritativeEntityClassIri(null);

		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${settingsIri}> <${settingPredicateIri}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});
});

describe('SparqlConnector — configurable represents-predicate setting (Backstage-sync STORY-103)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const settingsIri = `${SCHEMA_NAMESPACE}AppSettings`;
	const settingPredicateIri = `${SCHEMA_NAMESPACE}representsPredicate`;

	it('fetchRepresentsPredicateIri returns null when unset', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		expect(await connector.fetchRepresentsPredicateIri()).toBeNull();
	});

	it('setRepresentsPredicateIri writes the setting triple, then fetchRepresentsPredicateIri round-trips it', async () => {
		const predIri = genericPropertyIri('represents');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setRepresentsPredicateIri(predIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`DELETE { <${settingsIri}> <${settingPredicateIri}> ?old }`);
		expect(updates[0]).toContain(`INSERT { <${settingsIri}> <${settingPredicateIri}> <${predIri}> }`);

		const { fn: fetchFn } = mockGraphFetch({ representsPredicateIri: predIri });
		vi.stubGlobal('fetch', fetchFn);
		expect(await connector.fetchRepresentsPredicateIri()).toBe(predIri);
	});

	it('setRepresentsPredicateIri overwrites a previously-configured predicate', async () => {
		const newPredIri = genericPropertyIri('linksTo');
		const { fn, updates } = mockGraphFetch({ representsPredicateIri: genericPropertyIri('represents') });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setRepresentsPredicateIri(newPredIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`INSERT { <${settingsIri}> <${settingPredicateIri}> <${newPredIri}> }`);
	});

	it('setRepresentsPredicateIri(null) clears the setting', async () => {
		const { fn, updates } = mockGraphFetch({ representsPredicateIri: genericPropertyIri('represents') });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setRepresentsPredicateIri(null);

		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${settingsIri}> <${settingPredicateIri}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});
});

describe('SparqlConnector — backstageKind annotation (Backstage-mapping Story 003/005)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('setBackstageKind declares the predicate and writes the annotation triple', async () => {
		const { fn, updates } = mockGraphFetch({ annotationPropertyExists: false });
		vi.stubGlobal('fetch', fn);

		const entityIri = classIri('Application');
		const connector = new SparqlConnector('/api/sparql');
		await connector.setBackstageKind(entityIri, 'Component');

		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`<${BACKSTAGE_KIND_PREDICATE_IRI}> a owl:AnnotationProperty`);
		expect(updates[1]).toContain('DELETE');
		expect(updates[1]).toContain(`<${entityIri}> <${BACKSTAGE_KIND_PREDICATE_IRI}> ?old`);
		expect(updates[1]).toContain(`INSERT { <${entityIri}> <${BACKSTAGE_KIND_PREDICATE_IRI}> "Component"`);
	});

	it('setBackstageKind skips the predicate declaration when it already exists', async () => {
		const { fn, updates } = mockGraphFetch({ annotationPropertyExists: true });
		vi.stubGlobal('fetch', fn);

		const entityIri = classIri('Application');
		const connector = new SparqlConnector('/api/sparql');
		await connector.setBackstageKind(entityIri, 'Component');

		expect(updates).toHaveLength(1);
	});

	it('setBackstageKind overwrites a previously-set kind (one class -> one kind)', async () => {
		const { fn, updates } = mockGraphFetch({ annotationPropertyExists: true, backstageKind: 'Component' });
		vi.stubGlobal('fetch', fn);

		const entityIri = classIri('Application');
		const connector = new SparqlConnector('/api/sparql');
		await connector.setBackstageKind(entityIri, 'System');

		expect(updates[0]).toContain(`INSERT { <${entityIri}> <${BACKSTAGE_KIND_PREDICATE_IRI}> "System"`);
	});

	it('setBackstageKind rejects an empty kind without making any request', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.setBackstageKind(classIri('Application'), '   ')).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('setBackstageKind escapes the kind literal and validates the class IRI', async () => {
		const { fn, updates } = mockGraphFetch({ annotationPropertyExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setBackstageKind(classIri('Application'), 'Weird"Kind');
		expect(updates[0]).toContain('Weird\\"Kind');

		await expect(connector.setBackstageKind('not-a-safe-iri>', 'Component')).rejects.toThrow();
	});

	it('clearBackstageKind deletes the annotation triple', async () => {
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const entityIri = classIri('Application');
		const connector = new SparqlConnector('/api/sparql');
		await connector.clearBackstageKind(entityIri);

		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${entityIri}> <${BACKSTAGE_KIND_PREDICATE_IRI}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});

	it('fetchBackstageKind returns the current mapping, or null when unset', async () => {
		const entityIri = classIri('Application');

		const unset = mockGraphFetch();
		vi.stubGlobal('fetch', unset.fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchBackstageKind(entityIri)).resolves.toBeNull();
		vi.unstubAllGlobals();

		const set = mockGraphFetch({ backstageKind: 'Component' });
		vi.stubGlobal('fetch', set.fn);
		await expect(connector.fetchBackstageKind(entityIri)).resolves.toBe('Component');
	});

	it('insertClassAndSetBackstageKind creates the class and tags it in one call', async () => {
		const { fn, updates } = mockGraphFetch({ classExists: false, annotationPropertyExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertClassAndSetBackstageKind('Application', 'Component');

		expect(result.iri).toBe(classIri('Application'));
		expect(updates.some((u) => u.includes(`<${classIri('Application')}> a owl:Class`))).toBe(true);
		expect(
			updates.some((u) => u.includes(`<${classIri('Application')}> <${BACKSTAGE_KIND_PREDICATE_IRI}> "Component"`))
		).toBe(true);
	});
});

describe('SparqlConnector — rse:namespace annotation (Backstage-sync STORY-099/100)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('updateClassNamespace round-trips: unset -> set -> overwrite -> clear', async () => {
		const entityIri = classIri('Api');
		const namespaceA = 'http://example.org/ns-a';
		const namespaceB = 'http://example.org/ns-b';

		// unset -> set
		const setFixture = mockGraphFetch();
		vi.stubGlobal('fetch', setFixture.fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateClassNamespace(entityIri, namespaceA);
		expect(setFixture.updates).toHaveLength(1);
		expect(setFixture.updates[0]).toContain('DELETE');
		expect(setFixture.updates[0]).toContain(`<${entityIri}> <${NAMESPACE_PREDICATE_IRI}> ?old`);
		expect(setFixture.updates[0]).toContain(`INSERT { <${entityIri}> <${NAMESPACE_PREDICATE_IRI}> <${namespaceA}> }`);
		vi.unstubAllGlobals();

		// overwrite
		const overwriteFixture = mockGraphFetch({ ownNamespace: { [entityIri]: namespaceA } });
		vi.stubGlobal('fetch', overwriteFixture.fn);
		await connector.updateClassNamespace(entityIri, namespaceB);
		expect(overwriteFixture.updates[0]).toContain(
			`INSERT { <${entityIri}> <${NAMESPACE_PREDICATE_IRI}> <${namespaceB}> }`
		);
		vi.unstubAllGlobals();

		// clear
		const clearFixture = mockGraphFetch({ ownNamespace: { [entityIri]: namespaceB } });
		vi.stubGlobal('fetch', clearFixture.fn);
		await connector.updateClassNamespace(entityIri, null);
		expect(clearFixture.updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${entityIri}> <${NAMESPACE_PREDICATE_IRI}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});

	it('updateClassNamespace validates both the class IRI and the namespace base IRI', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.updateClassNamespace('not-a-safe-iri>', 'http://example.org/ns')).rejects.toThrow();
		await expect(connector.updateClassNamespace(classIri('Api'), 'not-a-safe-iri>')).rejects.toThrow();
	});

	it('resolveEffectiveClassNamespace returns the class\'s own declaration when present, without walking ancestry', async () => {
		const entityIri = classIri('Api');
		const namespaceA = 'http://example.org/ns-a';
		const { fn } = mockGraphFetch({ ownNamespace: { [entityIri]: namespaceA } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.resolveEffectiveClassNamespace(entityIri)).resolves.toEqual({
			baseIri: namespaceA,
			own: true
		});
	});

	it('resolveEffectiveClassNamespace falls back to the nearest ancestor\'s declaration', async () => {
		const coreConcept = classIri('CoreConcept');
		const shadowClass = classIri('Api');
		const inherited = 'http://example.org/inherited';
		const { fn } = mockGraphFetch({
			superClasses: { [shadowClass]: [coreConcept] },
			ownNamespace: { [coreConcept]: inherited }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.resolveEffectiveClassNamespace(shadowClass)).resolves.toEqual({
			baseIri: inherited,
			own: false
		});
	});

	it('resolveEffectiveClassNamespace returns null when no Namespace exists anywhere in the ancestry', async () => {
		const coreConcept = classIri('CoreConcept');
		const shadowClass = classIri('Api');
		const { fn } = mockGraphFetch({ superClasses: { [shadowClass]: [coreConcept] } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.resolveEffectiveClassNamespace(shadowClass)).resolves.toBeNull();
	});
});

describe('SparqlConnector — class-level attribute values (generalized "required for subclasses")', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('setClassAttributeValue replaces an existing value via DELETE-then-INSERT, typed per datatype', async () => {
		const classIriValue = classIri('Application');
		const attrIri = propertyIri(classIri('CoreConcept'), 'bAttr');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setClassAttributeValue(classIriValue, attrIri, 'string', 'https://ld.pla.com/');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`WITH <${DEFAULT_GRAPHS.schema}>`);
		expect(updates[0]).toContain(`DELETE { <${classIriValue}> <${attrIri}> ?old }`);
		expect(updates[0]).toContain(`INSERT { <${classIriValue}> <${attrIri}> "https://ld.pla.com/"^^xsd:string }`);
	});

	it('setClassAttributeValue clears the value (DELETE-only) when value is null', async () => {
		const classIriValue = classIri('Application');
		const attrIri = propertyIri(classIri('CoreConcept'), 'bAttr');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.setClassAttributeValue(classIriValue, attrIri, 'string', null);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`DELETE { <${classIriValue}> <${attrIri}> ?old }`);
		expect(updates[0]).not.toContain('INSERT {');
	});

	it('fetchClassAttributeValues returns the class\'s own values keyed by attribute IRI', async () => {
		const classIriValue = classIri('Application');
		const attrIri = propertyIri(classIri('CoreConcept'), 'bAttr');
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('SELECT ?p ?value')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['p', 'value'] },
						results: { bindings: [{ p: { type: 'uri', value: attrIri }, value: { type: 'literal', value: 'https://ld.pla.com/' } }] }
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchClassAttributeValues(classIriValue, [attrIri])).resolves.toEqual({
			[attrIri]: 'https://ld.pla.com/'
		});
	});

	it('fetchClassAttributeValues returns an empty object without making a request when given no attributes', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchClassAttributeValues(classIri('Application'), [])).resolves.toEqual({});
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('SparqlConnector — rse:sourceField annotation (Backstage-sync STORY-101/102)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('updateAttributeSourceField round-trips: unset -> set -> overwrite -> clear', async () => {
		const applicationIri = classIri('Application');
		const propIri = propertyIri(applicationIri, 'componentType');

		// unset -> set
		const setFixture = mockGraphFetch();
		vi.stubGlobal('fetch', setFixture.fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateAttributeSourceField(propIri, 'spec.type');
		expect(setFixture.updates).toHaveLength(1);
		expect(setFixture.updates[0]).toContain('DELETE');
		expect(setFixture.updates[0]).toContain(`<${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> ?old`);
		expect(setFixture.updates[0]).toContain(`INSERT { <${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> "spec.type" }`);
		vi.unstubAllGlobals();

		// overwrite
		const overwriteFixture = mockGraphFetch({ sourceField: 'spec.type' });
		vi.stubGlobal('fetch', overwriteFixture.fn);
		await connector.updateAttributeSourceField(propIri, 'metadata.labels.environment');
		expect(overwriteFixture.updates[0]).toContain(
			`INSERT { <${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> "metadata.labels.environment" }`
		);
		vi.unstubAllGlobals();

		// clear
		const clearFixture = mockGraphFetch({ sourceField: 'metadata.labels.environment' });
		vi.stubGlobal('fetch', clearFixture.fn);
		await connector.updateAttributeSourceField(propIri, null);
		expect(clearFixture.updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});

	it('updateAttributeSourceField treats an empty/whitespace-only value the same as clearing', async () => {
		const propIri = propertyIri(classIri('Application'), 'componentType');
		const { fn, updates } = mockGraphFetch({ sourceField: 'spec.type' });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateAttributeSourceField(propIri, '   ');
		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});

	it('updateAttributeSourceField escapes embedded newlines in a multi-line value', async () => {
		const propIri = propertyIri(classIri('Application'), 'componentType');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateAttributeSourceField(propIri, 'line one\nline two\r\nline three');
		expect(updates[0]).toContain(
			`INSERT { <${propIri}> <${SOURCE_FIELD_PREDICATE_IRI}> "line one\\nline two\\r\\nline three" }`
		);
		// No raw newline byte reaches the request body — only the escaped `\n`/`\r` sequences.
		expect(updates[0]).not.toMatch(/"line one\n/);
	});

	it('updateAttributeSourceField validates the property IRI', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.updateAttributeSourceField('not-a-safe-iri>', 'spec.type')).rejects.toThrow();
	});

	it('fetchAttributeSourceField returns the current mapping, or null when unset', async () => {
		const propIri = propertyIri(classIri('Application'), 'componentType');

		const unset = mockGraphFetch();
		vi.stubGlobal('fetch', unset.fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchAttributeSourceField(propIri)).resolves.toBeNull();
		vi.unstubAllGlobals();

		const set = mockGraphFetch({ sourceField: 'spec.type' });
		vi.stubGlobal('fetch', set.fn);
		await expect(connector.fetchAttributeSourceField(propIri)).resolves.toBe('spec.type');
	});
});

describe('SparqlConnector — rse:groupOnOneLine/rse:displayAsChips display markers', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('updateAttributeDisplayMarkers inserts only the markers that are true', async () => {
		const propIri = propertyIri(classIri('Component'), 'tags');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateAttributeDisplayMarkers(propIri, { groupOnOneLine: false, displayAsChips: true });

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE');
		expect(updates[0]).toContain(`<${propIri}> <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> ?oldGroup`);
		expect(updates[0]).toContain(`<${propIri}> <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> ?oldChips`);
		expect(updates[0]).toContain(`<${propIri}> <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> true .`);
		expect(updates[0]).not.toContain(`<${propIri}> <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> true .`);
	});

	it('updateAttributeDisplayMarkers with both false clears both markers, inserting nothing', async () => {
		const propIri = propertyIri(classIri('Component'), 'tags');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateAttributeDisplayMarkers(propIri, { groupOnOneLine: false, displayAsChips: false });

		expect(updates[0]).not.toContain(`<${propIri}> <${GROUP_ON_ONE_LINE_PREDICATE_IRI}> true .`);
		expect(updates[0]).not.toContain(`<${propIri}> <${DISPLAY_AS_CHIPS_PREDICATE_IRI}> true .`);
	});

	it('updateAttributeDisplayMarkers validates the property IRI', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.updateAttributeDisplayMarkers('not-a-safe-iri>', { groupOnOneLine: true, displayAsChips: false })
		).rejects.toThrow();
	});

	it('fetchAttributeDisplayMarkers returns both flags false when unset', async () => {
		const propIri = propertyIri(classIri('Component'), 'tags');
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchAttributeDisplayMarkers(propIri)).resolves.toEqual({
			groupOnOneLine: false,
			displayAsChips: false
		});
	});

	it('fetchAttributeDisplayMarkers returns the current markers when set', async () => {
		const propIri = propertyIri(classIri('Component'), 'tags');
		const { fn } = mockGraphFetch({ displayMarkers: { groupOnOneLine: true, displayAsChips: true } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchAttributeDisplayMarkers(propIri)).resolves.toEqual({
			groupOnOneLine: true,
			displayAsChips: true
		});
	});
});

describe('SparqlConnector — rse:sourceRelation annotation (Backstage-sync STORY-106/107)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('updateRelationSourceType round-trips: unset -> set -> overwrite -> clear', async () => {
		const applicationIri = classIri('Application');
		const propIri = propertyIri(applicationIri, 'ownedBy');

		// unset -> set
		const setFixture = mockGraphFetch();
		vi.stubGlobal('fetch', setFixture.fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateRelationSourceType(propIri, 'ownedBy');
		expect(setFixture.updates).toHaveLength(1);
		expect(setFixture.updates[0]).toContain('DELETE');
		expect(setFixture.updates[0]).toContain(`<${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> ?old`);
		expect(setFixture.updates[0]).toContain(`INSERT { <${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> "ownedBy" }`);
		vi.unstubAllGlobals();

		// overwrite
		const overwriteFixture = mockGraphFetch({ sourceType: 'ownedBy' });
		vi.stubGlobal('fetch', overwriteFixture.fn);
		await connector.updateRelationSourceType(propIri, 'partOf');
		expect(overwriteFixture.updates[0]).toContain(`INSERT { <${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> "partOf" }`);
		vi.unstubAllGlobals();

		// clear
		const clearFixture = mockGraphFetch({ sourceType: 'partOf' });
		vi.stubGlobal('fetch', clearFixture.fn);
		await connector.updateRelationSourceType(propIri, null);
		expect(clearFixture.updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});

	it('updateRelationSourceType treats an empty/whitespace-only value the same as clearing', async () => {
		const propIri = propertyIri(classIri('Application'), 'ownedBy');
		const { fn, updates } = mockGraphFetch({ sourceType: 'ownedBy' });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateRelationSourceType(propIri, '   ');
		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> ?old`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});

	it('updateRelationSourceType escapes an embedded newline', async () => {
		const propIri = propertyIri(classIri('Application'), 'ownedBy');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.updateRelationSourceType(propIri, 'owned\nBy');
		expect(updates[0]).toContain(`INSERT { <${propIri}> <${SOURCE_RELATION_PREDICATE_IRI}> "owned\\nBy" }`);
		// No raw newline byte reaches the request body — only the escaped `\n` sequence.
		expect(updates[0]).not.toMatch(/"owned\n/);
	});

	it('updateRelationSourceType validates the property IRI', async () => {
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.updateRelationSourceType('not-a-safe-iri>', 'ownedBy')).rejects.toThrow();
	});

	it('fetchRelationSourceType returns the current mapping, or null when unset', async () => {
		const propIri = propertyIri(classIri('Application'), 'ownedBy');

		const unset = mockGraphFetch();
		vi.stubGlobal('fetch', unset.fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchRelationSourceType(propIri)).resolves.toBeNull();
		vi.unstubAllGlobals();

		const set = mockGraphFetch({ sourceType: 'ownedBy' });
		vi.stubGlobal('fetch', set.fn);
		await expect(connector.fetchRelationSourceType(propIri)).resolves.toBe('ownedBy');
	});
});

describe('SparqlConnector — reverse relations (STORY-XXX)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('linkGeneratedReverse writes owl:inverseOf on both sides and rse:generatedReverseOf only on the reverse', async () => {
		const componentIri = classIri('Component');
		const groupIri = classIri('Group');
		const forwardPropIri = propertyIri(componentIri, 'ownedBy');
		const reversePropIri = propertyIri(groupIri, 'owns');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.linkGeneratedReverse(forwardPropIri, componentIri, reversePropIri, groupIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
		expect(updates[0]).toContain(`<${forwardPropIri}> owl:inverseOf <${reversePropIri}> .`);
		expect(updates[0]).toContain(`<${reversePropIri}> owl:inverseOf <${forwardPropIri}>`);
		expect(updates[0]).toContain(`<${reversePropIri}> owl:inverseOf <${forwardPropIri}> ;`);
		expect(updates[0]).toContain(`<${GENERATED_REVERSE_OF_PREDICATE_IRI}> <${forwardPropIri}>`);
		// The generatedReverseOf triple must not land on the forward side.
		const forwardBlock = updates[0].slice(0, updates[0].indexOf(reversePropIri));
		expect(forwardBlock).not.toContain(GENERATED_REVERSE_OF_PREDICATE_IRI);
	});

	it('unlinkGeneratedReverse clears owl:inverseOf on both sides and rse:generatedReverseOf', async () => {
		const componentIri = classIri('Component');
		const groupIri = classIri('Group');
		const forwardPropIri = propertyIri(componentIri, 'ownedBy');
		const reversePropIri = propertyIri(groupIri, 'owns');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.unlinkGeneratedReverse(forwardPropIri, componentIri, reversePropIri, groupIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${forwardPropIri}> owl:inverseOf <${reversePropIri}>`, DEFAULT_GRAPHS.schema)} }`
		);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${reversePropIri}> owl:inverseOf <${forwardPropIri}>`, DEFAULT_GRAPHS.schema)} }`
		);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${reversePropIri}> <${GENERATED_REVERSE_OF_PREDICATE_IRI}> <${forwardPropIri}>`, DEFAULT_GRAPHS.schema)} }`
		);
	});

	it('fetchInverseRelation returns null when no reverse is defined', async () => {
		const propIri = propertyIri(classIri('Component'), 'ownedBy');
		const { fn } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchInverseRelation(propIri)).resolves.toBeNull();
	});

	it('fetchInverseRelation returns the partner iri/name/mapping when a reverse is defined', async () => {
		const propIri = propertyIri(classIri('Component'), 'ownedBy');
		const reverseIri = propertyIri(classIri('Group'), 'owns');
		const { fn } = mockGraphFetch({
			inverseRelation: { iri: reverseIri, label: 'owns', sourceType: 'ownerOf' }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchInverseRelation(propIri)).resolves.toEqual({
			iri: reverseIri,
			name: 'owns',
			sourceRelation: 'ownerOf'
		});
	});

	it('fetchInverseRelation defaults name/sourceRelation when the reverse has neither label nor mapping', async () => {
		const propIri = propertyIri(classIri('Component'), 'ownedBy');
		const reverseIri = propertyIri(classIri('Group'), 'owns');
		const { fn } = mockGraphFetch({ inverseRelation: { iri: reverseIri } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchInverseRelation(propIri)).resolves.toEqual({
			iri: reverseIri,
			name: '',
			sourceRelation: null
		});
	});
});

describe('SparqlConnector — fetchMasterSystemsOfClass (data-catalog Story 004/008/020)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const NS_ADOIT = 'https://example.com/adoit';

	it('returns individuals mastering a class across namespaces via any property labeled "isMasterFor"', async () => {
		const applicationIri = classIri('Application');
		const systemOfWorkIri = `${NS_ADOIT}#AdoitSystemOfWork`;
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('rdfs:label "isMasterFor"') && q.includes(`<${applicationIri}>`)) {
				return new Response(
					JSON.stringify({
						head: { vars: ['s', 'label', 'g'] },
						results: {
							bindings: [
								{
									s: { type: 'uri', value: systemOfWorkIri },
									label: { type: 'literal', value: 'ADOIT' },
									g: { type: 'uri', value: NS_ADOIT }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchMasterSystemsOfClass(applicationIri);

		expect(result).toEqual([{ iri: systemOfWorkIri, label: 'ADOIT', namespaceBaseIri: NS_ADOIT }]);
	});

	it('does not hardcode any particular predicate IRI — the query matches purely by label', async () => {
		const applicationIri = classIri('Application');
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			expect(q).not.toContain('isMasterFor>');
			expect(q).toContain('rdfs:label "isMasterFor"');
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchMasterSystemsOfClass(applicationIri);
	});

	it('rejects a malicious/malformed IRI before any query is issued', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchMasterSystemsOfClass('not-a-safe-iri<>')).rejects.toThrow(/Invalid/);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('SparqlConnector — generalized individual→class relations (data-catalog Story 017/021)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const NS_ADOIT = 'https://example.com/adoit';
	const NS_CORE = 'https://example.com/core';

	/** `GRAPH ?g { <iri> a ?type }` (`findNamespaceOfIndividual`) needs its own mock shape, distinct
	 *  from `mockGraphFetch`'s `GRAPH ?g { <iri> a owl:Class }` pattern. `existingPredicateByLabel`
	 *  feeds `resolveOrMintPredicate`'s `findObjectPropertyByLabel` lookup — a match reuses that IRI
	 *  outright, skipping the mint-and-declare path entirely. */
	function mockIndividualNamespaceFetch(
		individualGraph: Record<string, string> = {},
		existingPredicateByLabel: Record<string, string> = {}
	) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('SELECT ?p WHERE') && q.includes('a owl:ObjectProperty')) {
				const match = q.match(/rdfs:label "([^"]+)"/);
				const label = match?.[1];
				const existingIri = label && existingPredicateByLabel[label];
				return new Response(
					JSON.stringify({
						head: { vars: ['p'] },
						results: { bindings: existingIri ? [{ p: { type: 'uri', value: existingIri } }] : [] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('ASK') && q.includes('owl:DatatypeProperty')) {
				return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
			}
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				const match = q.match(/GRAPH \?g \{ <([^>]+)> a \?type \}/);
				const individualIriValue = match?.[1];
				const graph = (individualIriValue && individualGraph[individualIriValue]) ?? DEFAULT_NAMESPACE_BASE_IRI;
				return new Response(
					JSON.stringify({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: graph } }] } }),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it("insertIndividualClassRelation mints a namespace-scoped predicate IRI, declares it, and writes into the individual's own namespace", async () => {
		const architectureIri = `${NS_ADOIT}#ApplicationArchitecture`;
		const applicationIri = classIri('Application', NS_CORE);
		const { fn, updates } = mockIndividualNamespaceFetch({ [architectureIri]: NS_ADOIT });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const { iri } = await connector.insertIndividualClassRelation(architectureIri, applicationIri, 'isAuthorityFor');

		expect(iri).toBe(genericPropertyIri('isAuthorityFor', NS_ADOIT));
		expect(updates).toHaveLength(2);
		expect(updates.some((u) => u.includes(`<${iri}> a owl:ObjectProperty ; rdfs:label "isAuthorityFor"`))).toBe(true);
		expect(
			updates.some((u) =>
				u.includes(inGraph(`<${architectureIri}> <${iri}> <${applicationIri}> .`, namespaceGraphs(NS_ADOIT).instances))
			)
		).toBe(true);
	});

	it('insertIndividualClassRelation reuses an existing declared property (generic or domain/range-specific) whose label matches, instead of minting a shadow predicate', async () => {
		const systemOfWorkIri = `${NS_ADOIT}#AdoitSystemOfWork`;
		const applicationIri = classIri('Application', NS_CORE);
		const existingIri = `${NS_ADOIT}#systemOfWorkIsMasterFor`;
		const { fn, updates } = mockIndividualNamespaceFetch(
			{ [systemOfWorkIri]: NS_ADOIT },
			{ isMasterFor: existingIri }
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const { iri } = await connector.insertIndividualClassRelation(systemOfWorkIri, applicationIri, 'isMasterFor');

		expect(iri).toBe(existingIri);
		// Only the ABox triple is written — no property declaration, since one already exists.
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			inGraph(`<${systemOfWorkIri}> <${existingIri}> <${applicationIri}> .`, namespaceGraphs(NS_ADOIT).instances)
		);
	});

	it('insertIndividualClassRelation rejects an empty relation name without issuing a query', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertIndividualClassRelation(`${NS_ADOIT}#Arch`, classIri('Application'), '   ')
		).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('deleteIndividualClassRelation removes exactly that triple', async () => {
		const architectureIri = `${NS_ADOIT}#ApplicationArchitecture`;
		const applicationIri = classIri('Application', NS_CORE);
		const predicateIri = genericPropertyIri('isAuthorityFor', NS_ADOIT);
		const { fn, updates } = mockIndividualNamespaceFetch({ [architectureIri]: NS_ADOIT });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteIndividualClassRelation(architectureIri, predicateIri, applicationIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`WITH <${namespaceGraphs(NS_ADOIT).instances}>`);
		expect(updates[0]).toContain(`DELETE { <${architectureIri}> <${predicateIri}> <${applicationIri}> .`);
	});

	it('updateIndividualRelation renames the predicate and retargets the ground triple in one WITH-scoped update, with no reification to preserve', async () => {
		const architectureIri = `${NS_ADOIT}#ApplicationArchitecture`;
		const applicationIri = classIri('Application', NS_CORE);
		const newTargetIri = classIri('Deployment', NS_CORE);
		const oldPredicateIri = genericPropertyIri('isAuthorityFor', NS_ADOIT);
		const { fn, updates } = mockIndividualNamespaceFetch({ [architectureIri]: NS_ADOIT });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const { predicateIri } = await connector.updateIndividualRelation(
			architectureIri,
			oldPredicateIri,
			applicationIri,
			'isCoOwnerOf',
			newTargetIri
		);

		expect(predicateIri).toBe(genericPropertyIri('isCoOwnerOf', NS_ADOIT));
		// One update mints+declares the new predicate, the second is the WITH-scoped rename/retarget.
		expect(updates).toHaveLength(2);
		const renameUpdate = updates[1];
		expect(renameUpdate).toContain(`WITH <${namespaceGraphs(NS_ADOIT).instances}>`);
		expect(renameUpdate).toContain(`<${architectureIri}> <${oldPredicateIri}> <${applicationIri}> .`);
		expect(renameUpdate).toContain(`<${architectureIri}> <${predicateIri}> <${newTargetIri}> .`);
	});

	it('updateIndividualRelation is a no-op (no query issued beyond predicate resolution) when neither the name nor the target actually changed', async () => {
		const architectureIri = `${NS_ADOIT}#ApplicationArchitecture`;
		const applicationIri = classIri('Application', NS_CORE);
		const predicateIri = genericPropertyIri('isAuthorityFor', NS_ADOIT);
		const { fn, updates } = mockIndividualNamespaceFetch(
			{ [architectureIri]: NS_ADOIT },
			{ isAuthorityFor: predicateIri }
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.updateIndividualRelation(
			architectureIri,
			predicateIri,
			applicationIri,
			'isAuthorityFor',
			applicationIri
		);

		expect(result).toEqual({ predicateIri });
		expect(updates).toHaveLength(0);
	});

	it('updateIndividualRelation rejects an empty relation name without issuing a query', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.updateIndividualRelation(
				`${NS_ADOIT}#Arch`,
				genericPropertyIri('isAuthorityFor', NS_ADOIT),
				classIri('Application'),
				'   ',
				classIri('Application')
			)
		).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('fetchAllIndividualClassRelations returns every predicate except rdf:type/rdfs:label, resolving cross-namespace class targets and preferring a real rdfs:label', async () => {
		const architectureIri = `${NS_ADOIT}#ApplicationArchitecture`;
		const applicationIri = classIri('Application', NS_CORE);
		const predicateIri = genericPropertyIri('isAuthorityFor', NS_ADOIT);
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('?s ?p ?plabel ?class') && q.includes('GRAPH ?classGraph')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['s', 'p', 'plabel', 'class'] },
						results: {
							bindings: [
								{
									s: { type: 'uri', value: architectureIri },
									p: { type: 'uri', value: predicateIri },
									plabel: { type: 'literal', value: 'isAuthorityFor' },
									class: { type: 'uri', value: applicationIri }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchAllIndividualClassRelations(NS_ADOIT);

		expect(result).toEqual([
			{
				individualIri: architectureIri,
				predicateIri,
				name: 'isAuthorityFor',
				classIri: applicationIri,
				namespaceBaseIri: NS_ADOIT
			}
		]);
	});

	it('fetchAllIndividualIndividualRelations returns every predicate except rdf:type/rdfs:label, resolving cross-namespace individual targets and preferring a real rdfs:label (relation-assertions Sprint 3 Story 007)', async () => {
		const aliceIri = `${NS_ADOIT}#alice`;
		const bobIri = `${NS_CORE}#bob`;
		const predicateIri = genericPropertyIri('isOperatedBy', NS_ADOIT);
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('?s ?p ?plabel ?o') && q.includes('GRAPH ?og')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['s', 'p', 'plabel', 'o'] },
						results: {
							bindings: [
								{
									s: { type: 'uri', value: aliceIri },
									p: { type: 'uri', value: predicateIri },
									plabel: { type: 'literal', value: 'isOperatedBy' },
									o: { type: 'uri', value: bobIri }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchAllIndividualIndividualRelations(NS_ADOIT);

		expect(result).toEqual([
			{
				individualIri: aliceIri,
				predicateIri,
				name: 'isOperatedBy',
				targetIndividualIri: bobIri,
				namespaceBaseIri: NS_ADOIT
			}
		]);
	});
});

describe('SparqlConnector — generic instance assertion editor (data-catalog Story 019/021)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const NS_ADOIT = 'https://example.com/adoit';
	const NS_CORE = 'https://example.com/core';

	/** Mirrors Story 017's own `mockIndividualNamespaceFetch` for `findNamespaceOfIndividual`'s
	 *  `GRAPH ?g { <iri> a ?type }` lookup, plus `resolveOrMintPredicate`'s label-lookup/declare
	 *  steps. */
	function mockIndividualNamespaceFetch(
		individualGraph: Record<string, string> = {},
		existingPredicateByLabel: Record<string, string> = {}
	) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('SELECT ?p WHERE') && q.includes('a owl:ObjectProperty')) {
				const match = q.match(/rdfs:label "([^"]+)"/);
				const label = match?.[1];
				const existingIri = label && existingPredicateByLabel[label];
				return new Response(
					JSON.stringify({
						head: { vars: ['p'] },
						results: { bindings: existingIri ? [{ p: { type: 'uri', value: existingIri } }] : [] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('ASK') && q.includes('owl:DatatypeProperty')) {
				return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
			}
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				const match = q.match(/GRAPH \?g \{ <([^>]+)> a \?type \}/);
				const individualIriValue = match?.[1];
				const graph = (individualIriValue && individualGraph[individualIriValue]) ?? DEFAULT_NAMESPACE_BASE_IRI;
				return new Response(
					JSON.stringify({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: graph } }] } }),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('insertAssertion reuses an existing declared property whose label matches "isMasterFor", targeting a non-class (attribute) object', async () => {
		const systemIri = `${NS_ADOIT}#System_B`;
		const attributeIri = `${NS_CORE}#SchutzobjektID`;
		const existingIri = `${NS_ADOIT}#isMasterFor`;
		const { fn, updates } = mockIndividualNamespaceFetch({ [systemIri]: NS_ADOIT }, { isMasterFor: existingIri });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const { predicateIri } = await connector.insertAssertion(systemIri, 'isMasterFor', attributeIri);

		expect(predicateIri).toBe(existingIri);
		expect(updates).toEqual([
			expect.stringContaining(
				inGraph(`<${systemIri}> <${existingIri}> <${attributeIri}> .`, namespaceGraphs(NS_ADOIT).instances)
			)
		]);
	});

	it('insertAssertion mints and declares a fresh namespace-scoped predicate for an unlisted label, targeting an individual object', async () => {
		const systemIri = `${NS_ADOIT}#System_B`;
		const authorityIri = `${NS_ADOIT}#RiskManagement`;
		const { fn, updates } = mockIndividualNamespaceFetch({ [systemIri]: NS_ADOIT });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const { predicateIri } = await connector.insertAssertion(systemIri, 'isOperatedBy', authorityIri);

		expect(predicateIri).toBe(genericPropertyIri('isOperatedBy', NS_ADOIT));
		expect(updates.some((u) => u.includes(`<${predicateIri}> a owl:ObjectProperty ; rdfs:label "isOperatedBy"`))).toBe(
			true
		);
		expect(
			updates.some((u) =>
				u.includes(inGraph(`<${systemIri}> <${predicateIri}> <${authorityIri}> .`, namespaceGraphs(NS_ADOIT).instances))
			)
		).toBe(true);
	});

	it('insertAssertion rejects an empty predicate label without issuing a query', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertAssertion(`${NS_ADOIT}#System_B`, '   ', `${NS_CORE}#SchutzobjektID`)
		).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('deleteAssertion removes exactly the given triple', async () => {
		const systemIri = `${NS_ADOIT}#System_B`;
		const attributeIri = `${NS_CORE}#SchutzobjektID`;
		const predicateIri = `${NS_ADOIT}#isMasterFor`;
		const { fn, updates } = mockIndividualNamespaceFetch({ [systemIri]: NS_ADOIT });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteAssertion(systemIri, predicateIri, attributeIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`WITH <${namespaceGraphs(NS_ADOIT).instances}>`);
		expect(updates[0]).toContain(`DELETE { <${systemIri}> <${predicateIri}> <${attributeIri}> .`);
	});

	it('fetchAssertionsForIndividual returns labeled predicate/object pairs, excluding rdf:type/rdfs:label', async () => {
		const systemIri = `${NS_ADOIT}#System_B`;
		const attributeIri = `${NS_CORE}#SchutzobjektID`;
		const predicateIri = `${NS_ADOIT}#isMasterFor`;
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				return new Response(
					JSON.stringify({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: NS_ADOIT } }] } }),
					{ status: 200 }
				);
			}
			if (q.includes('?p ?plabel ?o ?olabel')) {
				expect(q).toContain(
					'?p != rdf:type && ?p != rdfs:label && ?p != rdf:subject && ?p != rdf:predicate && ?p != rdf:object'
				);
				return new Response(
					JSON.stringify({
						head: { vars: ['p', 'plabel', 'o', 'olabel'] },
						results: {
							bindings: [
								{
									p: { type: 'uri', value: predicateIri },
									plabel: { type: 'literal', value: 'isMasterFor' },
									o: { type: 'uri', value: attributeIri },
									olabel: { type: 'literal', value: 'SchutzobjektID' }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchAssertionsForIndividual(systemIri);

		expect(result).toEqual([
			{
				individualIri: systemIri,
				predicateIri,
				predicateLabel: 'isMasterFor',
				objectIri: attributeIri,
				objectLabel: 'SchutzobjektID'
			}
		]);
	});

	it('fetchNameableEntities tags every schema entity with its kind, composing fetchFullSchemaForAllNamespaces', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchAllReifiedStatements').mockResolvedValue([]);
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			classes: [{ iri: 'urn:C', label: 'C', comment: null, namespaceBaseIri: NS_CORE }],
			datatypeProperties: [
				{
					iri: 'urn:A',
					label: 'A',
					domain: 'urn:C',
					range: 'http://www.w3.org/2001/XMLSchema#string',
					namespaceBaseIri: NS_CORE,
					required: false,
					repeatable: false
				}
			],
			objectProperties: [
				{
					iri: 'urn:R',
					label: 'R',
					domain: 'urn:C',
					range: 'urn:C',
					namespaceBaseIri: NS_CORE,
					required: false,
					repeatable: false,
					relationKind: 'specific'
				}
			],
			subClassOf: [],
			individuals: [
				{
					iri: 'urn:I',
					label: 'I',
					classIri: 'urn:C',
					namespaceBaseIri: NS_CORE,
					syncSource: null,
					syncStatus: null
				}
			],
			individualClassRelations: [],
			individualIndividualRelations: []
		});

		const result = await connector.fetchNameableEntities();

		expect(result).toEqual([
			{ iri: 'urn:C', label: 'C', kind: 'class' },
			{ iri: 'urn:A', label: 'C.A', kind: 'attribute' },
			{ iri: 'urn:R', label: 'R', kind: 'relation' },
			{ iri: 'urn:I', label: 'I', kind: 'individual' }
		]);
	});

	it('fetchNameableEntities appends reified statements as the "relationInstance" kind', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			classes: [],
			datatypeProperties: [],
			objectProperties: [],
			subClassOf: [],
			individuals: [],
			individualClassRelations: [],
			individualIndividualRelations: []
		});
		vi.spyOn(connector, 'fetchAllReifiedStatements').mockResolvedValue([
			{ iri: 'urn:Stmt1', label: 'Application supports Bal', kind: 'relationInstance' }
		]);

		const result = await connector.fetchNameableEntities();

		expect(result).toEqual([{ iri: 'urn:Stmt1', label: 'Application supports Bal', kind: 'relationInstance' }]);
	});

	it('fetchRelationPredicateOptions lists every declared relation (generic and specific) plus every named individual→class relation, deduplicated', async () => {
		const connector = new SparqlConnector('/api/sparql');
		const genericIri = genericPropertyIri('isOperatedBy', NS_ADOIT);
		const specificIri = `${NS_ADOIT}#systemOfWorkIsMasterFor`;
		const authorityRelIri = genericPropertyIri('isAuthorityFor', NS_ADOIT);
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			classes: [],
			datatypeProperties: [],
			objectProperties: [
				{
					iri: genericIri,
					label: 'isOperatedBy',
					domain: '',
					range: '',
					namespaceBaseIri: NS_ADOIT,
					required: false,
					repeatable: false,
					relationKind: 'generic'
				},
				{
					iri: specificIri,
					label: 'isMasterFor',
					domain: `${NS_ADOIT}#SystemOfWork`,
					range: `${NS_CORE}#AuthoritativeEntity`,
					namespaceBaseIri: NS_ADOIT,
					required: false,
					repeatable: false,
					relationKind: 'specific'
				}
			],
			subClassOf: [],
			individuals: [],
			individualClassRelations: [
				{
					individualIri: `${NS_ADOIT}#Arch`,
					predicateIri: authorityRelIri,
					name: 'isAuthorityFor',
					classIri: 'urn:C',
					namespaceBaseIri: NS_ADOIT
				}
			],
			individualIndividualRelations: []
		});

		const result = await connector.fetchRelationPredicateOptions();

		expect(result).toEqual(
			expect.arrayContaining([
				{ iri: specificIri, label: 'isMasterFor' },
				{ iri: genericIri, label: 'isOperatedBy' },
				{ iri: authorityRelIri, label: 'isAuthorityFor' }
			])
		);
		expect(result).toHaveLength(3);
	});
});

describe('SparqlConnector — relation-level assertions / reification (relation-assertions Sprint 4 Story 008/009)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const NS_ADOIT = 'https://example.com/adoit';

	/** Mocks `findNamespaceOfIndividual`'s `GRAPH ?g { <iri> a ?type }` lookup (the reified triple's
	 *  subject always resolves to `subjectGraph`) plus `fetchStatementIriForTriple`'s own
	 *  `?stmt rdf:subject ...` lookup, returning `existingStmt` (or no bindings if omitted). */
	function mockReificationFetch(subjectGraph: string, existingStmt?: string) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				return new Response(
					JSON.stringify({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: subjectGraph } }] } }),
					{ status: 200 }
				);
			}
			if (q.includes('?stmt rdf:subject')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['stmt'] },
						results: { bindings: existingStmt ? [{ stmt: { type: 'uri', value: existingStmt } }] : [] }
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('fetchStatementIriForTriple returns the existing statement IRI when the triple is already reified', async () => {
		const stmtIri = `${NS_ADOIT}#Statement123`;
		const { fn } = mockReificationFetch(NS_ADOIT, stmtIri);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchStatementIriForTriple(
			`${NS_ADOIT}#Application`,
			`${NS_ADOIT}#supports`,
			`${NS_ADOIT}#Bal`,
			NS_ADOIT
		);

		expect(result).toBe(stmtIri);
	});

	it('fetchStatementIriForTriple returns undefined when the triple is not reified, scoping the query to graphs.instances', async () => {
		const { fn } = mockReificationFetch(NS_ADOIT);
		vi.stubGlobal('fetch', fn);
		const subjectIri = `${NS_ADOIT}#Application`;
		const predicateIri = `${NS_ADOIT}#supports`;
		const objectIri = `${NS_ADOIT}#Bal`;

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchStatementIriForTriple(subjectIri, predicateIri, objectIri, NS_ADOIT);

		expect(result).toBeUndefined();
		const queryCall = fn.mock.calls.find(([, opts]: [string, { body: string }]) =>
			JSON.parse(opts.body).query?.includes('?stmt rdf:subject')
		);
		const query: string = JSON.parse(queryCall![1].body).query;
		expect(query).toContain(namespaceGraphs(NS_ADOIT).instances);
		expect(query).toContain(`rdf:subject <${subjectIri}>`);
		expect(query).toContain(`rdf:predicate <${predicateIri}>`);
		expect(query).toContain(`rdf:object <${objectIri}>`);
	});

	it('ensureReifiedStatement mints and inserts the four reification quads on first call', async () => {
		const subjectIri = `${NS_ADOIT}#Application`;
		const predicateIri = `${NS_ADOIT}#supports`;
		const objectIri = `${NS_ADOIT}#Bal`;
		const { fn, updates } = mockReificationFetch(NS_ADOIT);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const stmt = await connector.ensureReifiedStatement(subjectIri, predicateIri, objectIri);

		expect(stmt).toContain(`${NS_ADOIT}#Statement`);
		expect(updates).toEqual([
			expect.stringContaining(
				inGraph(
					`<${stmt}> a rdf:Statement ; rdf:subject <${subjectIri}> ; rdf:predicate <${predicateIri}> ; rdf:object <${objectIri}> .`,
					namespaceGraphs(NS_ADOIT).instances
				)
			)
		]);
	});

	it('ensureReifiedStatement reuses the existing statement IRI on a second call, without re-inserting', async () => {
		const subjectIri = `${NS_ADOIT}#Application`;
		const predicateIri = `${NS_ADOIT}#supports`;
		const objectIri = `${NS_ADOIT}#Bal`;
		const existingStmt = `${NS_ADOIT}#Statement999`;
		const { fn, updates } = mockReificationFetch(NS_ADOIT, existingStmt);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const stmt = await connector.ensureReifiedStatement(subjectIri, predicateIri, objectIri);

		expect(stmt).toBe(existingStmt);
		expect(updates).toEqual([]);
	});

	it('fetchAssertionsForIndividual excludes rdf:subject/rdf:predicate/rdf:object when scoped to a reified statement (Story 010)', async () => {
		const stmtIri = `${NS_ADOIT}#Statement123`;
		const { fn } = mockReificationFetch(NS_ADOIT);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchAssertionsForIndividual(stmtIri);

		const queryCall = fn.mock.calls.find(([, opts]: [string, { body: string }]) =>
			JSON.parse(opts.body).query?.includes('?p ?plabel ?o ?olabel')
		);
		const query: string = JSON.parse(queryCall![1].body).query;
		expect(query).toContain(
			'?p != rdf:type && ?p != rdfs:label && ?p != rdf:subject && ?p != rdf:predicate && ?p != rdf:object'
		);
	});
});

describe('SparqlConnector — split-dataset catalog generation for attribute overrides (data-catalog Story 020)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	const applicationIri = classIri('Application');
	const attributeIri = propertyIri(applicationIri, 'SchutzobjektID');
	const dataset = datasetIri(DEFAULT_NAMESPACE_BASE_IRI, 'Application');
	const systemBIri = 'https://example.com/adoit#System_B';
	const splitDataset = splitDatasetIri(DEFAULT_NAMESPACE_BASE_IRI, 'Application', 'System_B');

	function mockSplitCatalogFetch(
		fixture: {
			datasetExists?: boolean;
			splitDatasetExists?: boolean;
			label?: string;
			existingSplitIris?: string[];
			attributeOverride?: { systemIri: string; systemLabel: string } | null;
			operatingAuthority?: string | null;
		} = {}
	) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('ASK') && q.includes(`a <${DCAT.Catalog}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: true }), { status: 200 });
			}
			if (q.includes('ASK') && q.includes(`<${splitDataset}> a <${DCAT.Dataset}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.splitDatasetExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('ASK') && q.includes(`<${dataset}> a <${DCAT.Dataset}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.datasetExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('SELECT ?label ?comment')) {
				const binding: SparqlBinding = fixture.label ? { label: { type: 'literal', value: fixture.label } } : {};
				return new Response(
					JSON.stringify({ head: { vars: ['label', 'comment'] }, results: { bindings: fixture.label ? [binding] : [] } }),
					{ status: 200 }
				);
			}
			if (q.includes('rdfs:label "isMasterFor"') && q.includes(`<${applicationIri}>`)) {
				return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
			}
			if (q.includes('rdfs:label "isMasterFor"') && q.includes(`<${attributeIri}>`)) {
				const bindings = fixture.attributeOverride
					? [
							{
								s: { type: 'uri', value: fixture.attributeOverride.systemIri },
								label: { type: 'literal', value: fixture.attributeOverride.systemLabel },
								g: { type: 'uri', value: 'https://example.com/adoit' }
							}
						]
					: [];
				return new Response(JSON.stringify({ head: { vars: ['s', 'label', 'g'] }, results: { bindings } }), {
					status: 200
				});
			}
			if (q.includes('owl:DatatypeProperty')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['p', 'label', 'domain', 'range'] },
						results: {
							bindings: [
								{
									p: { type: 'uri', value: attributeIri },
									domain: { type: 'uri', value: applicationIri },
									range: { type: 'uri', value: 'http://www.w3.org/2001/XMLSchema#string' }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (q.includes('?split') && q.includes('isPartOf')) {
				const bindings = (fixture.existingSplitIris ?? []).map((iri) => ({ split: { type: 'uri', value: iri } }));
				return new Response(JSON.stringify({ head: { vars: ['split'] }, results: { bindings } }), { status: 200 });
			}
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: 'https://example.com/adoit' } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('SELECT ?authority WHERE')) {
				const bindings = fixture.operatingAuthority
					? [{ authority: { type: 'uri', value: fixture.operatingAuthority } }]
					: [];
				return new Response(JSON.stringify({ head: { vars: ['authority'] }, results: { bindings } }), {
					status: 200
				});
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('an entity with no attribute overrides generates exactly the same single dcat:Dataset output as before this story (no regression)', async () => {
		const { fn, updates } = mockSplitCatalogFetch({ label: 'Application' });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		expect(updates.some((u) => u.includes(splitDataset))).toBe(false);
	});

	it('an attribute-level override produces its own split dcat:Dataset, linked to the entity default dataset via dct:isPartOf', async () => {
		const { fn, updates } = mockSplitCatalogFetch({
			label: 'Application',
			attributeOverride: { systemIri: systemBIri, systemLabel: 'System B' }
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		const splitInsert = updates.find((u) => u.includes(`<${splitDataset}> a <${DCAT.Dataset}>`));
		expect(splitInsert).toBeDefined();
		expect(splitInsert).toContain(`<${splitDataset}> <${DCT.isPartOf}> <${dataset}>`);
		expect(splitInsert).toContain(`<${splitDataset}> <${PROV.wasAttributedTo}> <${systemBIri}>`);
		expect(splitInsert).toContain(`<${splitDataset}> <${PROV.wasDerivedFrom}> <${systemBIri}>`);

		const placeholderInsert = updates.find((u) => u.includes(`<${splitDataset}> <${DCAT.distribution}>`));
		expect(placeholderInsert).toBeDefined();
		expect(placeholderInsert).toContain(`<${splitDataset}> <${DCT.publisher}> ""`);
		expect(placeholderInsert).toContain(`<${splitDataset}> <${DCT.license}> ""`);
	});

	it("a split dataset's provenance also includes the overriding system's authority via isOperatedBy", async () => {
		const authorityIri = 'https://example.com/adoit#RiskManagement';
		const { fn, updates } = mockSplitCatalogFetch({
			label: 'Application',
			attributeOverride: { systemIri: systemBIri, systemLabel: 'System B' },
			operatingAuthority: authorityIri
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		const splitInsert = updates.find((u) => u.includes(`<${splitDataset}> a <${DCAT.Dataset}>`))!;
		expect(splitInsert).toContain(`<${splitDataset}> <${PROV.wasAttributedTo}> <${authorityIri}>`);
	});

	it('regeneration with an existing split dataset deletes/reinserts only generator-owned predicates, preserving publisher/license/distribution', async () => {
		const { fn, updates } = mockSplitCatalogFetch({
			label: 'Application',
			datasetExists: true,
			splitDatasetExists: true,
			existingSplitIris: [splitDataset],
			attributeOverride: { systemIri: systemBIri, systemLabel: 'System B' }
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		const splitDeleteOps = updates.filter((u) => u.includes('DELETE WHERE') && u.includes(`<${splitDataset}>`));
		expect(splitDeleteOps.some((u) => u.includes(`<${splitDataset}> <${DCT.title}>`))).toBe(true);
		expect(splitDeleteOps.some((u) => u.includes(`<${splitDataset}> <${DCT.publisher}>`))).toBe(false);
		expect(updates.some((u) => u.includes(`<${splitDataset}> <${DCAT.distribution}>`))).toBe(false);
	});

	it('removing an attribute override folds it back: an existing split dataset with no remaining override is deleted', async () => {
		const { fn, updates } = mockSplitCatalogFetch({
			label: 'Application',
			datasetExists: true,
			existingSplitIris: [splitDataset],
			attributeOverride: null
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		expect(updates.some((u) => u.includes('DELETE WHERE') && u.includes(`<${splitDataset}> ?p ?o`))).toBe(true);
		expect(updates.some((u) => u.includes(`<${splitDataset}> a <${DCAT.Dataset}>`))).toBe(false);
	});
});

describe('SparqlConnector — catalog generation & regeneration (data-catalog Story 008/012)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	const applicationIri = classIri('Application');
	const dataset = datasetIri(DEFAULT_NAMESPACE_BASE_IRI, 'Application');
	const catalog = catalogIri(DEFAULT_NAMESPACE_BASE_IRI);
	const distribution = distributionIri(DEFAULT_NAMESPACE_BASE_IRI, 'Application');

	function mockCatalogFetch(
		fixture: {
			catalogExists?: boolean;
			datasetExists?: boolean;
			label?: string;
			comment?: string | null;
			masters?: Array<{ s: string; label?: string; g: string }>;
			namespaceRows?: Array<{
				ns: string;
				prefix?: string;
				publisher?: string;
				license?: string;
			}>;
		} = {}
	) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('ASK') && q.includes(`a <${DCAT.Catalog}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.catalogExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('ASK') && q.includes(`a <${DCAT.Dataset}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.datasetExists ?? false }), {
					status: 200
				});
			}
			if (q.includes('SELECT ?label ?comment')) {
				const binding: SparqlBinding = {};
				if (fixture.label) binding.label = { type: 'literal', value: fixture.label };
				if (fixture.comment) binding.comment = { type: 'literal', value: fixture.comment };
				return new Response(
					JSON.stringify({
						head: { vars: ['label', 'comment'] },
						results: { bindings: fixture.label !== undefined ? [binding] : [] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('SELECT ?s ?label ?g WHERE')) {
				const bindings = (fixture.masters ?? []).map((m) => {
					const b: SparqlBinding = { s: { type: 'uri', value: m.s }, g: { type: 'uri', value: m.g } };
					if (m.label) b.label = { type: 'literal', value: m.label };
					return b;
				});
				return new Response(
					JSON.stringify({ head: { vars: ['s', 'label', 'g'] }, results: { bindings } }),
					{ status: 200 }
				);
			}
			if (q.includes('SELECT ?ns ?prefix ?desc ?color ?publisher ?license')) {
				const bindings = (fixture.namespaceRows ?? []).map((r) => {
					const b: SparqlBinding = { ns: { type: 'uri', value: r.ns } };
					if (r.prefix) b.prefix = { type: 'literal', value: r.prefix };
					if (r.publisher) b.publisher = { type: 'literal', value: r.publisher };
					if (r.license) b.license = { type: 'uri', value: r.license };
					return b;
				});
				return new Response(
					JSON.stringify({
						head: { vars: ['ns', 'prefix', 'desc', 'color', 'publisher', 'license'] },
						results: { bindings }
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('ensureCatalogContainer creates the container only if missing, and reuses it across classes', async () => {
		const { fn, updates } = mockCatalogFetch({ catalogExists: false });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.ensureCatalogContainer();
		expect(updates).toEqual([expect.stringContaining(`<${catalog}> a <${DCAT.Catalog}> .`)]);

		const { fn: fn2, updates: updates2 } = mockCatalogFetch({ catalogExists: true });
		vi.stubGlobal('fetch', fn2);
		await connector.ensureCatalogContainer();
		expect(updates2).toHaveLength(0);
	});

	it('generates the mandatory inferable triples for a first-time catalog entry', async () => {
		const { fn, updates } = mockCatalogFetch({
			catalogExists: false,
			datasetExists: false,
			label: 'Application',
			comment: 'An enterprise application.'
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const result = await connector.generateCatalogForClass(applicationIri);
		expect(result.datasetIri).toBe(dataset);

		const insertOps = updates.filter((u) => u.includes('INSERT DATA'));
		const generatorInsert = insertOps.find((u) => u.includes(`<${dataset}> a <${DCAT.Dataset}>`));
		expect(generatorInsert).toBeDefined();
		expect(generatorInsert).toContain(`<${dataset}> <${DCT.title}> "Application"`);
		expect(generatorInsert).toContain(`<${dataset}> <${DCT.description}> "An enterprise application."`);
		expect(generatorInsert).toContain(`<${dataset}> <${DCT.conformsTo}> <${applicationIri}>`);
		expect(generatorInsert).toContain(`<${dataset}> <${PROV.wasGeneratedBy}>`);
		expect(generatorInsert).not.toContain(PROV.wasAttributedTo);
		expect(generatorInsert).not.toContain(PROV.wasDerivedFrom);

		// dcat:Distribution placeholder is always emitted, never omitted.
		const placeholderInsert = insertOps.find((u) => u.includes(`<${dataset}> <${DCAT.distribution}>`));
		expect(placeholderInsert).toBeDefined();
		expect(placeholderInsert).toContain(`<${distribution}> a <${DCAT.Distribution}>`);
		expect(placeholderInsert).toContain(`<${distribution}> <${DCT.format}> ""`);
		expect(placeholderInsert).toContain(`<${distribution}> <${DCAT.mediaType}> ""`);
		expect(placeholderInsert).toContain(`<${distribution}> <${DCAT.accessURL}> ""`);
		// dcat:theme is never populated — no taxonomy source to infer it from.
		expect(placeholderInsert).not.toContain(DCAT.theme);
	});

	it('includes prov:wasAttributedTo/wasDerivedFrom when an isMasterFor assertion exists, omits them otherwise', async () => {
		const systemOfWorkIri = 'https://example.com/adoit#AdoitSystemOfWork';
		const { fn, updates } = mockCatalogFetch({
			label: 'Application',
			masters: [{ s: systemOfWorkIri, label: 'ADOIT', g: 'https://example.com/adoit' }]
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		const generatorInsert = updates.find((u) => u.includes(`<${dataset}> a <${DCAT.Dataset}>`))!;
		expect(generatorInsert).toContain(`<${dataset}> <${PROV.wasAttributedTo}> <${systemOfWorkIri}>`);
		expect(generatorInsert).toContain(`<${dataset}> <${PROV.wasDerivedFrom}> <${systemOfWorkIri}>`);
	});

	it('pre-fills dct:publisher/dct:license from the namespace default when one is set', async () => {
		const { fn, updates } = mockCatalogFetch({
			label: 'Application',
			namespaceRows: [
				{
					ns: DEFAULT_NAMESPACE_BASE_IRI,
					prefix: 'rse',
					publisher: 'Application Architecture Authority',
					license: 'https://example.com/license/enterprise-internal-v1'
				}
			]
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		const placeholderInsert = updates.find((u) => u.includes(`<${dataset}> <${DCAT.distribution}>`))!;
		expect(placeholderInsert).toContain(
			`<${dataset}> <${DCT.publisher}> "Application Architecture Authority"`
		);
		expect(placeholderInsert).toContain(
			`<${dataset}> <${DCT.license}> <https://example.com/license/enterprise-internal-v1>`
		);
	});

	it('emits empty placeholders for dct:publisher/dct:license when no namespace default exists', async () => {
		const { fn, updates } = mockCatalogFetch({ label: 'Application' });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		const placeholderInsert = updates.find((u) => u.includes(`<${dataset}> <${DCAT.distribution}>`))!;
		expect(placeholderInsert).toContain(`<${dataset}> <${DCT.publisher}> ""`);
		expect(placeholderInsert).toContain(`<${dataset}> <${DCT.license}> ""`);
	});

	it('regeneration deletes/reinserts only generator-owned predicates, leaving publisher/license/distribution untouched', async () => {
		const { fn, updates } = mockCatalogFetch({
			catalogExists: true,
			datasetExists: true,
			label: 'Application Renamed'
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);

		const deleteOps = updates.filter((u) => u.includes('DELETE WHERE'));
		// One DELETE WHERE per generator-owned predicate, none for publisher/license/distribution/theme/keyword.
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${RDF.type}>`))).toBe(true);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${DCT.title}>`))).toBe(true);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${DCT.description}>`))).toBe(true);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${DCT.conformsTo}>`))).toBe(true);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${PROV.wasAttributedTo}>`))).toBe(true);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${PROV.wasDerivedFrom}>`))).toBe(true);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${PROV.wasGeneratedBy}>`))).toBe(true);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${DCT.publisher}>`))).toBe(false);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${DCT.license}>`))).toBe(false);
		expect(deleteOps.some((u) => u.includes(`<${dataset}> <${DCAT.distribution}>`))).toBe(false);

		// No placeholder re-insertion on regeneration — publisher/license/distribution insert is
		// first-generation only.
		expect(updates.some((u) => u.includes(`<${dataset}> <${DCAT.distribution}>`))).toBe(false);

		const insertOp = updates.find((u) => u.includes('INSERT DATA'))!;
		expect(insertOp).toContain(`<${dataset}> <${DCT.title}> "Application Renamed"`);
	});

	it('two successive regeneration runs mint two distinct prov:Activity individuals', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const { fn, updates } = mockCatalogFetch({ catalogExists: true, datasetExists: true, label: 'Application' });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.generateCatalogForClass(applicationIri);
		vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
		await connector.generateCatalogForClass(applicationIri);

		const activityTriples = updates
			.filter((u) => u.includes('INSERT DATA') && u.includes(`a <${PROV.Activity}>`))
			.map((u) => u.match(new RegExp(`<([^>]+)> a <${PROV.Activity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`))?.[1]);
		expect(activityTriples).toHaveLength(2);
		expect(activityTriples[0]).not.toBe(activityTriples[1]);
	});

	it('rejects a malicious/malformed IRI before any query is issued', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.generateCatalogForClass('not-a-safe-iri<>')).rejects.toThrow(/Invalid/);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('SparqlConnector — fetchProvenanceReport (Story 012)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const applicationIri = classIri('Application');
	const attrAIri = propertyIri(applicationIri, 'attrA');
	const attrBIri = propertyIri(applicationIri, 'attrB');
	const dataset = datasetIri(DEFAULT_NAMESPACE_BASE_IRI, 'Application');

	function mockProvenanceFetch(
		fixture: {
			classLabel?: string;
			attributes?: Array<{ iri: string; label?: string }>;
			classMaster?: { iri: string; label: string } | null;
			attributeMasters?: Record<string, { iri: string; label: string }>;
			operatingAuthority?: Record<string, string>;
			labels?: Record<string, string>;
			datasetGeneratedAt?: Record<string, { started?: string; ended?: string }>;
		} = {}
	) {
		const attributes = fixture.attributes ?? [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;

			if (q.includes('GRAPH ?g') && q.includes('a owl:Class')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: DEFAULT_GRAPHS.schema } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: 'https://example.com/adoit' } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('SELECT ?label ?comment')) {
				const binding: SparqlBinding = fixture.classLabel
					? { label: { type: 'literal', value: fixture.classLabel } }
					: {};
				return new Response(
					JSON.stringify({
						head: { vars: ['label', 'comment'] },
						results: { bindings: fixture.classLabel ? [binding] : [] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('rdfs:label "isMasterFor"') && q.includes(`<${applicationIri}>`)) {
				const bindings = fixture.classMaster
					? [
							{
								s: { type: 'uri', value: fixture.classMaster.iri },
								label: { type: 'literal', value: fixture.classMaster.label },
								g: { type: 'uri', value: 'https://example.com/adoit' }
							}
						]
					: [];
				return new Response(JSON.stringify({ head: { vars: ['s', 'label', 'g'] }, results: { bindings } }), {
					status: 200
				});
			}
			for (const attr of attributes) {
				if (q.includes('rdfs:label "isMasterFor"') && q.includes(`<${attr.iri}>`)) {
					const override = fixture.attributeMasters?.[attr.iri];
					const bindings = override
						? [
								{
									s: { type: 'uri', value: override.iri },
									label: { type: 'literal', value: override.label },
									g: { type: 'uri', value: 'https://example.com/adoit' }
								}
							]
						: [];
					return new Response(JSON.stringify({ head: { vars: ['s', 'label', 'g'] }, results: { bindings } }), {
						status: 200
					});
				}
			}
			if (q.includes('owl:DatatypeProperty')) {
				const bindings = attributes.map((attr) => ({
					p: { type: 'uri', value: attr.iri },
					...(attr.label ? { label: { type: 'literal', value: attr.label } } : {}),
					domain: { type: 'uri', value: applicationIri },
					range: { type: 'uri', value: 'http://www.w3.org/2001/XMLSchema#string' }
				}));
				return new Response(
					JSON.stringify({ head: { vars: ['p', 'label', 'domain', 'range'] }, results: { bindings } }),
					{ status: 200 }
				);
			}
			if (q.includes('SELECT ?authority WHERE')) {
				const subject = q.match(/<([^>]+)> <[^>]+> \?authority/)?.[1];
				const authority = subject ? fixture.operatingAuthority?.[subject] : undefined;
				const bindings = authority ? [{ authority: { type: 'uri', value: authority } }] : [];
				return new Response(JSON.stringify({ head: { vars: ['authority'] }, results: { bindings } }), {
					status: 200
				});
			}
			if (q.includes('SELECT ?iri ?label')) {
				const iris = [...q.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
				const bindings = iris
					.filter((iri) => fixture.labels?.[iri])
					.map((iri) => ({ iri: { type: 'uri', value: iri }, label: { type: 'literal', value: fixture.labels![iri] } }));
				return new Response(JSON.stringify({ head: { vars: ['iri', 'label'] }, results: { bindings } }), {
					status: 200
				});
			}
			if (q.includes('SELECT ?dataset ?started ?ended')) {
				const bindings = Object.entries(fixture.datasetGeneratedAt ?? {}).map(([iri, times]) => ({
					dataset: { type: 'uri', value: iri },
					...(times.started ? { started: { type: 'literal', value: times.started } } : {}),
					...(times.ended ? { ended: { type: 'literal', value: times.ended } } : {})
				}));
				return new Response(
					JSON.stringify({ head: { vars: ['dataset', 'started', 'ended'] }, results: { bindings } }),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn };
	}

	it('resolves a class-level isMasterFor default onto every attribute with no override of its own', async () => {
		const { fn } = mockProvenanceFetch({
			classLabel: 'Application',
			attributes: [{ iri: attrAIri, label: 'attrA' }],
			classMaster: { iri: 'https://example.com/adoit#itam', label: 'ITAM' }
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const report = await connector.fetchProvenanceReport(applicationIri);

		expect(report.className).toBe('Application');
		expect(report.attributes).toHaveLength(1);
		expect(report.attributes[0]).toMatchObject({
			attributeIri: attrAIri,
			masterIri: 'https://example.com/adoit#itam',
			masterLabel: 'ITAM',
			isAttributeOverride: false,
			generatedAt: null
		});
	});

	it("an attribute-level isMasterFor override wins over the class-level default (Story 019 shape)", async () => {
		const { fn } = mockProvenanceFetch({
			classLabel: 'Application',
			attributes: [{ iri: attrAIri, label: 'attrA' }],
			classMaster: { iri: 'https://example.com/adoit#itam', label: 'ITAM' },
			attributeMasters: { [attrAIri]: { iri: 'https://example.com/adoit#System_B', label: 'System B' } }
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const report = await connector.fetchProvenanceReport(applicationIri);

		expect(report.attributes[0]).toMatchObject({
			masterIri: 'https://example.com/adoit#System_B',
			masterLabel: 'System B',
			isAttributeOverride: true
		});
	});

	it('returns partial data — no error, generatedAt null — for a class whose catalog has never been generated', async () => {
		const { fn } = mockProvenanceFetch({
			classLabel: 'Application',
			attributes: [{ iri: attrAIri, label: 'attrA' }],
			classMaster: { iri: 'https://example.com/adoit#itam', label: 'ITAM' },
			datasetGeneratedAt: {}
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const report = await connector.fetchProvenanceReport(applicationIri);

		expect(report.attributes[0].generatedAt).toBeNull();
	});

	it('picks up prov:wasGeneratedBy timing once the class-level dataset has actually been generated', async () => {
		const { fn } = mockProvenanceFetch({
			classLabel: 'Application',
			attributes: [{ iri: attrAIri, label: 'attrA' }],
			classMaster: { iri: 'https://example.com/adoit#itam', label: 'ITAM' },
			datasetGeneratedAt: { [dataset]: { started: '2026-01-01T00:00:00Z', ended: '2026-01-02T00:00:00Z' } }
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const report = await connector.fetchProvenanceReport(applicationIri);

		expect(report.attributes[0].generatedAt).toBe('2026-01-02T00:00:00Z');
	});

	it('resolves a Backstage-sourced SystemOfWork authority through the same code path as any hand-modeled one', async () => {
		const backstageSystemOfWorkIri = 'https://ld.pageagent.com/backstage#Backstage';
		const { fn } = mockProvenanceFetch({
			classLabel: 'Application',
			attributes: [{ iri: attrAIri, label: 'attrA' }],
			classMaster: { iri: backstageSystemOfWorkIri, label: 'Backstage' },
			operatingAuthority: { [backstageSystemOfWorkIri]: 'https://ld.pageagent.com/backstage#PlatformTeam' },
			labels: { 'https://ld.pageagent.com/backstage#PlatformTeam': 'Platform Team' }
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const report = await connector.fetchProvenanceReport(applicationIri);

		expect(report.attributes[0]).toMatchObject({
			masterIri: backstageSystemOfWorkIri,
			authorityIri: 'https://ld.pageagent.com/backstage#PlatformTeam',
			authorityLabel: 'Platform Team'
		});
	});

	it('shows "no known contributor" data (null master/authority) for an attribute with no isMasterFor chain anywhere', async () => {
		const { fn } = mockProvenanceFetch({
			classLabel: 'Application',
			attributes: [{ iri: attrAIri, label: 'attrA' }, { iri: attrBIri, label: 'attrB' }],
			classMaster: null
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const report = await connector.fetchProvenanceReport(applicationIri);

		expect(report.attributes).toHaveLength(2);
		for (const attr of report.attributes) {
			expect(attr.masterIri).toBeNull();
			expect(attr.masterLabel).toBeNull();
			expect(attr.authorityIri).toBeNull();
		}
	});

	it('rejects a malicious/malformed IRI before any query is issued', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchProvenanceReport('not-a-safe-iri<>')).rejects.toThrow(/Invalid/);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('SparqlConnector — catalog Turtle fetch/save & per-entity metadata (data-catalog Story 009/011)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const applicationIri = classIri('Application');
	const dataset = datasetIri(DEFAULT_NAMESPACE_BASE_IRI, 'Application');

	function mockCatalogGraphFetch(catalogQuadBindings: Array<{ s: string; p: string; o: SparqlBinding['o'] }>) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('SELECT ?s ?p ?o')) {
				const bindings = catalogQuadBindings.map((row) => ({
					s: { type: 'uri', value: row.s },
					p: { type: 'uri', value: row.p },
					o: row.o
				}));
				return new Response(
					JSON.stringify({ head: { vars: ['s', 'p', 'o'] }, results: { bindings } }),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('fetchCatalogTurtleForClass returns an empty string when nothing has been generated yet', async () => {
		const { fn } = mockCatalogGraphFetch([]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const result = await connector.fetchCatalogTurtleForClass(applicationIri);
		expect(result).toBe('');
	});

	it('fetchCatalogTurtleForClass returns the class scope as Turtle when a catalog entry exists', async () => {
		const { fn } = mockCatalogGraphFetch([
			{ s: dataset, p: RDF.type, o: { type: 'uri', value: DCAT.Dataset } },
			{ s: dataset, p: DCT.title, o: { type: 'literal', value: 'Application' } }
		]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const result = await connector.fetchCatalogTurtleForClass(applicationIri);
		expect(result).toContain('Application');
	});

	it('saveCatalogTurtleForClass rejects a draft missing mandatory fields without writing anything', async () => {
		const { fn, updates } = mockCatalogGraphFetch([]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		const incompleteTurtle = `
			@prefix dcat: <${DCAT.Dataset.slice(0, -'Dataset'.length)}> .
			<${dataset}> a dcat:Dataset .
		`;
		await expect(
			connector.saveCatalogTurtleForClass(applicationIri, incompleteTurtle)
		).rejects.toThrow();
		expect(updates).toHaveLength(0);
	});

	it('setCatalogPublisher/setCatalogLicense write per-entity overrides directly, distinct from the namespace default', async () => {
		const { fn, updates } = mockCatalogGraphFetch([]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.setCatalogPublisher(applicationIri, 'Override Org');
		await connector.setCatalogLicense(applicationIri, 'https://example.com/license/override');

		expect(updates[0]).toContain(`<${dataset}> <${DCT.publisher}> "Override Org"`);
		expect(updates[1]).toContain(`<${dataset}> <${DCT.license}> <https://example.com/license/override>`);
	});

	it('setCatalogDistribution replaces the one deterministic distribution node in place', async () => {
		const { fn, updates } = mockCatalogGraphFetch([]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');

		await connector.setCatalogDistribution(applicationIri, {
			format: 'https://www.iana.org/assignments/media-types/text/turtle',
			mediaType: 'https://www.iana.org/assignments/media-types/text/turtle',
			accessURL: 'https://example.com/adoit/distribution/application-inventory.ttl'
		});

		const distribution = distributionIri(DEFAULT_NAMESPACE_BASE_IRI, 'Application');
		expect(updates[0]).toContain(`<${dataset}> <${DCAT.distribution}> <${distribution}>`);
		expect(updates[0]).toContain(
			`<${distribution}> <${DCT.format}> <https://www.iana.org/assignments/media-types/text/turtle>`
		);
	});
});

describe('SparqlConnector — inheritance (STORY-008)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertSubClassOf writes the triple when there is no cycle', async () => {
		const company = classIri('Company');
		const organization = classIri('Organization');
		const { fn, updates } = mockGraphFetch({ ancestors: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertSubClassOf(company, organization);

		expect(result.cycleRejected).toBe(false);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${company}> rdfs:subClassOf <${organization}>`);
	});

	it('insertSubClassOf refuses a direct self-cycle without writing anything', async () => {
		const company = classIri('Company');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertSubClassOf(company, company);

		expect(result.cycleRejected).toBe(true);
		expect(updates).toHaveLength(0);
	});

	it('insertSubClassOf refuses an indirect cycle (A already an ancestor of the proposed superclass)', async () => {
		const a = classIri('A');
		const b = classIri('B');
		// B rdfs:subClassOf* already reaches A (e.g. B -> A already exists), so A -> B would cycle.
		const { fn, updates } = mockGraphFetch({ ancestors: [a] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertSubClassOf(a, b);

		expect(result.cycleRejected).toBe(true);
		expect(updates).toHaveLength(0);
	});

	it('insertSubClassOf allows diamond inheritance (A->B, A->C, B->D, C->D)', async () => {
		const a = classIri('A');
		const d = classIri('D');
		// D has no ancestors yet in this fixture, so A -> D (closing the diamond) is not a cycle.
		const { fn, updates } = mockGraphFetch({ ancestors: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertSubClassOf(a, d);

		expect(result.cycleRejected).toBe(false);
		expect(updates).toHaveLength(1);
	});

	it('deleteSubClassOf removes only the one triple', async () => {
		const company = classIri('Company');
		const organization = classIri('Organization');
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteSubClassOf(company, organization);

		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE DATA { ${inGraph(`<${company}> rdfs:subClassOf <${organization}> .`, DEFAULT_GRAPHS.schema)} }`
			)
		]);
	});
});

/** Mocks the single `SELECT ?s ?p ?o` whole-graph fetch that `fetchWholeGraphQuads` (and
 *  everything built on it: STORY-011's Turtle view, STORY-012's save) issues. Update calls are
 *  recorded so tests can assert on the generated DELETE/INSERT ops without any ASK/rdfs:domain
 *  fixture plumbing STORY-004..008's `mockGraphFetch` needs. */
/** `fetchAllTriplesAsTurtle`/`fetchTriplesForResourceAsTurtle`/`fetchScopedTurtlePair` now also
 *  call `fetchNamespaces()` (STORY-048) and `fetchExternalVocabularies()` (STORY-050) to build the
 *  full display-prefix map, so this mock answers both query shapes too — `namespaces` defaults to
 *  just the default namespace, matching production (STORY-028's migration); `externalVocabularies`
 *  defaults to `[]` since `fetchExternalVocabularies()` merges the built-in three itself regardless
 *  of what GraphDB returns. Pass more to test multi-namespace/-vocabulary prefix behavior. */
function mockWholeGraphFetch(
	bindings: Array<Record<'s' | 'p' | 'o', SparqlBinding[string]>>,
	namespaces: Array<{ baseIri: string; prefix: string }> = [{ baseIri: DEFAULT_NAMESPACE_BASE_IRI, prefix: 'rse' }],
	externalVocabularies: Array<{ baseIri: string; prefix: string }> = []
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query ?? '';
		if (q.includes('?ns ?prefix ?desc')) {
			return new Response(
				JSON.stringify({
					head: { vars: ['ns', 'prefix', 'desc', 'color'] },
					results: {
						bindings: namespaces.map((ns) => ({
							ns: { type: 'uri', value: ns.baseIri },
							prefix: { type: 'literal', value: ns.prefix }
						}))
					}
				}),
				{ status: 200 }
			);
		}
		if (q.includes('?v ?prefix')) {
			return new Response(
				JSON.stringify({
					head: { vars: ['v', 'prefix'] },
					results: {
						bindings: externalVocabularies.map((v) => ({
							v: { type: 'uri', value: v.baseIri },
							prefix: { type: 'literal', value: v.prefix }
						}))
					}
				}),
				{ status: 200 }
			);
		}
		return new Response(JSON.stringify({ head: { vars: ['s', 'p', 'o'] }, results: { bindings } }), {
			status: 200
		});
	});
	return { fn, updates };
}

describe('SparqlConnector — raw triples view + edit + validation (STORY-011/012/013)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personIri = classIri('Person');

	it('fetchAllTriplesAsTurtle serializes the whole graph as Turtle', async () => {
		const { fn } = mockWholeGraphFetch([
			{
				s: { type: 'uri', value: personIri },
				p: { type: 'uri', value: `${SCHEMA_NAMESPACE}dummy` },
				o: { type: 'uri', value: 'urn:x' }
			}
		]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const turtle = await connector.fetchAllTriplesAsTurtle();

		expect(turtle).toContain(personIri.startsWith(SCHEMA_NAMESPACE) ? 'rse:' : personIri);
	});

	it('fetchAllTriplesAsTurtle abbreviates a non-default namespace\'s class with its own registered prefix (STORY-048)', async () => {
		const coreBase = 'http://ld.pageagent.com/rdf-schema-editor/core';
		const coreSchemaBase = namespaceGraphs(coreBase).schema;
		const processIri = classIri('BusinessProcess', coreSchemaBase);
		const { fn } = mockWholeGraphFetch(
			[
				{
					s: { type: 'uri', value: processIri },
					p: { type: 'uri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
					o: { type: 'uri', value: 'http://www.w3.org/2002/07/owl#Class' }
				}
			],
			[
				{ baseIri: DEFAULT_NAMESPACE_BASE_IRI, prefix: 'rse' },
				{ baseIri: coreBase, prefix: 'core' }
			]
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const turtle = await connector.fetchAllTriplesAsTurtle();

		expect(turtle).toContain('core:BusinessProcess');
		expect(turtle).not.toContain(processIri);
	});

	it('fetchAllTriplesAsTurtle abbreviates an external-vocabulary reference with its registered prefix (STORY-050)', async () => {
		const appIri = classIri('Application');
		const gistBase = 'https://ontologies.semanticarts.com/gist/';
		const { fn } = mockWholeGraphFetch(
			[
				{
					s: { type: 'uri', value: appIri },
					p: { type: 'uri', value: 'http://www.w3.org/2000/01/rdf-schema#subClassOf' },
					o: { type: 'uri', value: `${gistBase}System` }
				}
			],
			undefined,
			[{ baseIri: gistBase, prefix: 'gist' }]
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const turtle = await connector.fetchAllTriplesAsTurtle();

		expect(turtle).toContain('gist:System');
		expect(turtle).not.toContain(`${gistBase}System`);
	});

	it('fetchTriplesForResourceAsTurtle scopes to just the selected class', async () => {
		const carIri = classIri('Car');
		const { fn } = mockWholeGraphFetch([
			{
				s: { type: 'uri', value: personIri },
				p: { type: 'uri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
				o: { type: 'uri', value: 'http://www.w3.org/2002/07/owl#Class' }
			},
			{
				s: { type: 'uri', value: carIri },
				p: { type: 'uri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
				o: { type: 'uri', value: 'http://www.w3.org/2002/07/owl#Class' }
			}
		]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const turtle = await connector.fetchTriplesForResourceAsTurtle(personIri);

		expect(turtle).toContain('owl:Class');
		expect(turtle).not.toContain(carIri);
	});

	it("fetchScopedTurtlePair merges a cross-namespace incoming individual relation into a class's own scope (relation-assertions Story 001)", async () => {
		const coreBase = DEFAULT_NAMESPACE_BASE_IRI;
		const coreGraphs = namespaceGraphs(coreBase);
		const applicationIri = classIri('Application', coreGraphs.schema);

		const govBase = 'http://ld.pageagent.com/rdf-schema-editor/gov';
		const govGraphs = namespaceGraphs(govBase);
		const systemOfWorkIri = `${govGraphs.schema}#SystemOfWork`;
		const isMasterForIri = `${govGraphs.schema}#isMasterFor`;
		const itamIri = `${govGraphs.instances}#systemOfWorkItam`;

		const coreBindings: SparqlBinding[] = [
			{
				s: { type: 'uri', value: applicationIri },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: OWL.Class }
			}
		];
		const govBindings: SparqlBinding[] = [
			{
				s: { type: 'uri', value: isMasterForIri },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: OWL.ObjectProperty }
			},
			{
				s: { type: 'uri', value: isMasterForIri },
				p: { type: 'uri', value: RDFS.domain },
				o: { type: 'uri', value: systemOfWorkIri }
			},
			{
				s: { type: 'uri', value: itamIri },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: systemOfWorkIri }
			},
			{
				s: { type: 'uri', value: itamIri },
				p: { type: 'uri', value: isMasterForIri },
				o: { type: 'uri', value: applicationIri }
			}
		];

		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query ?? '';
			if (q.includes('?ns ?prefix ?desc')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns', 'prefix', 'desc', 'color'] },
						results: {
							bindings: [
								{ ns: { type: 'uri', value: coreBase }, prefix: { type: 'literal', value: 'rse' } },
								{ ns: { type: 'uri', value: govBase }, prefix: { type: 'literal', value: 'gov' } }
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (q.includes('?v ?prefix')) {
				return new Response(
					JSON.stringify({ head: { vars: ['v', 'prefix'] }, results: { bindings: [] } }),
					{ status: 200 }
				);
			}
			const bindings = q.includes(govGraphs.schema) ? govBindings : coreBindings;
			return new Response(JSON.stringify({ head: { vars: ['s', 'p', 'o'] }, results: { bindings } }), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const { schema } = await connector.fetchScopedTurtlePair(applicationIri, coreBase);

		expect(schema).toContain('isMasterFor');
		expect(schema).toContain('systemOfWorkItam');
	});

	it('saveScopedTurtle sends one atomic DELETE/INSERT update on a valid edit', async () => {
		const { fn, updates } = mockWholeGraphFetch([
			{
				s: { type: 'uri', value: personIri },
				p: { type: 'uri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
				o: { type: 'uri', value: 'http://www.w3.org/2002/07/owl#Class' }
			}
		]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.saveScopedTurtle(
			personIri,
			`@prefix owl: <http://www.w3.org/2002/07/owl#> .
			 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			 <${personIri}> a owl:Class ; rdfs:label "Person" .`
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
		expect(updates[0]).toContain('INSERT DATA {');
		expect(updates[0]).toContain('http://www.w3.org/2000/01/rdf-schema#label> "Person"');
	});

	it('saveScopedTurtle rejects invalid Turtle syntax without calling the update endpoint', async () => {
		const { fn, updates } = mockWholeGraphFetch([]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.saveScopedTurtle(null, 'not : valid @@@ turtle')).rejects.toMatchObject({
			issues: [expect.objectContaining({ layer: 'syntax' })]
		});
		expect(updates).toHaveLength(0);
	});

	it('saveScopedTurtle rejects a structural violation (dangling rdfs:domain) without calling the update endpoint', async () => {
		const { fn, updates } = mockWholeGraphFetch([]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.saveScopedTurtle(
				null,
				`@prefix owl: <http://www.w3.org/2002/07/owl#> .
				 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
				 <urn:Car> a owl:Class .
				 <urn:owns> a owl:ObjectProperty ; rdfs:domain <urn:Ghost> ; rdfs:range <urn:Car> .`
			)
		).rejects.toMatchObject({ issues: [expect.objectContaining({ layer: 'structural' })] });
		expect(updates).toHaveLength(0);
	});

	it('saveScopedTurtle rejects an edit that would leave another property\'s rdfs:range dangling', async () => {
		const externalProp = `${SCHEMA_NAMESPACE}companyEmployee`;
		const { fn, updates } = mockWholeGraphFetch([
			{
				s: { type: 'uri', value: personIri },
				p: { type: 'uri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
				o: { type: 'uri', value: 'http://www.w3.org/2002/07/owl#Class' }
			},
			{
				s: { type: 'uri', value: externalProp },
				p: { type: 'uri', value: 'http://www.w3.org/2000/01/rdf-schema#range' },
				o: { type: 'uri', value: personIri }
			}
		]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		// Edit replaces Person with plain rdfs:label triples, no longer declaring it an owl:Class —
		// `companyEmployee`'s rdfs:range would then dangle, so STORY-013's structural check rejects
		// this before anything reaches GraphDB (a stronger guarantee than STORY-012's "at minimum, a
		// warning" AC calls for).
		await expect(
			connector.saveScopedTurtle(
				personIri,
				`@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . <${personIri}> rdfs:label "Person" .`
			)
		).rejects.toMatchObject({ issues: [expect.objectContaining({ layer: 'structural' })] });
		expect(updates).toHaveLength(0);
	});
});

describe('SparqlConnector — partition-scoped save (STORY-017)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personIri = classIri('Person');
	const shapeIri = nodeShapeIri(personIri);

	function makeClassWithShapeFixture() {
		return [
			{
				s: { type: 'uri' as const, value: personIri },
				p: { type: 'uri' as const, value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
				o: { type: 'uri' as const, value: 'http://www.w3.org/2002/07/owl#Class' }
			},
			{
				s: { type: 'uri' as const, value: personIri },
				p: { type: 'uri' as const, value: 'http://www.w3.org/2000/01/rdf-schema#label' },
				o: { type: 'literal' as const, value: 'Person' }
			},
			{
				s: { type: 'uri' as const, value: shapeIri },
				p: { type: 'uri' as const, value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
				o: { type: 'uri' as const, value: 'http://www.w3.org/ns/shacl#NodeShape' }
			}
		];
	}

	it("a Schema-tab save on a class emits only the class-own DELETE WHERE/INSERT DATA ops, leaving its sh:NodeShape untouched", async () => {
		const { fn, updates } = mockWholeGraphFetch(makeClassWithShapeFixture());
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.saveScopedTurtle(
			personIri,
			`@prefix owl: <http://www.w3.org/2002/07/owl#> .
			 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			 <${personIri}> a owl:Class ; rdfs:label "Person Renamed" .`,
			'schema'
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
		expect(updates[0]).not.toContain(`<${shapeIri}> ?p ?o`);
		expect(updates[0]).not.toContain('sh:property ?propShape');
		expect(updates[0]).toContain('"Person Renamed"');
	});

	it("a Shapes-tab save on a class emits only the shape-own/property-shape ops, leaving its owl:Class triples untouched", async () => {
		const { fn, updates } = mockWholeGraphFetch(makeClassWithShapeFixture());
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.saveScopedTurtle(
			personIri,
			`@prefix sh: <http://www.w3.org/ns/shacl#> .
			 <${shapeIri}> a sh:NodeShape ; sh:targetClass <${personIri}> .`,
			'shapes'
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`, DEFAULT_GRAPHS.shapes)} }`
		);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`, DEFAULT_GRAPHS.shapes)} }`
		);
		expect(updates[0]).not.toContain(
			`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
		expect(updates[0]).toContain(`<${shapeIri}> <http://www.w3.org/ns/shacl#targetClass>`);
	});

	it("default/'all'-partition save matches the pre-existing combined behavior unchanged", async () => {
		const { fn, updates } = mockWholeGraphFetch(makeClassWithShapeFixture());
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.saveScopedTurtle(
			personIri,
			`@prefix owl: <http://www.w3.org/2002/07/owl#> .
			 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			 <${personIri}> a owl:Class ; rdfs:label "Person" .`
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`, DEFAULT_GRAPHS.shapes)} }`
		);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`, DEFAULT_GRAPHS.shapes)} }`
		);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});
});

/** Mocks an `ASK { <iri> a <classIri> }` membership check plus recorded update bodies, for the
 *  individuals CRUD methods (STORY-019). Also answers `resolveEffectiveClassNamespace`'s own
 *  `SELECT ?ns`/`SELECT ?super` cross-graph lookups (run by `insertIndividual`'s identifier path,
 *  STORY-113's Concept-Namespace override) with empty bindings — i.e. "no Concept Namespace
 *  declared anywhere in the ancestry" — the correct default for every test in this block that
 *  doesn't itself exercise that override. Also answers `findNamespaceOfIndividual`'s own
 *  `GRAPH ?g { <iri> a ?type }` lookup (the omitted-`namespaceBaseIri` fallback every rename/delete/
 *  attribute-value method now resolves through) with `namespaceByIndividual[iri]`, defaulting to
 *  `DEFAULT_NAMESPACE_BASE_IRI` — the correct default for every test whose individual was minted
 *  there and doesn't itself exercise a cross-namespace scenario. */
function mockIndividualFetch(fixture: { exists?: boolean; namespaceByIndividual?: Record<string, string> } = {}) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		const namespaceMatch = q.match(/GRAPH \?g \{ <([^>]+)> a \?type \}/);
		if (namespaceMatch) {
			const graph = fixture.namespaceByIndividual?.[namespaceMatch[1]] ?? DEFAULT_NAMESPACE_BASE_IRI;
			return new Response(
				JSON.stringify({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: graph } }] } }),
				{ status: 200 }
			);
		}
		return new Response(
			JSON.stringify({ head: {}, results: { bindings: [] }, boolean: fixture.exists ?? false }),
			{ status: 200 }
		);
	});
	return { fn, updates };
}

describe('SparqlConnector — individuals / enumerated class members (STORY-019)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const relationType = classIri('RelationType');

	it('insertIndividual derives the IRI from the owning class + label and writes rdf:type + rdfs:label', async () => {
		const { fn, updates } = mockIndividualFetch({ exists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt');

		// Independently computed expected IRI (STORY-062) — not derived from `individualIri`'s own
		// default, so this assertion actually catches a regression to the old `/schema#` minting bug.
		expect(result.iri).toBe(`${DEFAULT_NAMESPACE_BASE_IRI}#relationTypeNutzt`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.instances}>`);
		expect(updates[0]).toContain(`<${result.iri}> a <${relationType}>`);
		expect(updates[0]).toContain('rdfs:label "nutzt"');
	});

	it('insertIndividual rejects a duplicate member name on the same class', async () => {
		const { fn } = mockIndividualFetch({ exists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertIndividual(relationType, 'nutzt')).rejects.toThrow(/already exists/);
	});

	it('insertIndividual rejects an empty label without making any request', async () => {
		const { fn } = mockIndividualFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertIndividual(relationType, '   ')).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	// -- User-specified identifier (STORY-113) ---------------------------------------------------

	it('insertIndividual mints <namespaceBaseIri>#<identifier> when an identifier is supplied, instead of the auto-derived IRI', async () => {
		const { fn, updates } = mockIndividualFetch({ exists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt', undefined, 'myCustomId');

		expect(result.iri).toBe(`${DEFAULT_NAMESPACE_BASE_IRI}#myCustomId`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${result.iri}> a <${relationType}>`);
	});

	it('insertIndividual falls back to individualIri() derivation when the identifier is blank/whitespace', async () => {
		const { fn } = mockIndividualFetch({ exists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt', undefined, '   ');

		expect(result.iri).toBe(`${DEFAULT_NAMESPACE_BASE_IRI}#relationTypeNutzt`);
	});

	it('insertIndividual rejects an identifier containing characters outside the allowed set, without making any request', async () => {
		const { fn } = mockIndividualFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertIndividual(relationType, 'nutzt', undefined, 'my id!')).rejects.toThrow(
			/Identifier must start with a letter/
		);
		await expect(connector.insertIndividual(relationType, 'nutzt', undefined, '-abc')).rejects.toThrow(
			/Identifier must start with a letter/
		);
		expect(fn).not.toHaveBeenCalled();
	});

	it('insertIndividual accepts a leading-digit identifier, since it only ever becomes an IRI fragment', async () => {
		const { fn } = mockIndividualFetch({ exists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt', undefined, '1abc');

		expect(result.iri).toBe(`${DEFAULT_NAMESPACE_BASE_IRI}#1abc`);
	});

	it('insertIndividual rejects a supplied identifier that collides with an existing individual, same error as the auto-derived collision case', async () => {
		const { fn } = mockIndividualFetch({ exists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertIndividual(relationType, 'nutzt', undefined, 'myCustomId')).rejects.toThrow(
			/already exists/
		);
	});

	// -- Concept Namespace override for the identifier path (`rse:namespace`) -------------------

	it('insertIndividual mints under the class\'s own effective Concept Namespace when one is declared, overriding namespaceBaseIri', async () => {
		const conceptNamespace = 'https://ld.pageagent.com/application/';
		const { fn, updates } = mockGraphFetch({ ownNamespace: { [relationType]: conceptNamespace } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt', undefined, '871944');

		const expectedBase = namespaceGraphs(conceptNamespace).instances;
		expect(result.iri).toBe(`${expectedBase}#871944`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${expectedBase}>`);
		expect(updates[0]).toContain(`<${result.iri}> a <${relationType}>`);
	});

	it('insertIndividual mints under an inherited Concept Namespace (nearest ancestor\'s declaration) when the class declares none of its own', async () => {
		const conceptNamespace = 'https://ld.pageagent.com/core-concept/';
		const parentClass = classIri('CoreConcept');
		const { fn, updates } = mockGraphFetch({
			superClasses: { [relationType]: [parentClass] },
			ownNamespace: { [parentClass]: conceptNamespace }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt', undefined, '871944');

		const expectedBase = namespaceGraphs(conceptNamespace).instances;
		expect(result.iri).toBe(`${expectedBase}#871944`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${expectedBase}>`);
	});

	it('insertIndividual falls back to namespaceBaseIri for the identifier path when the class declares no Concept Namespace anywhere in its ancestry', async () => {
		const chosenNamespace = 'https://ld.pageagent.com/core/';
		const { fn, updates } = mockGraphFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt', chosenNamespace, '871944');

		const expectedBase = namespaceGraphs(chosenNamespace).instances;
		expect(result.iri).toBe(`${expectedBase}#871944`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${expectedBase}>`);
	});

	it('insertIndividual ignores the Concept Namespace for a plain label-derived individual (no identifier) — override is scoped to the identifier path only', async () => {
		const conceptNamespace = 'https://ld.pageagent.com/application/';
		const { fn, updates } = mockGraphFetch({ ownNamespace: { [relationType]: conceptNamespace } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertIndividual(relationType, 'nutzt');

		expect(result.iri).toBe(`${DEFAULT_NAMESPACE_BASE_IRI}#relationTypeNutzt`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.instances}>`);
	});

	it('deleteIndividual removes the member entirely via one DELETE WHERE', async () => {
		const { fn, updates } = mockIndividualFetch();
		vi.stubGlobal('fetch', fn);

		const iri = individualIri(relationType, 'nutzt');
		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteIndividual(iri);

		expect(updates).toEqual([
			expect.stringContaining(`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, DEFAULT_GRAPHS.instances)} }`)
		]);
	});

	// The next two tests guard the actual bug report: a member minted into a Concept Namespace
	// different from its class's own namespace previously vanished from the frontend list (the UI
	// call "succeeded") while its triples stayed untouched in GraphDB — `DELETE WHERE`/rename against
	// the wrong graph matches zero triples and reports success, no error surfaced anywhere.

	it('deleteIndividual resolves the individual\'s own namespace via findNamespaceOfIndividual when none is passed, not a caller\'s guess', async () => {
		const iri = `https://example.com/ssi#871912`;
		const actualNamespace = 'https://example.com/ssi';
		const { fn, updates } = mockIndividualFetch({ namespaceByIndividual: { [iri]: actualNamespace } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteIndividual(iri);

		expect(updates).toEqual([
			expect.stringContaining(`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, actualNamespace)} }`)
		]);
	});

	it('deleteIndividual skips the namespace lookup entirely when the caller passes one explicitly', async () => {
		const iri = individualIri(relationType, 'nutzt');
		const { fn, updates } = mockIndividualFetch({
			// A wrong-namespace fixture the code must never consult, since an explicit namespaceBaseIri
			// is supplied below.
			namespaceByIndividual: { [iri]: 'https://example.com/should-not-be-used' }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteIndividual(iri, DEFAULT_NAMESPACE_BASE_IRI);

		expect(updates).toEqual([
			expect.stringContaining(`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, DEFAULT_GRAPHS.instances)} }`)
		]);
		expect(fn).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: expect.stringContaining('GRAPH ?g') }));
	});

	it('deleteIdentity removes outgoing triples via deleteIndividual, then incoming ones cross-graph', async () => {
		const iri = individualIri(relationType, 'nutzt');
		const { fn, updates } = mockIndividualFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteIdentity(iri, DEFAULT_NAMESPACE_BASE_IRI);

		expect(updates).toEqual([
			expect.stringContaining(`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`, DEFAULT_GRAPHS.instances)} }`),
			expect.stringContaining(`DELETE WHERE { GRAPH ?g { ?s ?p <${iri}> } }`)
		]);
	});

	it('deleteIdentity validates the target IRI before issuing any request', async () => {
		const { fn } = mockIndividualFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.deleteIdentity('not a safe iri')).rejects.toThrow(/Invalid individual IRI/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('renameIndividual resolves the individual\'s own namespace via findNamespaceOfIndividual when none is passed', async () => {
		const iri = `https://example.com/ssi#871912`;
		const actualNamespace = 'https://example.com/ssi';
		const { fn, updates } = mockIndividualFetch({ namespaceByIndividual: { [iri]: actualNamespace } });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.renameIndividual(iri, 'Neuer Name');

		expect(updates).toEqual([expect.stringContaining(`WITH <${actualNamespace}>`)]);
	});

	it('fetchIndividualsOfClass round-trips the members inserted for a class', async () => {
		const nutztIri = individualIri(relationType, 'nutzt');
		const verbuchtIri = individualIri(relationType, 'verbucht');
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['i', 'label', 'g'] },
					results: {
						bindings: [
							{
								i: { type: 'uri', value: nutztIri },
								label: { type: 'literal', value: 'nutzt' },
								g: { type: 'uri', value: DEFAULT_GRAPHS.instances }
							},
							{
								i: { type: 'uri', value: verbuchtIri },
								label: { type: 'literal', value: 'verbucht' },
								g: { type: 'uri', value: DEFAULT_GRAPHS.instances }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const members = await connector.fetchIndividualsOfClass(relationType);

		expect(members).toEqual([
			{ iri: nutztIri, label: 'nutzt', namespaceBaseIri: DEFAULT_GRAPHS.instances },
			{ iri: verbuchtIri, label: 'verbucht', namespaceBaseIri: DEFAULT_GRAPHS.instances }
		]);
	});

	it('fetchIndividualsOfClass finds a member minted under a namespace different from the one declaring its class, and reports that namespace', async () => {
		// Mirrors a hand-typed-identifier member (STORY-113) or a Backstage `represents` target: the
		// class lives in "core"'s own /schema graph, but the individual was minted into "interfaces",
		// the class's separately-configured Concept Namespace (STORY-099/100).
		const coreBase = 'https://example.com/core';
		const interfacesBase = 'https://example.com/interfaces';
		const schnittstelleClassIri = classIri('Schnittstelle', coreBase);
		const individualIriValue = `${interfacesBase}#871912`;

		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			expect(q).toContain('GRAPH ?g');
			// No `FROM` clause anywhere — mixing `FROM` with the unrestricted `GRAPH ?g` above would
			// collapse the query's named-graph set to empty per SPARQL 1.1 semantics, silently zeroing
			// out every result (the actual bug this test guards against).
			expect(q).not.toMatch(/\bFROM\b/);
			return new Response(
				JSON.stringify({
					head: { vars: ['i', 'label', 'g'] },
					results: {
						bindings: [
							{
								i: { type: 'uri', value: individualIriValue },
								label: { type: 'literal', value: '871912' },
								g: { type: 'uri', value: interfacesBase }
							}
						]
					}
				}),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const members = await connector.fetchIndividualsOfClass(schnittstelleClassIri);

		expect(members).toEqual([{ iri: individualIriValue, label: '871912', namespaceBaseIri: interfacesBase }]);
	});

	it('fetchAllIndividuals finds an individual minted under a Concept Namespace different from the one declaring its class — the class check spans every graph, not just this namespace\'s own /schema', async () => {
		// Mirrors a hand-typed-identifier member (STORY-113) or a Backstage `represents` target: the
		// class lives in "core"'s own /schema graph, but the individual was minted into "application",
		// the class's separately-configured Concept Namespace (STORY-099/100).
		const applicationBase = 'https://example.com/application';
		const coreBase = 'https://example.com/core';
		const applicationClassIri = classIri('Application', coreBase);
		const individualIriValue = `${applicationBase}#871944`;

		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('?i a ?type') && q.includes('GRAPH ?classGraph')) {
				expect(q).toContain(`GRAPH <${applicationBase}>`);
				// No `FROM` clause anywhere — mixing `FROM` with the unrestricted `GRAPH ?classGraph`
				// below would collapse the query's named-graph set to empty per SPARQL 1.1 semantics,
				// silently zeroing out every result (the actual bug this test guards against).
				expect(q).not.toMatch(/\bFROM\b/);
				return new Response(
					JSON.stringify({
						head: { vars: ['i', 'type'] },
						results: {
							bindings: [{ i: { type: 'uri', value: individualIriValue }, type: { type: 'uri', value: applicationClassIri } }]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchAllIndividuals(applicationBase);

		expect(result).toEqual([
			{
				iri: individualIriValue,
				classIri: applicationClassIri,
				label: '871944',
				namespaceBaseIri: applicationBase,
				syncSource: null,
				syncStatus: null
			}
		]);
	});
});

/** Mocks a `SELECT ?p ?value` query (`fetchIndividualAttributeValues`) returning `bindings`, plus
 *  recorded update bodies for the write-side methods in the same describe block. Also answers
 *  `findNamespaceOfIndividual`'s own `GRAPH ?g { <iri> a ?type }` lookup (the omitted-
 *  `namespaceBaseIri` fallback every method in this block now resolves through) with
 *  `DEFAULT_NAMESPACE_BASE_IRI` — every individual in this block's tests is minted there. */
function mockAttributeValueFetch(bindings: Array<{ p: string; value: string }> = []) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (/GRAPH \?g \{ <[^>]+> a \?type \}/.test(q)) {
			return new Response(
				JSON.stringify({
					head: { vars: ['g'] },
					results: { bindings: [{ g: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI } }] }
				}),
				{ status: 200 }
			);
		}
		return new Response(
			JSON.stringify({
				head: { vars: ['p', 'value'] },
				results: {
					bindings: bindings.map((b) => ({
						p: { type: 'uri', value: b.p },
						value: { type: 'literal', value: b.value }
					}))
				}
			}),
			{ status: 200 }
		);
	});
	return { fn, updates };
}

describe('SparqlConnector — ABox literal attribute values on individuals (STORY-110)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const person = classIri('Person');
	const employeeIri = individualIri(person, 'alice');
	const birthDateIri = propertyIri(person, 'birthDate');
	const nicknameIri = propertyIri(person, 'nickname');

	it('fetchIndividualAttributeValues returns {} without a request when given no attributes', async () => {
		const fn = vi.fn();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const values = await connector.fetchIndividualAttributeValues(employeeIri, []);
		expect(values).toEqual({});
		expect(fn).not.toHaveBeenCalled();
	});

	it('fetchIndividualAttributeValues returns a single string for a non-repeatable attribute', async () => {
		const { fn } = mockAttributeValueFetch([{ p: birthDateIri, value: '1990-01-01' }]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const values = await connector.fetchIndividualAttributeValues(employeeIri, [
			{ iri: birthDateIri, repeatable: false }
		]);
		expect(values).toEqual({ [birthDateIri]: '1990-01-01' });
	});

	it('fetchIndividualAttributeValues collects a repeatable attribute\'s values into an array', async () => {
		const { fn } = mockAttributeValueFetch([
			{ p: nicknameIri, value: 'Al' },
			{ p: nicknameIri, value: 'Ally' }
		]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const values = await connector.fetchIndividualAttributeValues(employeeIri, [
			{ iri: nicknameIri, repeatable: true }
		]);
		expect(values).toEqual({ [nicknameIri]: ['Al', 'Ally'] });
	});

	it('setIndividualAttributeValue replaces an existing value via DELETE-then-INSERT, typed as xsd:date', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.setIndividualAttributeValue(employeeIri, birthDateIri, 'date', '1990-01-01');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`WITH <${DEFAULT_GRAPHS.instances}>`);
		expect(updates[0]).toContain(`DELETE { <${employeeIri}> <${birthDateIri}> ?old .`);
		expect(updates[0]).toContain(`INSERT { <${employeeIri}> <${birthDateIri}> "1990-01-01"^^xsd:date .`);
		expect(updates[0]).toContain(`OPTIONAL { <${employeeIri}> <${birthDateIri}> ?old }`);
	});

	it('setIndividualAttributeValue clears the value (DELETE-only) when value is null', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.setIndividualAttributeValue(employeeIri, birthDateIri, 'date', null);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`DELETE { <${employeeIri}> <${birthDateIri}> ?old .`);
		expect(updates[0]).not.toContain('INSERT {');
	});

	it('addIndividualAttributeValue inserts one typed literal value for a repeatable attribute', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.addIndividualAttributeValue(employeeIri, nicknameIri, 'string', 'Al');

		expect(updates).toEqual([
			expect.stringContaining(
				inGraph(`<${employeeIri}> <${nicknameIri}> "Al"^^xsd:string .`, DEFAULT_GRAPHS.instances)
			)
		]);
	});

	it('removeIndividualAttributeValue deletes exactly the given typed literal triple', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.removeIndividualAttributeValue(employeeIri, nicknameIri, 'string', 'Al');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`WITH <${DEFAULT_GRAPHS.instances}>`);
		expect(updates[0]).toContain(`DELETE { <${employeeIri}> <${nicknameIri}> "Al"^^xsd:string .`);
	});
});

describe('SparqlConnector — applyAttributeSubmissions (STORY-111)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const person = classIri('Person');
	const employeeIri = individualIri(person, 'alice');
	const birthDateIri = propertyIri(person, 'birthDate');
	const nicknameIri = propertyIri(person, 'nickname');

	it('does nothing when given an empty submission list', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.applyAttributeSubmissions(employeeIri, []);
		expect(updates).toEqual([]);
	});

	it('calls setIndividualAttributeValue (replace) for a single-valued submission with a value', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.applyAttributeSubmissions(employeeIri, [
			{ attributeIri: birthDateIri, datatype: 'date', repeatable: false, value: '1990-01-01' }
		]);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`INSERT { <${employeeIri}> <${birthDateIri}> "1990-01-01"^^xsd:date .`);
	});

	it('calls setIndividualAttributeValue (clear) for a single-valued submission with value: null', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.applyAttributeSubmissions(employeeIri, [
			{ attributeIri: birthDateIri, datatype: 'date', repeatable: false, value: null }
		]);
		expect(updates).toHaveLength(1);
		expect(updates[0]).not.toContain('INSERT {');
	});

	it('adds and removes each value of a repeatable submission, added before removed', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.applyAttributeSubmissions(employeeIri, [
			{ attributeIri: nicknameIri, datatype: 'string', repeatable: true, added: ['Ally'], removed: ['Al'] }
		]);
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(
			inGraph(`<${employeeIri}> <${nicknameIri}> "Ally"^^xsd:string .`, DEFAULT_GRAPHS.instances)
		);
		expect(updates[1]).toContain(`DELETE { <${employeeIri}> <${nicknameIri}> "Al"^^xsd:string .`);
	});

	it('processes multiple submissions in order', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.applyAttributeSubmissions(employeeIri, [
			{ attributeIri: birthDateIri, datatype: 'date', repeatable: false, value: '2000-01-01' },
			{ attributeIri: nicknameIri, datatype: 'string', repeatable: true, added: ['Ally'], removed: [] }
		]);
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`<${birthDateIri}>`);
		expect(updates[1]).toContain(`<${nicknameIri}>`);
	});

	it('resolves the individual\'s own namespace once via findNamespaceOfIndividual (not per submission) when none is passed', async () => {
		const { fn, updates } = mockAttributeValueFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.applyAttributeSubmissions(employeeIri, [
			{ attributeIri: birthDateIri, datatype: 'date', repeatable: false, value: '2000-01-01' },
			{ attributeIri: nicknameIri, datatype: 'string', repeatable: true, added: ['Ally', 'A.'], removed: [] }
		]);
		expect(updates).toHaveLength(3);

		const namespaceLookupCalls = fn.mock.calls.filter(([, opts]: [string, { body: string }]) => {
			const body = JSON.parse(opts.body);
			return body.update === undefined && /GRAPH \?g \{ <[^>]+> a \?type \}/.test(body.query as string);
		});
		expect(namespaceLookupCalls).toHaveLength(1);
	});
});

describe('SparqlConnector — fetchLabelRequiredClasses (STORY-112)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const coreEntity = classIri('CoreEntity');
	const other = classIri('Other');

	function mockLabelShapeFetch(bindings: Array<{ class: string; minCount?: number }>) {
		return vi.fn(async (_url: string, _opts: { body: string }) =>
			new Response(
				JSON.stringify({
					head: { vars: ['class', 'minCount'] },
					results: {
						bindings: bindings.map((b) => ({
							class: { type: 'uri', value: b.class },
							...(b.minCount !== undefined ? { minCount: { type: 'literal', value: String(b.minCount) } } : {})
						}))
					}
				}),
				{ status: 200 }
			)
		);
	}

	it('returns a class whose sh:NodeShape constrains rdfs:label with sh:minCount >= 1', async () => {
		const fn = mockLabelShapeFetch([{ class: coreEntity, minCount: 1 }]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const classes = await connector.fetchLabelRequiredClasses();
		expect(classes).toEqual([coreEntity]);
	});

	it('excludes a class whose sh:property has no sh:minCount at all', async () => {
		const fn = mockLabelShapeFetch([{ class: other }]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const classes = await connector.fetchLabelRequiredClasses();
		expect(classes).toEqual([]);
	});

	it('excludes a class whose sh:minCount is 0', async () => {
		const fn = mockLabelShapeFetch([{ class: other, minCount: 0 }]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const classes = await connector.fetchLabelRequiredClasses();
		expect(classes).toEqual([]);
	});

	it('queries the shapes graph and targets sh:path rdfs:label specifically', async () => {
		const fn = mockLabelShapeFetch([]);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchLabelRequiredClasses();
		const body = JSON.parse(fn.mock.calls[0][1].body);
		expect(body.query).toContain(`FROM <${DEFAULT_GRAPHS.shapes}>`);
		expect(body.query).toContain('sh:path rdfs:label');
		expect(body.query).toContain('sh:targetClass ?class');
	});

	it('fetchFullSchema surfaces it as labelRequiredClassIris', async () => {
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query ?? '';
			if (q.includes('sh:path rdfs:label')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['class', 'minCount'] },
						results: { bindings: [{ class: { type: 'uri', value: coreEntity }, minCount: { type: 'literal', value: '1' } }] }
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const schema = await connector.fetchFullSchema();
		expect(schema.labelRequiredClassIris).toEqual([coreEntity]);
	});
});

/** Mocks the `SELECT ?s ?p ?o` scan `migrateIndividualNamespaceIris` (STORY-063) issues against
 *  `graphs.instances`, plus recorded update bodies. */
function mockMigrateIndividualFetch(fixture: { legacyBindings?: Array<Record<'s' | 'p' | 'o', SparqlBinding[string]>> } = {}) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('SELECT ?s ?p ?o')) {
			return new Response(
				JSON.stringify({
					head: { vars: ['s', 'p', 'o'] },
					results: { bindings: fixture.legacyBindings ?? [] }
				}),
				{ status: 200 }
			);
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector — migrate mis-minted individual IRIs (STORY-063)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const relationType = classIri('RelationType');
	const legacyIri = `${DEFAULT_GRAPHS.schema}#relationTypeNutzt`;
	const correctIri = `${DEFAULT_NAMESPACE_BASE_IRI}#relationTypeNutzt`;

	function legacyBindingsFor(iri: string) {
		return [
			{
				s: { type: 'uri' as const, value: iri },
				p: { type: 'uri' as const, value: RDF.type },
				o: { type: 'uri' as const, value: relationType }
			},
			{
				s: { type: 'uri' as const, value: iri },
				p: { type: 'uri' as const, value: RDFS.label },
				o: { type: 'literal' as const, value: 'nutzt' }
			}
		];
	}

	it('dry-run reports the affected old->new IRI pairs without issuing any writes', async () => {
		const { fn, updates } = mockMigrateIndividualFetch({ legacyBindings: legacyBindingsFor(legacyIri) });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.migrateIndividualNamespaceIris(DEFAULT_NAMESPACE_BASE_IRI, { dryRun: true });

		expect(result.migrated).toEqual([{ oldIri: legacyIri, newIri: correctIri }]);
		expect(updates).toHaveLength(0);
	});

	it('a real run rewrites the subject IRI within graphs.instances and any inbound object references', async () => {
		const { fn, updates } = mockMigrateIndividualFetch({ legacyBindings: legacyBindingsFor(legacyIri) });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.migrateIndividualNamespaceIris(DEFAULT_NAMESPACE_BASE_IRI, { dryRun: false });

		expect(result.migrated).toEqual([{ oldIri: legacyIri, newIri: correctIri }]);
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`WITH <${DEFAULT_GRAPHS.instances}>`);
		expect(updates[0]).toContain(`DELETE { <${legacyIri}> ?p ?o }`);
		expect(updates[0]).toContain(`INSERT { <${correctIri}> ?p ?o }`);
		expect(updates[1]).toContain(`DELETE { GRAPH ?g { ?s ?p <${legacyIri}> } }`);
		expect(updates[1]).toContain(`INSERT { GRAPH ?g { ?s ?p <${correctIri}> } }`);
	});

	it('does not classify a non-individual (a class/property declaration) as affected', async () => {
		const legacyClassIri = `${DEFAULT_GRAPHS.schema}#SomeClass`;
		const { fn, updates } = mockMigrateIndividualFetch({
			legacyBindings: [
				{
					s: { type: 'uri', value: legacyClassIri },
					p: { type: 'uri', value: RDF.type },
					o: { type: 'uri', value: OWL.Class }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.migrateIndividualNamespaceIris(DEFAULT_NAMESPACE_BASE_IRI, { dryRun: false });

		expect(result.migrated).toEqual([]);
		expect(updates).toHaveLength(0);
	});

	it('is idempotent — reports nothing affected once no subject still starts with the legacy prefix', async () => {
		const { fn } = mockMigrateIndividualFetch({ legacyBindings: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.migrateIndividualNamespaceIris(DEFAULT_NAMESPACE_BASE_IRI, { dryRun: false });

		expect(result.migrated).toEqual([]);
	});
});

/** Stateful fetch mock for STORY-027's namespace CRUD methods: distinguishes the two ASK shapes
 *  (`ensureNamespaceClass`'s `a owl:Class` check vs. `insertNamespace`'s `a <NAMESPACE_CLASS_IRI>`
 *  existence check) the same way `mockGraphFetch` distinguishes class/property/shape ASKs, plus a
 *  `COUNT(*)` handler for `deleteNamespace`'s non-empty check. */
function mockNamespaceFetch(
	fixture: {
		namespaceClassExists?: boolean;
		namespaceExists?: boolean;
		entryCount?: number;
		locked?: boolean;
	} = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('COUNT(*)')) {
			return new Response(
				JSON.stringify({
					head: { vars: ['c'] },
					results: { bindings: [{ c: { type: 'literal', value: String(fixture.entryCount ?? 0) } }] }
				}),
				{ status: 200 }
			);
		}
		if (q.includes('ASK')) {
			if (q.includes(NAMESPACE_LOCKED_PREDICATE_IRI)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.locked ?? false }), {
					status: 200
				});
			}
			if (q.includes('owl:Class')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.namespaceClassExists ?? false }), {
					status: 200
				});
			}
			return new Response(JSON.stringify({ head: {}, boolean: fixture.namespaceExists ?? false }), {
				status: 200
			});
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector — namespace management (STORY-027)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('ensureNamespaceClass creates the marker class only if missing', async () => {
		const { fn, updates } = mockNamespaceFetch({ namespaceClassExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureNamespaceClass();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${NAMESPACE_CLASS_IRI}> a owl:Class`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('ensureNamespaceClass is a no-op when the marker class already exists', async () => {
		const { fn, updates } = mockNamespaceFetch({ namespaceClassExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureNamespaceClass();

		expect(updates).toHaveLength(0);
	});

	it('insertNamespace creates the Namespace/prefix/comment declaration triple', async () => {
		const { fn, updates } = mockNamespaceFetch({ namespaceClassExists: true, namespaceExists: false });
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertNamespace('gov', govBase, 'Governmental entities');

		expect(result.baseIri).toBe(govBase);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> a <${NAMESPACE_CLASS_IRI}>`);
		expect(updates[0]).toContain(`<${NAMESPACE_PREFIX_PREDICATE_IRI}> "gov"`);
		expect(updates[0]).toContain('rdfs:comment "Governmental entities"');
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('insertNamespace includes the color triple when a color is given (STORY-042)', async () => {
		const { fn, updates } = mockNamespaceFetch({ namespaceClassExists: true, namespaceExists: false });
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.insertNamespace('gov', govBase, 'Governmental entities', '#ff0000');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${NAMESPACE_COLOR_PREDICATE_IRI}> "#ff0000"`);
	});

	it('insertNamespace rejects an empty prefix without making any request', async () => {
		const { fn } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertNamespace('   ', 'http://example.org/gov')).rejects.toThrow(
			/must not be empty/
		);
		expect(fn).not.toHaveBeenCalled();
	});

	it('insertNamespace rejects a duplicate base IRI', async () => {
		const { fn } = mockNamespaceFetch({ namespaceClassExists: true, namespaceExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertNamespace('gov', 'http://example.org/gov')).rejects.toThrow(
			/already exists/
		);
	});

	it('fetchNamespaces returns every registered namespace', async () => {
		const govBase = 'http://example.org/gov';
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['ns', 'prefix', 'desc'] },
					results: {
						bindings: [
							{
								ns: { type: 'uri', value: govBase },
								prefix: { type: 'literal', value: 'gov' },
								desc: { type: 'literal', value: 'Governmental entities' }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const namespaces = await connector.fetchNamespaces();

		expect(namespaces).toEqual([
			{
				baseIri: govBase,
				prefix: 'gov',
				description: 'Governmental entities',
				color: null,
				publisher: null,
				license: null,
				locked: false,
				defaultHidden: false,
				listedInFilter: true
			}
		]);
	});

	it('fetchNamespaces round-trips a namespace default color (STORY-042)', async () => {
		const govBase = 'http://example.org/gov';
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['ns', 'prefix', 'desc', 'color'] },
					results: {
						bindings: [
							{
								ns: { type: 'uri', value: govBase },
								prefix: { type: 'literal', value: 'gov' },
								color: { type: 'literal', value: '#ff0000' }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const namespaces = await connector.fetchNamespaces();

		expect(namespaces).toEqual([
			{
				baseIri: govBase,
				prefix: 'gov',
				description: null,
				color: '#ff0000',
				publisher: null,
				license: null,
				locked: false,
				defaultHidden: false,
				listedInFilter: true
			}
		]);
	});

	it('fetchNamespaces round-trips locked/defaultHidden/listedInFilter (STORY-095/096/097)', async () => {
		const govBase = 'http://example.org/gov';
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['ns', 'prefix', 'locked', 'defaultHidden', 'listedInFilter'] },
					results: {
						bindings: [
							{
								ns: { type: 'uri', value: govBase },
								prefix: { type: 'literal', value: 'gov' },
								locked: { type: 'literal', value: 'true' },
								defaultHidden: { type: 'literal', value: 'true' },
								listedInFilter: { type: 'literal', value: 'false' }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const namespaces = await connector.fetchNamespaces();

		expect(namespaces).toEqual([
			{
				baseIri: govBase,
				prefix: 'gov',
				description: null,
				color: null,
				publisher: null,
				license: null,
				locked: true,
				defaultHidden: true,
				listedInFilter: false
			}
		]);
	});

	it('fetchNamespaces defaults defaultHidden to true for DEFAULT_NAMESPACE_BASE_IRI itself when the triple is absent (STORY-096 backward-compat)', async () => {
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['ns', 'prefix'] },
					results: {
						bindings: [
							{
								ns: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI },
								prefix: { type: 'literal', value: 'default' }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const namespaces = await connector.fetchNamespaces();

		expect(namespaces[0].defaultHidden).toBe(true);
	});

	it('fetchFullSchemaForAllNamespaces merges every registered namespace\'s classes, each tagged with its own namespace (STORY-034)', async () => {
		const nsA = 'http://example.org/a';
		const nsB = 'http://example.org/b';
		const graphsA = namespaceGraphs(nsA);
		const graphsB = namespaceGraphs(nsB);

		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const query: string = body.query ?? '';
			if (query.includes('?ns ?prefix ?desc')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns', 'prefix', 'desc'] },
						results: {
							bindings: [
								{ ns: { type: 'uri', value: nsA }, prefix: { type: 'literal', value: 'a' } },
								{ ns: { type: 'uri', value: nsB }, prefix: { type: 'literal', value: 'b' } }
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (query.includes('?c ?label ?comment') && query.includes(graphsA.schema)) {
				return new Response(
					JSON.stringify({
						head: { vars: ['c', 'label', 'comment'] },
						results: { bindings: [{ c: { type: 'uri', value: `${nsA}#Foo` } }] }
					}),
					{ status: 200 }
				);
			}
			if (query.includes('?c ?label ?comment') && query.includes(graphsB.schema)) {
				return new Response(
					JSON.stringify({
						head: { vars: ['c', 'label', 'comment'] },
						results: { bindings: [{ c: { type: 'uri', value: `${nsB}#Bar` } }] }
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const schema = await connector.fetchFullSchemaForAllNamespaces();

		expect(schema.classes).toEqual([
			{ iri: `${nsA}#Foo`, label: 'Foo', comment: null, namespaceBaseIri: nsA },
			{ iri: `${nsB}#Bar`, label: 'Bar', comment: null, namespaceBaseIri: nsB }
		]);
	});

	it('fetchAllQuadsForExport tags each namespace\'s three graphs\' quads with their own graph IRI (STORY-036)', async () => {
		const nsA = 'http://example.org/a';
		const nsB = 'http://example.org/b';
		const graphsA = namespaceGraphs(nsA);
		const graphsB = namespaceGraphs(nsB);

		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const query: string = body.query ?? '';
			if (query.includes('?ns ?prefix ?desc')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns', 'prefix', 'desc'] },
						results: {
							bindings: [
								{ ns: { type: 'uri', value: nsA }, prefix: { type: 'literal', value: 'a' } },
								{ ns: { type: 'uri', value: nsB }, prefix: { type: 'literal', value: 'b' } }
							]
						}
					}),
					{ status: 200 }
				);
			}
			const graphOf = (g: string) => (query.includes(`FROM <${g}>`) ? g : null);
			const match = [
				graphsA.instances,
				graphsA.schema,
				graphsA.shapes,
				graphsB.instances,
				graphsB.schema,
				graphsB.shapes
			]
				.map(graphOf)
				.find((g) => g !== null);
			if (match) {
				return new Response(
					JSON.stringify({
						head: { vars: ['s', 'p', 'o'] },
						results: {
							bindings: [
								{
									s: { type: 'uri', value: `${match}#s` },
									p: { type: 'uri', value: `${match}#p` },
									o: { type: 'uri', value: `${match}#o` }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const quads = await connector.fetchAllQuadsForExport();

		expect(quads).toHaveLength(6);
		for (const graph of [graphsA.instances, graphsA.schema, graphsA.shapes, graphsB.instances, graphsB.schema, graphsB.shapes]) {
			const quad = quads.find((q) => q.subject.value === `${graph}#s`);
			expect(quad?.graph.value).toBe(graph);
		}
	});

	it('updateNamespaceDescription replaces rdfs:comment', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceDescription(govBase, 'Updated description');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> rdfs:comment "Updated description"`);
	});

	it('updateNamespaceColor sets the color predicate (STORY-042)', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceColor(govBase, '#00ff00');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> <${NAMESPACE_COLOR_PREDICATE_IRI}> "#00ff00"`);
	});

	it('updateNamespaceColor with null removes the color predicate', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceColor(govBase, null);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`DELETE WHERE`);
		expect(updates[0]).toContain(`<${govBase}> <${NAMESPACE_COLOR_PREDICATE_IRI}> ?old`);
	});

	it('updateNamespacePublisher sets dct:publisher as a plain literal (data-catalog Story 011)', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespacePublisher(govBase, 'Governmental Authority');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> <${DCT.publisher}> "Governmental Authority"`);
	});

	it('updateNamespacePublisher with null removes the publisher predicate', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespacePublisher(govBase, null);

		expect(updates).toEqual([
			expect.stringContaining(`DELETE WHERE { ${inGraph(`<${govBase}> <${DCT.publisher}> ?old`, DEFAULT_GRAPHS.schema)} }`)
		]);
	});

	it('updateNamespaceLicense sets dct:license as an IRI (data-catalog Story 011)', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceLicense(govBase, 'https://example.com/license/gov-v1');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> <${DCT.license}> <https://example.com/license/gov-v1>`);
	});

	it('updateNamespaceLicense with null removes the license predicate', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceLicense(govBase, null);

		expect(updates).toEqual([
			expect.stringContaining(`DELETE WHERE { ${inGraph(`<${govBase}> <${DCT.license}> ?old`, DEFAULT_GRAPHS.schema)} }`)
		]);
	});

	it('updateNamespaceLocked sets the locked flag (STORY-095)', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceLocked(govBase, true);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> <${NAMESPACE_LOCKED_PREDICATE_IRI}> true`);
	});

	it('updateNamespaceLocked(false) clears the locked flag rather than removing the triple entirely', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceLocked(govBase, false);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> <${NAMESPACE_LOCKED_PREDICATE_IRI}> false`);
	});

	it('updateNamespaceDefaultHidden sets the defaultHidden flag (STORY-096)', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceDefaultHidden(govBase, true);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> <${NAMESPACE_DEFAULT_HIDDEN_PREDICATE_IRI}> true`);
	});

	it('updateNamespaceListedInFilter sets the listedInFilter flag (STORY-097)', async () => {
		const { fn, updates } = mockNamespaceFetch();
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNamespaceListedInFilter(govBase, false);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${govBase}> <${NAMESPACE_LISTED_IN_FILTER_PREDICATE_IRI}> false`);
	});

	it('deleteNamespace without force is refused with the entry count when non-empty', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 5 });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteNamespace('http://example.org/gov');

		expect(result).toEqual({ deleted: false, entryCount: 5 });
		expect(updates).toHaveLength(0);
	});

	it('deleteNamespace refuses unconditionally when locked, even with zero triples (STORY-095)', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 0, locked: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteNamespace('http://example.org/gov');

		expect(result).toEqual({ deleted: false, entryCount: 0, locked: true });
		expect(updates).toHaveLength(0);
	});

	it('deleteNamespace({force: true}) still refuses when locked — force never overrides locked (STORY-095)', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 5, locked: true });
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteNamespace(govBase, { force: true });

		expect(result).toEqual({ deleted: false, entryCount: 0, locked: true });
		expect(updates).toHaveLength(0);
	});

	it('deleteNamespace with force:true drops all three graphs and the declaration triple', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 5 });
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const graphs = namespaceGraphs(govBase);
		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteNamespace(govBase, { force: true });

		expect(result).toEqual({ deleted: true, entryCount: 0 });
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`DROP GRAPH <${graphs.instances}>`);
		expect(updates[0]).toContain(`DROP GRAPH <${graphs.schema}>`);
		expect(updates[0]).toContain(`DROP GRAPH <${graphs.shapes}>`);
		expect(updates[1]).toContain(`<${govBase}> ?p ?o`);
	});

	it('deleteNamespace succeeds directly when already empty (no force needed)', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 0 });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteNamespace('http://example.org/gov');

		expect(result).toEqual({ deleted: true, entryCount: 0 });
		expect(updates).toHaveLength(1); // just the declaration-triple delete, no DROP GRAPH needed
	});
});

/** Stateful fetch mock for STORY-072/073's Workspace/WorkspaceMembership CRUD methods:
 *  distinguishes the four ASK shapes (`ensureWorkspaceClass`'s and
 *  `ensureWorkspaceMembershipClass`'s `<X> a owl:Class` marker checks vs. `insertWorkspace`'s and
 *  `addWorkspaceMember`'s `<iri> a <X_CLASS_IRI>` existence checks) the same way `mockNamespaceFetch`
 *  distinguishes its two ASK shapes. */
function mockWorkspaceFetch(
	fixture: {
		workspaceClassExists?: boolean;
		membershipClassExists?: boolean;
		workspaceExists?: boolean;
		membershipExists?: boolean;
	} = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('ASK')) {
			if (q.includes(`<${WORKSPACE_CLASS_IRI}> a owl:Class`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.workspaceClassExists ?? false }), {
					status: 200
				});
			}
			if (q.includes(`<${WORKSPACE_MEMBERSHIP_CLASS_IRI}> a owl:Class`)) {
				return new Response(
					JSON.stringify({ head: {}, boolean: fixture.membershipClassExists ?? false }),
					{ status: 200 }
				);
			}
			if (q.includes(`a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.membershipExists ?? false }), {
					status: 200
				});
			}
			if (q.includes(`a <${WORKSPACE_CLASS_IRI}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.workspaceExists ?? false }), {
					status: 200
				});
			}
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector — Workspace CRUD (STORY-072)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('ensureWorkspaceClass creates the marker class only if missing', async () => {
		const { fn, updates } = mockWorkspaceFetch({ workspaceClassExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureWorkspaceClass();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${WORKSPACE_CLASS_IRI}> a owl:Class`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('ensureWorkspaceClass is a no-op when the marker class already exists', async () => {
		const { fn, updates } = mockWorkspaceFetch({ workspaceClassExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureWorkspaceClass();

		expect(updates).toHaveLength(0);
	});

	it('insertWorkspace mints via workspaceIri(name) and creates the declaration triple', async () => {
		const { fn, updates } = mockWorkspaceFetch({ workspaceClassExists: true, workspaceExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const iri = await connector.insertWorkspace('Project Overview');

		expect(iri).toBe(workspaceIri('Project Overview'));
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${iri}> a <${WORKSPACE_CLASS_IRI}>`);
		expect(updates[0]).toContain('rdfs:label "Project Overview"');
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('insertWorkspace stores the optional default-namespace triple', async () => {
		const { fn, updates } = mockWorkspaceFetch({ workspaceClassExists: true, workspaceExists: false });
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.insertWorkspace('Project Overview', govBase);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> <${govBase}>`);
	});

	it('insertWorkspace rejects an empty name without making any request', async () => {
		const { fn } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertWorkspace('   ')).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('insertWorkspace rejects a duplicate name', async () => {
		const { fn } = mockWorkspaceFetch({ workspaceClassExists: true, workspaceExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertWorkspace('Project Overview')).rejects.toThrow(/already exists/);
	});

	it('ensureWorkspace inserts the declaration when the given IRI does not yet exist (STORY-091)', async () => {
		const { fn, updates } = mockWorkspaceFetch({ workspaceClassExists: true, workspaceExists: false });
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureWorkspace(ws, 'Project Overview');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${ws}> a <${WORKSPACE_CLASS_IRI}>`);
		expect(updates[0]).toContain('rdfs:label "Project Overview"');
	});

	it('ensureWorkspace is a no-op, without error, when the given IRI already exists (STORY-091)', async () => {
		const { fn, updates } = mockWorkspaceFetch({ workspaceClassExists: true, workspaceExists: true });
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.ensureWorkspace(ws, 'Some Other Label')).resolves.toBeUndefined();

		expect(updates).toHaveLength(0);
	});

	it('fetchWorkspaces returns every registered workspace with its label and default namespace', async () => {
		const ws = workspaceIri('Project Overview');
		const govBase = 'http://example.org/gov';
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['ws', 'label', 'defaultNs'] },
					results: {
						bindings: [
							{
								ws: { type: 'uri', value: ws },
								label: { type: 'literal', value: 'Project Overview' },
								defaultNs: { type: 'uri', value: govBase }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const workspaces = await connector.fetchWorkspaces();

		expect(workspaces).toEqual([{ iri: ws, label: 'Project Overview', defaultNamespaceBaseIri: govBase }]);
	});

	it('fetchWorkspaces defaults an unset default namespace to null', async () => {
		const ws = workspaceIri('Default');
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['ws', 'label'] },
					results: {
						bindings: [{ ws: { type: 'uri', value: ws }, label: { type: 'literal', value: 'Default' } }]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const workspaces = await connector.fetchWorkspaces();

		expect(workspaces).toEqual([{ iri: ws, label: 'Default', defaultNamespaceBaseIri: null }]);
	});

	it('renameWorkspace updates only rdfs:label — the workspace IRI is unchanged', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const connector = new SparqlConnector('/api/sparql');
		await connector.renameWorkspace(ws, 'Project Roadmap');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${ws}> rdfs:label "Project Roadmap"`);
		expect(updates[0]).not.toContain(workspaceIri('Project Roadmap'));
	});

	it('updateWorkspaceDefaultNamespace sets the default-namespace predicate', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateWorkspaceDefaultNamespace(ws, govBase);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${ws}> <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> <${govBase}>`);
	});

	it('updateWorkspaceDefaultNamespace with null removes the default-namespace predicate', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateWorkspaceDefaultNamespace(ws, null);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE WHERE');
		expect(updates[0]).toContain(`<${ws}> <${WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI}> ?old`);
	});

	it('deleteWorkspace removes the workspace\'s own triples and every membership row referencing it', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteWorkspace(ws);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`?m <${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${ws}>`);
		expect(updates[0]).toContain(`<${ws}> ?p ?o`);
	});

	it('deleteWorkspace also deletes every Note belonging to it (STORY-083) — outright, not just unlinked', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteWorkspace(ws);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`?n <${NOTE_WORKSPACE_PREDICATE_IRI}> <${ws}> . ?n ?p ?o`);
	});
});

/** Stateful fetch mock for STORY-087's SavedQuery CRUD methods: distinguishes
 *  `ensureSavedQueryClass`'s `<X> a owl:Class` marker check from `insertSavedQuery`'s
 *  `<iri> a <SAVED_QUERY_CLASS_IRI>` existence check, mirroring `mockWorkspaceFetch`. */
function mockSavedQueryFetch(
	fixture: {
		savedQueryClassExists?: boolean;
		savedQueryExists?: boolean;
	} = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('ASK')) {
			if (q.includes(`<${SAVED_QUERY_CLASS_IRI}> a owl:Class`)) {
				return new Response(
					JSON.stringify({ head: {}, boolean: fixture.savedQueryClassExists ?? false }),
					{ status: 200 }
				);
			}
			if (q.includes(`a <${SAVED_QUERY_CLASS_IRI}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.savedQueryExists ?? false }), {
					status: 200
				});
			}
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector — SavedQuery CRUD (STORY-087)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('ensureSavedQueryClass creates the marker class only if missing', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureSavedQueryClass();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${SAVED_QUERY_CLASS_IRI}> a owl:Class`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('ensureSavedQueryClass is a no-op when the marker class already exists', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureSavedQueryClass();

		expect(updates).toHaveLength(0);
	});

	it('insertSavedQuery mints via savedQueryIri(name) and creates the declaration triple', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: true, savedQueryExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const iri = await connector.insertSavedQuery(
			'Undocumented Classes',
			'SELECT ?class WHERE { ?class a owl:Class }',
			'finds gaps'
		);

		expect(iri).toBe(savedQueryIri('Undocumented Classes'));
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${iri}> a <${SAVED_QUERY_CLASS_IRI}>`);
		expect(updates[0]).toContain('rdfs:label "Undocumented Classes"');
		expect(updates[0]).toContain(
			`<${SAVED_QUERY_TEXT_PREDICATE_IRI}> "SELECT ?class WHERE { ?class a owl:Class }"`
		);
		expect(updates[0]).toContain('rdfs:comment "finds gaps"');
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('insertSavedQuery escapes the embedded newlines of a multi-line sparqlText instead of breaking the literal', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: true, savedQueryExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const sparqlText = 'SELECT ?type WHERE {\n  <urn:instance> a ?type .\n}';
		await connector.insertSavedQuery('Get Instance Type', sparqlText, 'finds the type of the given instance');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`<${SAVED_QUERY_TEXT_PREDICATE_IRI}> "SELECT ?type WHERE {\\n  <urn:instance> a ?type .\\n}"`
		);
		// No raw newline byte reaches the request body inside the string literal — only `\n`.
		expect(updates[0]).not.toMatch(/"SELECT \?type WHERE \{\n/);
	});

	it('insertSavedQuery omits rdfs:comment when no description is given', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: true, savedQueryExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.insertSavedQuery('Undocumented Classes', 'SELECT ?class WHERE { ?class a owl:Class }');

		expect(updates[0]).not.toContain('rdfs:comment');
	});

	it('insertSavedQuery rejects an empty name without making any request', async () => {
		const { fn } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertSavedQuery('   ', 'SELECT * WHERE { ?s ?p ?o }')).rejects.toThrow(
			/must not be empty/
		);
		expect(fn).not.toHaveBeenCalled();
	});

	it('insertSavedQuery rejects empty sparqlText without making any request', async () => {
		const { fn } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertSavedQuery('Undocumented Classes', '   ')).rejects.toThrow(
			/must not be empty/
		);
		expect(fn).not.toHaveBeenCalled();
	});

	it('insertSavedQuery rejects a duplicate name', async () => {
		const { fn } = mockSavedQueryFetch({ savedQueryClassExists: true, savedQueryExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertSavedQuery('Undocumented Classes', 'SELECT * WHERE { ?s ?p ?o }')
		).rejects.toThrow(/already exists/);
	});

	it('fetchSavedQueries returns every registered saved query with label, text, and description', async () => {
		const sq = savedQueryIri('Undocumented Classes');
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['sq', 'label', 'text', 'description'] },
					results: {
						bindings: [
							{
								sq: { type: 'uri', value: sq },
								label: { type: 'literal', value: 'Undocumented Classes' },
								text: { type: 'literal', value: 'SELECT ?class WHERE { ?class a owl:Class }' },
								description: { type: 'literal', value: 'finds gaps' }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const savedQueries = await connector.fetchSavedQueries();

		expect(savedQueries).toEqual([
			{
				iri: sq,
				label: 'Undocumented Classes',
				sparqlText: 'SELECT ?class WHERE { ?class a owl:Class }',
				description: 'finds gaps',
				published: false
			}
		]);
	});

	it('fetchSavedQueries defaults missing optional fields to empty strings', async () => {
		const sq = savedQueryIri('Undocumented Classes');
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['sq'] },
					results: { bindings: [{ sq: { type: 'uri', value: sq } }] }
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const savedQueries = await connector.fetchSavedQueries();

		expect(savedQueries).toEqual([{ iri: sq, label: '', sparqlText: '', description: '', published: false }]);
	});

	it('renameSavedQuery updates only rdfs:label — the saved query IRI is unchanged', async () => {
		const { fn, updates } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const sq = savedQueryIri('Undocumented Classes');
		const connector = new SparqlConnector('/api/sparql');
		await connector.renameSavedQuery(sq, 'Classes Missing Comments');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${sq}> rdfs:label "Classes Missing Comments"`);
		expect(updates[0]).not.toContain(savedQueryIri('Classes Missing Comments'));
	});

	it('updateSavedQueryText replaces the sparqlText triple', async () => {
		const { fn, updates } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const sq = savedQueryIri('Undocumented Classes');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateSavedQueryText(sq, 'SELECT ?x WHERE { ?x a owl:Class }');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`<${sq}> <${SAVED_QUERY_TEXT_PREDICATE_IRI}> "SELECT ?x WHERE { ?x a owl:Class }"`
		);
	});

	it('updateSavedQueryText rejects an empty string rather than clearing the query to blank', async () => {
		const { fn } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const sq = savedQueryIri('Undocumented Classes');
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.updateSavedQueryText(sq, '   ')).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('updateSavedQueryDescription sets the rdfs:comment triple', async () => {
		const { fn, updates } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const sq = savedQueryIri('Undocumented Classes');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateSavedQueryDescription(sq, 'finds gaps');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${sq}> rdfs:comment "finds gaps"`);
	});

	it('updateSavedQueryDescription with null removes the rdfs:comment triple', async () => {
		const { fn, updates } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const sq = savedQueryIri('Undocumented Classes');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateSavedQueryDescription(sq, null);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE WHERE');
		expect(updates[0]).toContain(`<${sq}> rdfs:comment ?old`);
	});

	it('deleteSavedQuery removes every triple with that subject', async () => {
		const { fn, updates } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);

		const sq = savedQueryIri('Undocumented Classes');
		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteSavedQuery(sq);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${sq}> ?p ?o`);
		expect(updates[0]).toContain('DELETE WHERE');
	});
});

describe('SparqlConnector — WorkspaceMembership CRUD and position storage (STORY-073)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('ensureWorkspaceMembershipClass creates the marker class only if missing', async () => {
		const { fn, updates } = mockWorkspaceFetch({ membershipClassExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureWorkspaceMembershipClass();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_CLASS_IRI}> a owl:Class`);
	});

	it('ensureWorkspaceMembershipClass is a no-op when the marker class already exists', async () => {
		const { fn, updates } = mockWorkspaceFetch({ membershipClassExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureWorkspaceMembershipClass();

		expect(updates).toHaveLength(0);
	});

	it('fetchWorkspaceMembers returns only the rows for the given workspace, with numeric x/y', async () => {
		const ws = workspaceIri('Project Overview');
		const elementIri = `${SCHEMA_NAMESPACE}Application`;
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['element', 'x', 'y'] },
					results: {
						bindings: [
							{
								element: { type: 'uri', value: elementIri },
								x: { type: 'literal', value: '120.5', datatype: 'http://www.w3.org/2001/XMLSchema#decimal' },
								y: { type: 'literal', value: '40', datatype: 'http://www.w3.org/2001/XMLSchema#decimal' }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const members = await connector.fetchWorkspaceMembers(ws);

		expect(members).toEqual([{ elementIri, x: 120.5, y: 40 }]);
	});

	it('addWorkspaceMember mints via workspaceMembershipIri and links the element at (x, y)', async () => {
		const { fn, updates } = mockWorkspaceFetch({ membershipClassExists: true, membershipExists: false });
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const elementIri = `${SCHEMA_NAMESPACE}Application`;
		const connector = new SparqlConnector('/api/sparql');
		await connector.addWorkspaceMember(ws, elementIri, 120.5, 40);

		const membershipIri = workspaceMembershipIri(ws, elementIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${membershipIri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${ws}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "120.5"^^xsd:decimal`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "40"^^xsd:decimal`);
	});

	it('addWorkspaceMember is idempotent — a no-op when the membership already exists', async () => {
		const { fn, updates } = mockWorkspaceFetch({ membershipClassExists: true, membershipExists: true });
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const elementIri = `${SCHEMA_NAMESPACE}Application`;
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.addWorkspaceMember(ws, elementIri, 0, 0)).resolves.toBeUndefined();

		expect(updates).toHaveLength(0);
	});

	it('removeWorkspaceMember deletes exactly the one membership subject\'s triples', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const elementIri = `${SCHEMA_NAMESPACE}Application`;
		const connector = new SparqlConnector('/api/sparql');
		await connector.removeWorkspaceMember(ws, elementIri);

		const membershipIri = workspaceMembershipIri(ws, elementIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE WHERE');
		expect(updates[0]).toContain(`<${membershipIri}> ?p ?o`);
	});

	it('updateWorkspaceMemberPosition round-trips a non-integer position as xsd:decimal', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const elementIri = `${SCHEMA_NAMESPACE}Application`;
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateWorkspaceMemberPosition(ws, elementIri, 88.25, 12.75);

		const membershipIri = workspaceMembershipIri(ws, elementIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "88.25"^^xsd:decimal`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "12.75"^^xsd:decimal`);
		// Re-asserts the full row (type + workspace + element link), not just x/y — an external
		// vocabulary stub can be dragged without ever going through `addWorkspaceMember`, so this
		// must upsert the whole membership row or the position is unrecoverable by
		// `fetchWorkspaceMembers` (which requires all five triples) after a reload.
		expect(updates[0]).toContain(`<${membershipIri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${ws}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}>`);
	});

	it('updateWorkspaceMemberPosition persists a position for an element that never had addWorkspaceMember called (e.g. an external class stub)', async () => {
		const { fn, updates } = mockWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const ws = workspaceIri('Project Overview');
		const elementIri = 'http://xmlns.com/foaf/0.1/Person';
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateWorkspaceMemberPosition(ws, elementIri, 300, 150);

		const membershipIri = workspaceMembershipIri(ws, elementIri);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${membershipIri}> a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${ws}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${elementIri}>`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "300"^^xsd:decimal`);
		expect(updates[0]).toContain(`<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "150"^^xsd:decimal`);
	});
});

describe('SparqlConnector — Add Element typeahead (STORY-080)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('fetchAddableWorkspaceElements narrows fetchNameableEntities to classes and individuals only', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchNameableEntities').mockResolvedValue([
			{ iri: 'urn:C', label: 'C', kind: 'class' },
			{ iri: 'urn:A', label: 'C.A', kind: 'attribute' },
			{ iri: 'urn:R', label: 'R', kind: 'relation' },
			{ iri: 'urn:I', label: 'I', kind: 'individual' },
			{ iri: 'urn:S', label: 'S', kind: 'relationInstance' }
		]);

		const result = await connector.fetchAddableWorkspaceElements();

		expect(result).toEqual([
			{ iri: 'urn:C', label: 'C', kind: 'class' },
			{ iri: 'urn:I', label: 'I', kind: 'individual' }
		]);
	});
});

describe('SparqlConnector — WorkspaceMembership cascade cleanup on delete (STORY-081)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('deleteClass also cleans up WorkspaceMembership rows for the class and its individuals, before deleting the class itself', async () => {
		const iri = classIri('Person');
		const { fn, updates } = mockGraphFetch({ externalReferences: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteClass(iri);

		expect(result.deleted).toBe(true);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`BIND(<${iri}> AS ?el)`);
		expect(updates[0]).toContain(`?el a <${iri}>`);
		expect(updates[0]).toContain(`?m <${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?el`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);

		// The cascade cleanup must precede the class's own triple delete (it depends on `<iri> a
		// owl:Class`/`?el a <iri>` still being present at that point in the update).
		const cleanupIndex = updates[0].indexOf('BIND(');
		const classDeleteIndex = updates[0].indexOf(`<${iri}> ?p ?o`);
		expect(cleanupIndex).toBeGreaterThanOrEqual(0);
		expect(cleanupIndex).toBeLessThan(classDeleteIndex);
	});

	it('deleteIndividual also cleans up every WorkspaceMembership row referencing it', async () => {
		const relationType = classIri('RelationType');
		const iri = individualIri(relationType, 'nutzt');
		const { fn, updates } = mockIndividualFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteIndividual(iri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`?m <${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${iri}> ; ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});

	it('deleteNamespace with force:true also cleans up WorkspaceMembership rows for every class/individual it removes', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 5 });
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const graphs = namespaceGraphs(govBase);
		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteNamespace(govBase, { force: true });

		expect(result).toEqual({ deleted: true, entryCount: 0 });
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`?m <${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> ?el`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
		expect(updates[0]).toContain(`DROP GRAPH <${graphs.instances}>`);
		expect(updates[0]).toContain(`DROP GRAPH <${graphs.schema}>`);
		expect(updates[0]).toContain(`DROP GRAPH <${graphs.shapes}>`);
		expect(updates[1]).toContain(`<${govBase}> ?p ?o`);
	});

	it('deleteNamespace when already empty attempts no WorkspaceMembership cleanup (nothing could reference it)', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 0 });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteNamespace('http://example.org/gov');

		expect(updates).toHaveLength(1);
		expect(updates[0]).not.toContain(WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI);
	});

	// STORY-083: a parallel cascade, but an *unlink* (not a delete) — every Note's `noteLinkedElement`
	// pointing at the removed class/individual is cleared, leaving the Note itself untouched.

	it('deleteClass also unlinks (not deletes) every Note pointing at the class or its individuals', async () => {
		const iri = classIri('Person');
		const { fn, updates } = mockGraphFetch({ externalReferences: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteClass(iri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?el`);

		// Must precede the class's own triple delete, same reasoning as the WorkspaceMembership cascade.
		const cleanupIndex = updates[0].indexOf(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?el`);
		const classDeleteIndex = updates[0].indexOf(`<${iri}> ?p ?o`);
		expect(cleanupIndex).toBeGreaterThanOrEqual(0);
		expect(cleanupIndex).toBeLessThan(classDeleteIndex);
	});

	it('deleteIndividual also unlinks (not deletes) every Note pointing at it', async () => {
		const relationType = classIri('RelationType');
		const iri = individualIri(relationType, 'nutzt');
		const { fn, updates } = mockIndividualFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteIndividual(iri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${iri}> .`, DEFAULT_GRAPHS.schema)} }`
		);
	});

	it('deleteNamespace with force:true also unlinks (not deletes) every Note pointing at a removed class/individual', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 5 });
		vi.stubGlobal('fetch', fn);

		const govBase = 'http://example.org/gov';
		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteNamespace(govBase, { force: true });

		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`?n <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?el`);
	});
});

/** Stateful fetch mock for STORY-083's Note CRUD methods: distinguishes `ensureNoteClass`'s
 *  `<NOTE_CLASS_IRI> a owl:Class` marker check the same way `mockWorkspaceFetch` distinguishes its
 *  own ASK shapes. Plain Note methods issue no other `ASK` (unlike `insertWorkspace`/
 *  `addWorkspaceMember` — a Note's IRI is timestamp-unique by construction, no "already exists"
 *  guard needed) — `noteExists` (STORY-091) is only consulted by `ensureNoteAtIri`'s own
 *  caller-given-IRI exists-guard, distinguished from the marker check by its `a <NOTE_CLASS_IRI>`
 *  (not `<NOTE_CLASS_IRI> a owl:Class`) shape. */
function mockNoteFetch(fixture: { noteClassExists?: boolean; noteExists?: boolean } = {}) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('ASK')) {
			if (q.includes(`<${NOTE_CLASS_IRI}> a owl:Class`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.noteClassExists ?? false }), {
					status: 200
				});
			}
			if (q.includes(`a <${NOTE_CLASS_IRI}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.noteExists ?? false }), {
					status: 200
				});
			}
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector — Note (sticky note) CRUD (STORY-083)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const ws = workspaceIri('Project Overview');

	it('ensureNoteClass creates the marker class only if missing', async () => {
		const { fn, updates } = mockNoteFetch({ noteClassExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureNoteClass();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${NOTE_CLASS_IRI}> a owl:Class`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('ensureNoteClass is a no-op when the marker class already exists', async () => {
		const { fn, updates } = mockNoteFetch({ noteClassExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureNoteClass();

		expect(updates).toHaveLength(0);
	});

	it('fetchNotesForWorkspace returns every Note row for the given workspace, with numeric x/y', async () => {
		const noteIriValue = noteIri(ws, '1700000000000');
		const linkedIri = `${SCHEMA_NAMESPACE}Application`;
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['n', 'text', 'color', 'x', 'y', 'linked'] },
					results: {
						bindings: [
							{
								n: { type: 'uri', value: noteIriValue },
								text: { type: 'literal', value: 'Reminder' },
								color: { type: 'literal', value: '#fff9b1' },
								x: { type: 'literal', value: '120.5', datatype: 'http://www.w3.org/2001/XMLSchema#decimal' },
								y: { type: 'literal', value: '40', datatype: 'http://www.w3.org/2001/XMLSchema#decimal' },
								linked: { type: 'uri', value: linkedIri }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const notes = await connector.fetchNotesForWorkspace(ws);

		expect(notes).toEqual([
			{ iri: noteIriValue, text: 'Reminder', color: '#fff9b1', x: 120.5, y: 40, linkedElementIri: linkedIri }
		]);
	});

	it('fetchNotesForWorkspace defaults an unset text/linked element to "" / null', async () => {
		const noteIriValue = noteIri(ws, '1700000000000');
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['n', 'color', 'x', 'y'] },
					results: {
						bindings: [
							{
								n: { type: 'uri', value: noteIriValue },
								color: { type: 'literal', value: '#fff9b1' },
								x: { type: 'literal', value: '0' },
								y: { type: 'literal', value: '0' }
							}
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const notes = await connector.fetchNotesForWorkspace(ws);

		expect(notes).toEqual([{ iri: noteIriValue, text: '', color: '#fff9b1', x: 0, y: 0, linkedElementIri: null }]);
	});

	it('insertNote mints via noteIri(workspaceIri, timestamp) and writes the required triples', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
		const { fn, updates } = mockNoteFetch({ noteClassExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const { iri } = await connector.insertNote(ws, 10, 20, '#fff9b1');

		expect(iri).toBe(noteIri(ws, '1700000000000'));
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${iri}> a <${NOTE_CLASS_IRI}>`);
		expect(updates[0]).toContain(`<${NOTE_WORKSPACE_PREDICATE_IRI}> <${ws}>`);
		expect(updates[0]).toContain(`<${NOTE_COLOR_PREDICATE_IRI}> "#fff9b1"`);
		expect(updates[0]).toContain(`<${NOTE_X_PREDICATE_IRI}> "10"^^xsd:decimal`);
		expect(updates[0]).toContain(`<${NOTE_Y_PREDICATE_IRI}> "20"^^xsd:decimal`);
		// No text/link passed — those two optional triples are omitted entirely, not stored empty.
		expect(updates[0]).not.toContain(NOTE_TEXT_PREDICATE_IRI);
		expect(updates[0]).not.toContain(NOTE_LINKED_ELEMENT_PREDICATE_IRI);
	});

	it('insertNote writes the optional text/linked-element triples when provided', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
		const { fn, updates } = mockNoteFetch({ noteClassExists: true });
		vi.stubGlobal('fetch', fn);

		const linkedIri = `${SCHEMA_NAMESPACE}Application`;
		const connector = new SparqlConnector('/api/sparql');
		await connector.insertNote(ws, 10, 20, '#fff9b1', 'Reminder', linkedIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${NOTE_TEXT_PREDICATE_IRI}> "Reminder"`);
		expect(updates[0]).toContain(`<${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${linkedIri}>`);
	});

	it('ensureNoteAtIri inserts at the given IRI when it does not yet exist (STORY-091)', async () => {
		const { fn, updates } = mockNoteFetch({ noteClassExists: true, noteExists: false });
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureNoteAtIri(noteIriValue, ws, 10, 20, '#fff9b1', 'Reminder');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${noteIriValue}> a <${NOTE_CLASS_IRI}>`);
		expect(updates[0]).toContain(`<${NOTE_COLOR_PREDICATE_IRI}> "#fff9b1"`);
		expect(updates[0]).toContain(`<${NOTE_TEXT_PREDICATE_IRI}> "Reminder"`);
	});

	it('ensureNoteAtIri is a no-op, without error, when that exact IRI already exists (STORY-091)', async () => {
		const { fn, updates } = mockNoteFetch({ noteClassExists: true, noteExists: true });
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.ensureNoteAtIri(noteIriValue, ws, 10, 20, '#fff9b1', 'Reminder')
		).resolves.toBeUndefined();

		expect(updates).toHaveLength(0);
	});

	it('updateNoteText sets the text triple', async () => {
		const { fn, updates } = mockNoteFetch();
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNoteText(noteIriValue, 'Updated text');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${noteIriValue}> <${NOTE_TEXT_PREDICATE_IRI}> "Updated text"`);
	});

	it('updateNoteText with empty/blank text removes the triple rather than storing ""', async () => {
		const { fn, updates } = mockNoteFetch();
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNoteText(noteIriValue, '   ');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE WHERE');
		expect(updates[0]).toContain(`<${noteIriValue}> <${NOTE_TEXT_PREDICATE_IRI}> ?old`);
	});

	it('updateNoteColor replaces the color triple', async () => {
		const { fn, updates } = mockNoteFetch();
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNoteColor(noteIriValue, '#d5f4e6');

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${noteIriValue}> <${NOTE_COLOR_PREDICATE_IRI}> "#d5f4e6"`);
	});

	it('updateNotePosition round-trips a non-integer position as xsd:decimal, without touching other triples', async () => {
		const { fn, updates } = mockNoteFetch();
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNotePosition(noteIriValue, 88.25, 12.75);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${noteIriValue}> <${NOTE_X_PREDICATE_IRI}> "88.25"^^xsd:decimal`);
		expect(updates[0]).toContain(`<${NOTE_Y_PREDICATE_IRI}> "12.75"^^xsd:decimal`);
		expect(updates[0]).not.toContain(NOTE_WORKSPACE_PREDICATE_IRI);
		expect(updates[0]).not.toContain(NOTE_COLOR_PREDICATE_IRI);
	});

	it('updateNoteLinkedElement sets the link triple', async () => {
		const { fn, updates } = mockNoteFetch();
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const linkedIri = `${SCHEMA_NAMESPACE}Application`;
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNoteLinkedElement(noteIriValue, linkedIri);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${noteIriValue}> <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> <${linkedIri}>`);
	});

	it('updateNoteLinkedElement with null removes the link triple without deleting the note', async () => {
		const { fn, updates } = mockNoteFetch();
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await connector.updateNoteLinkedElement(noteIriValue, null);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE WHERE');
		expect(updates[0]).toContain(`<${noteIriValue}> <${NOTE_LINKED_ELEMENT_PREDICATE_IRI}> ?old`);
	});

	it('deleteNote deletes exactly that Note subject\'s triples', async () => {
		const { fn, updates } = mockNoteFetch();
		vi.stubGlobal('fetch', fn);

		const noteIriValue = noteIri(ws, '1700000000000');
		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteNote(noteIriValue);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('DELETE WHERE');
		expect(updates[0]).toContain(`<${noteIriValue}> ?p ?o`);
	});
});

describe('SparqlConnector — Workspace-scoped Triples export (STORY-082)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it("fetchScopedTurtleForWorkspace unions every member's own scope, grouped by owning namespace, and skips a stale membership row", async () => {
		const classIriValue = classIri('Person');
		const otherNs = 'http://example.org/gov';
		const otherGraphs = namespaceGraphs(otherNs);
		const individualIriValue = `${otherGraphs.instances}#SomeIndividual`;
		const someClassInOtherNs = `${otherGraphs.schema}#SomeClass`;

		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchWorkspaceMembers').mockResolvedValue([
			{ elementIri: classIriValue, x: 0, y: 0 },
			{ elementIri: individualIriValue, x: 10, y: 10 },
			{ elementIri: 'urn:stale-deleted-element', x: 0, y: 0 }
		]);
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			classes: [{ iri: classIriValue, label: 'Person', comment: null, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }],
			datatypeProperties: [],
			objectProperties: [],
			subClassOf: [],
			individuals: [
				{
					iri: individualIriValue,
					label: 'SomeIndividual',
					classIri: someClassInOtherNs,
					namespaceBaseIri: otherNs,
					syncSource: null,
					syncStatus: null
				}
			],
			individualClassRelations: [],
			individualIndividualRelations: []
		});
		vi.spyOn(connector, 'fetchNamespaces').mockResolvedValue([]);
		vi.spyOn(connector, 'fetchExternalVocabularies').mockResolvedValue([]);

		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query ?? '';
			if (q.includes(`FROM <${DEFAULT_GRAPHS.instances}>`)) {
				return new Response(
					JSON.stringify({
						head: { vars: ['s', 'p', 'o'] },
						results: {
							bindings: [
								{
									s: { type: 'uri', value: classIriValue },
									p: { type: 'uri', value: RDF.type },
									o: { type: 'uri', value: OWL.Class }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (q.includes(`FROM <${otherGraphs.instances}>`)) {
				return new Response(
					JSON.stringify({
						head: { vars: ['s', 'p', 'o'] },
						results: {
							bindings: [
								{
									s: { type: 'uri', value: individualIriValue },
									p: { type: 'uri', value: RDF.type },
									o: { type: 'uri', value: someClassInOtherNs }
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const result = await connector.fetchScopedTurtleForWorkspace(workspaceIri('Project Overview'));

		expect(result.schema).toContain('Person');
		expect(result.schema).toContain('SomeIndividual');
	});

	it('fetchScopedTurtleForWorkspace returns empty text for a Workspace with no members', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchWorkspaceMembers').mockResolvedValue([]);
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			classes: [],
			datatypeProperties: [],
			objectProperties: [],
			subClassOf: [],
			individuals: [],
			individualClassRelations: [],
			individualIndividualRelations: []
		});
		vi.spyOn(connector, 'fetchNamespaces').mockResolvedValue([]);
		vi.spyOn(connector, 'fetchExternalVocabularies').mockResolvedValue([]);
		const fetchWholeGraphQuadsSpy = vi.spyOn(connector, 'fetchWholeGraphQuads');

		const result = await connector.fetchScopedTurtleForWorkspace(workspaceIri('Empty Workspace'));

		expect(result).toEqual({ schema: '', shapes: '' });
		expect(fetchWholeGraphQuadsSpy).not.toHaveBeenCalled();
	});
});

describe('SparqlConnector — exportWorkspaceBundle (workspace-export STORY-090)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const ws = workspaceIri('Project Overview');
	const personIri = classIri('Person');

	function stubCommon(
		connector: SparqlConnector,
		fixture: {
			members?: { elementIri: string; x: number; y: number }[];
			notes?: Array<{
				iri: string;
				text: string;
				color: string;
				x: number;
				y: number;
				linkedElementIri: string | null;
			}>;
			classes?: Array<{ iri: string; namespaceBaseIri: string }>;
			individuals?: Array<{ iri: string; namespaceBaseIri: string }>;
			namespaces?: Array<{ baseIri: string; prefix: string }>;
		}
	) {
		vi.spyOn(connector, 'fetchWorkspaces').mockResolvedValue([
			{ iri: ws, label: 'Project Overview', defaultNamespaceBaseIri: null }
		]);
		vi.spyOn(connector, 'fetchWorkspaceMembers').mockResolvedValue(fixture.members ?? []);
		vi.spyOn(connector, 'fetchNotesForWorkspace').mockResolvedValue(fixture.notes ?? []);
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			classes: (fixture.classes ?? []).map((c) => ({
				iri: c.iri,
				label: '',
				comment: null,
				namespaceBaseIri: c.namespaceBaseIri
			})),
			datatypeProperties: [],
			objectProperties: [],
			subClassOf: [],
			individuals: (fixture.individuals ?? []).map((i) => ({
				iri: i.iri,
				label: '',
				classIri: '',
				namespaceBaseIri: i.namespaceBaseIri,
				syncSource: null,
				syncStatus: null
			})),
			individualClassRelations: [],
			individualIndividualRelations: []
		});
		vi.spyOn(connector, 'fetchNamespaces').mockResolvedValue(
			(fixture.namespaces ?? []).map((ns) => ({
				baseIri: ns.baseIri,
				prefix: ns.prefix,
				description: null,
				color: null,
				publisher: null,
				license: null,
				locked: false,
				defaultHidden: false,
				listedInFilter: true
			}))
		);
		vi.spyOn(connector, 'fetchExternalVocabularies').mockResolvedValue([]);
	}

	/** Stubs `fetchWholeGraphQuads` for the raw `FROM <graph>` round-trip, keyed by namespace base IRI
	 *  (mirroring the STORY-082 test's own matching approach). */
	function mockRawQuadsFetch(bindingsByNamespace: Record<string, Array<Record<'s' | 'p' | 'o', SparqlBinding[string]>>>) {
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query ?? '';
			for (const [ns, bindings] of Object.entries(bindingsByNamespace)) {
				const graphs = namespaceGraphs(ns);
				if (q.includes(`FROM <${graphs.instances}>`)) {
					return new Response(
						JSON.stringify({ head: { vars: ['s', 'p', 'o'] }, results: { bindings } }),
						{ status: 200 }
					);
				}
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return fn;
	}

	it('bundles a single-namespace workspace with no external dependencies', async () => {
		const connector = new SparqlConnector('/api/sparql');
		stubCommon(connector, {
			members: [{ elementIri: personIri, x: 0, y: 0 }],
			classes: [{ iri: personIri, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }],
			namespaces: [{ baseIri: DEFAULT_NAMESPACE_BASE_IRI, prefix: 'rse' }]
		});
		vi.stubGlobal(
			'fetch',
			mockRawQuadsFetch({
				[DEFAULT_NAMESPACE_BASE_IRI]: [
					{
						s: { type: 'uri', value: personIri },
						p: { type: 'uri', value: RDF.type },
						o: { type: 'uri', value: OWL.Class }
					}
				]
			})
		);

		const result = await connector.exportWorkspaceBundle(ws);

		expect(result.truncatedDependencyCount).toBe(0);
		expect(result.turtle).toContain(personIri);
		expect(result.turtle).toContain(`<${ws}>`);
		expect(result.turtle).toContain('Project Overview');
		expect(result.turtle).toContain(`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${personIri}>`);
		expect(result.turtle).toContain(`<${NAMESPACE_PREFIX_PREDICATE_IRI}> "rse"`);
	});

	it("includes an external class's own declaration via the dependency closure (STORY-089)", async () => {
		const externalIri = classIri('LegalEntity');
		const connector = new SparqlConnector('/api/sparql');
		stubCommon(connector, {
			members: [{ elementIri: personIri, x: 0, y: 0 }],
			classes: [{ iri: personIri, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }],
			namespaces: [{ baseIri: DEFAULT_NAMESPACE_BASE_IRI, prefix: 'rse' }]
		});
		vi.stubGlobal(
			'fetch',
			mockRawQuadsFetch({
				[DEFAULT_NAMESPACE_BASE_IRI]: [
					{
						s: { type: 'uri', value: personIri },
						p: { type: 'uri', value: RDF.type },
						o: { type: 'uri', value: OWL.Class }
					},
					{
						s: { type: 'uri', value: personIri },
						p: { type: 'uri', value: RDFS.subClassOf },
						o: { type: 'uri', value: externalIri }
					},
					{
						s: { type: 'uri', value: externalIri },
						p: { type: 'uri', value: RDF.type },
						o: { type: 'uri', value: OWL.Class }
					}
				]
			})
		);

		const result = await connector.exportWorkspaceBundle(ws);

		expect(result.turtle).toContain('LegalEntity');
	});

	it('includes every namespace touched when members span two namespaces', async () => {
		const otherNs = 'http://example.org/gov';
		const otherClassIri = `${namespaceGraphs(otherNs).schema}#Application`;
		const connector = new SparqlConnector('/api/sparql');
		stubCommon(connector, {
			members: [
				{ elementIri: personIri, x: 0, y: 0 },
				{ elementIri: otherClassIri, x: 10, y: 10 }
			],
			classes: [
				{ iri: personIri, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI },
				{ iri: otherClassIri, namespaceBaseIri: otherNs }
			],
			namespaces: [
				{ baseIri: DEFAULT_NAMESPACE_BASE_IRI, prefix: 'rse' },
				{ baseIri: otherNs, prefix: 'gov' }
			]
		});
		vi.stubGlobal(
			'fetch',
			mockRawQuadsFetch({
				[DEFAULT_NAMESPACE_BASE_IRI]: [
					{
						s: { type: 'uri', value: personIri },
						p: { type: 'uri', value: RDF.type },
						o: { type: 'uri', value: OWL.Class }
					}
				],
				[otherNs]: [
					{
						s: { type: 'uri', value: otherClassIri },
						p: { type: 'uri', value: RDF.type },
						o: { type: 'uri', value: OWL.Class }
					}
				]
			})
		);

		const result = await connector.exportWorkspaceBundle(ws);

		expect(result.turtle).toContain(`<${NAMESPACE_PREFIX_PREDICATE_IRI}> "rse"`);
		expect(result.turtle).toContain(`<${NAMESPACE_PREFIX_PREDICATE_IRI}> "gov"`);
		expect(result.turtle).toContain(personIri);
		expect(result.turtle).toContain(otherClassIri);
	});

	it('includes Notes with their x/y/text', async () => {
		const connector = new SparqlConnector('/api/sparql');
		stubCommon(connector, {
			notes: [{ iri: noteIri(ws, '1700000000000'), text: 'Reminder', color: '#fff9b1', x: 5, y: 15, linkedElementIri: null }]
		});
		vi.stubGlobal('fetch', mockRawQuadsFetch({}));

		const result = await connector.exportWorkspaceBundle(ws);

		expect(result.turtle).toContain(`<${NOTE_TEXT_PREDICATE_IRI}> "Reminder"`);
		expect(result.turtle).toContain(`<${NOTE_X_PREDICATE_IRI}> "5"^^<http://www.w3.org/2001/XMLSchema#decimal>`);
		expect(result.turtle).toContain(`<${NOTE_Y_PREDICATE_IRI}> "15"^^<http://www.w3.org/2001/XMLSchema#decimal>`);
	});

	it('round-trips the WorkspaceMembership triples back into the exact shape fetchWorkspaceMembers would return', async () => {
		const connector = new SparqlConnector('/api/sparql');
		stubCommon(connector, {
			members: [{ elementIri: personIri, x: 12.5, y: 40 }],
			classes: [{ iri: personIri, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }],
			namespaces: [{ baseIri: DEFAULT_NAMESPACE_BASE_IRI, prefix: 'rse' }]
		});
		vi.stubGlobal(
			'fetch',
			mockRawQuadsFetch({
				[DEFAULT_NAMESPACE_BASE_IRI]: [
					{
						s: { type: 'uri', value: personIri },
						p: { type: 'uri', value: RDF.type },
						o: { type: 'uri', value: OWL.Class }
					}
				]
			})
		);

		const result = await connector.exportWorkspaceBundle(ws);
		const parsed = parseTurtle(result.turtle);
		const membershipIri = workspaceMembershipIri(ws, personIri);

		const element = parsed.find(
			(q) => q.subject.value === membershipIri && q.predicate.value === WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI
		)?.object.value;
		const x = parsed.find(
			(q) => q.subject.value === membershipIri && q.predicate.value === WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI
		)?.object.value;
		const y = parsed.find(
			(q) => q.subject.value === membershipIri && q.predicate.value === WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI
		)?.object.value;

		expect({ elementIri: element, x: parseFloat(x ?? ''), y: parseFloat(y ?? '') }).toEqual({
			elementIri: personIri,
			x: 12.5,
			y: 40
		});
	});

	it('produces a valid, parseable bundle for a workspace with zero members', async () => {
		const connector = new SparqlConnector('/api/sparql');
		stubCommon(connector, {});
		vi.stubGlobal('fetch', mockRawQuadsFetch({}));

		const result = await connector.exportWorkspaceBundle(ws);

		expect(() => parseTurtle(result.turtle)).not.toThrow();
		expect(result.truncatedDependencyCount).toBe(0);
	});
});

/** Mocks the fetch calls `ensureDefaultNamespaceMigrated` (STORY-028) issues: `fetchNamespaces`'s
 *  `SELECT ?ns ?prefix ?desc` lookup, the legacy-graph `SELECT ?s ?p ?o` scoped to `SCHEMA_GRAPH`,
 *  `ensureNamespaceClass`'s `owl:Class` ASK, and `insertNamespace`'s duplicate-check ASK — plus
 *  recorded update bodies. Distinguishes the two ASK shapes the same way `mockNamespaceFetch` does
 *  (STORY-027). */
function mockMigrationFetch(
	fixture: {
		alreadyRegistered?: boolean;
		legacyBindings?: Array<Record<'s' | 'p' | 'o', SparqlBinding[string]>>;
	} = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('SELECT ?ns ?prefix ?desc')) {
			const bindings = fixture.alreadyRegistered
				? [
						{
							ns: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI },
							prefix: { type: 'literal', value: 'rse' }
						}
					]
				: [];
			return new Response(
				JSON.stringify({ head: { vars: ['ns', 'prefix', 'desc'] }, results: { bindings } }),
				{ status: 200 }
			);
		}
		if (q.includes('SELECT ?s ?p ?o')) {
			return new Response(
				JSON.stringify({
					head: { vars: ['s', 'p', 'o'] },
					results: { bindings: fixture.legacyBindings ?? [] }
				}),
				{ status: 200 }
			);
		}
		if (q.includes('ASK')) {
			// ensureNamespaceClass's own-marker check (contains the literal "owl:Class") vs
			// insertNamespace's duplicate-baseIri check (does not).
			if (q.includes('owl:Class')) {
				return new Response(JSON.stringify({ head: {}, boolean: true }), { status: 200 });
			}
			return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

function mockExternalVocabFetch(
	fixture: { vocabClassExists?: boolean; vocabExists?: boolean; registered?: { baseIri: string; prefix: string }[] } = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('ASK')) {
			if (q.includes('owl:Class')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.vocabClassExists ?? false }), {
					status: 200
				});
			}
			return new Response(JSON.stringify({ head: {}, boolean: fixture.vocabExists ?? false }), { status: 200 });
		}
		if (q.includes('?v ?prefix')) {
			const registered = fixture.registered ?? [];
			return new Response(
				JSON.stringify({
					head: { vars: ['v', 'prefix'] },
					results: {
						bindings: registered.map((r) => ({
							v: { type: 'uri', value: r.baseIri },
							prefix: { type: 'literal', value: r.prefix }
						}))
					}
				}),
				{ status: 200 }
			);
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector — external vocabulary management (STORY-046)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('ensureExternalVocabularyClass creates the marker class only if missing', async () => {
		const { fn, updates } = mockExternalVocabFetch({ vocabClassExists: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureExternalVocabularyClass();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${EXTERNAL_VOCABULARY_CLASS_IRI}> a owl:Class`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('ensureExternalVocabularyClass is a no-op when the marker class already exists', async () => {
		const { fn, updates } = mockExternalVocabFetch({ vocabClassExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureExternalVocabularyClass();

		expect(updates).toHaveLength(0);
	});

	it('insertExternalVocabulary creates the ExternalVocabulary/prefix declaration triple', async () => {
		const { fn, updates } = mockExternalVocabFetch({ vocabClassExists: true, vocabExists: false });
		vi.stubGlobal('fetch', fn);

		const gistBase = 'https://ontologies.semanticarts.com/gist/';
		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.insertExternalVocabulary('gist', gistBase);

		expect(result.baseIri).toBe(gistBase);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${gistBase}> a <${EXTERNAL_VOCABULARY_CLASS_IRI}>`);
		expect(updates[0]).toContain(`<${NAMESPACE_PREFIX_PREDICATE_IRI}> "gist"`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});

	it('insertExternalVocabulary rejects an empty prefix without making any request', async () => {
		const { fn } = mockExternalVocabFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertExternalVocabulary('   ', 'https://ontologies.semanticarts.com/gist/')
		).rejects.toThrow(/must not be empty/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('insertExternalVocabulary rejects a duplicate base IRI', async () => {
		const { fn } = mockExternalVocabFetch({ vocabClassExists: true, vocabExists: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.insertExternalVocabulary('gist', 'https://ontologies.semanticarts.com/gist/')
		).rejects.toThrow(/already exists/);
	});

	it('fetchExternalVocabularies merges registered vocabularies with the three built-in defaults', async () => {
		const gistBase = 'https://ontologies.semanticarts.com/gist/';
		const { fn } = mockExternalVocabFetch({ registered: [{ baseIri: gistBase, prefix: 'gist' }] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const vocabularies = await connector.fetchExternalVocabularies();

		expect(vocabularies).toContainEqual({ baseIri: gistBase, prefix: 'gist', builtIn: false });
		expect(vocabularies).toContainEqual({
			baseIri: 'http://xmlns.com/foaf/0.1/',
			prefix: 'foaf',
			builtIn: true
		});
	});

	it('deleteExternalVocabulary removes the registration triple unconditionally', async () => {
		const { fn, updates } = mockExternalVocabFetch();
		vi.stubGlobal('fetch', fn);

		const gistBase = 'https://ontologies.semanticarts.com/gist/';
		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteExternalVocabulary(gistBase);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${gistBase}> ?p ?o`);
		expect(updates[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
	});
});

describe('SparqlConnector — default namespace migration (STORY-028)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personIri = classIri('Person');
	const nameProp = propertyIri(personIri, 'name');
	const shapeIri = nodeShapeIri(personIri);
	const relationTypeIri = classIri('RelationType');
	const nutztIri = individualIri(relationTypeIri, 'nutzt');

	/** Representative pre-migration `SCHEMA_GRAPH` content: a class + its datatype property
	 *  (schema bucket), a `sh:NodeShape` with a `sh:property` blank node (shapes bucket), and one
	 *  enumerated individual per STORY-019's `looksLikeIndividual` rule (instances bucket). */
	function legacyGraphFixture(): Array<Record<'s' | 'p' | 'o', SparqlBinding[string]>> {
		return [
			{
				s: { type: 'uri', value: personIri },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: OWL.Class }
			},
			{
				s: { type: 'uri', value: personIri },
				p: { type: 'uri', value: RDFS.label },
				o: { type: 'literal', value: 'Person' }
			},
			{
				s: { type: 'uri', value: nameProp },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: OWL.DatatypeProperty }
			},
			{
				s: { type: 'uri', value: nameProp },
				p: { type: 'uri', value: RDFS.domain },
				o: { type: 'uri', value: personIri }
			},
			{
				s: { type: 'uri', value: relationTypeIri },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: OWL.Class }
			},
			{
				s: { type: 'uri', value: shapeIri },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: SH.NodeShape }
			},
			{
				s: { type: 'uri', value: shapeIri },
				p: { type: 'uri', value: SH.targetClass },
				o: { type: 'uri', value: personIri }
			},
			{
				s: { type: 'uri', value: shapeIri },
				p: { type: 'uri', value: SH.property },
				o: { type: 'bnode', value: 'b0' }
			},
			{
				s: { type: 'bnode', value: 'b0' },
				p: { type: 'uri', value: SH.path },
				o: { type: 'uri', value: nameProp }
			},
			{
				s: { type: 'uri', value: nutztIri },
				p: { type: 'uri', value: RDF.type },
				o: { type: 'uri', value: relationTypeIri }
			},
			{
				s: { type: 'uri', value: nutztIri },
				p: { type: 'uri', value: RDFS.label },
				o: { type: 'literal', value: 'nutzt' }
			}
		];
	}

	/** Pulls just the body of one `GRAPH <graph> { ... }` block out of an `INSERT DATA` op string,
	 *  for asserting which bucket a triple landed in. Ground (N-Triples) triples never contain a
	 *  `{`/`}` of their own, so a non-greedy match is safe. */
	function graphBlockBody(insertOp: string, graph: string): string {
		const escaped = graph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return insertOp.match(new RegExp(`GRAPH <${escaped}> \\{([\\s\\S]*?)\\}`))?.[1] ?? '';
	}

	it('is a no-op when the default namespace is already registered (idempotent)', async () => {
		const { fn, updates } = mockMigrationFetch({ alreadyRegistered: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureDefaultNamespaceMigrated();

		// Only the fetchNamespaces lookup is issued — no legacy-graph SELECT, no update at all.
		expect(fn).toHaveBeenCalledTimes(1);
		expect(updates).toHaveLength(0);
	});

	it('copies SCHEMA_GRAPH triples into the three new graphs, classified like saveScopedTurtle does, then registers the default namespace', async () => {
		const { fn, updates } = mockMigrationFetch({ legacyBindings: legacyGraphFixture() });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureDefaultNamespaceMigrated();

		expect(updates).toHaveLength(2); // one INSERT DATA copy, then one insertNamespace registration
		const insertOp = updates[0];
		expect(insertOp).toContain('INSERT DATA {');

		const instancesBlock = graphBlockBody(insertOp, DEFAULT_GRAPHS.instances);
		expect(instancesBlock).toContain(nutztIri);
		expect(instancesBlock).not.toContain(personIri);
		expect(instancesBlock).not.toContain(shapeIri);

		const schemaBlock = graphBlockBody(insertOp, DEFAULT_GRAPHS.schema);
		expect(schemaBlock).toContain(personIri);
		expect(schemaBlock).toContain(nameProp);
		expect(schemaBlock).toContain(relationTypeIri);
		expect(schemaBlock).not.toContain(nutztIri);
		expect(schemaBlock).not.toContain(shapeIri);

		// (shapesBlock legitimately references personIri as the object of sh:targetClass — only
		// nutztIri, which belongs to a different bucket entirely, must be absent.)
		const shapesBlock = graphBlockBody(insertOp, DEFAULT_GRAPHS.shapes);
		expect(shapesBlock).toContain(shapeIri);
		expect(shapesBlock).not.toContain(nutztIri);

		expect(updates[1]).toContain(`<${DEFAULT_NAMESPACE_BASE_IRI}> a <${NAMESPACE_CLASS_IRI}>`);
		expect(updates[1]).toContain(`<${NAMESPACE_PREFIX_PREDICATE_IRI}> "rse"`);

		// Copy-not-move guarantee: SCHEMA_GRAPH is never DROPped/DELETEd by anything this emits.
		for (const update of updates) {
			expect(update).not.toContain(`DROP GRAPH <${SCHEMA_GRAPH}>`);
			expect(update).not.toContain(`GRAPH <${SCHEMA_GRAPH}>`);
		}
	});

	it('skips the empty INSERT DATA copy (but still registers) when SCHEMA_GRAPH has nothing in it', async () => {
		const { fn, updates } = mockMigrationFetch({ legacyBindings: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureDefaultNamespaceMigrated();

		expect(updates).toHaveLength(1); // just insertNamespace's registration
		expect(updates[0]).toContain(`<${DEFAULT_NAMESPACE_BASE_IRI}> a <${NAMESPACE_CLASS_IRI}>`);
	});
});

/** Pulls just the body of one `GRAPH <graph> { ... }` block out of an `INSERT DATA` op string —
 *  see the STORY-028 describe block above for the original of this helper; redeclared here at
 *  module scope (not nested inside another `describe`'s callback) so this describe block can use
 *  it too. */
function graphBlockBody(insertOp: string, graph: string): string {
	const escaped = graph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return insertOp.match(new RegExp(`GRAPH <${escaped}> \\{([\\s\\S]*?)\\}`))?.[1] ?? '';
}

/**
 * Mocks `importTurtle`'s two query shapes (STORY-044): a bare `GRAPH ?g {...}` per-subject
 * namespace lookup (`findNamespaceOfSubject`), answered from `fixture.subjectGraph` (a subject
 * absent from the map is "not found anywhere", i.e. a genuinely new subject), or a whole-graph
 * `SELECT ?s ?p ?o FROM <ns...> WHERE {...}` fetch, matched to a namespace by whichever `FROM`
 * graph carries neither a `/schema` nor `/shapes` suffix and answered from
 * `fixture.existingQuadsByNamespace` (a namespace absent from the map behaves as empty).
 */
function mockImportFetch(
	fixture: {
		subjectGraph?: Record<string, string>;
		existingQuadsByNamespace?: Record<string, Array<Record<'s' | 'p' | 'o', SparqlBinding[string]>>>;
	} = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('GRAPH ?g')) {
			const match = q.match(/GRAPH \?g \{ <([^>]+)> \?p \?o \}/);
			const subjectIri = match?.[1];
			const graph = subjectIri ? fixture.subjectGraph?.[subjectIri] : undefined;
			const bindings = graph ? [{ g: { type: 'uri', value: graph } }] : [];
			return new Response(JSON.stringify({ head: { vars: ['g'] }, results: { bindings } }), {
				status: 200
			});
		}
		const fromGraphs = [...q.matchAll(/FROM <([^>]+)>/g)].map((m) => m[1]);
		const ns = fromGraphs.find((g) => !g.endsWith('/schema') && !g.endsWith('/shapes'));
		const bindings = (ns && fixture.existingQuadsByNamespace?.[ns]) ?? [];
		return new Response(JSON.stringify({ head: { vars: ['s', 'p', 'o'] }, results: { bindings } }), {
			status: 200
		});
	});
	return { fn, updates };
}

describe('SparqlConnector — importTurtle (STORY-044)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personIri = classIri('Person');

	it('imports into an empty namespace — all quads inserted', async () => {
		const { fn, updates } = mockImportFetch({
			existingQuadsByNamespace: { [DEFAULT_NAMESPACE_BASE_IRI]: [] }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const summary = await connector.importTurtle(
			`@prefix owl: <http://www.w3.org/2002/07/owl#> .
			 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			 <${personIri}> a owl:Class ; rdfs:label "Person" .`
		);

		expect(summary.duplicates).toHaveLength(0);
		expect(summary.conflicts).toHaveLength(0);
		expect(summary.inserted).toHaveLength(2);
		expect(updates).toHaveLength(1);
		const schemaBlock = graphBlockBody(updates[0], DEFAULT_GRAPHS.schema);
		expect(schemaBlock).toContain(personIri);
		expect(schemaBlock).toContain('"Person"');
	});

	it('skips triples that exactly duplicate an existing one, inserting the rest', async () => {
		const { fn, updates } = mockImportFetch({
			subjectGraph: { [personIri]: DEFAULT_GRAPHS.schema },
			existingQuadsByNamespace: {
				[DEFAULT_NAMESPACE_BASE_IRI]: [
					{
						s: { type: 'uri', value: personIri },
						p: { type: 'uri', value: RDF.type },
						o: { type: 'uri', value: OWL.Class }
					}
				]
			}
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const summary = await connector.importTurtle(
			`@prefix owl: <http://www.w3.org/2002/07/owl#> .
			 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			 <${personIri}> a owl:Class ; rdfs:label "Person" .`
		);

		expect(summary.duplicates).toEqual([{ subject: personIri, predicate: RDF.type }]);
		expect(summary.inserted).toEqual([{ subject: personIri, predicate: RDFS.label }]);
		expect(summary.conflicts).toHaveLength(0);
		expect(updates).toHaveLength(1);
		const schemaBlock = graphBlockBody(updates[0], DEFAULT_GRAPHS.schema);
		expect(schemaBlock).toContain('"Person"');
		expect(schemaBlock).not.toContain('22-rdf-syntax-ns#type');
	});

	it('skips a conflicting triple (same subject+predicate, different object), never overwriting it', async () => {
		const { fn, updates } = mockImportFetch({
			subjectGraph: { [personIri]: DEFAULT_GRAPHS.schema },
			existingQuadsByNamespace: {
				[DEFAULT_NAMESPACE_BASE_IRI]: [
					{
						s: { type: 'uri', value: personIri },
						p: { type: 'uri', value: RDFS.label },
						o: { type: 'literal', value: 'Old Label' }
					}
				]
			}
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const summary = await connector.importTurtle(
			`@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . <${personIri}> rdfs:label "New Label" .`
		);

		expect(summary.conflicts).toEqual([{ subject: personIri, predicate: RDFS.label }]);
		expect(summary.inserted).toHaveLength(0);
		expect(summary.duplicates).toHaveLength(0);
		expect(updates).toHaveLength(0); // nothing to insert; the existing triple is left untouched
	});

	it('routes each subject to its own resolved namespace when the import spans two namespaces', async () => {
		const otherNsBase = 'http://example.org/other';
		const otherGraphs = namespaceGraphs(otherNsBase);
		const otherClassIri = `${otherGraphs.schema}#Vehicle`;

		const { fn, updates } = mockImportFetch({
			subjectGraph: {
				[personIri]: DEFAULT_GRAPHS.schema,
				[otherClassIri]: otherGraphs.schema
			},
			existingQuadsByNamespace: {
				[DEFAULT_NAMESPACE_BASE_IRI]: [],
				[otherNsBase]: []
			}
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const summary = await connector.importTurtle(
			`@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			 <${personIri}> rdfs:label "Person Updated" .
			 <${otherClassIri}> rdfs:label "Vehicle Updated" .`
		);

		expect(summary.inserted).toHaveLength(2);
		expect(updates).toHaveLength(1);
		const personBlock = graphBlockBody(updates[0], DEFAULT_GRAPHS.schema);
		expect(personBlock).toContain('"Person Updated"');
		const otherBlock = graphBlockBody(updates[0], otherGraphs.schema);
		expect(otherBlock).toContain('"Vehicle Updated"');
	});

	it('rejects invalid Turtle syntax without calling the update endpoint', async () => {
		const { fn, updates } = mockImportFetch({
			existingQuadsByNamespace: { [DEFAULT_NAMESPACE_BASE_IRI]: [] }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.importTurtle('not : valid @@@ turtle')).rejects.toMatchObject({
			issues: [expect.objectContaining({ layer: 'syntax' })]
		});
		expect(updates).toHaveLength(0);
	});

	it('rejects content that fails structural validation, aborting with zero writes', async () => {
		const { fn, updates } = mockImportFetch({
			existingQuadsByNamespace: { [DEFAULT_NAMESPACE_BASE_IRI]: [] }
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.importTurtle(
				`@prefix owl: <http://www.w3.org/2002/07/owl#> .
				 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
				 <urn:owns> a owl:ObjectProperty ; rdfs:domain <urn:Ghost> ; rdfs:range <urn:Car> .`
			)
		).rejects.toMatchObject({
			issues: [
				expect.objectContaining({ layer: 'structural' }),
				expect.objectContaining({ layer: 'structural' })
			]
		});
		expect(updates).toHaveLength(0);
	});
});

describe('SparqlConnector — importWorkspaceBundle (workspace-export STORY-092)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const ws = workspaceIri('Project Overview');
	const personIri = classIri('Person');
	const membershipIriValue = workspaceMembershipIri(ws, personIri);
	const noteIriValue = noteIri(ws, '1700000000000');
	const govBase = 'http://example.org/gov';

	function fullBundleText(): string {
		return `
			<${govBase}> <${RDF.type}> <${NAMESPACE_CLASS_IRI}> ; <${NAMESPACE_PREFIX_PREDICATE_IRI}> "gov" .

			<${ws}> <${RDF.type}> <${WORKSPACE_CLASS_IRI}> ; <${RDFS.label}> "Project Overview" .

			<${membershipIriValue}> <${RDF.type}> <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ;
				<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${ws}> ;
				<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${personIri}> ;
				<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "0"^^<http://www.w3.org/2001/XMLSchema#decimal> ;
				<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "0"^^<http://www.w3.org/2001/XMLSchema#decimal> .

			<${noteIriValue}> <${RDF.type}> <${NOTE_CLASS_IRI}> ;
				<${NOTE_WORKSPACE_PREDICATE_IRI}> <${ws}> ;
				<${NOTE_COLOR_PREDICATE_IRI}> "#fff9b1" ;
				<${NOTE_X_PREDICATE_IRI}> "5"^^<http://www.w3.org/2001/XMLSchema#decimal> ;
				<${NOTE_Y_PREDICATE_IRI}> "15"^^<http://www.w3.org/2001/XMLSchema#decimal> ;
				<${NOTE_TEXT_PREDICATE_IRI}> "Reminder" .

			<${personIri}> <${RDF.type}> <${OWL.Class}> ; <${RDFS.label}> "Person" .
		`;
	}

	it('imports into an empty target — every bucket inserted', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'askQuery').mockResolvedValue(false);
		vi.spyOn(connector, 'fetchNamespaces').mockResolvedValue([]);
		const insertNamespaceSpy = vi
			.spyOn(connector, 'insertNamespace')
			.mockResolvedValue({ baseIri: govBase });
		const ensureWorkspaceSpy = vi.spyOn(connector, 'ensureWorkspace').mockResolvedValue(undefined);
		const addWorkspaceMemberSpy = vi.spyOn(connector, 'addWorkspaceMember').mockResolvedValue(undefined);
		const ensureNoteAtIriSpy = vi.spyOn(connector, 'ensureNoteAtIri').mockResolvedValue(undefined);
		const importTurtleSpy = vi.spyOn(connector, 'importTurtle').mockResolvedValue({
			inserted: [{ subject: personIri, predicate: RDF.type }],
			duplicates: [],
			conflicts: []
		});

		const summary = await connector.importWorkspaceBundle(fullBundleText());

		expect(insertNamespaceSpy).toHaveBeenCalledTimes(1);
		expect(insertNamespaceSpy).toHaveBeenCalledWith('gov', govBase, undefined, undefined, undefined, undefined);
		expect(ensureWorkspaceSpy).toHaveBeenCalledWith(ws, 'Project Overview', undefined);
		expect(addWorkspaceMemberSpy).toHaveBeenCalledWith(ws, personIri, 0, 0);
		expect(ensureNoteAtIriSpy).toHaveBeenCalledWith(noteIriValue, ws, 5, 15, '#fff9b1', 'Reminder', undefined);
		expect(importTurtleSpy).toHaveBeenCalledTimes(1);

		expect(summary).toEqual({
			schema: { inserted: [{ subject: personIri, predicate: RDF.type }], duplicates: [], conflicts: [] },
			namespaces: { inserted: 1, alreadyPresent: 0 },
			workspaces: { inserted: 1, alreadyPresent: 0 },
			memberships: { inserted: 1, alreadyPresent: 0 },
			notes: { inserted: 1, alreadyPresent: 0 }
		});
	});

	it('re-importing the identical bundle is fully idempotent — every bucket reports alreadyPresent, insertNamespace never called', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'askQuery').mockResolvedValue(true);
		vi.spyOn(connector, 'fetchNamespaces').mockResolvedValue([]);
		const insertNamespaceSpy = vi.spyOn(connector, 'insertNamespace').mockResolvedValue({ baseIri: govBase });
		vi.spyOn(connector, 'ensureWorkspace').mockResolvedValue(undefined);
		vi.spyOn(connector, 'addWorkspaceMember').mockResolvedValue(undefined);
		vi.spyOn(connector, 'ensureNoteAtIri').mockResolvedValue(undefined);
		vi.spyOn(connector, 'importTurtle').mockResolvedValue({ inserted: [], duplicates: [{ subject: personIri, predicate: RDF.type }], conflicts: [] });

		const summary = await connector.importWorkspaceBundle(fullBundleText());

		expect(insertNamespaceSpy).not.toHaveBeenCalled();
		expect(summary.namespaces).toEqual({ inserted: 0, alreadyPresent: 1 });
		expect(summary.workspaces).toEqual({ inserted: 0, alreadyPresent: 1 });
		expect(summary.memberships).toEqual({ inserted: 0, alreadyPresent: 1 });
		expect(summary.notes).toEqual({ inserted: 0, alreadyPresent: 1 });
	});

	it('merges into a target with a partial overlap — only the rows the target lacks are reported as inserted', async () => {
		const connector = new SparqlConnector('/api/sparql');
		const secondPersonIri = classIri('Employee');
		const secondMembershipIri = workspaceMembershipIri(ws, secondPersonIri);
		vi.spyOn(connector, 'fetchNamespaces').mockResolvedValue([]);
		// The workspace and its first membership/note already exist on the target; the second
		// membership (a new element added to the same workspace since the last export) does not.
		vi.spyOn(connector, 'askQuery').mockImplementation(async (query: string) => !query.includes(secondMembershipIri));
		vi.spyOn(connector, 'insertNamespace').mockResolvedValue({ baseIri: govBase });
		vi.spyOn(connector, 'ensureWorkspace').mockResolvedValue(undefined);
		const addWorkspaceMemberSpy = vi.spyOn(connector, 'addWorkspaceMember').mockResolvedValue(undefined);
		vi.spyOn(connector, 'ensureNoteAtIri').mockResolvedValue(undefined);
		vi.spyOn(connector, 'importTurtle').mockResolvedValue({ inserted: [], duplicates: [], conflicts: [] });

		const text = `
			${fullBundleText()}
			<${secondMembershipIri}> <${RDF.type}> <${WORKSPACE_MEMBERSHIP_CLASS_IRI}> ;
				<${WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI}> <${ws}> ;
				<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${secondPersonIri}> ;
				<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "30"^^<http://www.w3.org/2001/XMLSchema#decimal> ;
				<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "30"^^<http://www.w3.org/2001/XMLSchema#decimal> .
		`;

		const summary = await connector.importWorkspaceBundle(text);

		expect(summary.workspaces).toEqual({ inserted: 0, alreadyPresent: 1 });
		expect(summary.memberships).toEqual({ inserted: 1, alreadyPresent: 1 });
		expect(addWorkspaceMemberSpy).toHaveBeenCalledWith(ws, personIri, 0, 0);
		expect(addWorkspaceMemberSpy).toHaveBeenCalledWith(ws, secondPersonIri, 30, 30);
	});

	it('rejects invalid Turtle syntax without touching any bucket', async () => {
		const connector = new SparqlConnector('/api/sparql');
		const insertNamespaceSpy = vi.spyOn(connector, 'insertNamespace').mockResolvedValue({ baseIri: govBase });
		const ensureWorkspaceSpy = vi.spyOn(connector, 'ensureWorkspace').mockResolvedValue(undefined);
		const importTurtleSpy = vi.spyOn(connector, 'importTurtle');

		await expect(connector.importWorkspaceBundle('not : valid @@@ turtle')).rejects.toMatchObject({
			issues: [expect.objectContaining({ layer: 'syntax' })]
		});

		expect(insertNamespaceSpy).not.toHaveBeenCalled();
		expect(ensureWorkspaceSpy).not.toHaveBeenCalled();
		expect(importTurtleSpy).not.toHaveBeenCalled();
	});

	it('aborts with zero Workspace/Membership/Note writes when the schema bucket fails validation', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'askQuery').mockResolvedValue(false);
		vi.spyOn(connector, 'fetchNamespaces').mockResolvedValue([]);
		vi.spyOn(connector, 'insertNamespace').mockResolvedValue({ baseIri: govBase });
		const ensureWorkspaceSpy = vi.spyOn(connector, 'ensureWorkspace').mockResolvedValue(undefined);
		const addWorkspaceMemberSpy = vi.spyOn(connector, 'addWorkspaceMember').mockResolvedValue(undefined);
		const ensureNoteAtIriSpy = vi.spyOn(connector, 'ensureNoteAtIri').mockResolvedValue(undefined);
		vi.spyOn(connector, 'importTurtle').mockRejectedValue(
			new SchemaValidationError([{ layer: 'structural', message: 'dangling reference' }])
		);

		await expect(connector.importWorkspaceBundle(fullBundleText())).rejects.toBeInstanceOf(SchemaValidationError);

		expect(ensureWorkspaceSpy).not.toHaveBeenCalled();
		expect(addWorkspaceMemberSpy).not.toHaveBeenCalled();
		expect(ensureNoteAtIriSpy).not.toHaveBeenCalled();
	});

	it("routes a brand-new namespace's class into its own graph, not the caller's active namespace (ordering risk)", async () => {
		const otherNsBase = 'http://example.org/newns';
		const otherGraphs = namespaceGraphs(otherNsBase);
		const otherClassIri = `${otherGraphs.schema}#Vehicle`;
		const defaultGraphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g')) {
				// findNamespaceOfSubject's bare cross-graph lookup: the class doesn't exist anywhere yet.
				return new Response(JSON.stringify({ head: { vars: ['g'] }, results: { bindings: [] } }), {
					status: 200
				});
			}
			if (q.includes('ASK')) {
				if (q.includes(`<${NAMESPACE_CLASS_IRI}> a owl:Class`)) {
					return new Response(JSON.stringify({ head: {}, boolean: true }), { status: 200 });
				}
				if (q.includes(`a <${NAMESPACE_CLASS_IRI}>`)) {
					return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
				}
				return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
			}
			if (q.includes('SELECT ?ns ?prefix')) {
				return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
					status: 200
				});
			}
			// Every FROM <graph> whole-graph fetch (both namespaces) — nothing exists yet.
			return new Response(JSON.stringify({ head: { vars: ['s', 'p', 'o'] }, results: { bindings: [] } }), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const summary = await connector.importWorkspaceBundle(`
			<${otherNsBase}> <${RDF.type}> <${NAMESPACE_CLASS_IRI}> ; <${NAMESPACE_PREFIX_PREDICATE_IRI}> "newns" .
			<${otherClassIri}> <${RDF.type}> <${OWL.Class}> ; <${RDFS.label}> "Vehicle" .
		`);

		expect(summary.namespaces).toEqual({ inserted: 1, alreadyPresent: 0 });
		expect(summary.schema.inserted).toEqual(
			expect.arrayContaining([{ subject: otherClassIri, predicate: RDF.type }])
		);

		const insertUpdate = updates.find((u) => u.includes(otherClassIri) && u.includes('INSERT DATA'));
		expect(insertUpdate).toBeDefined();
		expect(insertUpdate).toContain(`GRAPH <${otherGraphs.schema}>`);
		expect(insertUpdate).not.toContain(`GRAPH <${defaultGraphs.schema}>`);
	});
});

describe('SparqlConnector — deleteClass subClassOf reference check (STORY-047)', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** Mocks `fetchNamespaces()` plus a per-namespace `?sub rdfs:subClassOf <classIriValue>` scan,
	 *  mirroring `fetchFullSchemaForAllNamespaces`'s test mock shape above — `subsByNamespace` maps
	 *  a namespace base IRI to the sub-class IRIs found in that namespace's schema graph. */
	function mockSubClassFetch(namespaces: string[], subsByNamespace: Record<string, string[]> = {}) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			console.error('QUERY', JSON.stringify(q));
			if (q.includes('?ns ?prefix ?desc')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns', 'prefix', 'desc'] },
						results: {
							bindings: namespaces.map((ns) => ({ ns: { type: 'uri', value: ns } }))
						}
					}),
					{ status: 200 }
				);
			}
			if (q.includes('rdfs:subClassOf ')) {
				const ns = namespaces.find((n) => q.includes(`FROM <${namespaceGraphs(n).schema}>`));
				const subs = ns ? (subsByNamespace[ns] ?? []) : [];
				return new Response(
					JSON.stringify({
						head: { vars: ['sub'] },
						results: { bindings: subs.map((s) => ({ sub: { type: 'uri', value: s } })) }
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('findSubClassReferences scans every registered namespace\'s schema graph, not just one', async () => {
		const nsA = 'http://example.org/a';
		const nsB = 'http://example.org/b';
		const superIri = classIri('Asd');
		const subIri = `${nsB}#Application`;
		const { fn } = mockSubClassFetch([nsA, nsB], { [nsB]: [subIri] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const refs = await connector.findSubClassReferences(superIri);

		expect(refs).toEqual([{ subIri, namespaceBaseIri: nsB }]);
	});

	it('deleteClass refuses when another class (in a different namespace) is declared subClassOf it, without writing anything', async () => {
		const nsB = 'http://example.org/b';
		const superIri = classIri('Asd');
		const subIri = `${nsB}#Application`;
		const { fn, updates } = mockSubClassFetch([DEFAULT_NAMESPACE_BASE_IRI, nsB], { [nsB]: [subIri] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteClass(superIri);

		expect(result).toEqual({
			deleted: false,
			externalReferences: [],
			subClassReferences: [{ subIri, namespaceBaseIri: nsB }]
		});
		expect(updates).toHaveLength(0);
	});

	it('deleteClass({force: true}) deletes the dangling subClassOf triple(s) before deleting the class itself', async () => {
		const nsB = 'http://example.org/b';
		const superIri = classIri('Asd');
		const subIri = `${nsB}#Application`;
		const { fn, updates } = mockSubClassFetch([DEFAULT_NAMESPACE_BASE_IRI, nsB], { [nsB]: [subIri] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteClass(superIri, { force: true });

		expect(result.deleted).toBe(true);
		expect(
			updates.some((u) => u.includes(`DELETE DATA`) && u.includes(`<${subIri}> rdfs:subClassOf <${superIri}>`))
		).toBe(true);
		// the subClassOf delete must precede the class's own triple delete
		const subClassOfDeleteIndex = updates.findIndex((u) => u.includes(`<${subIri}> rdfs:subClassOf`));
		const classDeleteIndex = updates.findIndex((u) => u.includes(`<${superIri}> ?p ?o`));
		expect(subClassOfDeleteIndex).toBeGreaterThanOrEqual(0);
		expect(subClassOfDeleteIndex).toBeLessThan(classDeleteIndex);
	});
});

describe('SparqlConnector — canvas reconstruction from the shapes graph (STORY-054)', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** Routes `fetchFullSchema`'s Promise.all'd queries by their distinguishing patterns:
	 *  `fetchGenericObjectPropertyEdges`'s `FILTER NOT EXISTS { ?p rdfs:domain ?anyDomain }` (unique
	 *  to it) vs. `fetchAllObjectProperties`'s `owl:ObjectProperty ; rdfs:domain ?domain` (unique to
	 *  it — the generic query never asserts `rdfs:domain` on the *matched* variable). Every other
	 *  query (classes, datatype properties, shapes/constraints, subClassOf, individuals) defaults to
	 *  empty bindings — these tests only assert on `objectProperties`. */
	function mockFullSchemaFetch(
		fixture: {
			genericEdges?: Array<{ p: string; label: string; domain: string; range: string; minCount?: number; maxCount?: number }>;
			specificObjectProps?: Array<{ p: string; label: string; domain: string; range: string; reverseOf?: string }>;
		} = {}
	) {
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('FILTER NOT EXISTS { ?p rdfs:domain ?anyDomain }')) {
				const bindings = (fixture.genericEdges ?? []).map((e) => ({
					p: { type: 'uri', value: e.p },
					label: { type: 'literal', value: e.label },
					domain: { type: 'uri', value: e.domain },
					range: { type: 'uri', value: e.range },
					...(e.minCount !== undefined ? { minCount: { type: 'literal', value: String(e.minCount) } } : {}),
					...(e.maxCount !== undefined ? { maxCount: { type: 'literal', value: String(e.maxCount) } } : {})
				}));
				return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });
			}
			if (q.includes('owl:ObjectProperty') && q.includes('rdfs:domain ?domain')) {
				const bindings = (fixture.specificObjectProps ?? []).map((e) => ({
					p: { type: 'uri', value: e.p },
					label: { type: 'literal', value: e.label },
					domain: { type: 'uri', value: e.domain },
					range: { type: 'uri', value: e.range },
					...(e.reverseOf !== undefined ? { reverseOf: { type: 'uri', value: e.reverseOf } } : {})
				}));
				return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return fn;
	}

	it('fetchFullSchema merges a generic relation (no rdfs:domain/range) into objectProperties, tagged relationKind: generic', async () => {
		const project = classIri('Project');
		const tool = classIri('Tool');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const fn = mockFullSchemaFetch({ genericEdges: [{ p: usesIri, label: 'uses', domain: project, range: tool }] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const schema = await connector.fetchFullSchema();

		expect(schema.objectProperties).toContainEqual({
			iri: usesIri,
			label: 'uses',
			domain: project,
			range: tool,
			namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI,
			required: false,
			repeatable: true,
			relationKind: 'generic'
		});
	});

	it('fetchFullSchema tags a specific relation with generatedReverseOf when rse:generatedReverseOf is set (STORY-XXX)', async () => {
		const component = classIri('Component');
		const group = classIri('Group');
		const forwardIri = propertyIri(component, 'ownedBy');
		const reverseIri = propertyIri(group, 'owns');
		const fn = mockFullSchemaFetch({
			specificObjectProps: [{ p: reverseIri, label: 'owns', domain: group, range: component, reverseOf: forwardIri }]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const schema = await connector.fetchFullSchema();

		expect(schema.objectProperties).toContainEqual(
			expect.objectContaining({ iri: reverseIri, generatedReverseOf: forwardIri })
		);
	});

	it('the generic-edge query FROMs every registered namespace\'s own /schema graph, not just the namespace being fetched — a generic relation reused from a source class in a different namespace (STORY-051/053 cross-namespace reuse) has its owl:ObjectProperty declaration under the namespace that first minted it, not under the reusing source class\'s own namespace', async () => {
		const coreBase = 'http://example.org/core';
		const coreGraphs = namespaceGraphs(coreBase);
		const backstageBase = 'http://example.org/backstage';
		const backstageGraphs = namespaceGraphs(backstageBase);
		let genericEdgeQuery = '';
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('SELECT ?ns ?prefix')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['ns'] },
						results: {
							bindings: [
								{ ns: { type: 'uri', value: coreBase } },
								{ ns: { type: 'uri', value: backstageBase } }
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (q.includes('FILTER NOT EXISTS { ?p rdfs:domain ?anyDomain }')) genericEdgeQuery = q;
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchFullSchema(backstageBase);

		expect(genericEdgeQuery).toContain(`FROM <${backstageGraphs.shapes}>`);
		expect(genericEdgeQuery).toContain(`FROM <${coreGraphs.schema}>`);
		expect(genericEdgeQuery).toContain(`FROM <${backstageGraphs.schema}>`);
	});

	it('emits one edge per source class for a generic relation reused from two different source classes, each with its own cardinality', async () => {
		const project = classIri('Project');
		const recipe = classIri('Recipe');
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const fn = mockFullSchemaFetch({
			genericEdges: [
				{ p: usesIri, label: 'uses', domain: project, range: tool, minCount: 1 },
				{ p: usesIri, label: 'uses', domain: recipe, range: ingredient }
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const schema = await connector.fetchFullSchema();

		const genericEdges = schema.objectProperties.filter((op) => op.relationKind === 'generic');
		expect(genericEdges).toHaveLength(2);
		expect(genericEdges.find((e) => e.domain === project)).toMatchObject({
			range: tool,
			required: true,
			repeatable: true
		});
		expect(genericEdges.find((e) => e.domain === recipe)).toMatchObject({
			range: ingredient,
			required: false,
			repeatable: true
		});
	});

	it('emits one edge per target for a generic relation drawn to several targets from the *same* source class (independent sh:property blocks in the shapes graph, data-catalog Story 018)', async () => {
		const project = classIri('Project');
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const fn = mockFullSchemaFetch({
			genericEdges: [
				{ p: usesIri, label: 'uses', domain: project, range: tool },
				{ p: usesIri, label: 'uses', domain: project, range: ingredient }
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const schema = await connector.fetchFullSchema();

		const genericEdges = schema.objectProperties.filter((op) => op.relationKind === 'generic');
		expect(genericEdges).toHaveLength(2);
		expect(genericEdges.map((e) => e.range).sort()).toEqual([ingredient, tool].sort());
		expect(genericEdges.every((e) => e.domain === project && e.iri === usesIri)).toBe(true);
	});

	it('requires ?p a owl:ObjectProperty in the generic-edge query, so a stale sh:property whose path was manually deleted from /schema does not ghost back into objectProperties', async () => {
		let genericEdgeQuery = '';
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			if (q.includes('FILTER NOT EXISTS { ?p rdfs:domain ?anyDomain }')) genericEdgeQuery = q;
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchFullSchema();

		expect(genericEdgeQuery).toContain('?p a owl:ObjectProperty .');
	});

	it('does not confuse a specific relation with a generic one drawn between the same two classes', async () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const ownsIri = propertyIri(person, 'owns');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const fn = mockFullSchemaFetch({
			specificObjectProps: [{ p: ownsIri, label: 'owns', domain: person, range: car }],
			genericEdges: [{ p: usesIri, label: 'uses', domain: person, range: car }]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const schema = await connector.fetchFullSchema();

		expect(schema.objectProperties).toContainEqual(
			expect.objectContaining({ iri: ownsIri, relationKind: 'specific' })
		);
		expect(schema.objectProperties).toContainEqual(
			expect.objectContaining({ iri: usesIri, relationKind: 'generic' })
		);
	});
});

describe('SparqlConnector — own-properties / external-references shapes-graph equivalents (STORY-055)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it("findOwnProperties includes a generic relation's property IRI used from this class's own NodeShape, alongside rdfs:domain-scoped properties", async () => {
		const project = classIri('Project');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const attrIri = propertyIri(project, 'name');
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			expect(q).toContain('UNION');
			expect(q).toContain('sh:targetClass');
			return new Response(
				JSON.stringify({
					head: { vars: ['p'] },
					results: {
						bindings: [
							{ p: { type: 'uri', value: attrIri } },
							{ p: { type: 'uri', value: usesIri } }
						]
					}
				}),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.findOwnProperties(project);

		expect(result).toEqual([attrIri, usesIri]);
	});

	it('findExternalReferences includes a generic relation\'s property IRI when any NodeShape targets this class via sh:class', async () => {
		const tool = classIri('Tool');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			const q: string = body.query;
			expect(q).toContain('UNION');
			expect(q).toContain('sh:class');
			return new Response(
				JSON.stringify({ head: { vars: ['p'] }, results: { bindings: [{ p: { type: 'uri', value: usesIri } }] } }),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.findExternalReferences(tool);

		expect(result).toEqual([usesIri]);
	});

	it('deleteClass refuses to delete a class targeted by a generic relation, without writing anything, unless force: true', async () => {
		const tool = classIri('Tool');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const { fn, updates } = mockGraphFetch({ externalReferences: [usesIri] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteClass(tool);

		expect(result).toEqual({ deleted: false, externalReferences: [usesIri], subClassReferences: [] });
		expect(updates).toHaveLength(0);
	});
});

describe('SparqlConnector — reference-counted deletion for generic relations (STORY-056)', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** Fixture-driven mock for `deleteObjectProperty`'s internal `findNamespaceOfClass` lookup (a
	 *  bare `GRAPH ?g` query, answered with the default namespace's schema graph), plus
	 *  `deletePropertyTriples`'s two new ASK checks (STORY-056): "does the property have an
	 *  `rdfs:domain`" (`hasDomain` — false only for a generic relation) and, only when it doesn't,
	 *  "does any *other* NodeShape still reference this property's `sh:path`" (`usedElsewhere`). */
	function mockDeleteFetch(fixture: { hasDomain: boolean; usedElsewhere?: boolean }) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: DEFAULT_GRAPHS.schema } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('rdfs:domain ?d')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.hasDomain }), { status: 200 });
			}
			if (q.includes('sh:property [ sh:path')) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.usedElsewhere ?? false }), { status: 200 });
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it("deleting a generic relation's edge that is still used by another class removes only this class's sh:property entry, leaving the shared declaration untouched", async () => {
		const project = classIri('Project');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const { fn, updates } = mockDeleteFetch({ hasDomain: false, usedElsewhere: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(usesIri, project);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`sh:path <${usesIri}>`);
		expect(updates[0]).not.toContain(`<${usesIri}> ?p ?o`);
	});

	it("deleting a generic relation's last remaining edge removes both the sh:property entry and the shared owl:ObjectProperty/rdfs:label declaration", async () => {
		const project = classIri('Project');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const { fn, updates } = mockDeleteFetch({ hasDomain: false, usedElsewhere: false });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(usesIri, project);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`sh:path <${usesIri}>`);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${usesIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});

	it('specific-relation deletion is unchanged: always deletes the property declaration, no reference-counting applied', async () => {
		const person = classIri('Person');
		const propIri = propertyIri(person, 'owns');
		const { fn, updates } = mockDeleteFetch({ hasDomain: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(propIri, person);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});

	it("deleting one target of a generic relation with multiple independent sh:property targets (data-catalog Story 018, multiple targets from the same source class) only drops that target, leaving the shape and the other target(s) untouched", async () => {
		const project = classIri('Project');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: DEFAULT_GRAPHS.schema } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('SELECT ?class ?name ?minCount ?maxCount')) {
				return new Response(
					JSON.stringify({
						head: { vars: [] },
						results: {
							bindings: [
								{ class: { type: 'uri', value: tool }, name: { type: 'literal', value: 'uses' } },
								{ class: { type: 'uri', value: ingredient }, name: { type: 'literal', value: 'uses' } }
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(usesIri, project, ingredient);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`sh:class <${tool}>`);
		expect(updates[0]).not.toContain(`sh:class <${ingredient}>`);
		expect(updates[0]).not.toContain(`<${usesIri}> ?p ?o`);
	});

	it("deleting a generic relation's target when it's the union's last remaining target falls through to full removal (reference-counted as usual)", async () => {
		const project = classIri('Project');
		const usesIri = `${DEFAULT_GRAPHS.schema}uses`;
		const tool = classIri('Tool');
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: DEFAULT_GRAPHS.schema } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('SELECT ?class ?name ?minCount ?maxCount')) {
				return new Response(
					JSON.stringify({
						head: { vars: [] },
						results: { bindings: [{ class: { type: 'uri', value: tool }, name: { type: 'literal', value: 'uses' } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('rdfs:domain ?d')) {
				return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
			}
			if (q.includes('sh:property [ sh:path')) {
				return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(usesIri, project, tool);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${usesIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});

	it('deleting a specific relation always fully removes it, even if dirty/duplicate sh:property blocks make its shape look like a multi-target union', async () => {
		// A specific relation (has rdfs:domain) is single-owner, single-target by construction —
		// `fetchGenericPropertyShapeDetails` reporting >1 "targets" here can only mean leftover,
		// duplicate `sh:property` blocks (e.g. from an earlier delete that didn't fully clean up).
		// `deleteObjectProperty` must not mistake that for a generic relation's `sh:or` union and
		// shrink it — it must still do the full, unconditional removal.
		const api = classIri('Api');
		const system = classIri('System');
		const component = classIri('Component');
		const propIri = propertyIri(api, 'isPartOf');
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g')) {
				return new Response(
					JSON.stringify({
						head: { vars: ['g'] },
						results: { bindings: [{ g: { type: 'uri', value: DEFAULT_GRAPHS.schema } }] }
					}),
					{ status: 200 }
				);
			}
			if (q.includes('rdfs:domain ?d')) {
				return new Response(JSON.stringify({ head: {}, boolean: true }), { status: 200 });
			}
			if (q.includes('SELECT ?class ?name ?minCount ?maxCount')) {
				return new Response(
					JSON.stringify({
						head: { vars: [] },
						results: {
							bindings: [
								{ class: { type: 'uri', value: system }, name: { type: 'literal', value: 'isPartOf' } },
								{ class: { type: 'uri', value: component }, name: { type: 'literal', value: 'isPartOf' } }
							]
						}
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.deleteObjectProperty(propIri, api, system);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`, DEFAULT_GRAPHS.schema)} }`
		);
	});
});

/**
 * Mocks the fetch calls `ensureDefaultWorkspace`/its backfill (STORY-075) issue: the completion-
 * marker `ASK`, `ensureWorkspaceClass`/`ensureWorkspaceMembershipClass`'s own-marker `ASK`s, the
 * Default workspace's own existence `ASK`, `addWorkspaceMember`'s per-element existence `ASK` (always
 * "new" here — every backfilled element is by definition not yet a member), and the "element already
 * has a membership row anywhere" enumeration `SELECT`. `fetchFullSchemaForAllNamespaces` itself is
 * stubbed per-test via `vi.spyOn` (mirroring the `fetchNameableEntities` tests above) rather than
 * mocked at the fetch layer — reaching it through `fetchNamespaces`+`fetchFullSchema` would need many
 * more query-shape branches for no extra coverage here.
 */
function mockDefaultWorkspaceFetch(
	fixture: {
		backfillComplete?: boolean;
		workspaceClassExists?: boolean;
		workspaceExists?: boolean;
		membershipClassExists?: boolean;
		alreadyMemberElementIris?: string[];
		/** Throws instead of succeeding on the update whose body contains this substring — simulates a
		 *  mid-backfill failure (STORY-075's failure-handling AC) at a specific, content-addressed step
		 *  rather than a brittle call-count index. */
		throwOnUpdateContaining?: string;
	} = {}
) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			if (fixture.throwOnUpdateContaining && (body.update as string).includes(fixture.throwOnUpdateContaining)) {
				throw new Error('simulated GraphDB failure');
			}
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		if (q.includes('ASK')) {
			if (q.includes(WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.backfillComplete ?? false }), {
					status: 200
				});
			}
			if (q.includes(`<${WORKSPACE_CLASS_IRI}> a owl:Class`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.workspaceClassExists ?? false }), {
					status: 200
				});
			}
			if (q.includes(`<${WORKSPACE_MEMBERSHIP_CLASS_IRI}> a owl:Class`)) {
				return new Response(
					JSON.stringify({ head: {}, boolean: fixture.membershipClassExists ?? false }),
					{ status: 200 }
				);
			}
			if (q.includes(`a <${WORKSPACE_MEMBERSHIP_CLASS_IRI}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
			}
			if (q.includes(`a <${WORKSPACE_CLASS_IRI}>`)) {
				return new Response(JSON.stringify({ head: {}, boolean: fixture.workspaceExists ?? false }), {
					status: 200
				});
			}
		}
		if (
			q.includes('SELECT ?element') &&
			q.includes(WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI) &&
			!q.includes(WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI)
		) {
			const iris = fixture.alreadyMemberElementIris ?? [];
			return new Response(
				JSON.stringify({
					head: { vars: ['element'] },
					results: { bindings: iris.map((iri) => ({ element: { type: 'uri', value: iri } })) }
				}),
				{ status: 200 }
			);
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn, updates };
}

function emptySchemaFixture() {
	return {
		classes: [],
		datatypeProperties: [],
		objectProperties: [],
		subClassOf: [],
		individuals: [],
		individualClassRelations: [],
		individualIndividualRelations: []
	};
}

describe('SparqlConnector — default Workspace migration and backfill (STORY-075)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const defaultWsIri = workspaceIri('Default');
	const classA = classIri('ClassA');
	const classB = classIri('ClassB');
	const individualI = individualIri(classA, 'InstanceI');

	it('creates exactly one Default workspace the first time it runs against a repository with none', async () => {
		const { fn, updates } = mockDefaultWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue(emptySchemaFixture());

		const iri = await connector.ensureDefaultWorkspace();

		expect(iri).toBe(defaultWsIri);
		expect(updates.some((u) => u.includes(`<${defaultWsIri}> a <${WORKSPACE_CLASS_IRI}>`) && u.includes('rdfs:label "Default"'))).toBe(true);
		expect(
			updates.some((u) => u.includes(`<${defaultWsIri}> <${WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI}> true`))
		).toBe(true);
	});

	it('is idempotent: a second run against an already-migrated repository issues only the marker ASK', async () => {
		const { fn, updates } = mockDefaultWorkspaceFetch({ backfillComplete: true });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const schemaSpy = vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue(emptySchemaFixture());

		const iri = await connector.ensureDefaultWorkspace();

		expect(iri).toBe(defaultWsIri);
		expect(fn).toHaveBeenCalledTimes(1); // only the completion-marker ASK
		expect(updates).toHaveLength(0);
		expect(schemaSpy).not.toHaveBeenCalled(); // the expensive enumeration is skipped entirely
	});

	it('concurrent calls converge on the same Default workspace IRI with identical declaration/marker triples', async () => {
		const { fn, updates } = mockDefaultWorkspaceFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue(emptySchemaFixture());

		const [iri1, iri2] = await Promise.all([connector.ensureDefaultWorkspace(), connector.ensureDefaultWorkspace()]);

		expect(iri1).toBe(defaultWsIri);
		expect(iri2).toBe(defaultWsIri);

		const declarationInserts = updates.filter((u) => u.includes(`<${defaultWsIri}> a <${WORKSPACE_CLASS_IRI}>`));
		expect(declarationInserts.length).toBeGreaterThan(0);
		expect(new Set(declarationInserts).size).toBe(1); // every racing insert wrote the identical triple

		const markerInserts = updates.filter((u) =>
			u.includes(`<${defaultWsIri}> <${WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI}> true`)
		);
		expect(new Set(markerInserts).size).toBe(1);
	});

	it('backfills only elements with no WorkspaceMembership row anywhere yet, at auto-grid positions', async () => {
		const { fn, updates } = mockDefaultWorkspaceFetch({ alreadyMemberElementIris: [classA] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			...emptySchemaFixture(),
			classes: [
				{ iri: classA, label: 'ClassA', comment: null, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI },
				{ iri: classB, label: 'ClassB', comment: null, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }
			],
			individuals: [
				{
					iri: individualI,
					label: 'InstanceI',
					classIri: classA,
					namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI,
					syncSource: null,
					syncStatus: null
				}
			]
		});

		await connector.ensureDefaultWorkspace();

		// classA already had a membership row (in some Workspace) — not re-added.
		expect(updates.some((u) => u.includes(`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${classA}>`))).toBe(
			false
		);

		const classBInsert = updates.find((u) => u.includes(`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${classB}>`));
		const individualIInsert = updates.find((u) =>
			u.includes(`<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${individualI}>`)
		);
		expect(classBInsert).toBeDefined();
		expect(individualIInsert).toBeDefined();

		// gridPosition(0) = {x:0,y:0}, gridPosition(1) = {x:260,y:0} — classB backfilled before individualI.
		expect(classBInsert).toContain(`<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "0"^^xsd:decimal`);
		expect(classBInsert).toContain(`<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "0"^^xsd:decimal`);
		expect(individualIInsert).toContain(`<${WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI}> "260"^^xsd:decimal`);
		expect(individualIInsert).toContain(`<${WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI}> "0"^^xsd:decimal`);
	});

	it('leaves no completion marker behind if the backfill throws partway (e.g. mid-element-insert), so the next call retries from scratch', async () => {
		// Throws specifically on the membership-triple insert for classA — a mid-backfill failure,
		// not merely a failure during the earlier Workspace-declaration step.
		const { fn, updates } = mockDefaultWorkspaceFetch({
			throwOnUpdateContaining: `<${WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI}> <${classA}>`
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue({
			...emptySchemaFixture(),
			classes: [{ iri: classA, label: 'ClassA', comment: null, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI }]
		});

		await expect(connector.ensureDefaultWorkspace()).rejects.toThrow('simulated GraphDB failure');

		// The Workspace itself was created (visible on retry as an idempotent no-op), but backfill
		// never reached the completion marker.
		expect(updates.some((u) => u.includes(`<${defaultWsIri}> a <${WORKSPACE_CLASS_IRI}>`))).toBe(true);
		expect(updates.some((u) => u.includes(WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI))).toBe(false);
	});
});

// -- Identity browsing (STORY-115/116/117, `spec/browse-identity/plan.md`) ------------------------

/** Mocks the single `SELECT ?i ?type ?label ?ig ?syncSource ?syncStatus` query `searchIndividuals`
 *  issues — captures the emitted query text and answers with `bindings` regardless of its filters
 *  (the filter-narrowing itself lives in the query string, which individual tests assert on
 *  directly, mirroring how a real GraphDB would apply the same `FILTER`s server-side). */
function mockSearchIndividualsFetch(bindings: SparqlBinding[] = []) {
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		queries.push(body.query as string);
		return new Response(
			JSON.stringify({ head: { vars: ['i', 'type', 'label', 'ig', 'syncSource', 'syncStatus'] }, results: { bindings } }),
			{ status: 200 }
		);
	});
	return { fn, queries };
}

describe('SparqlConnector — searchIndividuals (STORY-115)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personClass = classIri('Person');
	const alice = individualIri(personClass, 'Alice');
	const bob = individualIri(personClass, 'Bob');

	function aliceBinding(overrides: Partial<Record<string, { type: string; value: string }>> = {}): SparqlBinding {
		return {
			i: { type: 'uri', value: alice },
			type: { type: 'uri', value: personClass },
			label: { type: 'literal', value: 'Alice' },
			ig: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI },
			...overrides
		};
	}

	it('text-only search filters by rdfs:label via CONTAINS/LCASE, escaped like every other connector method', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.searchIndividuals({ query: 'ali"ce' });

		expect(queries[0]).toContain('CONTAINS(LCASE(STR(?label)), LCASE("ali\\"ce"))');
		expect(page.results).toEqual([
			{ iri: alice, label: 'Alice', classIri: personClass, namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI, syncSource: null, syncStatus: null }
		]);
		expect(page.hasMore).toBe(false);
	});

	it('an empty/undefined query applies no label filter at all', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({});

		expect(queries[0]).not.toContain('CONTAINS');
	});

	it('classIri facet narrows via FILTER(?type = <...>), validated through assertSafeSparqlIri', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ classIri: personClass });

		expect(queries[0]).toContain(`FILTER(?type = <${personClass}>)`);

		await expect(connector.searchIndividuals({ classIri: 'not a safe iri' })).rejects.toThrow(
			/Invalid class IRI/
		);
	});

	it('namespaceBaseIri facet narrows via FILTER(?ig = <...>), the graph var doubling as namespace', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI });

		expect(queries[0]).toContain(`FILTER(?ig = <${DEFAULT_NAMESPACE_BASE_IRI}>)`);

		await expect(connector.searchIndividuals({ namespaceBaseIri: '<bad>' })).rejects.toThrow(
			/Invalid namespace base IRI/
		);
	});

	it('syncSource facet is an exact match, not a substring match', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([
			aliceBinding({ syncSource: { type: 'literal', value: 'backstage' } })
		]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.searchIndividuals({ syncSource: 'backstage' });

		expect(queries[0]).toContain('FILTER(BOUND(?syncSource) && STR(?syncSource) = "backstage")');
		expect(page.results[0].syncSource).toBe('backstage');
	});

	it('syncStatus facet is an exact match', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([
			aliceBinding({ syncStatus: { type: 'literal', value: 'stale' } })
		]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ syncStatus: 'stale' });

		expect(queries[0]).toContain('FILTER(BOUND(?syncStatus) && STR(?syncStatus) = "stale")');
	});

	it('combining classIri + syncStatus ANDs both filters into the same WHERE — an intersection, not a union of two separate queries', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ classIri: personClass, syncStatus: 'stale' });

		expect(fn).toHaveBeenCalledTimes(1);
		expect(queries[0]).toContain(`FILTER(?type = <${personClass}>)`);
		expect(queries[0]).toContain('FILTER(BOUND(?syncStatus) && STR(?syncStatus) = "stale")');
	});

	it('classIris facet narrows via FILTER(?type IN (...)), matching any of the given IRIs', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const childClass = classIri('Employee');
		await connector.searchIndividuals({ classIris: [personClass, childClass] });

		expect(queries[0]).toContain(`FILTER(?type IN (<${personClass}>, <${childClass}>))`);

		await expect(connector.searchIndividuals({ classIris: [personClass, 'not a safe iri'] })).rejects.toThrow(
			/Invalid class IRI/
		);
	});

	it('classIris takes precedence over classIri when both are given', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const childClass = classIri('Employee');
		await connector.searchIndividuals({ classIri: personClass, classIris: [childClass] });

		expect(queries[0]).toContain(`FILTER(?type IN (<${childClass}>))`);
		expect(queries[0]).not.toContain(`FILTER(?type = <${personClass}>)`);
	});

	it('pagination: limit/offset are interpolated, and a page fetches one extra row to compute hasMore', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding(), aliceBinding({ i: { type: 'uri', value: bob } })]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.searchIndividuals({ limit: 1, offset: 2 });

		expect(queries[0]).toContain('LIMIT 2');
		expect(queries[0]).toContain('OFFSET 2');
		expect(page.results).toHaveLength(1);
		expect(page.hasMore).toBe(true);
	});

	it('a page with fewer rows than limit + 1 reports hasMore: false', async () => {
		const { fn } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.searchIndividuals({ limit: 50 });

		expect(page.results).toHaveLength(1);
		expect(page.hasMore).toBe(false);
	});

	it('excludes schema/shapes constructs via the same ?type a owl:Class join + Note/Workspace exclusion fetchAllIndividuals uses, with no FROM mixed into the unrestricted GRAPH ?var blocks', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([aliceBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({});

		expect(queries[0]).toContain('GRAPH ?classGraph { ?type a owl:Class }');
		expect(queries[0]).toContain(`FILTER(?type NOT IN (<${NOTE_CLASS_IRI}>, <${WORKSPACE_CLASS_IRI}>, <${ANNOTATION_CLASS_IRI}>, <${ANNOTATION_LABEL_CLASS_IRI}>))`);
		expect(queries[0]).toContain('FILTER(isBlank(?i)');
		expect(queries[0]).not.toMatch(/\bFROM\b/);
	});

	it('label fallback: a result with no rdfs:label falls back to extractLocalName', async () => {
		const { fn } = mockSearchIndividualsFetch([aliceBinding({ label: undefined as unknown as SparqlBinding['label'] })]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.searchIndividuals({});

		expect(page.results[0].label).toBe(extractLocalName(alice));
	});
});

describe('SparqlConnector — searchIndividuals all-strings mode (STORY-186)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personClass = classIri('Person');
	const alice = individualIri(personClass, 'Alice');
	const hostProp = `${DEFAULT_NAMESPACE_BASE_IRI}#hostname`;

	function hitBinding(overrides: Partial<Record<string, { type: string; value: string }>> = {}): SparqlBinding {
		return {
			i: { type: 'uri', value: alice },
			type: { type: 'uri', value: personClass },
			label: { type: 'literal', value: 'Alice' },
			ig: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI },
			matchedProperty: { type: 'uri', value: hostProp },
			matchedValue: { type: 'literal', value: 'sap-prod-01' },
			...overrides
		};
	}

	it('matches any literal object of the individual and reports the matched property/value', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([hitBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.searchIndividuals({ query: 'sap', matchAllStringProperties: true });

		expect(queries[0]).toContain('?i ?mp ?mv');
		expect(queries[0]).toContain('isLiteral(?mv)');
		expect(queries[0]).toContain('CONTAINS(LCASE(STR(?mv)), LCASE("sap"))');
		expect(queries[0]).not.toContain('CONTAINS(LCASE(STR(?label))');
		expect(page.results[0]).toMatchObject({
			iri: alice,
			matchedPropertyIri: hostProp,
			matchedValue: 'sap-prod-01'
		});
	});

	it('collapses multiple matching literals of one individual to one hit via GROUP BY/SAMPLE', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([hitBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ query: 'sap', matchAllStringProperties: true });

		expect(queries[0]).toContain('(SAMPLE(?mp) AS ?matchedProperty)');
		expect(queries[0]).toContain('GROUP BY');
	});

	it('keeps the same exclusions, never mixes FROM with GRAPH, and excludes rdf:Statement nodes', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([hitBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ query: 'sap', matchAllStringProperties: true });

		expect(queries[0]).toContain(`FILTER(?type NOT IN (<${NOTE_CLASS_IRI}>, <${WORKSPACE_CLASS_IRI}>, <${ANNOTATION_CLASS_IRI}>, <${ANNOTATION_LABEL_CLASS_IRI}>))`);
		expect(queries[0]).toContain('FILTER(?type != rdf:Statement)');
		expect(queries[0]).not.toMatch(/\bFROM\b/);
	});

	it('escapes quotes, backslashes and newlines in the term', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ query: 'a"b\\c\nd', matchAllStringProperties: true });

		expect(queries[0]).toContain('LCASE("a\\"b\\\\c\\nd")');
	});

	it('returns an empty page without querying for terms shorter than 2 characters', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([hitBinding()]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.searchIndividuals({ query: 's', matchAllStringProperties: true });

		expect(queries).toHaveLength(0);
		expect(page).toEqual({ results: [], hasMore: false });
	});

	it('default (label-only) mode is unchanged: no matched-property pattern', async () => {
		const { fn, queries } = mockSearchIndividualsFetch([]);
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.searchIndividuals({ query: 'sap' });

		expect(queries[0]).not.toContain('matchedProperty');
		expect(queries[0]).not.toContain('GROUP BY');
	});
});

describe('SparqlConnector — searchIndividualFacetCounts (STORY-186)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personClass = classIri('Person');

	function mockFacetFetch() {
		const queries: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const q: string = JSON.parse(opts.body).query;
			queries.push(q);
			const bindings = q.includes('GROUP BY ?type')
				? [{ type: { type: 'uri', value: personClass }, count: { type: 'literal', value: '12' } }]
				: [{ ig: { type: 'uri', value: DEFAULT_NAMESPACE_BASE_IRI }, count: { type: 'literal', value: '7' } }];
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });
		});
		return { fn, queries };
	}

	it('returns class and namespace counts for the whole match set, with no LIMIT/OFFSET', async () => {
		const { fn, queries } = mockFacetFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const counts = await connector.searchIndividualFacetCounts({ query: 'sap' });

		expect(counts.byClass).toEqual([{ classIri: personClass, count: 12 }]);
		expect(counts.byNamespace).toEqual([{ namespaceBaseIri: DEFAULT_NAMESPACE_BASE_IRI, count: 7 }]);
		for (const q of queries) {
			expect(q).toContain('COUNT(DISTINCT ?i)');
			expect(q).not.toMatch(/\bLIMIT\b|\bOFFSET\b/);
			expect(q).not.toMatch(/\bFROM\b/);
			expect(q).toContain('LCASE("sap")');
		}
	});

	it('returns empty counts without querying for a too-short term', async () => {
		const { fn, queries } = mockFacetFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const counts = await connector.searchIndividualFacetCounts({ query: 'x' });

		expect(queries).toHaveLength(0);
		expect(counts).toEqual({ byClass: [], byNamespace: [] });
	});
});

/** Mocks `fetchResourcePage`'s two independent SELECT calls (outgoing then incoming, order-agnostic
 *  since `Promise.all` doesn't guarantee call order) — distinguished by which variable pattern each
 *  query's `WHERE` clause opens with. */
function mockResourcePageFetch(fixture: { outgoing?: SparqlBinding[]; incoming?: SparqlBinding[] } = {}) {
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		const q: string = body.query;
		if (q.includes('?p ?o ?pLabel ?oLabel')) {
			return new Response(
				JSON.stringify({ head: { vars: ['p', 'o', 'pLabel', 'oLabel'] }, results: { bindings: fixture.outgoing ?? [] } }),
				{ status: 200 }
			);
		}
		if (q.includes('?s ?p ?sLabel ?pLabel')) {
			return new Response(
				JSON.stringify({ head: { vars: ['s', 'p', 'sLabel', 'pLabel'] }, results: { bindings: fixture.incoming ?? [] } }),
				{ status: 200 }
			);
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
	});
	return { fn };
}

describe('SparqlConnector — fetchResourcePage (STORY-116)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personClass = classIri('Person');
	const alice = individualIri(personClass, 'Alice');
	const bob = individualIri(personClass, 'Bob');
	const knows = propertyIri(personClass, 'knows');

	it('validates the target IRI via assertSafeSparqlIri before issuing any request', async () => {
		const { fn } = mockResourcePageFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchResourcePage('not a safe iri')).rejects.toThrow(/Invalid resource IRI/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('outgoing-only: every <iri> ?p ?o triple, predicate label resolved', async () => {
		const { fn } = mockResourcePageFetch({
			outgoing: [
				{
					p: { type: 'uri', value: knows },
					pLabel: { type: 'literal', value: 'knows' },
					o: { type: 'uri', value: bob }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.iri).toBe(alice);
		expect(page.outgoing).toEqual([
			{
				predicateIri: knows,
				predicateLabel: 'knows',
				object: bob,
				objectType: 'uri',
				objectDatatype: undefined,
				objectLabel: undefined,
				predicateGroupOnOneLine: false,
				predicateDisplayAsChips: false
			}
		]);
		expect(page.incoming).toEqual([]);
	});

	it('resolves a URI object\'s own rdfs:label, distinct from the predicate label', async () => {
		const { fn } = mockResourcePageFetch({
			outgoing: [
				{
					p: { type: 'uri', value: knows },
					pLabel: { type: 'literal', value: 'knows' },
					o: { type: 'uri', value: bob },
					oLabel: { type: 'literal', value: 'Bob' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.outgoing[0].objectLabel).toBe('Bob');
	});

	it('leaves objectLabel undefined for a literal object, even if oLabel somehow binds', async () => {
		const born = propertyIri(personClass, 'bornOn');
		const { fn } = mockResourcePageFetch({
			outgoing: [
				{
					p: { type: 'uri', value: born },
					o: { type: 'literal', value: '1990-01-01', datatype: 'http://www.w3.org/2001/XMLSchema#date' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.outgoing[0].objectLabel).toBeUndefined();
	});

	it('resolves the groupOnOneLine/displayAsChips markers per predicate when asserted', async () => {
		const tags = propertyIri(personClass, 'tags');
		const { fn } = mockResourcePageFetch({
			outgoing: [
				{
					p: { type: 'uri', value: tags },
					o: { type: 'literal', value: 'go' },
					pGroupOnOneLine: { type: 'literal', value: 'true' },
					pDisplayAsChips: { type: 'literal', value: 'true' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.outgoing[0].predicateGroupOnOneLine).toBe(true);
		expect(page.outgoing[0].predicateDisplayAsChips).toBe(true);
	});

	it('incoming-only: every ?s ?p <iri> triple ("what links here"), subject + predicate labels resolved', async () => {
		const { fn } = mockResourcePageFetch({
			incoming: [
				{
					s: { type: 'uri', value: bob },
					sLabel: { type: 'literal', value: 'Bob' },
					p: { type: 'uri', value: knows },
					pLabel: { type: 'literal', value: 'knows' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.outgoing).toEqual([]);
		expect(page.incoming).toEqual([
			{ subjectIri: bob, subjectLabel: 'Bob', predicateIri: knows, predicateLabel: 'knows' }
		]);
	});

	it('both outgoing and incoming triples populate together in one call', async () => {
		const { fn } = mockResourcePageFetch({
			outgoing: [{ p: { type: 'uri', value: knows }, o: { type: 'uri', value: bob } }],
			incoming: [{ s: { type: 'uri', value: bob }, p: { type: 'uri', value: knows } }]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.outgoing).toHaveLength(1);
		expect(page.incoming).toHaveLength(1);
	});

	it('distinguishes literal vs. URI objects, carrying the datatype IRI for typed literals', async () => {
		const born = propertyIri(personClass, 'bornOn');
		const { fn } = mockResourcePageFetch({
			outgoing: [
				{
					p: { type: 'uri', value: knows },
					o: { type: 'uri', value: bob }
				},
				{
					p: { type: 'uri', value: born },
					o: { type: 'literal', value: '1990-01-01', datatype: 'http://www.w3.org/2001/XMLSchema#date' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.outgoing[0]).toMatchObject({ objectType: 'uri', objectDatatype: undefined });
		expect(page.outgoing[1]).toMatchObject({
			objectType: 'literal',
			object: '1990-01-01',
			objectDatatype: 'http://www.w3.org/2001/XMLSchema#date'
		});
	});

	it('a predicate/subject with no rdfs:label falls back to extractLocalName, matching extractLabel semantics', async () => {
		const { fn } = mockResourcePageFetch({
			outgoing: [{ p: { type: 'uri', value: knows }, o: { type: 'uri', value: bob } }],
			incoming: [{ s: { type: 'uri', value: bob }, p: { type: 'uri', value: knows } }]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page.outgoing[0].predicateLabel).toBe(extractLocalName(knows));
		expect(page.incoming[0].subjectLabel).toBe(extractLocalName(bob));
	});

	it('an IRI with zero outgoing and zero incoming triples returns empty arrays, not an error', async () => {
		const { fn } = mockResourcePageFetch({ outgoing: [], incoming: [] });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const page = await connector.fetchResourcePage(alice);

		expect(page).toEqual({ iri: alice, outgoing: [], incoming: [] });
	});
});

describe('SparqlConnector — buildResourcePageQuery', () => {
	const personClass = classIri('Person');
	const alice = individualIri(personClass, 'Alice');

	it('validates the target IRI, throwing before building anything', () => {
		const connector = new SparqlConnector('/api/sparql');
		expect(() => connector.buildResourcePageQuery('not a safe iri')).toThrow(/Invalid resource IRI/);
	});

	it('returns a single UNION-merged, pasteable SELECT covering both outgoing and incoming triples', () => {
		const connector = new SparqlConnector('/api/sparql');
		const query = connector.buildResourcePageQuery(alice);

		expect(query.match(/\bSELECT\b/g)).toHaveLength(1);
		expect(query).toContain('UNION');
		expect(query).toContain('BIND("outgoing" AS ?direction)');
		expect(query).toContain('BIND("incoming" AS ?direction)');
		expect(query.split(`<${alice}>`).length - 1).toBe(2);
	});
});

/** Mocks `fetchIdentityNeighborhood`'s two SELECT calls: a `VALUES ?i {...}` seed-info lookup and a
 *  `UNION`-branched outgoing/incoming edge lookup, distinguished by the presence of `UNION`. */
function mockNeighborhoodFetch(fixture: { seeds?: SparqlBinding[]; links?: SparqlBinding[] } = {}) {
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		const q: string = body.query;
		queries.push(q);
		if (q.includes('UNION')) {
			return new Response(
				JSON.stringify({
					head: { vars: ['source', 'predicate', 'target'] },
					results: { bindings: fixture.links ?? [] }
				}),
				{ status: 200 }
			);
		}
		return new Response(
			JSON.stringify({ head: { vars: ['i', 'type', 'label', 'ig'] }, results: { bindings: fixture.seeds ?? [] } }),
			{ status: 200 }
		);
	});
	return { fn, queries };
}

describe('SparqlConnector — fetchIdentityNeighborhood (STORY-117)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const personClass = classIri('Person');
	const alice = individualIri(personClass, 'Alice');
	const bob = individualIri(personClass, 'Bob');
	const carol = individualIri(personClass, 'Carol');
	const knows = propertyIri(personClass, 'knows');

	it('depth <= 0 or an empty seed list short-circuits to an empty graph without any request', async () => {
		const { fn } = mockNeighborhoodFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		expect(await connector.fetchIdentityNeighborhood([alice], 0)).toEqual({ nodes: [], links: [] });
		expect(await connector.fetchIdentityNeighborhood([], 1)).toEqual({ nodes: [], links: [] });
		expect(fn).not.toHaveBeenCalled();
	});

	it('validates every seed IRI via assertSafeSparqlIri before issuing any request', async () => {
		const { fn } = mockNeighborhoodFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.fetchIdentityNeighborhood([alice, 'not safe'], 1)).rejects.toThrow(/Invalid seed IRI/);
		expect(fn).not.toHaveBeenCalled();
	});

	it('outgoing edges: seed as source, target resolved as a node with its own classIri', async () => {
		const { fn, queries } = mockNeighborhoodFetch({
			seeds: [
				{
					i: { type: 'uri', value: alice },
					type: { type: 'uri', value: personClass },
					label: { type: 'literal', value: 'Alice' },
					ig: { type: 'uri', value: DEFAULT_GRAPHS.instances }
				}
			],
			links: [
				{
					source: { type: 'uri', value: alice },
					predicate: { type: 'uri', value: knows },
					target: { type: 'uri', value: bob },
					targetLabel: { type: 'literal', value: 'Bob' },
					targetType: { type: 'uri', value: personClass },
					targetTypeGraph: { type: 'uri', value: DEFAULT_GRAPHS.instances },
					predicateLabel: { type: 'literal', value: 'knows' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const graph = await connector.fetchIdentityNeighborhood([alice], 1);

		expect(graph.links).toEqual([{ source: alice, target: bob, predicateIri: knows, predicateLabel: 'knows' }]);
		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				{ iri: alice, label: 'Alice', classIri: personClass, namespaceBaseIri: DEFAULT_GRAPHS.instances },
				{ iri: bob, label: 'Bob', classIri: personClass, namespaceBaseIri: DEFAULT_GRAPHS.instances }
			])
		);
		expect(queries.some((q) => q.includes(`VALUES ?source { <${alice}> }`))).toBe(true);
	});

	it('incoming edges: seed as target, source resolved as a node', async () => {
		const { fn } = mockNeighborhoodFetch({
			seeds: [
				{
					i: { type: 'uri', value: alice },
					type: { type: 'uri', value: personClass },
					label: { type: 'literal', value: 'Alice' },
					ig: { type: 'uri', value: DEFAULT_GRAPHS.instances }
				}
			],
			links: [
				{
					source: { type: 'uri', value: carol },
					predicate: { type: 'uri', value: knows },
					target: { type: 'uri', value: alice },
					sourceLabel: { type: 'literal', value: 'Carol' },
					sourceType: { type: 'uri', value: personClass },
					sourceTypeGraph: { type: 'uri', value: DEFAULT_GRAPHS.instances },
					predicateLabel: { type: 'literal', value: 'knows' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const graph = await connector.fetchIdentityNeighborhood([alice], 1);

		expect(graph.links).toEqual([
			{ source: carol, target: alice, predicateIri: knows, predicateLabel: 'knows' }
		]);
		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				{ iri: carol, label: 'Carol', classIri: personClass, namespaceBaseIri: DEFAULT_GRAPHS.instances }
			])
		);
	});

	it('both outgoing and incoming edges of the seed are fetched in one call', async () => {
		const { fn } = mockNeighborhoodFetch({
			seeds: [
				{
					i: { type: 'uri', value: alice },
					type: { type: 'uri', value: personClass },
					ig: { type: 'uri', value: DEFAULT_GRAPHS.instances }
				}
			],
			links: [
				{
					source: { type: 'uri', value: alice },
					predicate: { type: 'uri', value: knows },
					target: { type: 'uri', value: bob },
					targetType: { type: 'uri', value: personClass },
					targetTypeGraph: { type: 'uri', value: DEFAULT_GRAPHS.instances }
				},
				{
					source: { type: 'uri', value: carol },
					predicate: { type: 'uri', value: knows },
					target: { type: 'uri', value: alice },
					sourceType: { type: 'uri', value: personClass },
					sourceTypeGraph: { type: 'uri', value: DEFAULT_GRAPHS.instances }
				}
			]
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const graph = await connector.fetchIdentityNeighborhood([alice], 1);

		expect(graph.links).toHaveLength(2);
		expect(fn).toHaveBeenCalledTimes(2); // one seed-info call, one edge call
	});

	it('the query requires each endpoint to carry a type that is itself a declared owl:Class, plus Note/Workspace exclusion and VOCAB_FILTER — excluding classes/properties/shapes from node results', async () => {
		const { fn, queries } = mockNeighborhoodFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchIdentityNeighborhood([alice], 1);

		const seedQuery = queries.find((q) => !q.includes('UNION'))!;
		expect(seedQuery).toContain('GRAPH ?classGraph { ?type a owl:Class }');
		expect(seedQuery).toContain(`FILTER(?type NOT IN (<${NOTE_CLASS_IRI}>, <${WORKSPACE_CLASS_IRI}>, <${ANNOTATION_CLASS_IRI}>, <${ANNOTATION_LABEL_CLASS_IRI}>))`);

		const linkQuery = queries.find((q) => q.includes('UNION'))!;
		expect(linkQuery).toContain('GRAPH ?sourceClassGraph { ?sourceType a owl:Class }');
		expect(linkQuery).toContain('GRAPH ?targetClassGraph { ?targetType a owl:Class }');
		expect(linkQuery).toContain(`FILTER(?sourceType NOT IN (<${NOTE_CLASS_IRI}>, <${WORKSPACE_CLASS_IRI}>, <${ANNOTATION_CLASS_IRI}>, <${ANNOTATION_LABEL_CLASS_IRI}>))`);
		expect(linkQuery).toContain(`FILTER(?targetType NOT IN (<${NOTE_CLASS_IRI}>, <${WORKSPACE_CLASS_IRI}>, <${ANNOTATION_CLASS_IRI}>, <${ANNOTATION_LABEL_CLASS_IRI}>))`);
		expect(linkQuery).toContain('FILTER(isBlank(?source)');
		expect(linkQuery).toContain('FILTER(isBlank(?target)');
	});

	it('excludes structural/ontology predicates (rdf:type, rdfs:subClassOf, skos:broader/inScheme/topConceptOf) from edges', async () => {
		const { fn, queries } = mockNeighborhoodFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchIdentityNeighborhood([alice], 1);

		const linkQuery = queries.find((q) => q.includes('UNION'))!;
		expect(linkQuery).toContain(`?predicate != <${RDF.type}>`);
		expect(linkQuery).toContain(`?predicate != <${RDFS.subClassOf}>`);
		expect(linkQuery).toContain('?predicate != <http://www.w3.org/2004/02/skos/core#broader>');
		expect(linkQuery).toContain('?predicate != <http://www.w3.org/2004/02/skos/core#inScheme>');
		expect(linkQuery).toContain('?predicate != <http://www.w3.org/2004/02/skos/core#topConceptOf>');
	});

	it('caps the edge query with an explicit LIMIT so one highly-connected node cannot return an unbounded neighborhood', async () => {
		const { fn, queries } = mockNeighborhoodFetch();
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchIdentityNeighborhood([alice], 1);

		const linkQuery = queries.find((q) => q.includes('UNION'))!;
		expect(linkQuery).toContain('LIMIT 500');
	});
});

describe('SparqlConnector — fetchInConstraints (query-workbench STORY-174)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('groups sh:in values per class+property and keeps IRI/literal kind', async () => {
		const fn = vi.fn(async (_url: string, _opts: { body: string }) =>
			new Response(
				JSON.stringify({
					head: { vars: ['class', 'path', 'value'] },
					results: {
						bindings: [
							{ class: { type: 'uri', value: 'urn:C' }, path: { type: 'uri', value: 'urn:p' }, value: { type: 'literal', value: 'A' } },
							{ class: { type: 'uri', value: 'urn:C' }, path: { type: 'uri', value: 'urn:p' }, value: { type: 'uri', value: 'urn:m' } },
							{ class: { type: 'uri', value: 'urn:C' }, path: { type: 'uri', value: 'urn:q' }, value: { type: 'literal', value: 'Z' } }
						]
					}
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.fetchInConstraints();
		expect(result).toEqual([
			{ classIri: 'urn:C', propertyIri: 'urn:p', values: [{ value: 'A', isIri: false }, { value: 'urn:m', isIri: true }] },
			{ classIri: 'urn:C', propertyIri: 'urn:q', values: [{ value: 'Z', isIri: false }] }
		]);
		const body = decodeURIComponent(fn.mock.calls[0][1].body.replace(/\+/g, ' '));
		expect(body).toContain('sh:in');
		expect(body).toContain('/shapes');
	});
});

describe('SparqlConnector — SavedQuery workbench fields (STORY-178)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const modelJson = '{"version":1,"note":"say \\"hi\\"\\n\\\\ done"}';

	it('insertSavedQuery with a workbench model stores model, createdBy, createdAt and published=false in one update', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: true, savedQueryExists: false });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const iri = await connector.insertSavedQuery('Apps by owner', 'SELECT ?x WHERE { ?x a ?t }', undefined, {
			queryModelJson: modelJson,
			createdBy: 'alice',
			createdAt: '2026-10-10T12:00:00.000Z'
		});

		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`<${iri}> a <${SAVED_QUERY_CLASS_IRI}>`);
		expect(u).toContain(`<${SAVED_QUERY_TEXT_PREDICATE_IRI}> "SELECT ?x WHERE { ?x a ?t }"`);
		expect(u).toContain(`<${SAVED_QUERY_CREATED_BY_PREDICATE_IRI}> "alice"`);
		expect(u).toContain(`<${SAVED_QUERY_CREATED_AT_PREDICATE_IRI}> "2026-10-10T12:00:00.000Z"^^xsd:dateTime`);
		expect(u).toContain(`<${SAVED_QUERY_PUBLISHED_PREDICATE_IRI}> "false"^^xsd:boolean`);
		expect(u).not.toContain('"true"^^xsd:boolean');
		expect(u).toContain(`<${SAVED_QUERY_MODEL_PREDICATE_IRI}> `);
	});

	it('stores the model JSON as an escaped literal that unescapes byte-identical', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: true, savedQueryExists: false });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.insertSavedQuery('Escapes', 'SELECT 1', undefined, {
			queryModelJson: modelJson, createdBy: 'a', createdAt: '2026-01-01T00:00:00.000Z'
		});
		const m = updates[0].match(new RegExp(`<${SAVED_QUERY_MODEL_PREDICATE_IRI}> "((?:[^"\\\\]|\\\\.)*)"`));
		expect(m).not.toBeNull();
		const unescaped = m![1].replace(/\\(["\\nr])/g, (_a, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));
		expect(unescaped).toBe(modelJson);
		expect(m![1]).not.toMatch(/[\n\r]/);
	});

	it('legacy insertSavedQuery writes none of the workbench predicates', async () => {
		const { fn, updates } = mockSavedQueryFetch({ savedQueryClassExists: true, savedQueryExists: false });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.insertSavedQuery('Legacy', 'SELECT 1');
		for (const p of [
			SAVED_QUERY_MODEL_PREDICATE_IRI, SAVED_QUERY_CREATED_BY_PREDICATE_IRI,
			SAVED_QUERY_CREATED_AT_PREDICATE_IRI, SAVED_QUERY_PUBLISHED_PREDICATE_IRI
		]) expect(updates[0]).not.toContain(p);
	});

	it('updateSavedQueryModel rewrites model and compiled SPARQL in a single update', async () => {
		const { fn, updates } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const iri = savedQueryIri('Apps by owner');
		await connector.updateSavedQueryModel(iri, '{"version":1}', 'SELECT 2');
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${SAVED_QUERY_MODEL_PREDICATE_IRI}> ?oldModel`);
		expect(updates[0]).toContain(`<${SAVED_QUERY_MODEL_PREDICATE_IRI}> "{\\"version\\":1}"`);
		expect(updates[0]).toContain(`<${SAVED_QUERY_TEXT_PREDICATE_IRI}> "SELECT 2"`);
		expect(updates[0]).not.toContain(SAVED_QUERY_PUBLISHED_PREDICATE_IRI);
	});

	it('updateSavedQueryModel rejects empty text and unsafe IRIs without a request', async () => {
		const { fn } = mockSavedQueryFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.updateSavedQueryModel(savedQueryIri('x'), '{}', '  ')).rejects.toThrow();
		await expect(connector.updateSavedQueryModel('urn:bad>x', '{}', 'SELECT 1')).rejects.toThrow();
		expect(fn).not.toHaveBeenCalled();
	});

	it('fetchSavedQueries maps new fields, defaulting published=false and leaving legacy model undefined', async () => {
		const row = (iri: string, extra: Record<string, string> = {}) => ({
			sq: { type: 'uri', value: iri },
			label: { type: 'literal', value: 'L' },
			text: { type: 'literal', value: 'SELECT 1' },
			...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { type: 'literal', value: v }]))
		});
		const fn = vi.fn(async () =>
			new Response(JSON.stringify({
				head: { vars: [] },
				results: { bindings: [
					row('urn:wb', { model: '{"version":1}', createdBy: 'alice', createdAt: '2026-01-01T00:00:00Z', published: 'false' }),
					row('urn:legacy')
				] }
			}), { status: 200 })
		);
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		const [wb, legacy] = await connector.fetchSavedQueries();
		expect(wb).toMatchObject({ queryModel: '{"version":1}', createdBy: 'alice', createdAt: '2026-01-01T00:00:00Z', published: false });
		expect(legacy.queryModel).toBeUndefined();
		expect(legacy.createdBy).toBeUndefined();
		expect(legacy.published).toBe(false);
		expect(legacy).toMatchObject({ iri: 'urn:legacy', label: 'L', sparqlText: 'SELECT 1', description: '' });
	});
});

describe('SparqlConnector — annotation vocabulary (query-workbench STORY-180)', () => {
	afterEach(() => vi.unstubAllGlobals());

	function mockAnnotationSeedFetch(fixture: { classes?: string[]; members?: string[] } = {}) {
		const updates: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			if (q.includes('ASK')) {
				const hit = (fixture.classes ?? []).some((c) => q.includes(`<${c}> a owl:Class`));
				return new Response(JSON.stringify({ head: {}, boolean: hit }), { status: 200 });
			}
			if (q.includes(`a <${ANNOTATION_LABEL_CLASS_IRI}>`)) {
				return new Response(JSON.stringify({
					head: { vars: ['m'] },
					results: { bindings: (fixture.members ?? []).map((m) => ({ m: { type: 'uri', value: m } })) }
				}), { status: 200 });
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates };
	}

	it('ensureAnnotationClasses declares both classes and seeds the four labels once', async () => {
		const { fn, updates } = mockAnnotationSeedFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').ensureAnnotationClasses();
		const all = updates.join('\n');
		expect(all).toContain(`<${ANNOTATION_CLASS_IRI}> a owl:Class`);
		expect(all).toContain(`<${ANNOTATION_LABEL_CLASS_IRI}> a owl:Class`);
		for (const l of SEED_ANNOTATION_LABELS) expect(all).toContain(`rdfs:label "${l}"`);
		expect(all.match(/a <http[^>]*AnnotationLabel>/g)).toHaveLength(4);
	});

	it('ensureAnnotationClasses is idempotent: a second call inserts nothing', async () => {
		const first = mockAnnotationSeedFetch();
		vi.stubGlobal('fetch', first.fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.ensureAnnotationClasses();
		const members = [...first.updates.join('\n').matchAll(/<([^>]+)> a <[^>]*AnnotationLabel>/g)].map((m) => m[1]);
		expect(members).toHaveLength(4);

		const second = mockAnnotationSeedFetch({
			classes: [ANNOTATION_CLASS_IRI, ANNOTATION_LABEL_CLASS_IRI],
			members
		});
		vi.stubGlobal('fetch', second.fn);
		await connector.ensureAnnotationClasses();
		expect(second.updates).toHaveLength(0);
	});

	it('seeds only the missing members', async () => {
		const { fn, updates } = mockAnnotationSeedFetch({
			classes: [ANNOTATION_CLASS_IRI, ANNOTATION_LABEL_CLASS_IRI],
			members: []
		});
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').ensureAnnotationClasses();
		expect(updates).toHaveLength(1);
		expect(updates[0]).not.toContain(`<${ANNOTATION_CLASS_IRI}> a owl:Class`);
	});

	it.each([
		['fetchAllIndividuals', (c: SparqlConnector) => c.fetchAllIndividuals()],
		['searchIndividuals', (c: SparqlConnector) => c.searchIndividuals({ query: 'x' })]
	])('%s excludes Annotation and AnnotationLabel typed nodes', async (_n, run) => {
		const queries: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			queries.push(JSON.parse(opts.body).query as string);
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);
		await run(new SparqlConnector('/api/sparql'));
		const main = queries.find((q) => q.includes('NOT IN'))!;
		expect(main).toContain(`<${ANNOTATION_CLASS_IRI}>`);
		expect(main).toContain(`<${ANNOTATION_LABEL_CLASS_IRI}>`);
	});

	it('fetchIdentityNeighborhood excludes them from seed and link type filters', async () => {
		const queries: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			queries.push(JSON.parse(opts.body).query as string);
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').fetchIdentityNeighborhood(['urn:a']);
		const withFilter = queries.filter((q) => q.includes('NOT IN'));
		expect(withFilter.length).toBeGreaterThan(0);
		for (const q of withFilter) {
			expect(q).toContain(`<${ANNOTATION_CLASS_IRI}>`);
			expect(q).toContain(`<${ANNOTATION_LABEL_CLASS_IRI}>`);
		}
	});
});

describe('SparqlConnector — literal-valued fact reification (query-workbench STORY-181)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const NS = 'https://example.com/facts';
	const subjectIri = `${NS}#app1`;
	const predicateIri = `${NS}#lifecycle`;
	const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer';

	/** `known` maps an exact `rdf:object` term (as written in the query) to its statement IRI. */
	function mockFactFetch(known: Record<string, string> = {}) {
		const updates: string[] = [];
		const queries: string[] = [];
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			queries.push(q);
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				return new Response(
					JSON.stringify({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: NS } }] } }),
					{ status: 200 }
				);
			}
			const m = q.match(/rdf:object (.+?) \.\s*\n/);
			if (m) {
				const stmt = known[m[1]];
				return new Response(
					JSON.stringify({
						head: { vars: ['stmt'] },
						results: { bindings: stmt ? [{ stmt: { type: 'uri', value: stmt } }] : [] }
					}),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 });
		});
		return { fn, updates, queries };
	}

	it('reifies an IRI object exactly like ensureReifiedStatement', async () => {
		const { fn, updates } = mockFactFetch();
		vi.stubGlobal('fetch', fn);
		const stmt = await new SparqlConnector('/api/sparql').ensureReifiedFact(subjectIri, predicateIri, {
			kind: 'iri',
			iri: `${NS}#Prod`
		});
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(
			`<${stmt}> a rdf:Statement ; rdf:subject <${subjectIri}> ; rdf:predicate <${predicateIri}> ; rdf:object <${NS}#Prod> .`
		);
	});

	it('reifies a plain literal object', async () => {
		const { fn, updates } = mockFactFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').ensureReifiedFact(subjectIri, predicateIri, {
			kind: 'literal',
			value: 'Production'
		});
		expect(updates[0]).toContain('rdf:object "Production" .');
	});

	it('is idempotent: a second call returns the same statement IRI and writes nothing', async () => {
		const { fn, updates } = mockFactFetch({ '"Production"': `${NS}#Statement1` });
		vi.stubGlobal('fetch', fn);
		const stmt = await new SparqlConnector('/api/sparql').ensureReifiedFact(subjectIri, predicateIri, {
			kind: 'literal',
			value: 'Production'
		});
		expect(stmt).toBe(`${NS}#Statement1`);
		expect(updates).toEqual([]);
	});

	it('treats plain, typed and language-tagged literals as three distinct facts', async () => {
		const { fn, updates } = mockFactFetch({ '"1"': `${NS}#StatementPlain` });
		vi.stubGlobal('fetch', fn);
		const c = new SparqlConnector('/api/sparql');
		const plain = await c.ensureReifiedFact(subjectIri, predicateIri, { kind: 'literal', value: '1' });
		const typed = await c.ensureReifiedFact(subjectIri, predicateIri, { kind: 'literal', value: '1', datatype: XSD_INT });
		const lang = await c.ensureReifiedFact(subjectIri, predicateIri, { kind: 'literal', value: '1', lang: 'en' });
		expect(plain).toBe(`${NS}#StatementPlain`);
		expect(typed).not.toBe(plain);
		expect(lang).not.toBe(plain);
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`rdf:object "1"^^<${XSD_INT}> .`);
		expect(updates[1]).toContain('rdf:object "1"@en .');
	});

	it('escapes quotes, backslashes and newlines in a literal', async () => {
		const { fn, updates } = mockFactFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').ensureReifiedFact(subjectIri, predicateIri, {
			kind: 'literal',
			value: 'say "hi"\\ \nbye'
		});
		expect(updates[0]).toContain('rdf:object "say \\"hi\\"\\\\ \\nbye" .');
		expect(updates[0]).not.toMatch(/"say[^"]*\n/);
	});

	it('rejects unsafe datatype IRIs, bad language tags and unsafe IRIs without a request', async () => {
		const { fn } = mockFactFetch();
		vi.stubGlobal('fetch', fn);
		const c = new SparqlConnector('/api/sparql');
		await expect(
			c.ensureReifiedFact(subjectIri, predicateIri, { kind: 'literal', value: 'x', datatype: 'http://x/>' })
		).rejects.toThrow();
		await expect(
			c.ensureReifiedFact(subjectIri, predicateIri, { kind: 'literal', value: 'x', lang: 'en" . } #' })
		).rejects.toThrow();
		await expect(c.ensureReifiedFact(subjectIri, predicateIri, { kind: 'iri', iri: 'urn:a>b' })).rejects.toThrow();
		await expect(
			c.fetchStatementIriForFact(subjectIri, 'urn:p>', { kind: 'literal', value: 'x' }, NS)
		).rejects.toThrow();
		expect(fn).not.toHaveBeenCalled();
	});

	it('the old IRI-only methods behave identically (thin wrappers)', async () => {
		const a = mockFactFetch();
		vi.stubGlobal('fetch', a.fn);
		await new SparqlConnector('/api/sparql').ensureReifiedStatement(subjectIri, predicateIri, `${NS}#Prod`);
		const b = mockFactFetch();
		vi.stubGlobal('fetch', b.fn);
		await new SparqlConnector('/api/sparql').ensureReifiedFact(subjectIri, predicateIri, {
			kind: 'iri',
			iri: `${NS}#Prod`
		});
		const strip = (u: string) => u.replace(/#Statement\d+/g, '#StatementX');
		expect(a.updates.map(strip)).toEqual(b.updates.map(strip));
		expect(a.queries).toEqual(b.queries);
	});

	it('fetchAllReifiedStatements labels a literal object with its own value', async () => {
		const fn = vi.fn(async () =>
			new Response(JSON.stringify({
				head: { vars: [] },
				results: { bindings: [{
					stmt: { type: 'uri', value: `${NS}#Statement1` },
					s: { type: 'uri', value: subjectIri },
					p: { type: 'uri', value: predicateIri },
					o: { type: 'literal', value: 'Production' }
				}] }
			}), { status: 200 })
		);
		vi.stubGlobal('fetch', fn);
		const [e] = await new SparqlConnector('/api/sparql').fetchAllReifiedStatements();
		expect(e.label).toBe('app1 lifecycle Production');
	});
});

describe('SparqlConnector — annotation CRUD (query-workbench STORY-182)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const NS = 'https://example.com/annot';
	const subject = `${NS}#app1`;
	const predicate = `${NS}#lifecycle`;
	const fact = { subjectIri: subject, predicateIri: predicate, object: { kind: 'literal' as const, value: 'Production' } };
	const meta = { annotatedBy: 'alice', annotatedAt: '2026-10-10T12:00:00.000Z' };
	const verified = `${NS}#VerifiedLabel`;

	function mockAnnotationFetch(opts: { labelMember?: boolean } = {}) {
		const updates: string[] = [];
		const queries: string[] = [];
		const fn = vi.fn(async (_url: string, o: { body: string }) => {
			const body = JSON.parse(o.body);
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			const q: string = body.query;
			queries.push(q);
			const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
			if (q.includes('ASK')) {
				// Class marker checks and label membership
				if (q.includes(`<${verified}> a <${ANNOTATION_LABEL_CLASS_IRI}>`)) {
					return json({ head: {}, boolean: opts.labelMember ?? true });
				}
				return json({ head: {}, boolean: true });
			}
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				return json({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: NS } }] } });
			}
			return json({ head: { vars: [] }, results: { bindings: [] } });
		});
		return { fn, updates, queries };
	}

	it('addAnnotation writes a text annotation node into the statement graph and returns its IRI', async () => {
		const { fn, updates } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		const iri = await new SparqlConnector('/api/sparql').addAnnotation(fact, { type: 'text', text: 'Check "this"' }, meta);
		const insert = updates.find((u) => u.includes(`a <${ANNOTATION_CLASS_IRI}>`))!;
		expect(insert).toContain(`<${iri}> a <${ANNOTATION_CLASS_IRI}>`);
		expect(insert).toContain(`<${ANNOTATES_PREDICATE_IRI}> <${NS}#Statement`);
		expect(insert).toContain(`<${ANNOTATION_TYPE_PREDICATE_IRI}> "text"`);
		expect(insert).toContain(`<${ANNOTATION_VALUE_PREDICATE_IRI}> "Check \\"this\\""`);
		expect(insert).toContain(`<${ANNOTATED_BY_PREDICATE_IRI}> "alice"`);
		expect(insert).toContain(`<${ANNOTATED_AT_PREDICATE_IRI}> "2026-10-10T12:00:00.000Z"^^xsd:dateTime`);
		expect(insert).toContain(`GRAPH <${NS}>`);
		expect(iri.startsWith(`${NS}#Annotation`)).toBe(true);
	});

	it('addAnnotation writes a label annotation whose value is the member IRI', async () => {
		const { fn, updates } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').addAnnotation(fact, { type: 'label', labelIri: verified }, meta);
		const insert = updates.find((u) => u.includes(`a <${ANNOTATION_CLASS_IRI}>`))!;
		expect(insert).toContain(`<${ANNOTATION_TYPE_PREDICATE_IRI}> "label"`);
		expect(insert).toContain(`<${ANNOTATION_VALUE_PREDICATE_IRI}> <${verified}>`);
	});

	it('can put a text and a label annotation on the same fact (two distinct nodes)', async () => {
		const { fn } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		const c = new SparqlConnector('/api/sparql');
		const a = await c.addAnnotation(fact, { type: 'text', text: 'note' }, meta);
		const b = await c.addAnnotation(fact, { type: 'label', labelIri: verified }, meta);
		expect(a).not.toBe(b);
	});

	it.each([
		['empty text', { type: 'text' as const, text: '   ' }],
		['over-long text', { type: 'text' as const, text: 'x'.repeat(ANNOTATION_MAX_TEXT_LENGTH + 1) }],
		['unsafe label IRI', { type: 'label' as const, labelIri: 'urn:x>y' }]
	])('addAnnotation rejects %s before any update', async (_n, annotation) => {
		const { fn, updates } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		await expect(new SparqlConnector('/api/sparql').addAnnotation(fact, annotation, meta)).rejects.toThrow();
		expect(updates).toEqual([]);
	});

	it('addAnnotation rejects a labelIri that is not an AnnotationLabel member before any update', async () => {
		const { fn, updates } = mockAnnotationFetch({ labelMember: false });
		vi.stubGlobal('fetch', fn);
		await expect(
			new SparqlConnector('/api/sparql').addAnnotation(fact, { type: 'label', labelIri: verified }, meta)
		).rejects.toThrow(/not an annotation label/i);
		// Vocabulary seeding may run, but no statement or Annotation node is written.
		expect(updates.some((u) => u.includes('rdf:Statement') || u.includes(`a <${ANNOTATION_CLASS_IRI}>`))).toBe(false);
	});

	it('addAnnotation rejects missing author/timestamp metadata', async () => {
		const { fn, updates } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		const c = new SparqlConnector('/api/sparql');
		await expect(c.addAnnotation(fact, { type: 'text', text: 'a' }, { annotatedBy: '', annotatedAt: meta.annotatedAt })).rejects.toThrow();
		await expect(c.addAnnotation(fact, { type: 'text', text: 'a' }, { annotatedBy: 'a', annotatedAt: 'yesterday' })).rejects.toThrow();
		expect(updates).toEqual([]);
	});

	it('fetchAnnotationsForFacts issues one query for N facts and returns [] for unannotated ones', async () => {
		const queries: string[] = [];
		const other = { subjectIri: `${NS}#app2`, predicateIri: predicate, object: { kind: 'iri' as const, iri: `${NS}#Prod` } };
		const fn = vi.fn(async (_u: string, o: { body: string }) => {
			queries.push(JSON.parse(o.body).query);
			return new Response(JSON.stringify({
				head: { vars: [] },
				results: { bindings: [
					{
						s: { type: 'uri', value: subject }, p: { type: 'uri', value: predicate },
						o: { type: 'literal', value: 'Production' },
						ann: { type: 'uri', value: `${NS}#Annotation1` },
						type: { type: 'literal', value: 'text' }, value: { type: 'literal', value: 'check' },
						by: { type: 'literal', value: 'alice' },
						at: { type: 'literal', value: '2026-10-10T12:00:00Z', datatype: 'http://www.w3.org/2001/XMLSchema#dateTime' }
					},
					{
						s: { type: 'uri', value: subject }, p: { type: 'uri', value: predicate },
						o: { type: 'literal', value: 'Production', datatype: 'http://www.w3.org/2001/XMLSchema#string' },
						ann: { type: 'uri', value: `${NS}#Annotation2` },
						type: { type: 'literal', value: 'label' }, value: { type: 'uri', value: verified },
						labelText: { type: 'literal', value: 'Verified' },
						by: { type: 'literal', value: 'bob' },
						at: { type: 'literal', value: '2026-10-11T12:00:00Z' }
					}
				] }
			}), { status: 200 });
		});
		vi.stubGlobal('fetch', fn);
		const c = new SparqlConnector('/api/sparql');
		const result = await c.fetchAnnotationsForFacts([fact, other]);

		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain('VALUES (?s ?p ?o)');
		expect(result.get(factKeyString(fact))).toEqual([
			{ iri: `${NS}#Annotation1`, type: 'text', text: 'check', annotatedBy: 'alice', annotatedAt: '2026-10-10T12:00:00Z' },
			{ iri: `${NS}#Annotation2`, type: 'label', labelIri: verified, labelText: 'Verified', annotatedBy: 'bob', annotatedAt: '2026-10-11T12:00:00Z' }
		]);
		expect(result.get(factKeyString(other))).toEqual([]);
	});

	it('fact keys canonicalise plain and xsd:string literals together but keep typed/lang literals apart', () => {
		const lit = (extra: object) => ({ subjectIri: 's', predicateIri: 'p', object: { kind: 'literal' as const, value: '1', ...extra } });
		expect(factKeyString(lit({}))).toBe(factKeyString(lit({ datatype: 'http://www.w3.org/2001/XMLSchema#string' })));
		expect(factKeyString(lit({}))).not.toBe(factKeyString(lit({ datatype: 'http://www.w3.org/2001/XMLSchema#integer' })));
		expect(factKeyString(lit({}))).not.toBe(factKeyString(lit({ lang: 'en' })));
		expect(factKeyString({ subjectIri: 's', predicateIri: 'p', object: { kind: 'iri', iri: '1' } })).not.toBe(factKeyString(lit({})));
	});

	it('fetchAnnotationsForFacts makes no request for an empty list', async () => {
		const { fn } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		const result = await new SparqlConnector('/api/sparql').fetchAnnotationsForFacts([]);
		expect(result.size).toBe(0);
		expect(fn).not.toHaveBeenCalled();
	});

	it('fetchAnnotationsForFacts validates every IRI before querying', async () => {
		const { fn } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		await expect(
			new SparqlConnector('/api/sparql').fetchAnnotationsForFacts([{ ...fact, predicateIri: 'urn:p>' }])
		).rejects.toThrow();
		expect(fn).not.toHaveBeenCalled();
	});

	it('fetchAnnotationLabels returns the enumerated labels', async () => {
		const fn = vi.fn(async () =>
			new Response(JSON.stringify({
				head: { vars: [] },
				results: { bindings: [
					{ m: { type: 'uri', value: verified }, label: { type: 'literal', value: 'Verified' } },
					{ m: { type: 'uri', value: `${NS}#NoLabel` } }
				] }
			}), { status: 200 })
		);
		vi.stubGlobal('fetch', fn);
		expect(await new SparqlConnector('/api/sparql').fetchAnnotationLabels()).toEqual([
			{ iri: verified, label: 'Verified' },
			{ iri: `${NS}#NoLabel`, label: 'NoLabel' }
		]);
	});

	it('deleteAnnotation removes only the Annotation node, not the statement or ground triple', async () => {
		const { fn, updates } = mockAnnotationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').deleteAnnotation(`${NS}#Annotation1`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${NS}#Annotation1> a <${ANNOTATION_CLASS_IRI}>`);
		expect(updates[0]).not.toContain('rdf:Statement');
		expect(updates[0]).not.toContain('rdf:subject');
		await expect(new SparqlConnector('/api/sparql').deleteAnnotation('urn:a>b')).rejects.toThrow();
		expect(updates).toHaveLength(1);
	});
});

describe('SparqlConnector — facts keep annotations consistent through edits and deletes (query-workbench STORY-184)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const NS = 'https://example.com/life';
	const G = namespaceGraphs(NS).instances;
	const subject = `${NS}#app1`;
	const attr = `${NS}#lifecycle`;
	const pred = `${NS}#hostedOn`;
	const target = `${NS}#srv1`;

	function mockMutationFetch() {
		const updates: string[] = [];
		const fn = vi.fn(async (_u: string, o: { body: string }) => {
			const body = JSON.parse(o.body);
			const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
			if (body.update !== undefined) {
				updates.push(body.update as string);
				return json({ success: true });
			}
			const q: string = body.query;
			if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
				return json({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: NS } }] } });
			}
			return json({ head: { vars: [] }, results: { bindings: [] } });
		});
		return { fn, updates };
	}

	const annotationCleanup = (u: string) => {
		expect(u).toContain('?stmt ?sp ?so');
		expect(u).toContain(`?ann <${ANNOTATES_PREDICATE_IRI}> ?stmt`);
		expect(u).toContain('?ann ?ap ?ao');
	};

	it('editing an attribute value rewrites the statement rdf:object in the same single update', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').setIndividualAttributeValue(subject, attr, 'string', 'Retired', NS);
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`WITH <${G}>`);
		expect(u).toContain('DELETE { <' + subject + '> <' + attr + '> ?old . ?stmt rdf:object ?old . }');
		expect(u).toContain('INSERT { <' + subject + '> <' + attr + '> "Retired"^^xsd:string . ?stmt rdf:object "Retired"^^xsd:string . }');
		expect(u).toContain(`OPTIONAL { ?stmt rdf:subject <${subject}> ; rdf:predicate <${attr}> ; rdf:object ?old . }`);
		// the statement is retargeted, never deleted, so its annotations stay attached
		expect(u).not.toContain('?ann');
	});

	it('clearing an attribute value removes its statement and annotation nodes', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').setIndividualAttributeValue(subject, attr, 'string', null, NS);
		expect(updates).toHaveLength(1);
		annotationCleanup(updates[0]);
		expect(updates[0]).not.toContain('INSERT');
	});

	it('removing one value of a multi-valued attribute is scoped to that value\'s statement only', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').removeIndividualAttributeValue(subject, attr, 'string', 'A', NS);
		expect(updates).toHaveLength(1);
		const u = updates[0];
		annotationCleanup(u);
		expect(u).toContain(`rdf:object "A"^^xsd:string .`);
		expect(u).not.toContain('"B"');
		expect(u).not.toMatch(/rdf:object \?[a-z]/); // never a wildcard object
	});

	it('every statement/annotation pattern is OPTIONAL, so unreified facts are unaffected', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').removeIndividualAttributeValue(subject, attr, 'string', 'A', NS);
		const where = updates[0].slice(updates[0].indexOf('WHERE'));
		expect(where).toMatch(/WHERE \{\s*OPTIONAL \{/);
		expect(updates[0]).toContain(`DELETE { <${subject}> <${attr}> "A"^^xsd:string .`);
	});

	it('deleteAssertion removes the relation statement and its annotations', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').deleteAssertion(subject, pred, target);
		expect(updates).toHaveLength(1);
		annotationCleanup(updates[0]);
		expect(updates[0]).toContain(`rdf:object <${target}> .`);
	});

	it('deleteIndividualClassRelation removes the relation statement and its annotations', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').deleteIndividualClassRelation(subject, pred, `${NS}#SomeClass`);
		annotationCleanup(updates[0]);
	});

	it('deleteIndividual also removes statements whose subject is the individual, with their annotations', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').deleteIndividual(subject, NS);
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`?stmt rdf:subject <${subject}> ; ?sp ?so .`);
		annotationCleanup(u);
		expect(u).toContain(`WITH <${G}>`);
	});

	it('updateIndividualRelation still retargets the existing statement (regression guard)', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').updateIndividualRelation(subject, pred, target, 'hostedOn', `${NS}#srv2`);
		const u = updates.find((x) => x.includes('rdf:object'))!;
		expect(u).toContain(`?stmt rdf:predicate <${pred}> ; rdf:object <${target}> .`);
		expect(u).toContain('OPTIONAL');
	});

	it('addIndividualAttributeValue stays a plain insert (additive, nothing to retarget)', async () => {
		const { fn, updates } = mockMutationFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').addIndividualAttributeValue(subject, attr, 'string', 'A', NS);
		expect(updates[0]).toContain('INSERT DATA');
		expect(updates[0]).not.toContain('?stmt');
	});
});
