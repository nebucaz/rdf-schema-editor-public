import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestActivity } from '#lib/stores/request-activity.svelte.js';
import { SparqlConnector, type FetchedNamespace } from './sparql-connector';

/**
 * reduce-requests STORY-298: `fetchSchemaBatched` must return what the per-namespace path
 * (`fetchFullSchemaForAllNamespaces(..., { includeInstances: false })`) returns, with a constant number of
 * requests. Both paths are fed the *same* fixture, each through a mock that answers the query shape that
 * path sends. This pins the parsing and merging; that the SPARQL itself selects the same triples is checked
 * on real data by the human (STORY-300).
 */

const BASES = ['http://example.org/a', 'http://example.org/b', 'http://example.org/c'];
const namespaces = BASES.map((baseIri, i) => ({ baseIri, prefix: `n${i}`, description: '' })) as unknown as FetchedNamespace[];
const schemaGraph = (base: string) => `${base}/schema`;
const shapesGraph = (base: string) => `${base}/shapes`;

interface NsData {
	classes: { iri: string; label?: string; comment?: string }[];
	dtProps: { p: string; label?: string; domain: string; range: string }[];
	objProps: { p: string; label?: string; domain: string; range: string; reverseOf?: string }[];
	subClassOf: { sub: string; sup: string }[];
	shapes: { path: string; min?: number; max?: number; rfs?: boolean }[];
	labelRequired: { cls: string; min?: number }[];
	inConstraints: { cls: string; path: string; value: string; isIri?: boolean }[];
	/** Generic-relation rows whose shape lives in this namespace's shapes graph. */
	generic: { p: string; label?: string; domain: string; range: string; min?: number; max?: number }[];
}

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const DATA: NsData[] = [
	{
		classes: [
			{ iri: 'http://example.org/a#Person', label: 'Person', comment: 'A person' },
			{ iri: 'http://example.org/a#Team' }
		],
		dtProps: [{ p: 'http://example.org/a#name', label: 'name', domain: 'http://example.org/a#Person', range: XSD_STRING }],
		objProps: [
			{ p: 'http://example.org/a#memberOf', label: 'member of', domain: 'http://example.org/a#Person', range: 'http://example.org/a#Team' },
			{
				p: 'http://example.org/a#hasMember',
				domain: 'http://example.org/a#Team',
				range: 'http://example.org/a#Person',
				reverseOf: 'http://example.org/a#memberOf'
			}
		],
		subClassOf: [{ sub: 'http://example.org/a#Team', sup: 'http://example.org/a#Person' }],
		shapes: [{ path: 'http://example.org/a#name', min: 1, max: 1 }, { path: 'http://example.org/a#memberOf', min: 0 }],
		labelRequired: [{ cls: 'http://example.org/a#Person', min: 1 }, { cls: 'http://example.org/a#Team' }],
		inConstraints: [
			{ cls: 'http://example.org/a#Person', path: 'http://example.org/a#name', value: 'Ann' },
			{ cls: 'http://example.org/a#Person', path: 'http://example.org/a#name', value: 'Bob' }
		],
		generic: [
			{ p: 'http://example.org/a#relatesTo', label: 'relates to', domain: 'http://example.org/a#Person', range: 'http://example.org/b#Person', min: 1 }
		]
	},
	{
		// Same local names as namespace a, different IRIs: must stay distinct.
		classes: [{ iri: 'http://example.org/b#Person', label: 'Person' }],
		dtProps: [{ p: 'http://example.org/b#name', label: 'name', domain: 'http://example.org/b#Person', range: XSD_STRING }],
		objProps: [],
		subClassOf: [],
		// A constraint on a path that is only declared in namespace a must not leak into b's properties.
		shapes: [{ path: 'http://example.org/a#name', min: 1 }, { path: 'http://example.org/b#name', rfs: true }],
		labelRequired: [],
		inConstraints: [{ cls: 'http://example.org/b#Person', path: 'http://example.org/b#name', value: 'http://example.org/b#x', isIri: true }],
		generic: [{ p: 'http://example.org/a#relatesTo', label: 'relates to', domain: 'http://example.org/b#Person', range: 'http://example.org/a#Person', max: 3 }]
	},
	{ classes: [], dtProps: [], objProps: [], subClassOf: [], shapes: [], labelRequired: [], inConstraints: [], generic: [] }
];

const uri = (value: string) => ({ type: 'uri', value });
const lit = (value: string) => ({ type: 'literal', value });
const opt = (key: string, v: string | number | boolean | undefined) => (v === undefined ? {} : { [key]: lit(String(v)) });
const json = (bindings: unknown[]) =>
	new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });

