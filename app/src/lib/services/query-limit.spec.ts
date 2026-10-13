import { describe, it, expect, vi } from 'vitest';
import {
	emptyQueryModel,
	parseQueryModel,
	queryModelWarnings,
	serializeQueryModel,
	validateQueryModel,
	type QueryModel
} from './query-model';
import { buildBuilderSchema } from './query-builder-schema';
import { compileCountQuery, compileQuery, compileUnpagedQuery } from './query-compiler';
import { exportAllRows, EXPORT_ROW_CAP } from './query-export';
import { pageInfo } from './query-results';
import { printSplPipeline } from './query-spl';
import type { FetchedSchema, SparqlSelectResults } from './sparql-connector';

const NS = 'http://example.org/ns';
const APP = `${NS}#Application`;
const schema = buildBuilderSchema({
	classes: [{ iri: APP, label: 'Application', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [],
	individualClassRelations: [], individualIndividualRelations: []
} as FetchedSchema);

function model(limit?: number): QueryModel {
	const m = emptyQueryModel(APP, [NS]);
	m.columns = [{ id: 'name', hopId: null, source: 'label', header: 'Name' }];
	if (limit !== undefined) m.limit = limit;
	return m;
}
const issuePaths = (m: QueryModel) => validateQueryModel(m, new Set([APP]), schema).map((i) => i.path);
const sparql = (m: QueryModel, limit: number, offset: number) =>
	compileQuery(m, schema, { limit, offset }).sparql;

describe('row limit — model and validation', () => {
	it('accepts 1 … EXPORT_ROW_CAP and an absent limit', () => {
		expect(issuePaths(model())).toEqual([]);
		expect(issuePaths(model(1))).toEqual([]);
		expect(issuePaths(model(EXPORT_ROW_CAP))).toEqual([]);
	});

	it('rejects zero, negative, fractional, too large and non-finite limits', () => {
		for (const limit of [0, -3, 2.5, EXPORT_ROW_CAP + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(issuePaths(model(limit)), String(limit)).toEqual(['limit']);
		}
	});

	it('is rejected at parse time unless a number', () => {
		const m = JSON.parse(serializeQueryModel(model(5)));
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(true);
		m.limit = '5';
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(false);
	});

	it('an absent limit serialises without the key', () => {
		expect('limit' in JSON.parse(serializeQueryModel(model()))).toBe(false);
	});

	it('warns (not errors) when a limit has no sort', () => {
		expect(issuePaths(model(5))).toEqual([]);
		expect(queryModelWarnings(model(5)).map((w) => w.path)).toEqual(['limit']);
		const sorted = model(5);
		sorted.sort = [{ columnId: 'name', direction: 'asc' }];
		expect(queryModelWarnings(sorted)).toEqual([]);
		expect(queryModelWarnings(model())).toEqual([]);
	});
});

describe('row limit — compiler and paging', () => {
	it('is byte-identical without a limit', () => {
		expect(sparql(model(), 50, 100)).toMatch(/LIMIT 50 OFFSET 100$/);
	});

	it('shrinks the page LIMIT so offset+limit never passes the cap', () => {
		expect(sparql(model(120), 50, 0)).toMatch(/LIMIT 50 OFFSET 0$/);
		expect(sparql(model(120), 50, 100)).toMatch(/LIMIT 20 OFFSET 100$/);
		expect(sparql(model(120), 50, 150)).toMatch(/LIMIT 0 OFFSET 150$/);
		expect(sparql(model(10), 50, 0)).toMatch(/LIMIT 10 OFFSET 0$/);
	});

	it('caps the unpaged query too', () => {
		expect(compileUnpagedQuery(model(7), schema)).toMatch(/LIMIT 7$/);
		expect(compileUnpagedQuery(model(), schema)).not.toMatch(/LIMIT/);
	});

	it('leaves the count query counting everything (the cap is applied client-side)', () => {
		expect(compileCountQuery(model(7), schema).sparql).not.toMatch(/LIMIT/);
	});

	it('pageInfo clamps the total, the last page is short and nextOffset stops', () => {
		const first = pageInfo(1243, 0, 50, 120);
		expect(first).toMatchObject({ from: 1, to: 50, total: 120, hasNext: true, uncappedTotal: 1243 });
		const last = pageInfo(1243, 100, 50, 120);
		expect(last).toMatchObject({ from: 101, to: 120, total: 120, hasNext: false, hasPrev: true });
		expect(pageInfo(30, 0, 50, 120)).toMatchObject({ total: 30, to: 30, hasNext: false });
		expect(pageInfo(30, 0, 50, 120).uncappedTotal).toBeUndefined();
		expect(pageInfo(1243, 0, 50)).toMatchObject({ total: 1243, hasNext: true });
	});
});

const offsetOf = (q: string) => Number(/OFFSET (\d+)/.exec(q)![1]);
const limitOf = (q: string) => Number(/LIMIT (\d+)/.exec(q)![1]);
function store(total: number) {
	return {
		selectQuery: vi.fn(async (q: string): Promise<SparqlSelectResults> => {
			const off = offsetOf(q);
			const n = Math.max(0, Math.min(limitOf(q), total - off));
			return {
				head: { vars: ['root', 'c0'] },
				results: {
					bindings: Array.from({ length: n }, (_, i) => ({
						root: { type: 'uri' as const, value: `${NS}#e${off + i}` },
						c0: { type: 'literal' as const, value: `Name ${off + i}` }
					}))
				}
			};
		})
	};
}

describe('row limit — export', () => {
	it('writes exactly the limit and does not report truncation', async () => {
		const s = store(5000);
		const r = await exportAllRows(model(2500), schema, s);
		expect(r.rows).toHaveLength(2500);
		expect(r.truncated).toBe(false);
		expect(s.selectQuery.mock.calls.map((c) => offsetOf(c[0]))).toEqual([0, 1000, 2000]);
	});

	it('stops without a pointless extra request when the limit is a chunk multiple', async () => {
		const s = store(5000);
		const r = await exportAllRows(model(2000), schema, s);
		expect(r.rows).toHaveLength(2000);
		expect(s.selectQuery).toHaveBeenCalledTimes(2);
	});

	it('returns fewer rows when the data is smaller than the limit', async () => {
		const r = await exportAllRows(model(900), schema, store(40));
		expect(r.rows).toHaveLength(40);
		expect(r.truncated).toBe(false);
	});

	it('without a limit still caps at EXPORT_ROW_CAP and reports truncation', async () => {
		const r = await exportAllRows(model(), schema, store(EXPORT_ROW_CAP + 10));
		expect(r.rows).toHaveLength(EXPORT_ROW_CAP);
		expect(r.truncated).toBe(true);
	});
});

describe('row limit — SPL printer', () => {
	it('prints `| head N` as the final stage, after sort', () => {
		const m = model(10);
		m.sort = [{ columnId: 'name', direction: 'desc' }];
		const lines = printSplPipeline(m, schema).split('\n');
		expect(lines.at(-1)).toBe('| head 10');
		expect(lines.at(-2)).toBe('| sort -label');
	});

	it('prints nothing for an absent limit', () => {
		expect(printSplPipeline(model(), schema)).not.toContain('head');
	});
});
