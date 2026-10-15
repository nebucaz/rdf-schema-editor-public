import { describe, it, expect } from 'vitest';
import {
	isRelativeTime,
	resolveRelativeTime,
	describeRelativeFilters,
	formatTimeWindow
} from './query-relative-time';
import { compileCountQuery, compileQuery, compileUnpagedQuery, QueryCompileError } from './query-compiler';
import { XSD_DATE, XSD_DATETIME, XSD_INTEGER } from './query-datatypes';
import { emptyQueryModel } from './query-model';
import { buildBuilderSchema } from './query-builder-schema';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI, SOC_SCHEMA_NS } from './soc-test-support';

const NOW = new Date('2026-03-15T10:30:45.678Z');

describe('isRelativeTime', () => {
	it.each(['now', '-24h', '+1d', '-90m', '-2w', '-30s', '-0h'])('accepts %s', (v) => {
		expect(isRelativeTime(v)).toBe(true);
	});
	it.each(['', '24h', '-24', '-24x', '- 24h', '-1.5d', 'NOW', '-24h@d', '2026-01-01T00:00:00Z', '-9999999h'])(
		'rejects %j',
		(v) => {
			expect(isRelativeTime(v)).toBe(false);
		}
	);
});

describe('resolveRelativeTime', () => {
	it('resolves to a UTC dateTime lexical form without fraction', () => {
		expect(resolveRelativeTime('now', NOW, XSD_DATETIME)).toBe('2026-03-15T10:30:45Z');
		expect(resolveRelativeTime('-24h', NOW, XSD_DATETIME)).toBe('2026-03-14T10:30:45Z');
		expect(resolveRelativeTime('+1d', NOW, XSD_DATETIME)).toBe('2026-03-16T10:30:45Z');
		expect(resolveRelativeTime('-90m', NOW, XSD_DATETIME)).toBe('2026-03-15T09:00:45Z');
		expect(resolveRelativeTime('-2w', NOW, XSD_DATETIME)).toBe('2026-03-01T10:30:45Z');
		expect(resolveRelativeTime('-30s', NOW, XSD_DATETIME)).toBe('2026-03-15T10:30:15Z');
	});
	it('resolves to a UTC calendar date for xsd:date', () => {
		expect(resolveRelativeTime('-24h', NOW, XSD_DATE)).toBe('2026-03-14');
		expect(resolveRelativeTime('now', new Date('2026-12-31T23:59:59Z'), XSD_DATE)).toBe('2026-12-31');
	});
	it('refuses a non-temporal datatype and a malformed expression', () => {
		expect(() => resolveRelativeTime('-24h', NOW, XSD_INTEGER)).toThrow();
		expect(() => resolveRelativeTime('24h', NOW, XSD_DATETIME)).toThrow();
	});
});

describe('describeRelativeFilters', () => {
	const schema = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
	it('lists each relative filter with its property label, operator and resolved bound', () => {
		const m = {
			...emptyQueryModel(`${SOC_SCHEMA_NS}AuthenticationEvent`, [SOC_BASE_IRI]),
			filters: [
				{ id: 'f1', hopId: null, propertyIri: `${SOC_SCHEMA_NS}timestamp`, op: 'gte' as const, relativeTime: '-24h' },
				{ id: 'f2', hopId: null, propertyIri: `${SOC_SCHEMA_NS}timestamp`, op: 'lt' as const, relativeTime: 'now' },
				{ id: 'f3', hopId: null, propertyIri: `${SOC_SCHEMA_NS}user`, op: 'eq' as const, value: 'x' }
			]
		};
		expect(describeRelativeFilters(m, schema, NOW)).toEqual([
			{ filterId: 'f1', property: 'timestamp', op: 'gte', expression: '-24h', resolved: '2026-03-14T10:30:45Z' },
			{ filterId: 'f2', property: 'timestamp', op: 'lt', expression: 'now', resolved: '2026-03-15T10:30:45Z' }
		]);
	});
});

describe('compiling relative time (injected clock)', () => {
	const schema = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
	const XSD_DT = 'http://www.w3.org/2001/XMLSchema#dateTime';
	const model = () => ({
		...emptyQueryModel(`${SOC_SCHEMA_NS}AuthenticationEvent`, [SOC_BASE_IRI]),
		filters: [
			{ id: 'f1', hopId: null, propertyIri: `${SOC_SCHEMA_NS}timestamp`, op: 'gte' as const, relativeTime: '-24h' },
			{ id: 'f2', hopId: null, propertyIri: `${SOC_SCHEMA_NS}timestamp`, op: 'lt' as const, relativeTime: 'now' }
		],
		columns: [{ id: 'c1', hopId: null, source: { propertyIri: `${SOC_SCHEMA_NS}user` }, header: 'user' }]
	});

	it('resolves each bound against the supplied clock as a typed literal', () => {
		const q = compileQuery(model(), schema, { limit: 10, offset: 0 }, { now: NOW }).sparql;
		expect(q).toContain(`FILTER(?f0 >= "2026-03-14T10:30:45Z"^^<${XSD_DT}>)`);
		expect(q).toContain(`FILTER(?f1 < "2026-03-15T10:30:45Z"^^<${XSD_DT}>)`);
	});

	it('is deterministic for a given clock and different for another', () => {
		const a = compileUnpagedQuery(model(), schema, { now: NOW });
		expect(compileUnpagedQuery(model(), schema, { now: NOW })).toBe(a);
		expect(compileUnpagedQuery(model(), schema, { now: new Date('2027-01-01T00:00:00Z') })).not.toBe(a);
	});

	it('count and paged queries use the same window', () => {
		expect(compileCountQuery(model(), schema, { now: NOW }).sparql).toContain('"2026-03-14T10:30:45Z"');
	});

	it('refuses to compile a relative filter without a clock', () => {
		expect(() => compileUnpagedQuery(model(), schema)).toThrow(/clock|current time/i);
		expect(() => compileQuery(model(), schema, { limit: 1, offset: 0 })).toThrow(QueryCompileError);
	});

	it('leaves queries without relative time independent of the clock', () => {
		const m = { ...model(), filters: [] };
		expect(compileUnpagedQuery(m, schema)).toBe(compileUnpagedQuery(m, schema, { now: NOW }));
	});
});

describe('formatTimeWindow', () => {
	it('prints property, operator symbol, resolved bound and the expression', () => {
		expect(
			formatTimeWindow({ filterId: 'f1', property: 'timestamp', op: 'gte', expression: '-24h', resolved: '2026-03-14T10:30:45Z' })
		).toBe('timestamp ≥ 2026-03-14T10:30:45Z (-24h)');
		expect(
			formatTimeWindow({ filterId: 'f2', property: 'timestamp', op: 'lt', expression: 'now', resolved: '2026-03-15T10:30:45Z' })
		).toBe('timestamp < 2026-03-15T10:30:45Z (now)');
	});
});
