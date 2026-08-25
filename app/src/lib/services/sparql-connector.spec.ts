import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SparqlConnector, type SparqlBinding } from './sparql-connector';
import {
	classIri,
	propertyIri,
	individualIri,
	nodeShapeIri,
	SCHEMA_NAMESPACE,
	NAMESPACE_CLASS_IRI,
	NAMESPACE_PREFIX_PREDICATE_IRI,
	NAMESPACE_COLOR_PREDICATE_IRI,
	EXTERNAL_VOCABULARY_CLASS_IRI
} from '../utils/iri';
import { DEFAULT_NAMESPACE_BASE_IRI, SCHEMA_GRAPH, namespaceGraphs } from '../config';
import { RDF, RDFS, OWL, SH } from './turtle';

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
		ownProperties?: string[];
		externalReferences?: string[];
		ancestors?: string[];
		classGraph?: Record<string, string>;
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
			return new Response(JSON.stringify({ head: {}, boolean: false }), { status: 200 });
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
 *  individuals CRUD methods (STORY-019). */
function mockIndividualFetch(fixture: { exists?: boolean } = {}) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		return new Response(JSON.stringify({ head: {}, boolean: fixture.exists ?? false }), { status: 200 });
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

		expect(result.iri).toBe(individualIri(relationType, 'nutzt'));
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

	it('fetchIndividualsOfClass round-trips the members inserted for a class', async () => {
		const nutztIri = individualIri(relationType, 'nutzt');
		const verbuchtIri = individualIri(relationType, 'verbucht');
		const fn = vi.fn(async () =>
			new Response(
				JSON.stringify({
					head: { vars: ['i', 'label'] },
					results: {
						bindings: [
							{ i: { type: 'uri', value: nutztIri }, label: { type: 'literal', value: 'nutzt' } },
							{ i: { type: 'uri', value: verbuchtIri }, label: { type: 'literal', value: 'verbucht' } }
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
			{ iri: nutztIri, label: 'nutzt' },
			{ iri: verbuchtIri, label: 'verbucht' }
		]);
	});
});

/** Stateful fetch mock for STORY-027's namespace CRUD methods: distinguishes the two ASK shapes
 *  (`ensureNamespaceClass`'s `a owl:Class` check vs. `insertNamespace`'s `a <NAMESPACE_CLASS_IRI>`
 *  existence check) the same way `mockGraphFetch` distinguishes class/property/shape ASKs, plus a
 *  `COUNT(*)` handler for `deleteNamespace`'s non-empty check. */
function mockNamespaceFetch(
	fixture: { namespaceClassExists?: boolean; namespaceExists?: boolean; entryCount?: number } = {}
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
			{ baseIri: govBase, prefix: 'gov', description: 'Governmental entities', color: null }
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

		expect(namespaces).toEqual([{ baseIri: govBase, prefix: 'gov', description: null, color: '#ff0000' }]);
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

	it('deleteNamespace without force is refused with the entry count when non-empty', async () => {
		const { fn, updates } = mockNamespaceFetch({ entryCount: 5 });
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		const result = await connector.deleteNamespace('http://example.org/gov');

		expect(result).toEqual({ deleted: false, entryCount: 5 });
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
