import { describe, expect, it, vi } from 'vitest';
import { createSchemaStore } from './schema-store';
import { SparqlConnector, type FetchedNamespace, type FetchedSchema } from '#lib/services/sparql-connector.js';

const NS = [{ baseIri: 'http://example.org/a', prefix: 'a', description: '' }] as unknown as FetchedNamespace[];

function schemaOf(tag: string): FetchedSchema {
	return {
		classes: [{ iri: `urn:${tag}`, label: tag, comment: null, namespaceBaseIri: NS[0].baseIri }],
		datatypeProperties: [],
		objectProperties: [],
		subClassOf: [],
		individuals: [],
		individualClassRelations: [],
		individualIndividualRelations: []
	};
}

function setup() {
	let writes = 0;
	const fetchSchema = vi.fn(async (_ns: FetchedNamespace[], variant: 'schema' | 'full') => schemaOf(variant));
	const loadNamespaces = vi.fn(async () => NS);
	const store = createSchemaStore({ loadNamespaces, fetchSchema, writeCount: () => writes });
	return { store, fetchSchema, loadNamespaces, write: () => void writes++ };
}

describe('schema store', () => {
	it('returns the cached schema on later calls without refetching', async () => {
		const { store, fetchSchema } = setup();
		const first = await store.ensureLoaded('schema');
		const second = await store.ensureLoaded('schema');
		expect(second).toBe(first);
		expect(fetchSchema).toHaveBeenCalledTimes(1);
	});

	it('shares one in-flight request between concurrent callers', async () => {
		const { store, fetchSchema } = setup();
		const [a, b] = await Promise.all([store.ensureLoaded('schema'), store.ensureLoaded('schema')]);
		expect(a).toBe(b);
		expect(fetchSchema).toHaveBeenCalledTimes(1);
	});

	it('hands the namespace list to the fetch and asks for the variant requested', async () => {
		const { store, fetchSchema } = setup();
		await store.ensureLoaded('full');
		expect(fetchSchema).toHaveBeenCalledWith(NS, 'full');
	});

	it('lets a loaded full schema satisfy a schema request', async () => {
		const { store, fetchSchema } = setup();
		const full = await store.ensureLoaded('full');
		expect(await store.ensureLoaded('schema')).toBe(full);
		expect(fetchSchema).toHaveBeenCalledTimes(1);
	});

	it('does not let a schema-only copy satisfy a full request', async () => {
		const { store, fetchSchema } = setup();
		await store.ensureLoaded('schema');
		await store.ensureLoaded('full');
		expect(fetchSchema).toHaveBeenCalledTimes(2);
		expect(fetchSchema).toHaveBeenLastCalledWith(NS, 'full');
	});

	it('lets an in-flight full load satisfy a concurrent schema request', async () => {
		const { store, fetchSchema } = setup();
		await Promise.all([store.ensureLoaded('full'), store.ensureLoaded('schema')]);
		expect(fetchSchema).toHaveBeenCalledTimes(1);
	});

	it('refetches after a write, and not before', async () => {
		const { store, fetchSchema, write } = setup();
		await store.ensureLoaded('schema');
		await store.ensureLoaded('schema');
		expect(fetchSchema).toHaveBeenCalledTimes(1);
		write();
		await store.ensureLoaded('schema');
		expect(fetchSchema).toHaveBeenCalledTimes(2);
		await store.ensureLoaded('schema');
		expect(fetchSchema).toHaveBeenCalledTimes(2);
	});

	it('treats a load that overlapped a write as stale', async () => {
		const { store, fetchSchema, write } = setup();
		const pending = store.ensureLoaded('schema');
		write();
		await pending;
		await store.ensureLoaded('schema');
		expect(fetchSchema).toHaveBeenCalledTimes(2);
	});

	it('refresh() forces a refetch', async () => {
		const { store, fetchSchema } = setup();
		await store.ensureLoaded('schema');
		await store.refresh('schema');
		expect(fetchSchema).toHaveBeenCalledTimes(2);
	});

	it('invalidate() drops the cache without fetching, so the next ensureLoaded refetches', async () => {
		const { store, fetchSchema } = setup();
		await store.ensureLoaded('full');
		store.invalidate();
		expect(fetchSchema).toHaveBeenCalledTimes(1);
		await store.ensureLoaded('schema');
		expect(fetchSchema).toHaveBeenCalledTimes(2);
	});

	it('does not cache a failed load', async () => {
		const { store, fetchSchema } = setup();
		fetchSchema.mockRejectedValueOnce(new Error('boom'));
		await expect(store.ensureLoaded('schema')).rejects.toThrow('boom');
		await expect(store.ensureLoaded('schema')).resolves.toBeDefined();
		expect(fetchSchema).toHaveBeenCalledTimes(2);
	});
});

describe('SparqlConnector.writeCount', () => {
	it('increases after every update, successful or not', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
		);
		expect(connector.writeCount).toBe(0);
		await connector.executeUpdate('INSERT DATA {}');
		expect(connector.writeCount).toBe(1);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ message: 'no' }), { status: 500 }))
		);
		await expect(connector.executeUpdate('INSERT DATA {}')).rejects.toThrow();
		expect(connector.writeCount).toBe(2);
		vi.unstubAllGlobals();
	});

	it('does not change on a read', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 }))
		);
		await connector.selectQuery('SELECT * WHERE {}');
		expect(connector.writeCount).toBe(0);
		vi.unstubAllGlobals();
	});
});
