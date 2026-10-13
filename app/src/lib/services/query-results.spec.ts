import { describe, it, expect } from 'vitest';
import {
	PAGE_SIZES,
	DEFAULT_PAGE_SIZE,
	clampPageSize,
	pageInfo,
	cellFact,
	formatLiteral,
	buildResultRows,
	readableQueryError
} from './query-results';
import { MAX_PAGE_SIZE, type CompiledQuery } from './query-compiler';
import type { Column, QueryModel } from './query-model';
import { startQueryFromClass } from './query-model-edit';
import type { SparqlSelectResults } from './sparql-connector';

const NS = 'http://example.org/ns';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const lit = (value: string, datatype?: string) => ({ type: 'literal' as const, value, ...(datatype ? { datatype } : {}) });
const uri = (value: string) => ({ type: 'uri' as const, value });

describe('paging math', () => {
	it('offers constant page sizes within the compiler maximum', () => {
		expect(PAGE_SIZES).toContain(DEFAULT_PAGE_SIZE);
		expect(Math.max(...PAGE_SIZES)).toBeLessThanOrEqual(MAX_PAGE_SIZE);
	});
	it('clampPageSize snaps junk and oversize values to a safe size', () => {
		expect(clampPageSize(100)).toBe(100);
		expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
		expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
		expect(clampPageSize(10_000_000)).toBe(MAX_PAGE_SIZE);
	});
	it('pageInfo reports the visible range, total and neighbours', () => {
		expect(pageInfo(1243, 0, 100)).toMatchObject({ from: 1, to: 100, total: 1243, hasPrev: false, hasNext: true, nextOffset: 100, prevOffset: 0 });
		expect(pageInfo(1243, 1200, 100)).toMatchObject({ from: 1201, to: 1243, hasPrev: true, hasNext: false, prevOffset: 1100 });
		expect(pageInfo(0, 0, 50)).toMatchObject({ from: 0, to: 0, hasPrev: false, hasNext: false });
	});
	it('pageInfo never goes below offset 0 when stepping back', () => {
		expect(pageInfo(500, 30, 100).prevOffset).toBe(0);
	});
});

describe('cellFact', () => {
	const prop: Column = { id: 'c1', hopId: 'h1', source: { propertyIri: `${NS}#hostname` }, header: 'Host' };
	it('maps a property cell to (entity of the hop, property, value)', () => {
		expect(cellFact({ rowKind: 'facts', column: prop, subjectIri: `${NS}#srv1`, value: lit('srv1.local') }))
			.toEqual({ subjectIri: `${NS}#srv1`, predicateIri: `${NS}#hostname`, object: { value: 'srv1.local', isIri: false } });
	});
	it('keeps the datatype and language tag so typed literals match their annotations', () => {
		const typed = cellFact({ rowKind: 'facts', column: prop, subjectIri: `${NS}#a`, value: lit('42', `${XSD}integer`) });
		expect(typed?.object).toEqual({ value: '42', isIri: false, datatype: `${XSD}integer` });
		const tagged = cellFact({
			rowKind: 'facts', column: prop, subjectIri: `${NS}#a`,
			value: { type: 'literal', value: 'hallo', 'xml:lang': 'de' }
		});
		expect(tagged?.object).toEqual({ value: 'hallo', isIri: false, lang: 'de' });
	});
	it('marks IRI-valued objects', () => {
		expect(cellFact({ rowKind: 'facts', column: prop, subjectIri: `${NS}#a`, value: uri(`${NS}#b`) })?.object.isIri).toBe(true);
	});
	it('is undefined for aggregate rows, label/IRI columns, measures, and missing parts', () => {
		const base = { subjectIri: `${NS}#a`, value: lit('x') };
		expect(cellFact({ ...base, rowKind: 'aggregate', column: prop })).toBeUndefined();
		expect(cellFact({ ...base, rowKind: 'facts', column: { ...prop, source: 'label' } })).toBeUndefined();
		expect(cellFact({ ...base, rowKind: 'facts', column: { ...prop, source: 'iri' } })).toBeUndefined();
		expect(cellFact({ ...base, rowKind: 'facts', column: undefined })).toBeUndefined();
		expect(cellFact({ rowKind: 'facts', column: prop, subjectIri: undefined, value: lit('x') })).toBeUndefined();
		expect(cellFact({ rowKind: 'facts', column: prop, subjectIri: `${NS}#a`, value: undefined })).toBeUndefined();
	});
});

describe('formatLiteral', () => {
	it('renders booleans, dates and plain strings per datatype', () => {
		expect(formatLiteral(lit('true', `${XSD}boolean`))).toBe('Yes');
		expect(formatLiteral(lit('0', `${XSD}boolean`))).toBe('No');
		expect(formatLiteral(lit('2024-03-01', `${XSD}date`))).toBe('2024-03-01');
		expect(formatLiteral(lit('2024-03-01T10:15:30Z', `${XSD}dateTime`))).toBe('2024-03-01 10:15 UTC');
		expect(formatLiteral(lit('hello'))).toBe('hello');
		expect(formatLiteral(lit('42', `${XSD}integer`))).toBe('42');
	});
});

