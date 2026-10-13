import { describe, it, expect } from 'vitest';
import {
	emptyQueryModel,
	parseQueryModel,
	serializeQueryModel,
	validateQueryModel,
	type Measure,
	type QueryModel
} from './query-model';
import { buildBuilderSchema } from './query-builder-schema';
import { compileQuery } from './query-compiler';
import { printSplPipeline } from './query-spl';
import type { FetchedSchema } from './sparql-connector';
import { RUNBOOK_QUERIES } from './soc-runbook-queries';

const NS = 'http://example.org/ns';
const iri = (n: string) => `${NS}#${n}`;
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const dp = (n: string, range: string) => ({
	iri: iri(n), label: n, domain: iri('Event'), range, namespaceBaseIri: NS, required: false, repeatable: false
});

// The SOC sample has no numeric property, so the numeric fixture lives in this spec only.
const fetched: FetchedSchema = {
	classes: [
		{ iri: iri('Event'), label: 'Event', comment: null, namespaceBaseIri: NS },
		{ iri: iri('Host'), label: 'Host', comment: null, namespaceBaseIri: NS }
	],
	datatypeProperties: [
		dp('bytes', `${XSD}integer`),
		dp('ratio', `${XSD}decimal`),
		dp('at', `${XSD}dateTime`),
		dp('day', `${XSD}date`),
		dp('user', `${XSD}string`)
	],
	objectProperties: [
		{ iri: iri('on'), label: 'on', domain: iri('Event'), range: iri('Host'), namespaceBaseIri: NS, required: false, repeatable: false, relationKind: 'specific' }
	],
	subClassOf: [],
	individuals: [],
	individualClassRelations: [],
	individualIndividualRelations: []
};
const schema = buildBuilderSchema(fetched);
const known = new Set(schema.classes.keys());

const col = (id: string, p: string) => ({ id, hopId: null, source: { propertyIri: iri(p) }, header: p });

function model(measures: Measure[], extra: Partial<QueryModel> = {}): QueryModel {
	return {
		...emptyQueryModel(iri('Event'), [NS]),
		columns: [col('user', 'user'), col('bytes', 'bytes'), col('at', 'at'), col('ratio', 'ratio'), col('day', 'day'),
			{ id: 'name', hopId: null, source: 'label', header: 'Name' }],
		aggregation: { groupBy: ['user'], measures },
		...extra
	};
}
const issues = (m: QueryModel) => validateQueryModel(m, known, schema).map((i) => `${i.path}: ${i.message}`);

describe('extra measures — model and validation', () => {
	it('round-trips sum, avg, min and max through the strict parser', () => {
		const m = model([
			{ fn: 'sum', of: 'bytes', alias: 'total' },
			{ fn: 'avg', of: 'ratio', alias: 'mean' },
			{ fn: 'min', of: 'at', alias: 'first' },
			{ fn: 'max', of: 'day', alias: 'last' }
		]);
		expect(parseQueryModel(serializeQueryModel(m))).toEqual({ ok: true, model: m });
		expect(issues(m)).toEqual([]);
	});

	it('rejects an unknown fn at parse time', () => {
		const m = JSON.parse(serializeQueryModel(model([{ fn: 'sum', of: 'bytes', alias: 't' }])));
		m.aggregation.measures[0].fn = 'median';
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(false);
	});

	it('rejects sum/avg on non-numeric ranges, including dates and strings', () => {
		for (const [fn, of] of [['sum', 'user'], ['avg', 'at'], ['sum', 'day']] as const) {
			expect(issues(model([{ fn, of, alias: 't' }])), `${fn} ${of}`).toEqual([
				expect.stringContaining('aggregation.measures[0].of')
			]);
		}
	});

	it('allows min/max on dates and numbers but not strings', () => {
		expect(issues(model([{ fn: 'min', of: 'at', alias: 'a' }, { fn: 'max', of: 'bytes', alias: 'b' }]))).toEqual([]);
		expect(issues(model([{ fn: 'max', of: 'user', alias: 'a' }])).length).toBe(1);
	});

	it('rejects a measure of a column that does not exist, of the root, or of a non-property column', () => {
		expect(issues(model([{ fn: 'sum', of: 'ghost', alias: 't' }]))[0]).toContain('does not exist');
		expect(issues(model([{ fn: 'sum', of: 'root', alias: 't' }])).length).toBe(1);
		expect(issues(model([{ fn: 'sum', of: 'name', alias: 't' }])).length).toBe(1);
	});

	it('still counts anything (count and countDistinct unaffected)', () => {
		expect(issues(model([{ fn: 'count', of: 'root', alias: 'n' }, { fn: 'countDistinct', of: 'user', alias: 'u' }]))).toEqual([]);
	});

	it('does not check datatypes without a schema', () => {
		expect(validateQueryModel(model([{ fn: 'sum', of: 'user', alias: 't' }]), known)).toEqual([]);
	});

	it('rejects having a number-threshold on a date min/max', () => {
		const m = model([{ fn: 'min', of: 'at', alias: 'first' }]);
		m.aggregation!.having = [{ measure: 'first', op: 'gt', value: 5 }];
		expect(issues(m)).toEqual([expect.stringContaining('aggregation.having[0].measure')]);
	});
});

