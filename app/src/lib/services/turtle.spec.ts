import { describe, it, expect } from 'vitest';
import {
	parseTurtle,
	quadsToTurtle,
	quadsToGroundTriples,
	quadsToNQuads,
	bindingToQuad,
	quadKey,
	selectScope,
	partitionQuads,
	groupSchemaQuads,
	nestBlankNodes,
	buildDisplayPrefixes,
	isRdfType,
	OWL,
	RDFS,
	SH,
	type Quad
} from './turtle';
import type { SparqlBinding } from './sparql-connector';
import { classIri, nodeShapeIri, propertyIri, xsdIri, SCHEMA_NAMESPACE } from '$lib/utils/iri';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '$lib/config';

describe('parseTurtle / quadsToTurtle round-trip (STORY-011)', () => {
	it('re-parses serialized Turtle to the same triple set', async () => {
		const personIri = classIri('Person');
		const original = parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			<${personIri}> a owl:Class ; rdfs:label "Person" .
		`);

		const turtle = await quadsToTurtle(original);
		const reparsed = parseTurtle(turtle);

		expect(new Set(reparsed.map(quadKey))).toEqual(new Set(original.map(quadKey)));
	});

	it('throws with line info on invalid Turtle, without producing any quads', () => {
		expect(() => parseTurtle('this is not : valid turtle @@@')).toThrow(/line/i);
	});

	it('serializes blank nodes as ground N-Triples suitable for INSERT DATA', async () => {
		const quads = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			<urn:shape> sh:property [ sh:path <urn:p> ] .
		`);
		const body = await quadsToGroundTriples(quads);
		expect(body).toContain('_:');
		expect(body).not.toContain('@prefix');
	});
});

