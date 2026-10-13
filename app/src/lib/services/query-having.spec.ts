import { describe, it, expect } from 'vitest';
import {
	parseQueryModel,
	serializeQueryModel,
	validateQueryModel,
	type QueryModel
} from './query-model';
import { buildBuilderSchema } from './query-builder-schema';
import { compileCountQuery, compileQuery, compileUnpagedQuery } from './query-compiler';
import { printSplPipeline } from './query-spl';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI, SOC_SCHEMA_NS } from './soc-test-support';
import { RUNBOOK_QUERIES } from './soc-runbook-queries';

const quads = loadSocQuads();
const builder = buildBuilderSchema(buildSocFetchedSchema(quads));
const PAGE = { limit: 25, offset: 0 };

const r4 = (having?: NonNullable<QueryModel['aggregation']>['having']): QueryModel => {
	const m = structuredClone(RUNBOOK_QUERIES.R4.model);
	if (having) m.aggregation!.having = having;
	return m;
};
const issues = (m: QueryModel) =>
	validateQueryModel(m, new Set(builder.classes.keys()), builder).map((i) => i.path);

describe('having — model and validation', () => {
	it('round-trips through the strict model parser', () => {
		const m = r4([{ measure: 'count', op: 'gt', value: 7 }]);
		expect(parseQueryModel(serializeQueryModel(m))).toEqual({ ok: true, model: m });
		expect(issues(m)).toEqual([]);
	});

	it('rejects a malformed having entry at parse time', () => {
		for (const bad of [
			[{ measure: 'count', op: 'between', value: 7 }],
			[{ measure: 'count', op: 'gt', value: '7' }],
			[{ measure: 3, op: 'gt', value: 7 }],
			{ measure: 'count', op: 'gt', value: 7 }
		]) {
			const m = JSON.parse(serializeQueryModel(r4()));
			m.aggregation.having = bad;
			expect(parseQueryModel(JSON.stringify(m)).ok).toBe(false);
		}
	});

	it('rejects a top-level having, which would live outside an aggregation', () => {
		const m = JSON.parse(serializeQueryModel(r4()));
		m.having = [{ measure: 'count', op: 'gt', value: 7 }];
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(false);
	});

	it('flags an unknown measure alias', () => {
		expect(issues(r4([{ measure: 'nope', op: 'gt', value: 7 }]))).toEqual(['aggregation.having[0].measure']);
	});

	it('flags a non-finite value', () => {
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(issues(r4([{ measure: 'count', op: 'gt', value }]))).toEqual(['aggregation.having[0].value']);
		}
	});

	it('flags having on an aggregation with no measures', () => {
		const m = r4([{ measure: 'count', op: 'gt', value: 7 }]);
		m.aggregation!.measures = [];
		m.sort = [];
		expect(issues(m)).toContain('aggregation.having[0].measure');
	});
});

describe('having — compiler', () => {
	it('repeats the aggregate expression in HAVING after GROUP BY', () => {
		const q = compileQuery(r4([{ measure: 'count', op: 'gt', value: 7 }]), builder, PAGE).sparql;
		expect(q).toMatch(/GROUP BY \?c0\nHAVING\(COUNT\(\?root\) > 7\)\nORDER BY DESC\(\?m_count\)/);
		expect(q).toContain('(COUNT(?root) AS ?m_count)');
	});

	it('emits every operator and repeats distinct counts in full', () => {
		const m = structuredClone(RUNBOOK_QUERIES.R5.model);
		m.aggregation!.having = [
			{ measure: 'events', op: 'gte', value: 2 },
			{ measure: 'users', op: 'lt', value: 5 },
			{ measure: 'users', op: 'lte', value: 4 },
			{ measure: 'events', op: 'eq', value: 3 },
			{ measure: 'events', op: 'neq', value: 9 }
		];
		const q = compileUnpagedQuery(m, builder);
		expect(q).toMatch(
			/HAVING\(COUNT\(\?root\) >= 2 && COUNT\(DISTINCT \?c\d\) < 5 && COUNT\(DISTINCT \?c\d\) <= 4 && COUNT\(\?root\) = 3 && COUNT\(\?root\) != 9\)/
		);
	});

	it('counts only surviving groups in the count query', () => {
		const sparql = compileCountQuery(r4([{ measure: 'count', op: 'gt', value: 7 }]), builder).sparql;
		expect(sparql).toContain('HAVING(COUNT(?root) > 7)');
		expect(sparql.indexOf('HAVING')).toBeLessThan(sparql.lastIndexOf('}'));
		expect(sparql).toMatch(/SELECT \(COUNT\(\*\) AS \?total\)/);
	});

	it('leaves a query without having unchanged', () => {
		expect(compileUnpagedQuery(r4(), builder)).not.toContain('HAVING');
	});

	it('R4 with having count>7 keeps the sources with 13 and 8 failures, not 7 or 1', () => {
		const sparql = compileUnpagedQuery(r4([{ measure: 'count', op: 'gt', value: 7 }]), builder);
		expect(sparql).toContain('HAVING(COUNT(?root) > 7)');
		// Golden per-source failure counts, computed from the dataset the query runs against.
		const P = (n: string) => `${SOC_SCHEMA_NS}${n}`;
		const failure = `${SOC_BASE_IRI}#outcomeFailure`;
		const byIp = new Map<string, number>();
		for (const q of quads) {
			if (q.predicate.value !== P('outcome') || q.object.value !== failure) continue;
			const ip = quads.find((x) => x.subject.value === q.subject.value && x.predicate.value === P('sourceIp'))!;
			byIp.set(ip.object.value, (byIp.get(ip.object.value) ?? 0) + 1);
		}
		const kept = [...byIp.values()].filter((n) => n > 7).sort((a, b) => b - a);
		expect(kept).toEqual([13, 8]);
		expect([...byIp.values()].sort((a, b) => b - a)).toEqual([13, 8, 7, 1]);
	});
});

describe('having — SPL printer', () => {
	it('prints `| where count>7` after stats and before sort', () => {
		const lines = printSplPipeline(r4([{ measure: 'count', op: 'gt', value: 7 }]), builder).split('\n');
		const stats = lines.findIndex((l) => l.startsWith('| stats'));
		expect(lines[stats + 1]).toBe('| where count>7');
		expect(lines[stats + 2]).toMatch(/^\| sort /);
	});

	it('prints each operator and one stage per condition', () => {
		const out = printSplPipeline(
			r4([
				{ measure: 'count', op: 'gte', value: 2 },
				{ measure: 'count', op: 'lt', value: 20 },
				{ measure: 'count', op: 'eq', value: 8 },
				{ measure: 'count', op: 'neq', value: 1 },
				{ measure: 'count', op: 'lte', value: 13 }
			]),
			builder
		);
		for (const s of ['count>=2', 'count<20', 'count=8', 'count!=1', 'count<=13']) {
			expect(out).toContain(`| where ${s}`);
		}
	});

	it('existing aggregated models print unchanged', () => {
		expect(printSplPipeline(r4(), builder)).not.toContain('| where count');
	});
});