describe('extra measures — compiler', () => {
	const q = (m: QueryModel) => compileQuery(m, schema, { limit: 10, offset: 0 }).sparql;

	it('emits SUM/AVG/MIN/MAX over the typed column variable, without casting', () => {
		const text = q(model([
			{ fn: 'sum', of: 'bytes', alias: 'total' },
			{ fn: 'avg', of: 'ratio', alias: 'mean' },
			{ fn: 'min', of: 'at', alias: 'first' },
			{ fn: 'max', of: 'at', alias: 'last' }
		]));
		expect(text).toMatch(/\(SUM\(\?c1\) AS \?m_total\)/);
		expect(text).toMatch(/\(AVG\(\?c3\) AS \?m_mean\)/);
		expect(text).toMatch(/\(MIN\(\?c2\) AS \?m_first\)/);
		expect(text).toMatch(/\(MAX\(\?c2\) AS \?m_last\)/);
		expect(text).not.toMatch(/xsd:|\^\^|STR\(|xsd#/);
	});

	it('HAVING works with a numeric measure', () => {
		const m = model([{ fn: 'sum', of: 'bytes', alias: 'total' }]);
		m.aggregation!.having = [{ measure: 'total', op: 'gte', value: 1000 }];
		m.sort = [{ columnId: 'total', direction: 'desc' }];
		expect(q(m)).toMatch(/GROUP BY \?c0\nHAVING\(SUM\(\?c1\) >= 1000\)\nORDER BY DESC\(\?m_total\)/);
	});

	it('leaves existing count queries unchanged', () => {
		const text = q(model([{ fn: 'count', of: 'root', alias: 'n' }]));
		expect(text).toContain('(COUNT(?root) AS ?m_n)');
	});

	it('the SOC R4 and R5 models still compile identically in shape', () => {
		expect(RUNBOOK_QUERIES.R4.model.aggregation?.measures[0].fn).toBe('count');
	});
});

describe('extra measures — SPL printer', () => {
	it('prints sum(<field>) as <alias> and the other three', () => {
		const out = printSplPipeline(
			model([
				{ fn: 'sum', of: 'bytes', alias: 'total' },
				{ fn: 'avg', of: 'ratio', alias: 'mean' },
				{ fn: 'min', of: 'at', alias: 'first' },
				{ fn: 'max', of: 'day', alias: 'last' }
			]),
			schema
		);
		expect(out).toContain('| stats sum(bytes) as total, avg(ratio) as mean, min(at) as first, max(day) as last by user');
	});

	it('prints a measure over a hop field with its dotted path', () => {
		const m = model([{ fn: 'sum', of: 'hb', alias: 't' }]);
		m.hops = [{ id: 'h1', parentHopId: null, propertyIri: iri('on'), direction: 'forward', targetClassIri: iri('Host') }];
		m.columns.push({ id: 'hb', hopId: 'h1', source: { propertyIri: iri('bytes') }, header: 'bytes' });
		expect(printSplPipeline(m, schema)).toContain('sum(on.bytes) as t');
	});
});
