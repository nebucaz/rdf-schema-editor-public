import { describe, it, expect, vi } from 'vitest';
import { exportAllRows, exportFileName, exportCellText, EXPORT_ROW_CAP } from './query-export';
import { MAX_PAGE_SIZE } from './query-compiler';
import { buildBuilderSchema } from './query-builder-schema';
import { startQueryFromClass, addColumn, moveColumn } from './query-model-edit';
import type { FetchedSchema, SparqlSelectResults } from './sparql-connector';
import type { ResultCell } from './query-results';

const NS = 'http://example.org/ns';
const APP = `${NS}#Application`;
const schema = buildBuilderSchema({
	classes: [{ iri: APP, label: 'Application', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [],
	individualClassRelations: [], individualIndividualRelations: []
} as FetchedSchema);

let model = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'Name' });
model = addColumn(model, { hopId: null, source: 'iri', header: 'Entity' });

const offsetOf = (q: string) => Number(/OFFSET (\d+)/.exec(q)![1]);
const limitOf = (q: string) => Number(/LIMIT (\d+)/.exec(q)![1]);
/** Serves `total` rows from a fake store, honouring LIMIT/OFFSET. */
function store(total: number) {
	return {
		selectQuery: vi.fn(async (q: string): Promise<SparqlSelectResults> => {
			const off = offsetOf(q);
			const n = Math.max(0, Math.min(limitOf(q), total - off));
			// Column variables are positional; the IRI column is the one compiled as `(?root AS ?cK)`.
			const iriVar = /\(\?root AS \?(c\d)\)/.exec(q)![1];
			const labelVar = iriVar === 'c0' ? 'c1' : 'c0';
			return {
				head: { vars: ['root', 'c0', 'c1'] },
				results: {
					bindings: Array.from({ length: n }, (_, i) => ({
						root: { type: 'uri' as const, value: `${NS}#e${off + i}` },
						[labelVar]: { type: 'literal' as const, value: `Name ${off + i}` },
						[iriVar]: { type: 'uri' as const, value: `${NS}#e${off + i}` }
					}))
				}
			};
		})
	};
}

describe('exportAllRows', () => {
	it('fetches every page with OFFSET and returns all rows, header first', async () => {
		const s = store(2500);
		const r = await exportAllRows(model, schema, s);
		expect(r.rows).toHaveLength(2500);
		expect(r.truncated).toBe(false);
		expect(r.headers).toEqual(['Name', 'Entity']);
		expect(s.selectQuery.mock.calls.map((c) => offsetOf(c[0]))).toEqual([0, 1000, 2000]);
		// the IRI cell shows the hop's label because a label column exists (same rule as the table)
		expect(r.rows[0]).toEqual(['Name 0', 'Name 0']);
		expect(r.rows[2499]).toEqual(['Name 2499', 'Name 2499']);
	});

	it('stops at the cap and reports truncation', async () => {
		const s = store(EXPORT_ROW_CAP + 3000);
		const r = await exportAllRows(model, schema, s);
		expect(r.rows).toHaveLength(EXPORT_ROW_CAP);
		expect(r.truncated).toBe(true);
	});

	it('an exact multiple of the chunk size is not reported as truncated', async () => {
		const r = await exportAllRows(model, schema, store(MAX_PAGE_SIZE * 2));
		expect(r.rows).toHaveLength(MAX_PAGE_SIZE * 2);
		expect(r.truncated).toBe(false);
	});

	it('honours column order and can export raw IRIs instead of names', async () => {
		const reordered = moveColumn(model, model.columns[1].id, -1);
		const r = await exportAllRows(reordered, schema, store(1), { rawIris: true });
		expect(r.headers).toEqual(['Entity', 'Name']);
		expect(r.rows[0]).toEqual([`${NS}#e0`, 'Name 0']);
	});

	it('exports an unbound cell as an empty string', async () => {
		const s = {
			selectQuery: async (): Promise<SparqlSelectResults> => ({
				head: { vars: ['root'] },
				results: { bindings: [{ root: { type: 'uri' as const, value: `${NS}#x` } }] }
			})
		};
		const r = await exportAllRows(model, schema, s);
		expect(r.rows).toEqual([['', '']]);
	});

	it('rejects with the compile error for an invalid model', async () => {
		await expect(exportAllRows({ ...model, namespaces: [] }, schema, store(1))).rejects.toThrow();
	});

	it('reports progress per chunk', async () => {
		const seen: number[] = [];
		await exportAllRows(model, schema, store(2100), { onProgress: (n) => seen.push(n) });
		expect(seen).toEqual([1000, 2000, 2100]);
	});
});

describe('exportCellText', () => {
	const cell = (c: Partial<ResultCell>): ResultCell => ({ columnId: 'c', header: 'h', text: '', rawValue: '', isMeasure: false, ...c });
	it('uses the raw literal for values, the label for entities, the full IRI when asked', () => {
		expect(exportCellText(cell({ text: 'Yes', rawValue: 'true' }), false)).toBe('true');
		expect(exportCellText(cell({ text: 'srv1', rawValue: `${NS}#srv1`, title: `${NS}#srv1` }), false)).toBe('srv1');
		expect(exportCellText(cell({ text: 'srv1', rawValue: `${NS}#srv1`, title: `${NS}#srv1` }), true)).toBe(`${NS}#srv1`);
		expect(exportCellText(cell({ text: 'SAP', rawValue: 'SAP' }), true)).toBe('SAP');
	});
});

describe('exportFileName', () => {
	const d = new Date('2026-10-10T12:00:00Z');
	it('defaults to workbench-export-<date>.csv', () => {
		expect(exportFileName(null, d)).toBe('workbench-export-2026-10-10.csv');
	});
	it('uses a sanitised saved-query name', () => {
		expect(exportFileName('Apps by Owner / Q3?', d)).toBe('Apps-by-Owner-Q3.csv');
	});
	it('falls back when the name sanitises to nothing', () => {
		expect(exportFileName('///', d)).toBe('workbench-export-2026-10-10.csv');
	});
});
