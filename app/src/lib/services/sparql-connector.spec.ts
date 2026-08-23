import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SparqlConnector, type SparqlBinding } from './sparql-connector';
import { classIri, propertyIri, individualIri, nodeShapeIri, SCHEMA_NAMESPACE } from '../utils/iri';
import { SCHEMA_GRAPH } from '../config';

/** Wraps triples the same way `sparql-connector.ts`'s `inGraph` does, so assertions on generated
 *  `INSERT DATA`/`DELETE DATA`/`DELETE WHERE` bodies stay in sync with the named-graph wrapping
 *  (issue #1: schema/shapes data lives in `SCHEMA_GRAPH`, configurable via `.env`). */
function inGraph(triples: string): string {
	return `GRAPH <${SCHEMA_GRAPH}> { ${triples} }`;
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
 */
function mockGraphFetch(
	fixture: {
		classExists?: boolean;
		propertyExists?: boolean;
		shapeExists?: boolean;
		ownProperties?: string[];
		externalReferences?: string[];
		ancestors?: string[];
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

		expect(result).toEqual({ deleted: true, externalReferences: [] });
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

		expect(result).toEqual({ deleted: false, externalReferences: [externalProp] });
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

		expect(updates[1]).toContain(`<${expectedPropIri}> a owl:DatatypeProperty`);
		expect(updates[1]).toContain(`rdfs:domain <${iri}>`);
		expect(updates[1]).toContain('rdfs:range <http://www.w3.org/2001/XMLSchema#date>');
		expect(updates[1]).toContain('rdfs:label "birth date"');
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
		expect(updates[0]).toContain(`DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`)} }`);
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
		expect(updates[0]).toContain(`<${expectedIri}> a owl:ObjectProperty`);
		expect(updates[0]).toContain(`rdfs:domain <${person}>`);
		expect(updates[0]).toContain(`rdfs:range <${car}>`);
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
		expect(updates[0]).toContain(`DELETE WHERE { ${inGraph(`<${propIri}> ?p ?o .`)} }`);
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

		expect(result).toEqual({ deleted: true, externalReferences: [] });
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
			expect.stringContaining(`DELETE DATA { ${inGraph(`<${assocIri}> rdfs:subClassOf <${markerIri}> .`)} }`)
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
			expect.stringContaining(`DELETE DATA { ${inGraph(`<${company}> rdfs:subClassOf <${organization}> .`)} }`)
		]);
	});
});

/** Mocks the single `SELECT ?s ?p ?o` whole-graph fetch that `fetchWholeGraphQuads` (and
 *  everything built on it: STORY-011's Turtle view, STORY-012's save) issues. Update calls are
 *  recorded so tests can assert on the generated DELETE/INSERT ops without any ASK/rdfs:domain
 *  fixture plumbing STORY-004..008's `mockGraphFetch` needs. */
function mockWholeGraphFetch(bindings: Array<Record<'s' | 'p' | 'o', SparqlBinding[string]>>) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update as string);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
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
		expect(updates[0]).toContain(`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`)} }`);
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
		expect(updates[0]).toContain(`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`)} }`);
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
			`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`)} }`
		);
		expect(updates[0]).toContain(`DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`)} }`);
		expect(updates[0]).not.toContain(`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`)} }`);
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
			`DELETE WHERE { ${inGraph(`<${shapeIri}> sh:property ?propShape . ?propShape ?p ?o .`)} }`
		);
		expect(updates[0]).toContain(`DELETE WHERE { ${inGraph(`<${shapeIri}> ?p ?o .`)} }`);
		expect(updates[0]).toContain(`DELETE WHERE { ${inGraph(`<${personIri}> ?p ?o .`)} }`);
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

		expect(updates).toEqual([expect.stringContaining(`DELETE WHERE { ${inGraph(`<${iri}> ?p ?o .`)} }`)]);
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
