import { describe, it, expect } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import { compileCountQuery, compileQuery, compileUnpagedQuery } from './query-compiler';
import { parseQueryModel, serializeQueryModel, validateQueryModel, validateRunnableQueryModel } from './query-model';
import { printSplPipeline } from './query-spl';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI, SOC_SCHEMA_NS } from './soc-test-support';
import { RUNBOOK_QUERIES, runbookQueryModel } from './soc-runbook-queries';

/**
 * The SOC runbook's queries (`examples/soc/RUNBOOK.md`, spec/spl-examples STORY-208) as tested models:
 * each validates, compiles with only known IRIs, and prints the SPL block the runbook quotes verbatim.
 */

const builder = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
const PAGE = { limit: 25, offset: 0 };
const ids = ['R3', 'R4', 'R5', 'R6', 'R7', 'R8'] as const;
/** Fixed clock: relative time (R8) resolves against it, never the real time. */
const NOW = new Date('2026-03-16T12:00:00Z');

describe.each(ids)('runbook query %s', (id) => {
	const q = RUNBOOK_QUERIES[id];

	it('is a runnable, valid model over known classes', () => {
		expect(validateRunnableQueryModel(q.model, new Set(builder.classes.keys()))).toEqual([]);
		expect(q.model.namespaces).toEqual([SOC_BASE_IRI]);
	});

	it('round-trips through the strict model parser', () => {
		const parsed = parseQueryModel(serializeQueryModel(q.model));
		expect(parsed).toEqual({ ok: true, model: q.model });
	});

	it('compiles (paged, unpaged, count) using only known or standard IRIs', () => {
		const compiled = compileQuery(q.model, builder, PAGE, { now: NOW });
		expect(compiled.sparql).toMatch(/LIMIT 25 OFFSET 0$/);
		expect(compileUnpagedQuery(q.model, builder, { now: NOW })).not.toMatch(/LIMIT/);
		expect(compileCountQuery(q.model, builder, { now: NOW }).sparql).toContain('COUNT(*)');
		const iris = [...compiled.sparql.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
		expect(iris.length).toBeGreaterThan(0);
		for (const iri of iris) {
			expect(
				iri.startsWith(SOC_BASE_IRI) || iri.startsWith('http://www.w3.org/'),
				`unexpected IRI <${iri}>`
			).toBe(true);
		}
	});

	it('prints the SPL snapshot quoted in the runbook', () => {
		expect(printSplPipeline(q.model, builder)).toBe(q.spl);
	});
});

describe('R3 alert → logfile → server', () => {
	it('walks the forward chain and filters on severity High', () => {
		const m = RUNBOOK_QUERIES.R3.model;
		expect(m.root.classIri).toBe(`${SOC_SCHEMA_NS}Alert`);
		expect(m.hops.map((h) => h.propertyIri.slice(SOC_SCHEMA_NS.length))).toEqual([
			'triggeredBy',
			'recordedIn',
			'hostedOn'
		]);
		expect(m.filters).toHaveLength(1);
		expect(m.filters[0].value).toBe(`${SOC_BASE_IRI}#severityHigh`);
	});

	it('selects one entity per hop so every cell traces back to its entity', () => {
		const compiled = compileQuery(RUNBOOK_QUERIES.R3.model, builder, PAGE);
		expect(Object.keys(compiled.entityVariables)).toHaveLength(4);
		expect(compiled.columns.map((c) => c.header)).toEqual(['alertId', 'title', 'timestamp', 'path', 'hostname']);
	});
});

describe('R4 top failing sources', () => {
	it('groups failures by sourceIp and sorts by the count descending', () => {
		const sparql = compileQuery(RUNBOOK_QUERIES.R4.model, builder, PAGE).sparql;
		expect(sparql).toMatch(/GROUP BY \?c0\b/);
		expect(sparql).toContain('(COUNT(?root) AS ?m_count)');
		expect(sparql).toMatch(/ORDER BY DESC\(\?m_count\)/);
		expect(sparql).toContain(`${SOC_BASE_IRI}#outcomeFailure`);
	});
});

describe('R5 blast radius of one source', () => {
	it('filters one sourceIp, groups by server hostname and counts distinct users', () => {
		const m = RUNBOOK_QUERIES.R5.model;
		expect(m.filters[0].value).toBe('203.0.113.45');
		expect(m.aggregation?.measures.map((x) => x.fn)).toEqual(['count', 'countDistinct']);
		const sparql = compileQuery(m, builder, PAGE).sparql;
		expect(sparql).toContain('COUNT(DISTINCT');
		expect(sparql).toMatch(/GROUP BY \?c\d\b/);
	});
});

describe('engine limits the runbook documents', () => {
	const base = () => runbookQueryModel.alertsByServer();

	it('has no measure filter: an ordering filter cannot target the entity, so count > N is not a filter', () => {
		const m = structuredClone(RUNBOOK_QUERIES.R4.model);
		m.filters.push({ id: 'h', hopId: null, propertyIri: null, op: 'gt', value: '5' });
		expect(validateQueryModel(m).some((i) => i.path === 'filters[1].propertyIri' || i.path.endsWith('.propertyIri'))).toBe(true);
	});

	it('offers no inbound relationship from Server → Alert in the builder yet (inverse is STORY-226+)', () => {
		const m = JSON.parse(serializeQueryModel(base()));
		m.hops[0].direction = 'inverse';
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(true); // the model carries it since STORY-225
		const server = builder.classes.get(`${SOC_SCHEMA_NS}Server`)!;
		expect(server.relationships.map((r) => r.targetClassIri)).not.toContain(`${SOC_SCHEMA_NS}Alert`);
	});

	it('has no named date-range filter operators (ranges are gte + lt, STORY-212)', () => {
		for (const op of ['before', 'after', 'between']) {
			const m = JSON.parse(serializeQueryModel(base()));
			m.filters.push({ id: 'd', hopId: 'h1', propertyIri: `${SOC_SCHEMA_NS}timestamp`, op, value: '2026-03-14' });
			expect(parseQueryModel(JSON.stringify(m)).ok, op).toBe(false);
		}
	});

	it('only sorts an aggregate by a grouped column or a measure (no top-N cut-off either)', () => {
		const m = structuredClone(RUNBOOK_QUERIES.R4.model);
		m.columns.push({ id: 'extra', hopId: null, source: 'label', header: 'label' });
		m.sort = [{ columnId: 'extra', direction: 'desc' }];
		expect(validateQueryModel(m).some((i) => i.path === 'sort[0].columnId')).toBe(true);
	});
});

describe('OR group golden data (STORY-230)', () => {
	const quads = loadSocQuads();
	const alertCls = `${SOC_SCHEMA_NS}Alert`;
	const sev = (n: string) => `${SOC_BASE_IRI}#severity${n}`;
	const codes = (levels: string[]) =>
		quads
			.filter((q) => q.predicate.value === `${SOC_SCHEMA_NS}severity` && levels.map(sev).includes(q.object.value))
			.map((q) => q.subject.value)
			.map((s) => quads.find((x) => x.subject.value === s && x.predicate.value === `${SOC_SCHEMA_NS}alertId`)!.object.value)
			.sort();

	it('High OR Medium selects A-1001, A-1002 and A-1004 in the dataset', () => {
		expect(codes(['High', 'Medium'])).toEqual(['A-1001', 'A-1002', 'A-1004']);
	});

	it('compiles severity=High OR severity=Medium as one group over the same values', () => {
		const m = {
			...RUNBOOK_QUERIES.R3.model,
			hops: [],
			filters: ['High', 'Medium'].map((n, i) => ({
				id: `f${i}`, hopId: null, propertyIri: `${SOC_SCHEMA_NS}severity`, op: 'eq' as const, value: sev(n), orGroup: 'g'
			})),
			columns: [{ id: 'c', hopId: null, source: { propertyIri: `${SOC_SCHEMA_NS}alertId` }, header: 'Alert' }]
		};
		m.root = { classIri: alertCls, includeSubclasses: true } as typeof m.root;
		const sparql = compileUnpagedQuery(m, builder);
		expect(sparql).toContain(`"${sev('High')}"`);
		expect(sparql).toContain(`"${sev('Medium')}"`);
		expect(sparql.match(/ \|\| /g)).toHaveLength(1);
	});
});