describe('buildResultRows', () => {
	const model: QueryModel = {
		...startQueryFromClass(`${NS}#Application`, [NS]),
		hops: [{ id: 'h1', parentHopId: null, propertyIri: `${NS}#hostedOn`, direction: 'forward', targetClassIri: `${NS}#Server` }],
		columns: [
			{ id: 'name', hopId: null, source: 'label', header: 'Name' },
			{ id: 'host', hopId: 'h1', source: { propertyIri: `${NS}#hostname` }, header: 'Host' },
			{ id: 'self', hopId: 'h1', source: 'iri', header: 'Server' }
		]
	};
	const compiled: CompiledQuery = {
		sparql: '',
		rowKind: 'facts',
		columns: [
			{ id: 'name', variable: 'c0', header: 'Name' },
			{ id: 'host', variable: 'c1', header: 'Host' },
			{ id: 'self', variable: 'c2', header: 'Server' }
		],
		entityVariables: { root: 'root', h1: 'h0' }
	};
	const results: SparqlSelectResults = {
		head: { vars: ['root', 'c0', 'c1', 'c2', 'h0'] },
		results: { bindings: [{ root: uri(`${NS}#SAP`), c0: lit('SAP'), c1: lit('srv1.local'), c2: uri(`${NS}#srv1`), h0: uri(`${NS}#srv1`) }] }
	};

	it('builds cells with text, drill-down links and facts', () => {
		const { headers, rows } = buildResultRows(model, compiled, results);
		expect(headers).toEqual(['Name', 'Host', 'Server']);
		const [name, host, self] = rows[0];
		expect(name).toMatchObject({ text: 'SAP', href: `/identities?node=${encodeURIComponent(`${NS}#SAP`)}` });
		expect(name.fact).toBeUndefined();
		expect(host.text).toBe('srv1.local');
		expect(host.fact).toEqual({ subjectIri: `${NS}#srv1`, predicateIri: `${NS}#hostname`, object: { value: 'srv1.local', isIri: false } });
		expect(host.href).toBeUndefined();
		expect(self.text).toBe('srv1');
		expect(self.title).toBe(`${NS}#srv1`);
		expect(self.href).toBe(`/identities?node=${encodeURIComponent(`${NS}#srv1`)}`);
		expect(self.fact).toBeUndefined();
	});

	it('an IRI cell shows the entity label when the hop also has a label column', () => {
		const m: QueryModel = { ...model, columns: [...model.columns, { id: 'hl', hopId: 'h1', source: 'label', header: 'Server name' }] };
		const c: CompiledQuery = { ...compiled, columns: [...compiled.columns, { id: 'hl', variable: 'c3', header: 'Server name' }] };
		const r: SparqlSelectResults = { ...results, results: { bindings: [{ ...results.results.bindings[0], c3: lit('Server One') }] } };
		expect(buildResultRows(m, c, r).rows[0][2].text).toBe('Server One');
	});

	it('aggregate rows have measure text, no facts, no label links', () => {
		const aggModel: QueryModel = { ...model, aggregation: { groupBy: ['name'], measures: [{ fn: 'count', of: 'root', alias: 'total' }] } };
		const aggCompiled: CompiledQuery = {
			sparql: '', rowKind: 'aggregate', entityVariables: {},
			columns: [{ id: 'name', variable: 'c0', header: 'Name' }, { id: 'total', variable: 'm_total', header: 'total' }]
		};
		const aggResults: SparqlSelectResults = {
			head: { vars: ['c0', 'm_total'] },
			results: { bindings: [{ c0: lit('SAP'), m_total: lit('3', `${XSD}integer`) }] }
		};
		const [name, total] = buildResultRows(aggModel, aggCompiled, aggResults).rows[0];
		expect(total.text).toBe('3');
		expect(name.fact).toBeUndefined();
		expect(name.href).toBeUndefined();
		expect(total.fact).toBeUndefined();
	});

	it('an unbound cell is empty', () => {
		const r: SparqlSelectResults = { head: { vars: ['root'] }, results: { bindings: [{ root: uri(`${NS}#SAP`) }] } };
		const cells = buildResultRows(model, compiled, r).rows[0];
		expect(cells[1].text).toBe('');
		expect(cells[1].fact).toBeUndefined();
	});
});

describe('readableQueryError', () => {
	it('turns timeouts into a plain-language hint', () => {
		expect(readableQueryError(new Error('Query evaluation timed out after 60s'))).toMatch(/too long/i);
	});
	it('passes through other messages and handles non-errors', () => {
		expect(readableQueryError(new Error('SPARQL query failed: 500'))).toBe('SPARQL query failed: 500');
		expect(readableQueryError('boom')).toMatch(/failed/i);
	});
});
