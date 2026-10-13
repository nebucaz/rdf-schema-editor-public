import { describe, it, expect } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import { emptyQueryModel, validateRunnableQueryModel, type QueryModel } from './query-model';
import {
	addColumn,
	addFilter,
	addHaving,
	addMeasure,
	enableAggregation,
	removeColumn,
	removeHaving,
	removeMeasure,
	setLimit,
	toggleGroupBy,
	upsertFilter
} from './query-model-edit';
import { describeFilter, makeFilter, makeRangeFilters, operatorsForProperty } from './query-filter-editor';
import {
	hiddenBuilderState,
	havingMeasures,
	measureFnsForColumn,
	parseLimitInput,
	shapeGroupOpenByDefault
} from './query-builder-parity';
import { parseSpl } from './query-spl-parser';
import { printSplPipeline } from './query-spl';
import { EXPORT_ROW_CAP } from './query-model';
import type { FetchedSchema } from './sparql-connector';

const NS = 'http://example.org/ns';
const iri = (n: string) => `${NS}#${n}`;
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const dp = (n: string, range: string) => ({
	iri: iri(n), label: n, domain: iri('Event'), range, namespaceBaseIri: NS, required: false, repeatable: false
});
const fetched: FetchedSchema = {
	classes: [{ iri: iri('Event'), label: 'Event', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [
		dp('bytes', `${XSD}integer`),
		dp('at', `${XSD}dateTime`),
		dp('user', `${XSD}string`),
		dp('ok', `${XSD}boolean`)
	],
	objectProperties: [],
	subClassOf: [],
	individuals: [],
	individualClassRelations: [],
	individualIndividualRelations: []
};
const schema = buildBuilderSchema(fetched);
const prop = (n: string) => schema.classes.get(iri('Event'))!.properties.find((p) => p.iri === iri(n))!;
const known = new Set(schema.classes.keys());

const base = (): QueryModel => {
	let m = emptyQueryModel(iri('Event'), [NS]);
	for (const p of ['user', 'bytes', 'at']) m = addColumn(m, { hopId: null, source: { propertyIri: iri(p) }, header: p });
	return m;
};

describe('operators depend only on the schema datatype', () => {
	it('numeric and temporal properties offer comparisons', () => {
		for (const n of ['bytes', 'at']) {
			const ops = operatorsForProperty(prop(n));
			for (const op of ['gt', 'gte', 'lt', 'lte', 'eq'] as const) expect(ops).toContain(op);
		}
	});
	it('string, boolean and enumerated properties do not', () => {
		for (const n of ['user', 'ok']) {
			const ops = operatorsForProperty(prop(n));
			for (const op of ['gt', 'gte', 'lt', 'lte'] as const) expect(ops).not.toContain(op);
		}
		const ops = operatorsForProperty({ datatype: `${XSD}integer`, allowedValues: [{ value: 'a', label: 'a', isIri: false }] } as never);
		expect(ops).not.toContain('gt');
	});
	it('makeFilter builds a typed comparison and rejects a bad lexical form', () => {
		const ok = makeFilter({ hopId: null, property: prop('bytes'), op: 'gte', value: '10' });
		expect(ok).toEqual({ ok: true, filter: { hopId: null, propertyIri: iri('bytes'), op: 'gte', value: '10' } });
		expect(makeFilter({ hopId: null, property: prop('bytes'), op: 'gt', value: 'abc' }).ok).toBe(false);
		expect(makeFilter({ hopId: null, property: prop('user'), op: 'gt', value: '1' }).ok).toBe(false);
	});
});

describe('range helper', () => {
	it('builds a gte + lt pair', () => {
		const r = makeRangeFilters({ hopId: null, property: prop('at'), from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' });
		expect(r).toEqual({
			ok: true,
			filters: [
				{ hopId: null, propertyIri: iri('at'), op: 'gte', value: '2026-01-01T00:00:00Z' },
				{ hopId: null, propertyIri: iri('at'), op: 'lt', value: '2026-02-01T00:00:00Z' }
			]
		});
	});
	it('rejects a non-comparable property, a bad bound and missing bounds', () => {
		expect(makeRangeFilters({ hopId: null, property: prop('user'), from: 'a', to: 'b' }).ok).toBe(false);
		expect(makeRangeFilters({ hopId: null, property: prop('bytes'), from: '1', to: 'x' }).ok).toBe(false);
		expect(makeRangeFilters({ hopId: null, property: prop('bytes'), from: '', to: '' }).ok).toBe(false);
	});
	it('allows an open-ended range with one bound', () => {
		const r = makeRangeFilters({ hopId: null, property: prop('bytes'), from: '5', to: '' });
		expect(r.ok && r.filters.map((f) => f.op)).toEqual(['gte']);
	});
});

describe('filters on the same property', () => {
	it('keeps gte and lt side by side but re-entering one replaces only it', () => {
		let m = base();
		m = upsertFilter(m, { hopId: null, propertyIri: iri('bytes'), op: 'gte', value: '1' });
		m = upsertFilter(m, { hopId: null, propertyIri: iri('bytes'), op: 'lt', value: '9' });
		expect(m.filters.map((f) => f.op)).toEqual(['gte', 'lt']);
		m = upsertFilter(m, { hopId: null, propertyIri: iri('bytes'), op: 'gte', value: '2' });
		expect(m.filters.map((f) => [f.op, f.value])).toEqual([['gte', '2'], ['lt', '9']]);
	});
	it('still replaces a non-comparison filter on the same property', () => {
		let m = base();
		m = upsertFilter(m, { hopId: null, propertyIri: iri('user'), op: 'eq', value: 'a' });
		m = upsertFilter(m, { hopId: null, propertyIri: iri('user'), op: 'contains', value: 'b' });
		expect(m.filters).toHaveLength(1);
		expect(m.filters[0].op).toBe('contains');
	});
});

describe('chips print the SPL operators', () => {
	it.each([
		['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<='], ['neq', '!=']
	] as const)('%s → %s', (op, sym) => {
		expect(describeFilter({ id: 'f1', hopId: null, propertyIri: iri('bytes'), op, value: '5' }, 'bytes')).toBe(`bytes ${sym} 5`);
	});
});

describe('row limit', () => {
	it('sets and clears', () => {
		const m = setLimit(base(), 25);
		expect(m.limit).toBe(25);
		expect('limit' in setLimit(m, null)).toBe(false);
	});
	it('parses input text', () => {
		expect(parseLimitInput('')).toEqual({ ok: true, value: null });
		expect(parseLimitInput(' 20 ')).toEqual({ ok: true, value: 20 });
		for (const bad of ['0', '-3', '1.5', 'abc', String(EXPORT_ROW_CAP + 1)]) expect(parseLimitInput(bad).ok).toBe(false);
		expect(parseLimitInput(String(EXPORT_ROW_CAP)).ok).toBe(true);
	});
});

describe('measures and having', () => {
	const agg = () => {
		let m = enableAggregation(base());
		m = toggleGroupBy(m, 'c1');
		return m;
	};
	it('offers functions by column datatype', () => {
		const m = agg();
		expect(measureFnsForColumn(m, schema, 'root')).toEqual(['count', 'countDistinct']);
		expect(measureFnsForColumn(m, schema, 'c1')).toEqual(['count', 'countDistinct']); // string
		expect(measureFnsForColumn(m, schema, 'c2')).toEqual(['count', 'countDistinct', 'sum', 'avg', 'min', 'max']); // integer
		expect(measureFnsForColumn(m, schema, 'c3')).toEqual(['count', 'countDistinct', 'min', 'max']); // dateTime
	});
	it('addMeasure supports sum/avg/min/max with fn-based aliases', () => {
		let m = addMeasure(agg(), 'sum', 'c2');
		m = addMeasure(m, 'sum', 'c2');
		expect(m.aggregation!.measures.map((x) => x.alias)).toEqual(['total', 'sum', 'sum_2']);
		expect(validateRunnableQueryModel(m, known, schema)).toEqual([]);
	});
	it('havingMeasures excludes min/max over dates', () => {
		let m = addMeasure(agg(), 'max', 'c3');
		m = addMeasure(m, 'avg', 'c2');
		expect(havingMeasures(m, schema).map((x) => x.alias)).toEqual(['total', 'avg']);
	});
	it('adds and removes having conditions', () => {
		let m = addHaving(agg(), { measure: 'total', op: 'gt', value: 5 });
		m = addHaving(m, { measure: 'total', op: 'lt', value: 50 });
		expect(m.aggregation!.having).toHaveLength(2);
		m = removeHaving(m, 0);
		expect(m.aggregation!.having).toEqual([{ measure: 'total', op: 'lt', value: 50 }]);
		m = removeHaving(m, 0);
		expect(m.aggregation!.having).toBeUndefined();
	});
	it('addHaving ignores an unknown measure and a non-finite threshold', () => {
		const m = agg();
		expect(addHaving(m, { measure: 'nope', op: 'gt', value: 1 })).toBe(m);
		expect(addHaving(m, { measure: 'total', op: 'gt', value: Number.NaN })).toBe(m);
	});
	it('removing a measure drops its having and sort', () => {
		let m = addMeasure(agg(), 'sum', 'c2');
		m = addHaving(m, { measure: 'sum', op: 'gt', value: 5 });
		m = removeMeasure(m, 'sum');
		expect(m.aggregation!.having).toBeUndefined();
	});
	it('removing a column drops numeric measures over it instead of leaving an invalid root sum', () => {
		let m = addMeasure(agg(), 'sum', 'c2');
		m = addHaving(m, { measure: 'sum', op: 'gt', value: 5 });
		m = addMeasure(m, 'count', 'c2');
		m = removeColumn(m, 'c2');
		expect(m.aggregation!.measures.map((x) => x.fn)).toEqual(['count', 'count']);
		expect(m.aggregation!.measures.every((x) => x.of === 'root')).toBe(true);
		expect(m.aggregation!.having).toBeUndefined();
		expect(validateRunnableQueryModel(m, known, schema)).toEqual([]);
	});
});

describe('SPL → builder: nothing hidden', () => {
	const parse = (t: string) => {
		const r = parseSpl(t, schema, { namespaces: [NS] });
		if (!r.ok) throw new Error(r.error.message);
		return r.model;
	};
	it('an SPL model with every tranche-1 feature has no hidden builder state', () => {
		const m = parse(
			'Event | where bytes>=10 | where bytes<100 | where at>="2026-01-01T00:00:00Z" | stats count as n, sum(bytes) as total by user | where n>5 | sort -n | head 10'
		);
		expect(hiddenBuilderState(m, schema)).toEqual([]);
		expect(m.limit).toBe(10);
		expect(m.aggregation!.having).toHaveLength(1);
		expect(m.filters.filter((f) => f.propertyIri === iri('bytes'))).toHaveLength(2);
	});
	it('reports state the builder cannot show', () => {
		const m = addFilter(base(), { hopId: null, propertyIri: iri('user'), op: 'gt', value: '1' });
		expect(hiddenBuilderState(m, schema).length).toBeGreaterThan(0);
	});
	it('prints back unchanged after a builder no-op round trip', () => {
		const text = 'Event | where bytes>=10 | stats count as n by user | where n>5 | head 10';
		const m = parse(text);
		expect(printSplPipeline(parse(printSplPipeline(m, schema)), schema)).toBe(printSplPipeline(m, schema));
	});
});

describe('picker values', () => {
	it('completes a date-time without seconds, as a datetime-local control emits', () => {
		const r = makeFilter({ hopId: null, property: prop('at'), op: 'gte', value: '2026-03-01T08:30' });
		expect(r.ok && r.filter.value).toBe('2026-03-01T08:30:00');
	});
});

describe('aggregate & limit group default state', () => {
	it('is collapsed for a plain model', () => {
		expect(shapeGroupOpenByDefault(base())).toBe(false);
	});
	it('opens for an aggregated model or one with a row limit', () => {
		expect(shapeGroupOpenByDefault(enableAggregation(base()))).toBe(true);
		expect(shapeGroupOpenByDefault(setLimit(base(), 10))).toBe(true);
	});
});