describe('buildDisplayPrefixes (STORY-048)', () => {
	it('adds a schema/shapes prefix pair per registered namespace, keyed by its own prefix', () => {
		const coreBase = 'http://ld.pageagent.com/rdf-schema-editor/core';
		const coreGraphs = namespaceGraphs(coreBase);

		const prefixes = buildDisplayPrefixes([{ prefix: 'core', baseIri: coreBase }]);

		expect(prefixes.core).toBe(`${coreGraphs.schema}#`);
		expect(prefixes['core-sh']).toBe(`${coreGraphs.shapes}#`);
	});

	it('always includes the standard vocabulary prefixes, even with no registered namespaces', () => {
		const prefixes = buildDisplayPrefixes([]);

		expect(prefixes).toMatchObject({
			rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
			rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
			owl: 'http://www.w3.org/2002/07/owl#',
			sh: 'http://www.w3.org/ns/shacl#'
		});
	});

	it('skips a namespace with an empty prefix rather than emitting an unusable `: <iri>` entry', () => {
		const prefixes = buildDisplayPrefixes([{ prefix: '', baseIri: 'http://example.org/anon' }]);

		expect(prefixes['']).toBeUndefined();
	});

	it('round-trips a non-default namespace\'s class through quadsToTurtle + parseTurtle using its own prefix', async () => {
		const coreBase = 'http://ld.pageagent.com/rdf-schema-editor/core';
		const processIri = classIri('BusinessProcess', namespaceGraphs(coreBase).schema);
		const quads = parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			<${processIri}> a owl:Class .
		`);

		const prefixes = buildDisplayPrefixes([
			{ prefix: 'rse', baseIri: DEFAULT_NAMESPACE_BASE_IRI },
			{ prefix: 'core', baseIri: coreBase }
		]);
		const turtle = await quadsToTurtle(quads, prefixes);

		expect(turtle).toContain('core:BusinessProcess');
		expect(turtle).not.toContain(processIri);

		const reparsed = parseTurtle(turtle);
		expect(new Set(reparsed.map(quadKey))).toEqual(new Set(quads.map(quadKey)));
	});

	it('adds one flat prefix per external vocabulary, not a schema/shapes pair (STORY-050)', () => {
		const prefixes = buildDisplayPrefixes(
			[],
			[{ prefix: 'gist', baseIri: 'https://ontologies.semanticarts.com/gist/' }]
		);

		expect(prefixes.gist).toBe('https://ontologies.semanticarts.com/gist/');
		expect(prefixes['gist-sh']).toBeUndefined();
	});

	it('round-trips an external-vocabulary reference (e.g. rdfs:subClassOf gist:System) using its own prefix', async () => {
		const appIri = classIri('Application');
		const quads = parseTurtle(`
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			<${appIri}> rdfs:subClassOf <https://ontologies.semanticarts.com/gist/System> .
		`);

		const prefixes = buildDisplayPrefixes(
			[{ prefix: 'rse', baseIri: DEFAULT_NAMESPACE_BASE_IRI }],
			[{ prefix: 'gist', baseIri: 'https://ontologies.semanticarts.com/gist/' }]
		);
		const turtle = await quadsToTurtle(quads, prefixes);

		expect(turtle).toContain('gist:System');
		expect(turtle).not.toContain('https://ontologies.semanticarts.com/gist/System');

		const reparsed = parseTurtle(turtle);
		expect(new Set(reparsed.map(quadKey))).toEqual(new Set(quads.map(quadKey)));
	});

	it('lets a registered namespace\'s prefix win over a same-named external vocabulary entry', () => {
		const prefixes = buildDisplayPrefixes(
			[{ prefix: 'core', baseIri: 'http://ld.pageagent.com/rdf-schema-editor/core' }],
			[{ prefix: 'core', baseIri: 'https://example.org/unrelated-vocab#' }]
		);

		expect(prefixes.core).toBe('http://ld.pageagent.com/rdf-schema-editor/core/schema#');
	});
});

describe('bindingToQuad', () => {
	it('converts uri/literal/bnode SPARQL-JSON bindings into RDF/JS quads', () => {
		const uriBinding: SparqlBinding = {
			s: { type: 'uri', value: 'urn:a' },
			p: { type: 'uri', value: 'urn:b' },
			o: { type: 'uri', value: 'urn:c' }
		};
		const q1 = bindingToQuad(uriBinding);
		expect(q1.subject.value).toBe('urn:a');
		expect(q1.object.termType).toBe('NamedNode');

		const literalBinding: SparqlBinding = {
			s: { type: 'uri', value: 'urn:a' },
			p: { type: 'uri', value: 'urn:label' },
			o: { type: 'literal', value: 'hi', 'xml:lang': 'en' }
		};
		const q2 = bindingToQuad(literalBinding);
		expect(q2.object.termType).toBe('Literal');
		expect((q2.object as { value: string }).value).toBe('hi');

		const bnodeBinding: SparqlBinding = {
			s: { type: 'bnode', value: 'b0' },
			p: { type: 'uri', value: 'urn:path' },
			o: { type: 'uri', value: 'urn:d' }
		};
		const q3 = bindingToQuad(bnodeBinding);
		expect(q3.subject.termType).toBe('BlankNode');
		expect(q3.subject.value).toBe('b0');
	});

	it('preserves a datatype IRI on a typed literal', () => {
		const binding: SparqlBinding = {
			s: { type: 'uri', value: 'urn:a' },
			p: { type: 'uri', value: 'urn:count' },
			o: { type: 'literal', value: '3', datatype: xsdIri('integer') }
		};
		const q = bindingToQuad(binding);
		expect(q.object.termType).toBe('Literal');
		expect((q.object as { datatype: { value: string } }).datatype.value).toBe(xsdIri('integer'));
	});

	it('sets the graph term for a binding from a given graph (STORY-036)', () => {
		const binding: SparqlBinding = {
			s: { type: 'uri', value: 'urn:a' },
			p: { type: 'uri', value: 'urn:b' },
			o: { type: 'uri', value: 'urn:c' }
		};
		const untagged = bindingToQuad(binding);
		expect(untagged.graph.termType).toBe('DefaultGraph');

		const tagged = bindingToQuad(binding, 'urn:graph/schema');
		expect(tagged.graph.termType).toBe('NamedNode');
		expect(tagged.graph.value).toBe('urn:graph/schema');
	});
});

describe('quadsToNQuads round-trip (STORY-036)', () => {
	it('re-parses serialized N-Quads to the same per-graph quad sets as the source', async () => {
		const schemaGraph = 'urn:ns1/schema';
		const shapesGraph = 'urn:ns2/shapes';

		const original: Quad[] = [
			bindingToQuad(
				{
					s: { type: 'uri', value: 'urn:a' },
					p: { type: 'uri', value: 'urn:b' },
					o: { type: 'uri', value: 'urn:c' }
				},
				schemaGraph
			),
			bindingToQuad(
				{
					s: { type: 'uri', value: 'urn:d' },
					p: { type: 'uri', value: 'urn:e' },
					o: { type: 'literal', value: 'hi' }
				},
				shapesGraph
			)
		];

		const nquads = await quadsToNQuads(original);
		const reparsed = parseTurtle(nquads);

		const byGraph = (quads: Quad[], graph: string) =>
			new Set(quads.filter((q) => q.graph.value === graph).map(quadKey));

		expect(byGraph(reparsed, schemaGraph)).toEqual(byGraph(original, schemaGraph));
		expect(byGraph(reparsed, shapesGraph)).toEqual(byGraph(original, shapesGraph));
	});
});

describe('selectScope (shared by STORY-011 view and STORY-012 save)', () => {
	const personIri = classIri('Person');
	const carIri = classIri('Car');
	const ownsIri = propertyIri(personIri, 'owns');
	const personShapeIri = nodeShapeIri(personIri);

	function makeAllQuads() {
		return parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			@prefix sh: <http://www.w3.org/ns/shacl#> .

			<${personIri}> a owl:Class ; rdfs:label "Person" .
			<${carIri}> a owl:Class ; rdfs:label "Car" .
			<${ownsIri}> a owl:ObjectProperty ; rdfs:domain <${personIri}> ; rdfs:range <${carIri}> ; rdfs:label "owns" .
			<${personShapeIri}> a sh:NodeShape ; sh:targetClass <${personIri}> ;
				sh:property [ sh:path <${ownsIri}> ; sh:class <${carIri}> ] .
		`);
	}

	it('returns the whole graph when iri is null', () => {
		const all = makeAllQuads();
		expect(selectScope(all, null)).toHaveLength(all.length);
	});

	it('scopes a class to its own triples plus its shape and property-shape blank nodes', () => {
		const all = makeAllQuads();
		const scoped = selectScope(all, personIri);

		expect(scoped.some((q) => q.subject.value === personIri && isRdfType(q, OWL.Class))).toBe(true);
		expect(scoped.some((q) => q.subject.value === personShapeIri && isRdfType(q, SH.NodeShape))).toBe(
			true
		);
		expect(scoped.some((q) => q.predicate.value === SH.path && q.object.value === ownsIri)).toBe(true);
		// Car (a different class) must not leak into Person's scope.
		expect(scoped.some((q) => q.subject.value === carIri)).toBe(false);
	});

	it('scopes a property to its own triples plus just its one sh:property blank node', () => {
		const all = makeAllQuads();
		const scoped = selectScope(all, ownsIri);

		expect(scoped.some((q) => q.subject.value === ownsIri && q.predicate.value === RDFS.domain)).toBe(
			true
		);
		expect(scoped.some((q) => q.predicate.value === SH.path && q.object.value === ownsIri)).toBe(true);
		// The shape's own `a sh:NodeShape`/`sh:targetClass` triples belong to the class's scope, not
		// the property's.
		expect(scoped.some((q) => q.subject.value === personShapeIri && isRdfType(q, SH.NodeShape))).toBe(
			false
		);
	});
});

