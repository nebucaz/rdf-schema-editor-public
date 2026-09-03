import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SparqlConnector, type SparqlBinding } from './sparql-connector';
import {
	classIri,
	propertyIri,
	genericPropertyIri,
	individualIri,
	nodeShapeIri,
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
	catalogIri,
	datasetIri,
	distributionIri,
	splitDatasetIri
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
		authoritativeEntityClassIri?: string;
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
		if (q.includes('authoritativeEntityClass')) {
			const bindings = fixture.authoritativeEntityClassIri
				? [{ classIri: { type: 'uri', value: fixture.authoritativeEntityClassIri } }]
				: [];
			return new Response(JSON.stringify({ head: { vars: ['classIri'] }, results: { bindings } }), {
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
			if (q.includes('FILTER NOT EXISTS')) {
				const bindings = fixture.existingGenericIri
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

	it('updateObjectProperty on a generic relation retargets only sh:class, leaving the shared property untouched', async () => {
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
		expect(updates[0]).not.toContain('rdfs:label');
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

	it('listGenericObjectProperties returns label+iri pairs for properties with no rdfs:domain', async () => {
		const usesIri = genericPropertyIri('uses', DEFAULT_GRAPHS.schema);
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
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

		expect(result).toEqual([{ iri: usesIri, label: 'uses' }]);
	});

	it('listGenericObjectProperties queries with ORDER BY LCASE(?label) (Sprint 6 Story 018)', async () => {
		const fn = vi.fn(async (_url: string, opts: { body: string }) => {
			const body = JSON.parse(opts.body);
			expect(body.query).toContain('ORDER BY LCASE(?label)');
			return new Response(JSON.stringify({ head: { vars: ['p', 'label'] }, results: { bindings: [] } }), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fn);

		const connector = new SparqlConnector('/api/sparql');
		await connector.listGenericObjectProperties();
		expect(fn).toHaveBeenCalled();
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

		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${architectureIri}> <${predicateIri}> <${applicationIri}> .`, namespaceGraphs(NS_ADOIT).instances)} }`
			)
		]);
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

		expect(updates).toEqual([
			expect.stringContaining(
				`DELETE WHERE { ${inGraph(`<${systemIri}> <${predicateIri}> <${attributeIri}> .`, namespaceGraphs(NS_ADOIT).instances)} }`
			)
		]);
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
				description: 'finds gaps'
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

		expect(savedQueries).toEqual([{ iri: sq, label: '', sparqlText: '', description: '' }]);
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
			specificObjectProps?: Array<{ p: string; label: string; domain: string; range: string }>;
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
					range: { type: 'uri', value: e.range }
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
