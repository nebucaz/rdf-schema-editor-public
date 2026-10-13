import { describe, it, expect } from 'vitest';
import { parseSpl, type SplParseResult } from './query-spl-parser';
import { printSplPipeline } from './query-spl';
import { buildBuilderSchema } from './query-builder-schema';
import { validateRunnableQueryModel, type QueryModel } from './query-model';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI, SOC_SCHEMA_NS } from './soc-test-support';
import { RUNBOOK_QUERIES } from './soc-runbook-queries';
import { normaliseModel } from './query-spl-normalise';

const schema = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
const NS = [SOC_BASE_IRI];
const cls = (n: string) => `${SOC_SCHEMA_NS}${n}`;
const parse = (text: string): SplParseResult => parseSpl(text, schema, { namespaces: NS });
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

describe('parseSpl round trip of the runbook queries', () => {
	for (const id of ['R3', 'R4', 'R5'] as const) {
		it(`${id}: parse(print(m)) equals m modulo ids, headers and namespaces`, () => {
			const q = RUNBOOK_QUERIES[id];
			const parsed = okModel(printSplPipeline(q.model, schema));
			expect(normaliseModel(parsed)).toEqual(normaliseModel(q.model));
			expect(printSplPipeline(parsed, schema)).toBe(q.spl);
		});
	}

	it('takes namespaces from the caller and synthesises deterministic ids and headers', () => {
		const m = okModel(RUNBOOK_QUERIES.R3.spl);
		expect(m.namespaces).toEqual(NS);
		expect(m.hops.map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
		expect(m.hops.map((h) => h.parentHopId)).toEqual([null, 'h1', 'h2']);
		expect(m.filters.map((f) => f.id)).toEqual(['f1']);
		expect(m.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
		expect(m.columns.map((c) => c.header)).toEqual(['alertId', 'title', 'timestamp', 'path', 'hostname']);
		expect(okModel(RUNBOOK_QUERIES.R3.spl)).toEqual(m);
		expect(validateRunnableQueryModel(m, new Set(schema.classes.keys()), schema)).toEqual([]);
	});
});

describe('parseSpl stages', () => {
	it('resolves the root case-insensitively and honours (exact)', () => {
		expect(okModel('alert | fields title').root).toEqual({ classIri: cls('Alert'), includeSubclasses: true });
		expect(okModel('authentication EVENT (exact) | fields user').root).toEqual({
			classIri: cls('AuthenticationEvent'),
			includeSubclasses: false
		});
	});

	it('parses each filter form', () => {
		const m = okModel(
			[
				'Authentication event',
				'| where user!="root"',
				'| where like(message, "%denied%")',
				'| where method IN ("ssh", "rdp")',
				'| where isnull(user)',
				'| where isnotnull(sourceIp)',
				'| where timestamp>="2026-01-01T00:00:00Z"',
				'| where timestamp<"2026-02-01T00:00:00Z"',
				'| where outcome="Failure"',
				'| fields user'
			].join('\n')
		);
		expect(m.filters.map((f) => [f.op, f.propertyIri?.slice(SOC_SCHEMA_NS.length), f.value])).toEqual([
			['neq', 'user', 'root'],
			['contains', 'message', 'denied'],
			['in', 'method', ['ssh', 'rdp']],
			['isEmpty', 'user', undefined],
			['isNotEmpty', 'sourceIp', undefined],
			['gte', 'timestamp', '2026-01-01T00:00:00Z'],
			['lt', 'timestamp', '2026-02-01T00:00:00Z'],
			['eq', 'outcome', `${SOC_BASE_IRI}#outcomeFailure`]
		]);
	});

	it('parses entity filters on iri and filters on hop fields', () => {
		const m = okModel(
			'Alert | triggeredBy | where triggeredBy.sourceIp="1.2.3.4" | where iri="http://x/y" | fields alertId'
		);
		expect(m.filters[0]).toMatchObject({ hopId: 'h1', propertyIri: cls('sourceIp'), op: 'eq', value: '1.2.3.4' });
		expect(m.filters[1]).toMatchObject({ hopId: null, propertyIri: null, op: 'eq', value: 'http://x/y' });
	});

	it('parses fields with label and iri sources and synthesises headers', () => {
		const m = okModel('Alert | triggeredBy | fields label, iri, triggeredBy.label, triggeredBy.iri, title');
		expect(m.columns.map((c) => c.source)).toEqual([
			'label',
			'iri',
			'label',
			'iri',
			{ propertyIri: cls('title') }
		]);
		expect(m.columns.map((c) => c.hopId)).toEqual([null, null, 'h1', 'h1', null]);
		expect(m.columns.map((c) => c.header)).toEqual([
			'Alert',
			'Alert IRI',
			'Authentication event',
			'Authentication event IRI',
			'title'
		]);
	});

	it('parses all measure forms, group-by, having, sort, head', () => {
		const m = okModel(
			[
				'Authentication event',
				'| stats count as n, count(user) as nu, dc(user) as users, min(timestamp) as first by sourceIp',
				'| where n>5',
				'| where users<=3',
				'| sort -n, sourceIp',
				'| head 10'
			].join('\n')
		);
		expect(m.aggregation?.measures.map((x) => [x.fn, x.of, x.alias])).toEqual([
			['count', 'root', 'n'],
			['count', 'c2', 'nu'],
			['countDistinct', 'c2', 'users'],
			['min', 'c3', 'first']
		]);
		expect(m.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
		expect(m.aggregation?.groupBy).toEqual(['c1']);
		expect(m.aggregation?.having).toEqual([
			{ measure: 'n', op: 'gt', value: 5 },
			{ measure: 'users', op: 'lte', value: 3 }
		]);
		expect(m.sort).toEqual([
			{ columnId: 'n', direction: 'desc' },
			{ columnId: 'c1', direction: 'asc' }
		]);
		expect(m.limit).toBe(10);
	});

	it('treats dc of the root label as a distinct count of the entity', () => {
		const m = okModel('Authentication event | stats dc(Authentication event) as events by user');
		expect(m.aggregation?.measures[0]).toEqual({ fn: 'countDistinct', of: 'root', alias: 'events' });
	});

	it('parses a non-aggregated sort on a shown column', () => {
		const m = okModel('Alert | fields alertId, title | sort -title');
		expect(m.sort).toEqual([{ columnId: 'c2', direction: 'desc' }]);
	});

	it('is positionally stable across newlines and extra whitespace', () => {
		const a = okModel('Alert\n\n  | where   title = "x"\n| fields   alertId');
		const b = okModel('Alert | where title="x" | fields alertId');
		expect(a).toEqual(b);
	});
});

describe('parseSpl errors', () => {
	it('unknown root class: span of the label, up to 5 suggestions', () => {
		const text = 'Authentcation event | fields user';
		const e = errorOf(text);
		expect(text.slice(e.start, e.end)).toBe('Authentcation event');
		expect(e.expected).toContain('Authentication event');
		expect((e.expected ?? []).length).toBeLessThanOrEqual(5);
	});

	it('unknown field: span of the label, suggestions', () => {
		const text = 'Alert | where titel="x" | fields alertId';
		const e = errorOf(text);
		expect(text.slice(e.start, e.end)).toBe('titel');
		expect(e.expected).toContain('title');
		expect(e.message).toMatch(/unknown/i);
	});

	it('unknown relationship in a hop path points at that segment', () => {
		const text = 'Alert | triggeredBy | triggeredBy.recordedn | fields alertId';
		const e = errorOf(text);
		expect(text.slice(e.start, e.end)).toBe('recordedn');
		expect(e.expected).toContain('recordedIn');
	});

	it('unknown enumeration member lists suggestions', () => {
		const text = 'Alert | where severity="Hgh" | fields alertId';
		const e = errorOf(text);
		expect(text.slice(e.start, e.end)).toBe('"Hgh"');
		expect(e.expected).toContain('High');
	});

	it('a hop path must expand its parent first', () => {
		const e = errorOf('Alert | triggeredBy.recordedIn | fields alertId');
		expect(e.message).toMatch(/triggeredBy/);
	});

	it('like only supports contains-style patterns', () => {
		const text = 'Alert | where like(title, "abc%") | fields alertId';
		const e = errorOf(text);
		expect(e.message).toBe('only contains-style patterns are supported: use like(field, "%value%")');
		expect(text.slice(e.start, e.end)).toBe('"abc%"');
	});

	it('a model that fails runnable validation is an error, not a model', () => {
		const e1 = errorOf('Alert');
		expect(e1.message).toMatch(/at least one column/i);
		const text = 'Authentication event | where timestamp>"yesterday" | fields user';
		const e2 = errorOf(text);
		expect(text.slice(e2.start, e2.end)).toBe('"yesterday"');
		expect(e2.message).toMatch(/not a valid date-time/);
	});

	it('rejects stages out of order and repeated stats', () => {
		expect(errorOf('Alert | fields title | where title="x"').message).toMatch(/before/);
		expect(errorOf('Alert | stats count as n | stats count as m').message).toMatch(/one stats/i);
		expect(errorOf('Alert | head 5 | sort title').message).toMatch(/before/);
	});

	it('rejects unknown commands with a positioned error', () => {
		const text = 'Alert | frobnicate x';
		const e = errorOf(text);
		expect(text.slice(e.start, e.end)).toBe('frobnicate');
	});

	it('rejects a having on an unknown measure and sort on a hidden field', () => {
		expect(errorOf('Alert | stats count as n by title | where m>1').message).toMatch(/m/);
		expect(errorOf('Alert | fields alertId | sort title').message).toMatch(/title/);
	});

	it('propagates tokenizer errors with their position', () => {
		const e = errorOf('Alert | where title="oops');
		expect(e.start).toBe(20);
	});
});

describe('ambiguity', () => {
	// Two classes under one root that both declare a property labelled "name" would be ambiguous; build
	// that on a tiny schema so the SOC fixture stays untouched.
	const iri = (n: string) => `http://example.org/ns#${n}`;
	const X = 'http://www.w3.org/2001/XMLSchema#string';
	const amb = buildBuilderSchema({
		classes: [
			{ iri: iri('Base'), label: 'Base', comment: null, namespaceBaseIri: 'http://example.org/ns' },
			{ iri: iri('Left'), label: 'Thing', comment: null, namespaceBaseIri: 'http://example.org/ns' },
			{ iri: iri('Right'), label: 'Thing', comment: null, namespaceBaseIri: 'http://example.org/ns' }
		],
		datatypeProperties: [
			{ iri: iri('a'), label: 'name', domain: iri('Left'), range: X, namespaceBaseIri: 'x', required: false, repeatable: true },
			{ iri: iri('b'), label: 'name', domain: iri('Base'), range: X, namespaceBaseIri: 'x', required: false, repeatable: true },
			{ iri: iri('c'), label: 'name', domain: iri('Right'), range: X, namespaceBaseIri: 'x', required: false, repeatable: true }
		],
		objectProperties: [],
		subClassOf: [
			{ sub: iri('Left'), super: iri('Base'), namespaceBaseIri: 'http://example.org/ns' },
			{ sub: iri('Right'), super: iri('Base'), namespaceBaseIri: 'http://example.org/ns' }
		],
		individuals: [],
		individualClassRelations: [],
		individualIndividualRelations: []
	});

	it('is an error listing every candidate, never a guess', () => {
		const r = parseSpl('Base | fields name', amb, { namespaces: ['http://example.org/ns'] });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/ambiguous/i);
		expect(r.error.expected).toEqual(expect.arrayContaining(['Base.name', 'Thing.name']));
		expect(r.error.expected).toHaveLength(3);
	});

	it('an ambiguous class label lists every class', () => {
		const r = parseSpl('Thing | fields name', amb, { namespaces: ['http://example.org/ns'] });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/ambiguous/i);
		expect(r.error.expected).toHaveLength(2);
	});
});