describe('selectScope partition parameter (STORY-017)', () => {
	const personIri = classIri('Person');
	const carIri = classIri('Car');
	const ownsIri = propertyIri(personIri, 'owns');
	const personShapeIri = nodeShapeIri(personIri);

	function makeAllQuads() {
		return parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			@prefix sh: <http://www.w3.org/ns/shacl#> .

			<${personIri}> a owl:Class ; rdfs:label "Person" .
			<${carIri}> a owl:Class ; rdfs:label "Car" .
			<${ownsIri}> a owl:ObjectProperty ; rdfs:domain <${personIri}> ; rdfs:range <${carIri}> ; rdfs:label "owns" .
			<${personShapeIri}> a sh:NodeShape ; sh:targetClass <${personIri}> ;
				sh:property [ sh:path <${ownsIri}> ; sh:class <${carIri}> ] .
		`);
	}

	it("selectScope(allQuads, iri, 'schema') returns only that entity's schema-bucket triples", () => {
		const all = makeAllQuads();
		const scoped = selectScope(all, personIri, 'schema');

		expect(scoped.every((q) => q.subject.value === personIri)).toBe(true);
		expect(scoped.some((q) => isRdfType(q, OWL.Class))).toBe(true);
		expect(scoped.some((q) => q.subject.value === personShapeIri)).toBe(false);
		expect(scoped.some((q) => q.subject.termType === 'BlankNode')).toBe(false);
	});

	it("selectScope(allQuads, iri, 'shapes') returns only that entity's shapes-bucket triples", () => {
		const all = makeAllQuads();
		const scoped = selectScope(all, personIri, 'shapes');

		expect(scoped.some((q) => q.subject.value === personShapeIri && isRdfType(q, SH.NodeShape))).toBe(true);
		expect(scoped.some((q) => q.subject.termType === 'BlankNode')).toBe(true);
		expect(scoped.some((q) => isRdfType(q, OWL.Class))).toBe(false);
	});

	it('selectScope(allQuads, iri) with no partition argument preserves the combined default behavior unchanged', () => {
		const all = makeAllQuads();
		const combined = selectScope(all, personIri);
		const explicitAll = selectScope(all, personIri, 'all');
		expect(new Set(combined.map(quadKey))).toEqual(new Set(explicitAll.map(quadKey)));
		expect(combined.some((q) => isRdfType(q, OWL.Class))).toBe(true);
		expect(combined.some((q) => q.subject.value === personShapeIri)).toBe(true);
	});
});

describe('partitionQuads (STORY-014)', () => {
	const personIri = classIri('Person');
	const carIri = classIri('Car');
	const ownsIri = propertyIri(personIri, 'owns');
	const personShapeIri = nodeShapeIri(personIri);

	function makeMixedQuads(): Quad[] {
		return parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			@prefix sh: <http://www.w3.org/ns/shacl#> .

			<${personIri}> a owl:Class ; rdfs:label "Person" .
			<${carIri}> a owl:Class ; rdfs:label "Car" .
			<${ownsIri}> a owl:ObjectProperty ; rdfs:domain <${personIri}> ; rdfs:range <${carIri}> ; rdfs:label "owns" .
			<${personShapeIri}> a sh:NodeShape ; sh:targetClass <${personIri}> ;
				sh:property [ sh:path <${ownsIri}> ; sh:class <${carIri}> ] .
		`);
	}

	it('splits a pure schema graph entirely into the schema bucket', () => {
		const quads = parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			<${personIri}> a owl:Class ; rdfs:label "Person" .
		`);
		const { schema, shapes } = partitionQuads(quads);
		expect(schema).toHaveLength(quads.length);
		expect(shapes).toHaveLength(0);
	});

	it('splits a pure shapes graph (NodeShape + blank-node property shapes) entirely into the shapes bucket', () => {
		const quads = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			<${personShapeIri}> a sh:NodeShape ; sh:targetClass <${personIri}> ;
				sh:property [ sh:path <${ownsIri}> ] .
		`);
		const { schema, shapes } = partitionQuads(quads);
		expect(schema).toHaveLength(0);
		expect(shapes).toHaveLength(quads.length);
	});

	it('splits a realistic mixed graph so every quad lands in exactly one bucket', () => {
		const all = makeMixedQuads();
		const { schema, shapes } = partitionQuads(all);

		expect(schema.length + shapes.length).toBe(all.length);
		expect(new Set([...schema, ...shapes].map(quadKey))).toEqual(new Set(all.map(quadKey)));

		expect(schema.every((q) => q.subject.value === personIri || q.subject.value === carIri || q.subject.value === ownsIri)).toBe(true);
		expect(shapes.some((q) => q.subject.value === personShapeIri)).toBe(true);
		expect(shapes.every((q) => q.subject.termType === 'BlankNode' || q.subject.value === personShapeIri)).toBe(true);
	});

	it('routes a quad by SHACL predicate to shapes even if its subject is a SCHEMA_NAMESPACE IRI (robustness override)', () => {
		const misplaced = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			<${personIri}> sh:targetClass <${carIri}> .
		`);
		const { schema, shapes } = partitionQuads(misplaced);
		expect(schema).toHaveLength(0);
		expect(shapes).toHaveLength(1);
	});

	it('every input quad appears in exactly one output bucket, with no drops or duplicates', () => {
		const all = makeMixedQuads();
		const { schema, shapes } = partitionQuads(all);
		expect(schema.length + shapes.length).toBe(all.length);
	});

	it('routes a NodeShape\'s own `a sh:NodeShape` triple to shapes even in a non-default namespace (STORY-048 regression)', () => {
		// This triple has neither an `sh:*` predicate nor a blank-node subject — before the fix, the
		// old `SHAPES_NAMESPACE`-prefix check only matched the *default* namespace's shapes IRIs, so
		// this fell through to the schema bucket for any other namespace (reproducing a real
		// duplicate-triple bug: this quad round-tripped into the wrong namespace's schema graph).
		const coreShapesBase = 'http://ld.pageagent.com/rdf-schema-editor/core/shapes';
		const coreShapeIri = nodeShapeIri(classIri('BusinessProcess'), coreShapesBase);
		const quads = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			<${coreShapeIri}> a sh:NodeShape .
		`);

		const { schema, shapes } = partitionQuads(quads);

		expect(shapes).toHaveLength(1);
		expect(schema).toHaveLength(0);
	});
});

