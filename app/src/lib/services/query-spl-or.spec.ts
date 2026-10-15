import { describe, it, expect } from 'vitest';
import { parseSpl, type SplParseResult } from './query-spl-parser';
import { printSplPipeline } from './query-spl';
import { buildBuilderSchema } from './query-builder-schema';
import { emptyQueryModel, validateRunnableQueryModel, type QueryModel } from './query-model';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI, SOC_SCHEMA_NS } from './soc-test-support';
import { normaliseModel } from './query-spl-normalise';

/** STORY-231: `(a OR b) AND c` — one canonical spelling, standard-precedence ambiguity rejected. */

const schema = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
const cls = (n: string) => `${SOC_SCHEMA_NS}${n}`;
const parse = (text: string): SplParseResult => parseSpl(text, schema, { namespaces: [SOC_BASE_IRI] });
const okModel = (text: string): QueryModel => {
	const r = parse(text);
	if (!r.ok) throw new Error(`${r.error.message} @${r.error.start}-${r.error.end}`);
	return r.model;
};
const errorOf = (text: string) => {
	const r = parse(text);
	if (r.ok) throw new Error('expected an error');
	return r.error;
};

const model = (filters: QueryModel['filters']): QueryModel => ({
	...emptyQueryModel(cls('Alert'), [SOC_BASE_IRI]),
	filters,
	columns: [{ id: 'c1', hopId: null, source: { propertyIri: cls('alertId') }, header: 'alertId' }]
});
const eq = (id: string, prop: string, value: string, orGroup?: string) => ({
	id, hopId: null, propertyIri: cls(prop), op: 'eq' as const, value, ...(orGroup ? { orGroup } : {})
});

describe('printing OR groups', () => {
	it('prints a group as one parenthesised where stage and ungrouped filters as before', () => {
		const m = model([eq('f1', 'title', 'a', 'g1'), eq('f2', 'title', 'b', 'g1'), eq('f3', 'alertId', 'A-1')]);
		expect(printSplPipeline(m, schema)).toBe(
			['Alert', '| where (title="a" OR title="b")', '| where alertId="A-1"', '| fields alertId'].join('\n')
		);
	});
});

describe('parsing OR groups', () => {
	it('(a OR b) AND c is one group plus one plain filter', () => {
		const m = okModel('Alert | where (title="a" OR title="b") AND alertId="A-1" | fields alertId');
		expect(m.filters.map((f) => f.orGroup)).toEqual(['g1', 'g1', undefined]);
		expect(m.filters.map((f) => f.value)).toEqual(['a', 'b', 'A-1']);
		expect(validateRunnableQueryModel(m, new Set(schema.classes.keys()), schema)).toEqual([]);
	});

	it('a bare top-level OR is one group', () => {
		const m = okModel('Alert | where title="a" OR title="b" | fields alertId');
		expect(m.filters.map((f) => f.orGroup)).toEqual(['g1', 'g1']);
	});

	it('numbers groups by first appearance', () => {
		const m = okModel('Alert | where (title="a" OR title="b") | where (alertId="1" OR alertId="2") | fields alertId');
		expect(m.filters.map((f) => f.orGroup)).toEqual(['g1', 'g1', 'g2', 'g2']);
	});

	it('accepts like/isnull/IN members', () => {
		const m = okModel('Alert | where (like(title, "%x%") OR isnull(alertId) OR title IN ("a","b")) | fields alertId');
		expect(m.filters.map((f) => f.op)).toEqual(['contains', 'isEmpty', 'in']);
		expect(new Set(m.filters.map((f) => f.orGroup))).toEqual(new Set(['g1']));
	});

	it('print → parse is the identity on a group', () => {
		const m = model([eq('f1', 'alertId', 'A-1'), eq('f2', 'title', 'a', 'g1'), eq('f3', 'title', 'b', 'g1')]);
		const text = printSplPipeline(m, schema);
		expect(normaliseModel(okModel(text))).toEqual(normaliseModel(m));
		expect(printSplPipeline(okModel(text), schema)).toBe(text);
	});

	it('a one-member parenthesised condition is just a plain filter', () => {
		const m = okModel('Alert | where (title="a") | fields alertId');
		expect(m.filters.map((f) => f.orGroup)).toEqual([undefined]);
	});
});

describe('non-expressible boolean logic fails with a positioned error', () => {
	const cases: [string, string, string, RegExp][] = [
		['unparenthesised mix', 'Alert | where title="a" OR title="b" AND alertId="1" | fields alertId', 'OR', /parenthes/i],
		['AND inside a group', 'Alert | where (title="a" AND alertId="1" OR title="b") | fields alertId', 'AND', /not expressible/i],
		['nested group', 'Alert | where ((title="a" OR title="b") OR alertId="1") | fields alertId', '(title="a" OR title="b")', /not expressible/i],
		['NOT at top level', 'Alert | where NOT title="a" | fields alertId', 'NOT', /not supported/i],
		['NOT inside a group', 'Alert | where (NOT title="a" OR title="b") | fields alertId', 'NOT', /not supported/i],
		['dangling OR', 'Alert | where title="a" OR | fields alertId', 'OR', /Expected a condition/],
		['OR on measures', 'Alert | stats count as n | where n>1 OR n<0', 'OR', /not supported|measure/i]
	];
	it.each(cases)('%s', (_n, text, spanned, message) => {
		const e = errorOf(text);
		expect(e.message).toMatch(message);
		expect(text.slice(e.start, e.end)).toBe(spanned);
	});
});
