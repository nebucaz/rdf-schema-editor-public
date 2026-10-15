import { describe, it, expect } from 'vitest';
import { parseSpl } from './query-spl-parser';
import { printSplPipeline } from './query-spl';
import { buildBuilderSchema } from './query-builder-schema';
import type { QueryModel } from './query-model';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI, SOC_SCHEMA_NS } from './soc-test-support';
import { RUNBOOK_QUERIES } from './soc-runbook-queries';
import { normaliseModel } from './query-spl-normalise';

const schema = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
const parse = (text: string) => parseSpl(text, schema, { namespaces: [SOC_BASE_IRI] });
const model = (text: string): QueryModel => {
	const r = parse(text);
	if (!r.ok) throw new Error(`${r.error.message} @${r.error.start}-${r.error.end}`);
	return r.model;
};
const error = (text: string) => {
	const r = parse(text);
	if (r.ok) throw new Error('expected an error');
	return r.error;
};
/** Both texts mean the same query: equal structure, equal canonical SPL. */
const same = (dialect: string, canonical: string) => {
	const a = model(dialect);
	const b = model(canonical);
	expect(normaliseModel(a)).toEqual(normaliseModel(b));
	expect(printSplPipeline(a, schema)).toBe(printSplPipeline(b, schema));
};

describe('accepted synonyms map to the canonical model', () => {
	const cases: [string, string, string][] = [
		['leading search', 'search Alert | fields title', 'Alert | fields title'],
		['search with a multi-word class', 'search Authentication event | fields user', 'Authentication event | fields user'],
		['== for =', 'Alert | where title=="x" | fields alertId', 'Alert | where title="x" | fields alertId'],
		['AND in one where', 'Alert | where title="x" AND alertId="a1" | fields title', 'Alert | where title="x" | where alertId="a1" | fields title'],
		['lower-case and', 'Alert | where title="x" and isnotnull(alertId) | fields title', 'Alert | where title="x" | where isnotnull(alertId) | fields title'],
		['AND around IN', 'Alert | where title IN ("a", "b") AND alertId="1" | fields title', 'Alert | where title IN ("a", "b") | where alertId="1" | fields title'],
		['table for fields', 'Alert | table alertId, title', 'Alert | fields alertId, title'],
		['== in a measure filter', 'Alert | stats count as n by title | where n==2', 'Alert | stats count as n by title | where n=2'],
		['stats without alias', 'Authentication event | stats count by sourceIp', 'Authentication event | stats count as count by sourceIp'],
		['head after sort', 'Alert | fields title | sort title | head 3', 'Alert | fields title | sort title | head 3']
	];
	it.each(cases)('%s', (_name, dialect, canonical) => same(dialect, canonical));

	it('a class whose own label starts with "search" still resolves', () => {
		// The whole text is tried as a label before "search" is treated as a keyword.
		expect(model('search Alert | fields title').root.classIri).toBe(`${SOC_SCHEMA_NS}Alert`);
	});

	it('earliest/latest with absolute timestamps become gte/lt on the single dateTime property', () => {
		const m = model('Authentication event earliest="2026-01-01T00:00:00Z" latest="2026-02-01T00:00:00Z" | fields user');
		expect(m.filters.map((f) => [f.op, f.propertyIri, f.value])).toEqual([
			['gte', `${SOC_SCHEMA_NS}timestamp`, '2026-01-01T00:00:00Z'],
			['lt', `${SOC_SCHEMA_NS}timestamp`, '2026-02-01T00:00:00Z']
		]);
		same(
			'search Authentication event earliest="2026-01-01T00:00:00Z" | fields user',
			'Authentication event | where timestamp>="2026-01-01T00:00:00Z" | fields user'
		);
		same(
			'Authentication event | where earliest="2026-01-01T00:00:00Z" | fields user',
			'Authentication event | where timestamp>="2026-01-01T00:00:00Z" | fields user'
		);
		expect(model('Authentication event (exact) earliest="2026-01-01T00:00:00Z" | fields user').root.includeSubclasses).toBe(false);
	});

	it('earliest/latest on a class without exactly one dateTime property names the candidates', () => {
		const none = error('Server earliest="2026-01-01T00:00:00Z" | fields hostname');
		expect(none.message).toMatch(/dateTime/);
		expect(none.message).toMatch(/Server/);
	});

	it('top N f equals stats count by f | sort -count | head N', () => {
		const top = model('Authentication event | where outcome="Failure" | top 5 sourceIp');
		const r4 = { ...RUNBOOK_QUERIES.R4.model, limit: 5 };
		expect(normaliseModel(top)).toEqual(normaliseModel(r4));
		expect(printSplPipeline(top, schema)).toBe(`${RUNBOOK_QUERIES.R4.spl}\n| head 5`);
		same('Authentication event | top limit=5 sourceIp', 'Authentication event | stats count as count by sourceIp | sort -count | head 5');
		expect(model('Authentication event | top sourceIp').limit).toBe(10);
	});

	it('rename sets a column header or renames a measure alias and its references', () => {
		const a = model('Alert | fields alertId, title | rename title as "Alert title"');
		expect(a.columns.map((c) => c.header)).toEqual(['alertId', 'Alert title']);
		const b = model('Authentication event | stats count as c by user | rename c as n | where n>5 | sort -n');
		expect(b.aggregation?.measures[0].alias).toBe('n');
		expect(b.aggregation?.having).toEqual([{ measure: 'n', op: 'gt', value: 5 }]);
		expect(b.sort).toEqual([{ columnId: 'n', direction: 'desc' }]);
		expect(error('Alert | rename title as x').message).toMatch(/after/);
	});
});