const GRAPH_OF_FROM = /FROM <([^>]+)>/;
const nsIndexOfGraph = (g: string) => BASES.findIndex((b) => g === schemaGraph(b) || g === shapesGraph(b));

/** Answers the per-namespace queries of the old path, one namespace per `FROM <graph>`. */
function legacyMock() {
	return vi.fn(async (_url: string, opts: { body: string }) => {
		const q: string = JSON.parse(opts.body).query;
		const from = GRAPH_OF_FROM.exec(q);
		const d = from ? DATA[nsIndexOfGraph(from[1])] : undefined;
		if (!d) return json([]);
		if (q.includes('FILTER NOT EXISTS { ?p rdfs:domain ?anyDomain }'))
			return json(
				d.generic.map((e) => ({
					p: uri(e.p), domain: uri(e.domain), range: uri(e.range),
					...(e.label ? { label: lit(e.label) } : {}), ...opt('minCount', e.min), ...opt('maxCount', e.max)
				}))
			);
		if (q.includes('SELECT ?c ?label ?comment'))
			return json(d.classes.map((c) => ({ c: uri(c.iri), ...(c.label ? { label: lit(c.label) } : {}), ...(c.comment ? { comment: lit(c.comment) } : {}) })));
		if (q.includes('?p a owl:DatatypeProperty ; rdfs:domain'))
			return json(d.dtProps.map((e) => ({ p: uri(e.p), domain: uri(e.domain), range: uri(e.range), ...(e.label ? { label: lit(e.label) } : {}) })));
		if (q.includes('?p a owl:ObjectProperty ; rdfs:domain'))
			return json(
				d.objProps.map((e) => ({
					p: uri(e.p), domain: uri(e.domain), range: uri(e.range),
					...(e.label ? { label: lit(e.label) } : {}), ...(e.reverseOf ? { reverseOf: uri(e.reverseOf) } : {})
				}))
			);
		if (q.includes('SELECT ?path ?minCount ?maxCount ?requiredForSubclasses'))
			return json(d.shapes.map((s) => ({ path: uri(s.path), ...opt('minCount', s.min), ...opt('maxCount', s.max), ...opt('requiredForSubclasses', s.rfs) })));
		if (q.includes('SELECT ?sub ?super')) return json(d.subClassOf.map((s) => ({ sub: uri(s.sub), super: uri(s.sup) })));
		if (q.includes('sh:path rdfs:label')) return json(d.labelRequired.map((l) => ({ class: uri(l.cls), ...opt('minCount', l.min) })));
		if (q.includes('SELECT ?class ?path ?value'))
			return json(d.inConstraints.map((c) => ({ class: uri(c.cls), path: uri(c.path), value: c.isIri ? uri(c.value) : lit(c.value) })));
		return json([]);
	});
}

/** Answers the cross-namespace queries of the batched path: every namespace's rows, tagged with `?g`. */
function batchedMock() {
	const all = <T>(graphOf: (base: string) => string, rows: (d: NsData) => T[], bind: (r: T) => object) =>
		json(DATA.flatMap((d, i) => rows(d).map((r) => ({ g: uri(graphOf(BASES[i])), ...bind(r) }))));
	return vi.fn(async (_url: string, opts: { body: string }) => {
		const q: string = JSON.parse(opts.body).query;
		if (q.includes('SELECT DISTINCT ?gs'))
			return json(
				DATA.flatMap((d, i) =>
					d.generic.map((e) => ({
						gs: uri(shapesGraph(BASES[i])), p: uri(e.p), domain: uri(e.domain), range: uri(e.range),
						...(e.label ? { label: lit(e.label) } : {}), ...opt('minCount', e.min), ...opt('maxCount', e.max)
					}))
				)
			);
		if (q.includes('SELECT ?g ?c ?label ?comment'))
			return all(schemaGraph, (d) => d.classes, (c) => ({ c: uri(c.iri), ...(c.label ? { label: lit(c.label) } : {}), ...(c.comment ? { comment: lit(c.comment) } : {}) }));
		if (q.includes('SELECT ?g ?ptype')) {
			const row = (ptype: string, i: number) => (e: { p: string; label?: string; domain: string; range: string; reverseOf?: string }) => ({
				g: uri(schemaGraph(BASES[i])), ptype: uri(ptype), p: uri(e.p), domain: uri(e.domain), range: uri(e.range),
				...(e.label ? { label: lit(e.label) } : {}), ...(e.reverseOf ? { reverseOf: uri(e.reverseOf) } : {})
			});
			return json(
				DATA.flatMap((d, i) => [
					...d.dtProps.map(row('http://www.w3.org/2002/07/owl#DatatypeProperty', i)),
					...d.objProps.map(row('http://www.w3.org/2002/07/owl#ObjectProperty', i))
				])
			);
		}
		if (q.includes('SELECT ?g ?path ?minCount'))
			return all(shapesGraph, (d) => d.shapes, (s) => ({ path: uri(s.path), ...opt('minCount', s.min), ...opt('maxCount', s.max), ...opt('requiredForSubclasses', s.rfs) }));
		if (q.includes('SELECT ?g ?sub ?super')) return all(schemaGraph, (d) => d.subClassOf, (s) => ({ sub: uri(s.sub), super: uri(s.sup) }));
		if (q.includes('SELECT ?g ?class ?minCount')) return all(shapesGraph, (d) => d.labelRequired, (l) => ({ class: uri(l.cls), ...opt('minCount', l.min) }));
		if (q.includes('SELECT ?g ?class ?path ?value'))
			return all(shapesGraph, (d) => d.inConstraints, (c) => ({ class: uri(c.cls), path: uri(c.path), value: c.isIri ? uri(c.value) : lit(c.value) }));
		return json([]);
	});
}

