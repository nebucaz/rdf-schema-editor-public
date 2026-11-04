import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestActivity } from '#lib/stores/request-activity.svelte.js';
import { SparqlConnector, type FetchedNamespace, type FetchedSchema } from './sparql-connector';

/**
 * Pins how many SPARQL requests the all-namespace schema load costs (reduce-requests STORY-293), so
 * every story that lowers the number updates `expectedRequests` and a regression fails the build.
 * Every query is answered with an empty result: only the request count matters here.
 */

function fakeNamespaces(n: number): FetchedNamespace[] {
	return Array.from({ length: n }, (_, i) => ({
		baseIri: `http://example.org/ns${i}`,
		prefix: `ns${i}`,
		description: ''
	})) as FetchedNamespace[];
}

/** Requests `fetchFullSchemaForAllNamespaces(namespaces)` makes: the 13 queries inside `fetchFullSchema`
 *  per namespace. (STORY-294 removed the 14th, a `fetchNamespaces()` per namespace.) */
function expectedRequests(n: number, options: { includeInstances?: boolean } = {}): number {
	// Schema-only (STORY-295) skips the 5 instance queries: individuals, untyped list and count, and both
	// individual relation queries.
	return (options.includeInstances === false ? 8 : 13) * n;
}

describe('SparqlConnector — request count of the all-namespace schema load', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		requestActivity.reset();
		fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		requestActivity.reset();
	});

	it.each([1, 3, 12])('costs the pinned number of requests for %i namespace(s)', async (n) => {
		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchFullSchemaForAllNamespaces(fakeNamespaces(n));
		expect(fetchMock).toHaveBeenCalledTimes(expectedRequests(n));
		expect(requestActivity.started).toBe(expectedRequests(n));
	});

	it.each([1, 3, 12])('schema-only variant costs 8 requests per namespace for %i namespace(s)', async (n) => {
		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchFullSchemaForAllNamespaces(fakeNamespaces(n), { includeInstances: false });
		expect(fetchMock).toHaveBeenCalledTimes(expectedRequests(n, { includeInstances: false }));
	});

	it('schema-only variant leaves the instance fields empty but present', async () => {
		const schema = await new SparqlConnector('/api/sparql').fetchFullSchemaForAllNamespaces(fakeNamespaces(2), {
			includeInstances: false
		});
		expect(schema.individuals).toEqual([]);
		expect(schema.untypedIndividuals).toEqual([]);
		expect(schema.untypedTotal).toBe(0);
		expect(schema.individualClassRelations).toEqual([]);
		expect(schema.individualIndividualRelations).toEqual([]);
	});

	it('fetches the namespace list exactly once when none is passed', async () => {
		fetchMock.mockImplementation(async (_url: string, opts: { body: string }) => {
			const q: string = JSON.parse(opts.body).query;
			const bindings = q.includes('?ns ?prefix ?desc')
				? fakeNamespaces(3).map((ns) => ({
						ns: { type: 'uri', value: ns.baseIri },
						prefix: { type: 'literal', value: ns.prefix },
						desc: { type: 'literal', value: '' }
					}))
				: [];
			return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });
		});
		await new SparqlConnector('/api/sparql').fetchFullSchemaForAllNamespaces();
		const namespaceFetches = fetchMock.mock.calls.filter(([, opts]) =>
			JSON.parse((opts as { body: string }).body).query.includes('?ns ?prefix ?desc')
		);
		expect(namespaceFetches).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1 + expectedRequests(3));
	});

	it('grows linearly with the number of namespaces today', async () => {
		const counts: number[] = [];
		for (const n of [1, 2, 3]) {
			fetchMock.mockClear();
			await new SparqlConnector('/api/sparql').fetchFullSchemaForAllNamespaces(fakeNamespaces(n));
			counts.push(fetchMock.mock.calls.length);
		}
		expect(counts[1] - counts[0]).toBe(counts[2] - counts[1]);
	});
});

describe('SparqlConnector — edit-form option lists reuse a supplied schema (STORY-297)', () => {
	const schema: FetchedSchema = {
		classes: [],
		datatypeProperties: [],
		objectProperties: [
			{
				iri: 'urn:rel',
				label: 'rel',
				domain: 'urn:a',
				range: 'urn:b',
				namespaceBaseIri: 'http://example.org/ns0',
				required: false,
				repeatable: true
			} as FetchedSchema['objectProperties'][number]
		],
		subClassOf: [],
		individuals: [],
		individualClassRelations: [],
		individualIndividualRelations: []
	};

	it('fetchRelationPredicateOptions(schema) sends no request at all', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const options = await new SparqlConnector('/api/sparql').fetchRelationPredicateOptions(schema);
		expect(options).toEqual([{ iri: 'urn:rel', label: 'rel' }]);
		expect(fetchMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('fetchNameableEntities(schema) sends only the reified-statements query, no schema load', async () => {
		const connector = new SparqlConnector('/api/sparql');
		const fullLoad = vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces');
		const reified = vi.spyOn(connector, 'fetchAllReifiedStatements').mockResolvedValue([]);
		await connector.fetchNameableEntities(schema);
		expect(fullLoad).not.toHaveBeenCalled();
		expect(reified).toHaveBeenCalledTimes(1);
	});

	it('both still load the schema themselves when called without one', async () => {
		const connector = new SparqlConnector('/api/sparql');
		const fullLoad = vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue(schema);
		vi.spyOn(connector, 'fetchAllReifiedStatements').mockResolvedValue([]);
		await connector.fetchRelationPredicateOptions();
		await connector.fetchNameableEntities();
		expect(fullLoad).toHaveBeenCalledTimes(2);
	});
});

describe('SparqlConnector — dev request log (reduce-requests)', () => {
	it('records each request under the connector method that sent it', async () => {
		const { requestLog } = await import('#lib/utils/request-log.js');
		requestLog.clear();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 }))
		);
		const connector = new SparqlConnector('/api/sparql');
		await connector.fetchAllClasses('http://example.org/ns0');
		await connector.fetchAllClasses('http://example.org/ns1');
		await connector.executeUpdate('INSERT DATA {}');
		vi.unstubAllGlobals();
		expect(requestLog.entries.map((e) => e.kind)).toEqual(['query', 'query', 'update']);
		expect(requestLog.entries.slice(0, 2).map((e) => e.caller)).toEqual(['fetchAllClasses', 'fetchAllClasses']);
		expect(requestLog.entries.every((e) => e.ok && e.ms >= 0)).toBe(true);
		requestLog.clear();
	});
});
