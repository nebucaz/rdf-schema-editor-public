import { describe, it, expect, vi } from 'vitest';
import { QueryRunStore } from './query-run-store.svelte';
import { startQueryFromClass, addColumn } from '../services/query-model-edit';
import { buildBuilderSchema } from '../services/query-builder-schema';
import type { FetchedSchema, SparqlSelectResults } from '../services/sparql-connector';

const NS = 'http://example.org/ns';
const APP = `${NS}#Application`;
const fetched = {
	classes: [{ iri: APP, label: 'Application', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [],
	individualClassRelations: [], individualIndividualRelations: []
} as FetchedSchema;
const schema = buildBuilderSchema(fetched);
const model = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'Name' });

const rows = (names: string[]): SparqlSelectResults => ({
	head: { vars: ['root', 'c0'] },
	results: {
		bindings: names.map((n) => ({
			root: { type: 'uri' as const, value: `${NS}#${n}` },
			c0: { type: 'literal' as const, value: n }
		}))
	}
});
const count = (n: number): SparqlSelectResults => ({
	head: { vars: ['total'] },
	results: { bindings: [{ total: { type: 'literal' as const, value: String(n), datatype: 'http://www.w3.org/2001/XMLSchema#integer' } }] }
});

function connector(handler: (q: string) => Promise<SparqlSelectResults>) {
	return { selectQuery: vi.fn(handler) };
}
const isCount = (q: string) => q.includes('AS ?total');

describe('QueryRunStore', () => {
	it('run fetches one page with LIMIT/OFFSET plus the total, and starts at offset 0', async () => {
		const c = connector(async (q) => (isCount(q) ? count(1243) : rows(['a', 'b'])));
		const store = new QueryRunStore(c);
		store.pageSize = 100;
		await store.run(model, schema);
		const page = c.selectQuery.mock.calls.map((x) => x[0]).find((q) => !isCount(q))!;
		expect(page).toMatch(/LIMIT 100 OFFSET 0/);
		expect(store.total).toBe(1243);
		expect(store.table?.rows).toHaveLength(2);
		expect(store.info?.to).toBe(100);
	});

	it('a model row limit caps the visible total and stops paging at it', async () => {
		const c = connector(async (q) => (isCount(q) ? count(1243) : rows(['x'])));
		const store = new QueryRunStore(c);
		store.pageSize = 100;
		const capped = { ...model, limit: 150 };
		await store.run(capped, schema);
		expect(store.info).toMatchObject({ total: 150, to: 100, hasNext: true, uncappedTotal: 1243 });
		await store.next(capped, schema);
		expect(c.selectQuery.mock.calls.at(-1)![0]).toMatch(/LIMIT 50 OFFSET 100/);
		expect(store.info).toMatchObject({ from: 101, to: 150, hasNext: false });
	});

	it('paging asks GraphDB for the next OFFSET and does not re-run the count', async () => {
		const c = connector(async (q) => (isCount(q) ? count(250) : rows(['x'])));
		const store = new QueryRunStore(c);
		store.pageSize = 100;
		await store.run(model, schema);
		c.selectQuery.mockClear();
		await store.next(model, schema);
		expect(c.selectQuery).toHaveBeenCalledTimes(1);
		expect(c.selectQuery.mock.calls[0][0]).toMatch(/LIMIT 100 OFFSET 100/);
		expect(store.offset).toBe(100);
		await store.previous(model, schema);
		expect(c.selectQuery.mock.calls[1][0]).toMatch(/OFFSET 0/);
	});

	it('re-running after a model change re-counts', async () => {
		const c = connector(async (q) => (isCount(q) ? count(5) : rows(['x'])));
		const store = new QueryRunStore(c);
		await store.run(model, schema);
		await store.next(model, schema);
		c.selectQuery.mockClear();
		await store.run(model, schema);
		expect(c.selectQuery.mock.calls.some((x) => isCount(x[0]))).toBe(true);
		expect(store.offset).toBe(0);
	});

	it('a failure shows an error and keeps the previous table', async () => {
		let fail = false;
		const c = connector(async (q) => {
			if (fail) throw new Error('Query evaluation timed out');
			return isCount(q) ? count(1) : rows(['kept']);
		});
		const store = new QueryRunStore(c);
		await store.run(model, schema);
		fail = true;
		await store.run(model, schema);
		expect(store.error).toMatch(/too long/i);
		expect(store.table?.rows[0][0].text).toBe('kept');
		expect(store.running).toBe(false);
	});

	it('a compile error is reported without calling GraphDB', async () => {
		const c = connector(async () => rows([]));
		const store = new QueryRunStore(c);
		await store.run({ ...model, namespaces: [] }, schema);
		expect(c.selectQuery).not.toHaveBeenCalled();
		expect(store.error).toBeTruthy();
	});

	it('an older response never overwrites a newer one', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let calls = 0;
		const c = connector(async (q) => {
			const mine = ++calls;
			if (mine <= 2) await gate; // the first run's two queries are slow
			return isCount(q) ? count(1) : rows([mine <= 2 ? 'old' : 'new']);
		});
		const store = new QueryRunStore(c);
		const first = store.run(model, schema);
		const second = store.run(model, schema);
		await second;
		release();
		await first;
		expect(store.table?.rows[0][0].text).toBe('new');
	});
});
