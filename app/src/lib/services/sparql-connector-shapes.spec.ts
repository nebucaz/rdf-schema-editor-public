import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector, type FetchedNamespace } from './sparql-connector';

/**
 * ontology-pipeline STORY-319: the batched schema load also reports each NodeShape (target class and the
 * `sh:path`s of its property shapes), taken from the query that already read the shapes graph, so the gates
 * need no request of their own.
 */

const BASE = 'http://example.org/a';
const namespaces = [{ baseIri: BASE, prefix: 'a', description: '' }] as unknown as FetchedNamespace[];
const uri = (value: string) => ({ type: 'uri', value });
const json = (bindings: unknown[]) =>
	new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });

function mock(rows: unknown[]) {
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const q: string = JSON.parse(opts.body).query;
		queries.push(q);
		return q.includes('SELECT ?g ?path ?minCount') ? json(rows) : json([]);
	});
	return { fn, queries };
}

describe('fetchSchemaBatched — shapes (STORY-319)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('groups the paths of a shape and keeps a shape without properties or target', async () => {
		const g = uri(`${BASE}/shapes`);
		const { fn } = mock([
			{ g, shape: uri('http://e#PersonShape'), target: uri('http://e#Person'), path: uri('http://e#name') },
			{ g, shape: uri('http://e#PersonShape'), target: uri('http://e#Person'), path: uri('http://e#age') },
			{ g, shape: uri('http://e#EmptyShape'), target: uri('http://e#Empty') },
			{ g, shape: uri('http://e#LooseShape'), path: uri('http://e#x') }
		]);
		vi.stubGlobal('fetch', fn);
		const schema = await new SparqlConnector('/api/sparql').fetchSchemaBatched(namespaces);

		expect(schema.shapes).toEqual([
			{ iri: 'http://e#PersonShape', targetClassIri: 'http://e#Person', paths: ['http://e#name', 'http://e#age'], namespaceBaseIri: BASE },
			{ iri: 'http://e#EmptyShape', targetClassIri: 'http://e#Empty', paths: [], namespaceBaseIri: BASE },
			{ iri: 'http://e#LooseShape', paths: ['http://e#x'], namespaceBaseIri: BASE }
		]);
	});

	it('still reads cardinality from rows that carry a path, and ignores rows without one for it', async () => {
		const g = uri(`${BASE}/shapes`);
		const lit = (value: string) => ({ type: 'literal', value });
		const { fn } = mock([
			{ g, shape: uri('http://e#S'), target: uri('http://e#C'), path: uri('http://e#name'), minCount: lit('1') },
			{ g, shape: uri('http://e#Empty'), target: uri('http://e#D') }
		]);
		vi.stubGlobal('fetch', fn);
		const schema = await new SparqlConnector('/api/sparql').fetchSchemaBatched(namespaces);
		expect(schema.shapes).toHaveLength(2);
	});

	it('does not add a request: the shapes ride on the existing shapes-graph query', async () => {
		const { fn } = mock([]);
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').fetchSchemaBatched(namespaces);
		expect(fn).toHaveBeenCalledTimes(7);
	});
});