describe('groupSchemaQuads (STORY-015)', () => {
	const personIri = classIri('Person');
	const carIri = classIri('Car');
	const personNameIri = propertyIri(personIri, 'name');
	const carModelIri = propertyIri(carIri, 'model');

	it('orders output as class A, class A\'s own properties, then class B, class B\'s own properties', () => {
		// Deliberately out-of-order input: Car's property before Person, Person's property
		// scattered after Car's own triples. Class order in the output is alphabetical by IRI (a
		// pure function of content, not arrival order — required for the byte-identical AC below),
		// so Car (rse:Car) sorts before Person (rse:Person).
		const quads = parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

			<${carModelIri}> a owl:DatatypeProperty ; rdfs:domain <${carIri}> ; rdfs:label "model" .
			<${personIri}> a owl:Class ; rdfs:label "Person" .
			<${carIri}> a owl:Class ; rdfs:label "Car" .
			<${personNameIri}> a owl:DatatypeProperty ; rdfs:domain <${personIri}> ; rdfs:label "name" .
		`);

		const ordered = groupSchemaQuads(quads);
		const subjectSequence = ordered.map((q) => q.subject.value);
		const firstIndex = (iri: string) => subjectSequence.indexOf(iri);
		const lastIndex = (iri: string) => subjectSequence.lastIndexOf(iri);

		// Car (alphabetically first) sorts before Person, and each class's own property block is
		// fully contained within its class block (contiguous, not interleaved).
		expect(firstIndex(carIri)).toBeLessThan(firstIndex(personIri));
		expect(firstIndex(carModelIri)).toBeGreaterThan(firstIndex(carIri));
		expect(lastIndex(carModelIri)).toBeLessThan(firstIndex(personIri));
		expect(firstIndex(personNameIri)).toBeGreaterThan(firstIndex(personIri));
	});

	it('keeps same-subject quads adjacent so n3.Writer collapses them into one ;-block', () => {
		const quads = parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

			<${personNameIri}> a owl:DatatypeProperty .
			<${personIri}> a owl:Class .
			<${personNameIri}> rdfs:domain <${personIri}> .
			<${personIri}> rdfs:label "Person" .
			<${personNameIri}> rdfs:label "name" .
		`);

		const ordered = groupSchemaQuads(quads);
		const subjectSequence = ordered.map((q) => q.subject.value);
		for (const iri of [personIri, personNameIri]) {
			const indices = subjectSequence.reduce<number[]>((acc, v, i) => (v === iri ? [...acc, i] : acc), []);
			for (let i = 1; i < indices.length; i++) {
				expect(indices[i]).toBe(indices[i - 1] + 1);
			}
		}
	});

	it('two serializations of an unchanged graph are byte-identical regardless of input quad order', async () => {
		const quads = parseTurtle(`
			@prefix owl: <http://www.w3.org/2002/07/owl#> .
			@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
			<${personIri}> a owl:Class ; rdfs:label "Person" .
			<${personNameIri}> a owl:DatatypeProperty ; rdfs:domain <${personIri}> ; rdfs:label "name" .
			<${carIri}> a owl:Class ; rdfs:label "Car" .
		`);
		const shuffled = [...quads].reverse();

		const [turtleA, turtleB] = await Promise.all([
			quadsToTurtle(groupSchemaQuads(quads)),
			quadsToTurtle(groupSchemaQuads(shuffled))
		]);
		expect(turtleA).toBe(turtleB);
	});
});