describe('SparqlConnector.fetchSchemaBatched (reduce-requests STORY-298)', () => {
	beforeEach(() => requestActivity.reset());
	afterEach(() => {
		vi.unstubAllGlobals();
		requestActivity.reset();
	});

	it('returns what the per-namespace schema-only path returns, for the same data', async () => {
		vi.stubGlobal('fetch', legacyMock());
		const legacy = await new SparqlConnector('/api/sparql').fetchFullSchemaForAllNamespaces(namespaces, { includeInstances: false });
		vi.stubGlobal('fetch', batchedMock());
		const batched = await new SparqlConnector('/api/sparql').fetchSchemaBatched(namespaces);
		expect(batched).toEqual(legacy);
		// Guard against a vacuous pass: the fixture really produced content, including the cross-namespace cases.
		expect(batched.classes).toHaveLength(3);
		expect(batched.objectProperties.filter((p) => p.relationKind === 'generic')).toHaveLength(2);
		expect(batched.datatypeProperties.map((p) => [p.namespaceBaseIri, p.required])).toEqual([
			[BASES[0], true],
			[BASES[1], false]
		]);
	});

	it('keeps same-named classes of different namespaces distinct and tagged with their own namespace', async () => {
		vi.stubGlobal('fetch', batchedMock());
		const batched = await new SparqlConnector('/api/sparql').fetchSchemaBatched(namespaces);
		const people = batched.classes.filter((c) => c.label === 'Person');
		expect(people.map((c) => [c.iri, c.namespaceBaseIri])).toEqual([
			['http://example.org/a#Person', BASES[0]],
			['http://example.org/b#Person', BASES[1]]
		]);
	});

	it.each([1, 3, 12])('sends a constant 7 requests for %i namespace(s)', async (n) => {
		const fetchMock = vi.fn(async () => json([]));
		vi.stubGlobal('fetch', fetchMock);
		const many = Array.from({ length: n }, (_, i) => ({ baseIri: `http://example.org/n${i}`, prefix: `n${i}`, description: '' })) as unknown as FetchedNamespace[];
		await new SparqlConnector('/api/sparql').fetchSchemaBatched(many);
		expect(fetchMock).toHaveBeenCalledTimes(7);
	});

	it.each([1, 3, 12])('sends a constant 12 requests with instances for %i namespace(s)', async (n) => {
		const fetchMock = vi.fn(async () => json([]));
		vi.stubGlobal('fetch', fetchMock);
		const many = Array.from({ length: n }, (_, i) => ({ baseIri: `http://example.org/n${i}`, prefix: `n${i}`, description: '' })) as unknown as FetchedNamespace[];
		await new SparqlConnector('/api/sparql').fetchSchemaBatched(many, { includeInstances: true });
		expect(fetchMock).toHaveBeenCalledTimes(12);
	});

	it('returns what the per-namespace full path returns when instances are included', async () => {
		// Per namespace: an individual, two untyped (one shared with the other namespace), a count, both relation kinds.
		const inst = (base: string) => ({
			individuals: [{ i: `${base}#x1`, type: `${base}#Person`, label: 'X one', syncSource: 'backstage' }],
			untyped: [{ i: `${base}#u1`, label: 'Untyped' }, { i: 'http://example.org/shared#u', label: 'Shared' }],
			count: 2,
			classRel: [{ s: `${base}#x1`, p: `${base}#likes`, plabel: 'likes', class: `${base}#Person` }],
			indRel: [{ s: `${base}#x1`, p: `${base}#knows`, o: `${base}#x2` }]
		});
		const instances = new Map(BASES.map((b) => [b, inst(b)]));
		const nsOfQuery = (q: string) => BASES.find((b) => q.includes(`GRAPH <${b}>`));
		const tag = (batched: boolean, ns: string, row: Record<string, unknown>) => (batched ? { g: uri(ns), ...row } : row);
		const answer = (batched: boolean) => (q: string, ns: string | undefined): Record<string, unknown>[] | undefined => {
			const each = batched ? BASES : ns ? [ns] : [];
			const rows = (pick: (d: ReturnType<typeof inst>, b: string) => Record<string, unknown>[]) =>
				each.flatMap((b) => pick(instances.get(b)!, b).map((r) => tag(batched, b, r)));
			if (q.includes('SELECT') && /SELECT (?:\?g )?\?i \?type/.test(q))
				return rows((d) => d.individuals.map((e) => ({ i: uri(e.i), type: uri(e.type), label: lit(e.label), syncSource: lit(e.syncSource) })));
			if (q.includes('COUNT(DISTINCT ?i)')) return rows((d) => [{ n: lit(String(d.count)) }]);
			if (/SELECT (?:\?g )?\?i \?label WHERE/.test(q)) return rows((d) => d.untyped.map((e) => ({ i: uri(e.i), label: lit(e.label) })));
			if (/SELECT (?:\?g )?\?s \?p \?plabel \?class/.test(q))
				return rows((d) => d.classRel.map((e) => ({ s: uri(e.s), p: uri(e.p), plabel: lit(e.plabel), class: uri(e.class) })));
			if (/SELECT DISTINCT (?:\?g )?\?s \?p \?plabel \?o/.test(q)) return rows((d) => d.indRel.map((e) => ({ s: uri(e.s), p: uri(e.p), o: uri(e.o) })));
			return undefined;
		};
		const legacyAnswer = answer(false);
		const batchedAnswer = answer(true);
		const mockWith = (legacy: boolean) =>
			vi.fn(async (_u: string, opts: { body: string }) => {
				const q: string = JSON.parse(opts.body).query;
				const base = legacyMock();
				const rows = (legacy ? legacyAnswer(q, nsOfQuery(q)) : batchedAnswer(q, undefined));
				if (rows) return json(rows);
				return (legacy ? base : batchedMock())(_u, opts as never);
			});
		vi.stubGlobal('fetch', mockWith(true));
		const legacy = await new SparqlConnector('/api/sparql').fetchFullSchemaForAllNamespaces(namespaces);
		vi.stubGlobal('fetch', mockWith(false));
		const batched = await new SparqlConnector('/api/sparql').fetchSchemaBatched(namespaces, { includeInstances: true });
		expect(batched).toEqual(legacy);
		expect(batched.individuals).toHaveLength(3);
		expect(batched.untypedTotal).toBe(6);
		expect((batched.untypedIndividuals ?? []).map((u) => u.iri).filter((i) => i === 'http://example.org/shared#u')).toHaveLength(1);
		expect(batched.individualClassRelations).toHaveLength(3);
		expect(batched.individualIndividualRelations).toHaveLength(3);
	});

	it('returns an empty schema without any request for an empty namespace list', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const schema = await new SparqlConnector('/api/sparql').fetchSchemaBatched([]);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(schema.classes).toEqual([]);
		expect(schema.individuals).toEqual([]);
	});

	it('scopes every query with VALUES over the namespaces\' own graphs and never mixes FROM with GRAPH', async () => {
		const fetchMock = batchedMock();
		vi.stubGlobal('fetch', fetchMock);
		await new SparqlConnector('/api/sparql').fetchSchemaBatched(namespaces);
		for (const [, opts] of fetchMock.mock.calls) {
			const q: string = JSON.parse((opts as { body: string }).body).query;
			expect(q).not.toMatch(/\bFROM\b/);
			expect(q).toMatch(/VALUES \?\w+ \{/);
			expect(q).toContain('GRAPH ?');
			// Every namespace is in the graph list, as its schema graph, its shapes graph, or both.
			for (const b of BASES) {
				expect(q.includes(`<${schemaGraph(b)}>`) || q.includes(`<${shapesGraph(b)}>`)).toBe(true);
			}
		}
	});

	it('refuses a namespace whose base IRI is unsafe to interpolate', async () => {
		vi.stubGlobal('fetch', vi.fn());
		const bad = [{ baseIri: 'http://x/> } DROP', prefix: 'x', description: '' }] as unknown as FetchedNamespace[];
		await expect(new SparqlConnector('/api/sparql').fetchSchemaBatched(bad)).rejects.toThrow();
	});
});