describe('unsupported constructs fail with a positioned "not supported" error', () => {
	const table: [string, string, string, string][] = [
		['eval', 'Alert | eval x=1 | fields title', 'eval', 'eval is not supported in this workbench'],
		['rex', 'Alert | rex field=title "(?<x>.*)" | fields title', 'rex', 'rex is not supported in this workbench'],
		['join', 'Alert | join title | fields title', 'join', 'join is not supported in this workbench'],
		['append', 'Alert | append [ search Server ] | fields title', 'append', 'append is not supported in this workbench'],
		['lookup', 'Alert | lookup users user | fields title', 'lookup', 'lookup is not supported in this workbench'],
		['subsearch', 'Alert | where title IN [ search Server | fields hostname ] | fields title', '[ search Server | fields hostname ]', 'subsearch is not supported in this workbench'],
		['NOT', 'Alert | where NOT title="a" | fields title', 'NOT', 'NOT is not supported in this workbench']
	];
	it.each(table)('%s', (_name, text, spanned, message) => {
		const e = error(text);
		expect(e.message).toBe(message);
		expect(text.slice(e.start, e.end)).toBe(spanned);
		expect(e.helpTopic).toBe('spl-unsupported');
	});

	it('fields - x is not supported', () => {
		const e = error('Alert | fields - title');
		expect(e.message).toMatch(/not supported/);
	});

	it('relative earliest/latest become a relative bound on the single dateTime property', () => {
		const m = model('Authentication event earliest=-24h latest=now | fields user');
		expect(m.filters.map((f) => ({ op: f.op, relativeTime: f.relativeTime, value: f.value }))).toEqual([
			{ op: 'gte', relativeTime: '-24h', value: undefined },
			{ op: 'lt', relativeTime: 'now', value: undefined }
		]);
		const quoted = model('Authentication event | where earliest="-90m" | fields user');
		expect(quoted.filters[0]).toMatchObject({ op: 'gte', relativeTime: '-90m' });
	});

	it('a comparison on a dateTime field accepts a relative bound, quoted or bare', () => {
		for (const bound of ['"-1d"', '-1d']) {
			const m = model(`Authentication event | where timestamp>=${bound} | fields user`);
			expect(m.filters[0]).toMatchObject({ op: 'gte', relativeTime: '-1d' });
			expect(m.filters[0].value).toBeUndefined();
		}
	});

	it('a relative bound on a non-date property is a positioned validation error', () => {
		const text = 'Authentication event | where user>="-1d" | fields user';
		const r = parse(text);
		expect(r.ok).toBe(false);
	});

	it('unsupported relative syntax (snapping, months) keeps a dedicated error', () => {
		const text = 'Authentication event earliest="-1d@d" | fields user';
		const e = error(text);
		expect(e.message).toMatch(/unsupported relative time/);
		expect(e.helpTopic).toBe('spl-relative-time');
		expect(error('Authentication event | where latest="-1mon" | fields user').helpTopic).toBe('spl-relative-time');
	});
});