describe('nestBlankNodes (STORY-016)', () => {
	const carIri = classIri('Car');
	const ownsIri = propertyIri(classIri('Person'), 'owns');
	const personShapeIri = nodeShapeIri(classIri('Person'));

	it('nests a single sh:property blank node inline instead of a top-level _: statement', () => {
		const quads = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			<${personShapeIri}> a sh:NodeShape ; sh:targetClass <${classIri('Person')}> ;
				sh:property [ sh:path <${ownsIri}> ; sh:class <${carIri}> ; sh:minCount 1 ] .
		`);

		const turtle = nestBlankNodes(quads);

		expect(turtle).toContain('sh:property [');
		expect(turtle).not.toMatch(/^_:/m);
		expect(turtle).not.toMatch(/\s_:\w+\s*\./);
	});

	it('round-trips: re-parsing the nested output yields the same quads modulo blank-node labels', () => {
		const quads = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			<${personShapeIri}> a sh:NodeShape ; sh:targetClass <${classIri('Person')}> ;
				sh:property [ sh:path <${ownsIri}> ; sh:class <${carIri}> ; sh:minCount 1 ] .
		`);

		const turtle = nestBlankNodes(quads);
		const reparsed = parseTurtle(turtle);

		const blankAgnosticKey = (q: Quad) =>
			[q.subject, q.predicate, q.object]
				.map((t) => (t.termType === 'BlankNode' ? 'BlankNode' : `${t.termType}|${t.value}`))
				.join('||');

		expect(reparsed).toHaveLength(quads.length);
		expect(new Set(reparsed.map(blankAgnosticKey))).toEqual(new Set(quads.map(blankAgnosticKey)));
	});

	it('supports two levels of nesting depth via recursion', () => {
		const outerShape = personShapeIri;
		const quads = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			<${outerShape}> a sh:NodeShape ;
				sh:property [
					sh:path <${ownsIri}> ;
					sh:qualifiedValueShape [ sh:path <urn:nested-path> ; sh:minCount 1 ]
				] .
		`);

		const turtle = nestBlankNodes(quads);
		const reparsed = parseTurtle(turtle);

		// No bare top-level `_:label ...` statement at either nesting level — every blank node is
		// only ever written as nested `[ ... ]` syntax (blank nodes still exist at the RDF/quad
		// level after re-parsing, since bracket syntax is sugar for a blank node subject — that's
		// unavoidable and correct; what matters is the *serialized text* never starts a line at a
		// bare blank-node subject).
		expect(turtle).not.toMatch(/^_:/m);
		expect(turtle).toContain('sh:property [');
		expect(turtle).toContain('sh:qualifiedValueShape [');
		expect(reparsed).toHaveLength(quads.length);
	});

	it('falls back to labeled _: output for a blank node shared across more than one reference, without failing the whole serialize', () => {
		const quads = parseTurtle(`
			@prefix sh: <http://www.w3.org/ns/shacl#> .
			_:shared sh:path <urn:shared-path> ; sh:minCount 1 .
			<urn:shapeA> sh:property _:shared .
			<urn:shapeB> sh:property _:shared .
		`);

		const turtle = nestBlankNodes(quads);
		const reparsed = parseTurtle(turtle);

		expect(new Set(reparsed.map(quadKey)).size).toBeGreaterThan(0);
		expect(reparsed).toHaveLength(quads.length);
		// Both shapes still reference the very same (shared) blank node.
		const shapeAObj = reparsed.find((q) => q.subject.value === 'urn:shapeA')?.object.value;
		const shapeBObj = reparsed.find((q) => q.subject.value === 'urn:shapeB')?.object.value;
		expect(shapeAObj).toBe(shapeBObj);
	});
});
