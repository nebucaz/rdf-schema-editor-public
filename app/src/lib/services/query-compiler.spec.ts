import { describe, it, expect } from 'vitest';
import { compileQuery, compileUnpagedQuery, compileCountQuery, QueryCompileError, MAX_PAGE_SIZE } from './query-compiler';
import { emptyQueryModel, type QueryModel } from './query-model';
import { buildBuilderSchema } from './query-builder-schema';
import type { FetchedSchema } from './sparql-connector';

const NS = 'http://example.org/ns';
const iri = (n: string) => `${NS}#${n}`;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

const fetched: FetchedSchema = {
	classes: ['Application', 'WebApp', 'Server', 'IP'].map((n) => ({
		iri: iri(n), label: n, comment: null, namespaceBaseIri: NS
	})),
	datatypeProperties: [
		{ iri: iri('lifecycle'), label: 'lifecycle', domain: iri('Application'), range: XSD_STRING, namespaceBaseIri: NS, required: false, repeatable: true },
		{ iri: iri('hostname'), label: 'hostname', domain: iri('Server'), range: XSD_STRING, namespaceBaseIri: NS, required: false, repeatable: true }
	],
	objectProperties: [
		{ iri: iri('hostedOn'), label: 'hostedOn', domain: iri('Application'), range: iri('Server'), namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific' },
		{ iri: iri('hasIP'), label: 'hasIP', domain: iri('Server'), range: iri('IP'), namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific' }
	],
	subClassOf: [{ sub: iri('WebApp'), super: iri('Application'), namespaceBaseIri: NS }],
	individuals: [],
	individualClassRelations: [],
	individualIndividualRelations: []
};
const schema = buildBuilderSchema(fetched);
const page = { limit: 50, offset: 0 };

function base(): QueryModel {
	const m = emptyQueryModel(iri('Application'), [NS]);
	m.columns = [{ id: 'name', hopId: null, source: 'label', header: 'Name' }];
	return m;
}
const hop = (id: string, parentHopId: string | null, p: string, target: string) => ({
	id, parentHopId, propertyIri: iri(p), direction: 'forward' as const, targetClassIri: iri(target)
});
const sparql = (m: QueryModel, p = page) => compileQuery(m, schema, p).sparql;

describe('compileQuery — shape', () => {
	it('compiles a root-only query with paging and a root tiebreaker', () => {
		const q = sparql(base());
		expect(q).toMatch(/SELECT DISTINCT \?root \?c0/);
		expect(q).toContain(`VALUES ?type { <${iri('Application')}> <${iri('WebApp')}> }`);
		expect(q).toMatch(/ORDER BY \?root\s+LIMIT 50 OFFSET 0/);
		expect(q).toContain('rdfs:label ?c0');
	});

	it('emits only the class when includeSubclasses is false', () => {
		const m = base();
		m.root.includeSubclasses = false;
		const q = sparql(m);
		expect(q).toContain(`VALUES ?type { <${iri('Application')}> }`);
		expect(q).not.toContain(iri('WebApp'));
	});

	it('uses GRAPH ?g with VALUES for namespaces and never FROM', () => {
		const m = base();
		m.namespaces = [NS, 'http://example.org/other'];
		const q = sparql(m);
		expect(q).toMatch(/VALUES \?g\w* \{ <http:\/\/example\.org\/ns> <http:\/\/example\.org\/other> \}/);
		expect(q).toContain('GRAPH ?g');
		expect(q).not.toMatch(/\bFROM\b/);
	});

	it('joins a single hop to the root', () => {
		const m = base();
		m.hops = [hop('h', null, 'hostedOn', 'Server')];
		m.columns.push({ id: 'host', hopId: 'h', source: { propertyIri: iri('hostname') }, header: 'Host' });
		const q = sparql(m);
		expect(q).toContain(`?root <${iri('hostedOn')}> ?h0`);
		expect(q).toContain(`?h0 <${iri('hostname')}> ?c1`);
	});

	it('chains hops and supports sibling hops', () => {
		const m = base();
		m.hops = [
			hop('a', null, 'hostedOn', 'Server'),
			hop('b', 'a', 'hasIP', 'IP'),
			hop('c', null, 'hostedOn', 'Server')
		];
		const q = sparql(m);
		expect(q).toContain(`?root <${iri('hostedOn')}> ?h0`);
		expect(q).toContain(`?h0 <${iri('hasIP')}> ?h1`);
		expect(q).toContain(`?root <${iri('hostedOn')}> ?h2`);
	});

	it('selects the entity IRI for an iri column', () => {
		const m = base();
		m.columns = [{ id: 'self', hopId: null, source: 'iri', header: 'IRI' }];
		expect(sparql(m)).toContain('(?root AS ?c0)');
	});

	it('exposes the root and hop entity variables of columned hops (STORY-192)', () => {
		const m = base();
		m.hops = [hop('a', null, 'hostedOn', 'Server'), hop('b', 'a', 'hasIP', 'IP')];
		m.columns.push({ id: 'host', hopId: 'a', source: { propertyIri: iri('hostname') }, header: 'Host' });
		const r = compileQuery(m, schema, page);
		expect(r.entityVariables).toEqual({ root: 'root', a: 'h0' });
		expect(r.sparql).toMatch(/SELECT DISTINCT \?root \?c0 \?c1 \?h0\b/);
		// hop `b` carries no column, so its variable is not selected
		expect(r.sparql).not.toMatch(/SELECT[^{]*\?h1/);
	});

	it('keeps the select list unchanged when no hop has a column', () => {
		const r = compileQuery(base(), schema, page);
		expect(r.entityVariables).toEqual({ root: 'root' });
		expect(r.sparql).toMatch(/SELECT DISTINCT \?root \?c0\n/);
	});

	it('reports no entity variables for aggregate queries', () => {
		const m = base();
		m.aggregation = { groupBy: ['name'], measures: [{ fn: 'count', of: 'root', alias: 'total' }] };
		expect(compileQuery(m, schema, page).entityVariables).toEqual({});
	});

	it('returns the output column mapping', () => {
		const r = compileQuery(base(), schema, page);
		expect(r.columns).toEqual([{ id: 'name', variable: 'c0', header: 'Name' }]);
	});
});

describe('compileQuery — filters', () => {
	const withFilter = (f: Partial<QueryModel['filters'][number]>): string => {
		const m = base();
		m.filters = [{ id: 'f', hopId: null, propertyIri: iri('lifecycle'), op: 'eq', value: 'Production', ...f }];
		return sparql(m);
	};

	it('eq / neq compare string values', () => {
		expect(withFilter({ op: 'eq' })).toContain('FILTER(STR(?f0) = "Production")');
		expect(withFilter({ op: 'neq' })).toContain('FILTER(STR(?f0) != "Production")');
	});
	it('contains is case-insensitive', () => {
		expect(withFilter({ op: 'contains', value: 'Prod' })).toContain(
			'FILTER(CONTAINS(LCASE(STR(?f0)), LCASE("Prod")))'
		);
	});
	it('in compiles to IN (...)', () => {
		expect(withFilter({ op: 'in', value: ['a', 'b'] })).toContain('FILTER(STR(?f0) IN ("a", "b"))');
	});
	it('isEmpty / isNotEmpty use NOT EXISTS / EXISTS', () => {
		expect(withFilter({ op: 'isEmpty', value: undefined })).toContain('FILTER NOT EXISTS');
		const q = withFilter({ op: 'isNotEmpty', value: undefined });
		expect(q).toMatch(/FILTER EXISTS/);
		expect(q).not.toContain('FILTER NOT EXISTS');
	});
	it('filters the entity IRI when propertyIri is null', () => {
		expect(withFilter({ propertyIri: null, value: iri('x') })).toContain(`FILTER(STR(?root) = "${iri('x')}")`);
	});
	it('rejects isEmpty on the entity itself', () => {
		expect(() => withFilter({ propertyIri: null, op: 'isEmpty', value: undefined })).toThrow(QueryCompileError);
	});
});

describe('compileQuery — sort and paging', () => {
	it('orders by columns then the root tiebreaker', () => {
		const m = base();
		m.columns.push({ id: 'lc', hopId: null, source: { propertyIri: iri('lifecycle') }, header: 'LC' });
		m.sort = [{ columnId: 'lc', direction: 'desc' }, { columnId: 'name', direction: 'asc' }];
		expect(sparql(m)).toMatch(/ORDER BY DESC\(\?c1\) ASC\(\?c0\) \?root\s+LIMIT/);
	});
	it('clamps limit to the maximum and offset to >= 0', () => {
		const q = sparql(base(), { limit: 10_000_000, offset: -5 });
		expect(q).toContain(`LIMIT ${MAX_PAGE_SIZE} OFFSET 0`);
		expect(sparql(base(), { limit: 0, offset: 20 })).toContain('LIMIT 1 OFFSET 20');
	});
});

describe('compileQuery — safety', () => {
	const payloads = ['>', '"', '}', '\n', '> } # ', '\\u003E', 'x" ) } INSERT DATA { <a> <b> <c> } #'];

	it.each(payloads)('escapes literal payload %j', (p) => {
		const m = base();
		m.filters = [{ id: 'f', hopId: null, propertyIri: iri('lifecycle'), op: 'eq', value: p }];
		const strip = (q: string) => q.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
		const benign = base();
		benign.filters = [{ id: 'f', hopId: null, propertyIri: iri('lifecycle'), op: 'eq', value: 'ok' }];
		// With literals blanked, a hostile value must yield exactly the same query structure.
		expect(strip(sparql(m))).toBe(strip(sparql(benign)));
	});

	it.each(['>', '"', '}', 'a b', 'a\nb', '<x', 'x>y'])('rejects unsafe IRI %j', (bad) => {
		const m = base();
		m.root.classIri = `http://x/${bad}`;
		expect(() => sparql(m)).toThrow();
		const n = base();
		n.namespaces = [`http://x/${bad}`];
		expect(() => sparql(n)).toThrow();
		const h = base();
		h.hops = [hop('h', null, 'hostedOn', 'Server')];
		h.hops[0].propertyIri = `http://x/${bad}`;
		expect(() => sparql(h)).toThrow();
	});

	it('never derives variable names from user text', () => {
		const m = base();
		m.columns = [{ id: 'x} DROP', hopId: null, source: 'label', header: 'H?x' }];
		m.hops = [hop('h} #', null, 'hostedOn', 'Server')];
		m.filters = [{ id: 'f} #', hopId: 'h} #', propertyIri: iri('hostname'), op: 'eq', value: 'v' }];
		const q = sparql(m);
		expect(q).not.toContain('DROP');
		expect(q).not.toContain('H?x');
		const vars = [...q.matchAll(/\?([A-Za-z0-9_]+)/g)].map((v) => v[1]);
		for (const v of vars) expect(v).toMatch(/^(root|type|[cfhg]\d+|g|g\d+)$/);
	});
});

describe('compileQuery — validation', () => {
	it('throws a typed error before producing SPARQL for an invalid model', () => {
		const m = base();
		m.sort = [{ columnId: 'ghost', direction: 'asc' }];
		try {
			compileQuery(m, schema, page);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(QueryCompileError);
			expect((e as QueryCompileError).issues[0].path).toBe('sort[0].columnId');
		}
	});
	it('rejects an unknown root class', () => {
		const m = emptyQueryModel(iri('Nope'), [NS]);
		expect(() => compileQuery(m, schema, page)).toThrow(QueryCompileError);
	});
	it('refuses an inverse hop rather than running it as a forward hop (until STORY-227)', () => {
		const m = base();
		m.hops = [{ id: 'h1', parentHopId: null, propertyIri: iri('p'), direction: 'inverse', targetClassIri: m.root.classIri }];
		expect(() => compileQuery(m, schema, page)).toThrow(QueryCompileError);
	});
});

describe('compileQuery — aggregation (STORY-176)', () => {
	function agg(): QueryModel {
		const m = base();
		m.columns = [
			{ id: 'life', hopId: null, source: { propertyIri: iri('lifecycle') }, header: 'Lifecycle' },
			{ id: 'host', hopId: 'h', source: 'label', header: 'Host' }
		];
		m.hops = [hop('h', null, 'hostedOn', 'Server')];
		m.aggregation = { groupBy: ['life'], measures: [{ fn: 'count', of: 'root', alias: 'total' }] };
		return m;
	}

	it('groups by one column with COUNT', () => {
		const r = compileQuery(agg(), schema, page);
		expect(r.rowKind).toBe('aggregate');
		expect(r.sparql).toMatch(/SELECT \?c0 \(COUNT\(\?root\) AS \?m_total\)/);
		expect(r.sparql).toMatch(/GROUP BY \?c0/);
		expect(r.columns).toEqual([
			{ id: 'life', variable: 'c0', header: 'Lifecycle' },
			{ id: 'total', variable: 'm_total', header: 'total' }
		]);
	});

	it('does not select or pattern-match columns that are not grouped or measured', () => {
		const q = compileQuery(agg(), schema, page).sparql;
		expect(q).not.toContain('?c1');
	});

	it('groups by two columns', () => {
		const m = agg();
		m.aggregation!.groupBy = ['life', 'host'];
		const q = compileQuery(m, schema, page).sparql;
		expect(q).toMatch(/SELECT \?c0 \?c1 \(COUNT/);
		expect(q).toMatch(/GROUP BY \?c0 \?c1/);
	});

	it('compiles countDistinct of root over a fanning-out hop', () => {
		const m = agg();
		m.aggregation!.measures = [{ fn: 'countDistinct', of: 'root', alias: 'apps' }];
		const q = compileQuery(m, schema, page).sparql;
		expect(q).toContain('(COUNT(DISTINCT ?root) AS ?m_apps)');
		expect(q).toContain(`?root <${iri('hostedOn')}> ?h0`);
	});

	it('counts a column that is not grouped by', () => {
		const m = agg();
		m.aggregation!.measures = [{ fn: 'countDistinct', of: 'host', alias: 'hosts' }];
		const q = compileQuery(m, schema, page).sparql;
		expect(q).toContain('(COUNT(DISTINCT ?c1) AS ?m_hosts)');
		expect(q).toContain('rdfs:label ?c1');
	});

	it('groups by an iri column using the entity variable', () => {
		const m = agg();
		m.columns.push({ id: 'self', hopId: 'h', source: 'iri', header: 'Server' });
		m.aggregation!.groupBy = ['self'];
		const r = compileQuery(m, schema, page);
		expect(r.sparql).toMatch(/SELECT \?h0 \(COUNT/);
		expect(r.sparql).toMatch(/GROUP BY \?h0/);
		expect(r.columns[0]).toEqual({ id: 'self', variable: 'h0', header: 'Server' });
	});

	it('sorts by a measure alias and by a group-by column, then by group keys', () => {
		const m = agg();
		m.sort = [{ columnId: 'total', direction: 'desc' }];
		expect(compileQuery(m, schema, page).sparql).toMatch(/ORDER BY DESC\(\?m_total\) \?c0\s+LIMIT/);
		m.sort = [{ columnId: 'life', direction: 'asc' }];
		expect(compileQuery(m, schema, page).sparql).toMatch(/ORDER BY ASC\(\?c0\)\s+LIMIT/);
	});

	it('rejects sorting by a non-grouped column', () => {
		const m = agg();
		m.sort = [{ columnId: 'host', direction: 'asc' }];
		try {
			compileQuery(m, schema, page);
			expect.unreachable();
		} catch (e) {
			expect((e as QueryCompileError).issues.map((i) => i.path)).toContain('sort[0].columnId');
		}
	});

	it('rejects aliases that are not plain identifiers', () => {
		const m = agg();
		m.aggregation!.measures[0].alias = 'x) AS ?y } #';
		expect(() => compileQuery(m, schema, page)).toThrow(QueryCompileError);
	});

	it('reports rowKind facts for non-aggregate models', () => {
		expect(compileQuery(base(), schema, page).rowKind).toBe('facts');
	});
});

describe('compileCountQuery (STORY-176)', () => {
	it('wraps the un-paged query as a sub-select returning ?total', () => {
		const q = compileCountQuery(base(), schema).sparql;
		expect(q).toMatch(/SELECT \(COUNT\(\*\) AS \?total\)/);
		expect(q).toMatch(/\{\s*SELECT DISTINCT \?root \?c0/);
		expect(q).not.toMatch(/LIMIT|OFFSET|ORDER BY/);
	});

	it('counts groups for an aggregated model', () => {
		const m = base();
		m.columns = [{ id: 'life', hopId: null, source: { propertyIri: iri('lifecycle') }, header: 'L' }];
		m.aggregation = { groupBy: ['life'], measures: [{ fn: 'count', of: 'root', alias: 'n' }] };
		const q = compileCountQuery(m, schema).sparql;
		expect(q).toMatch(/SELECT \(COUNT\(\*\) AS \?total\)/);
		expect(q).toContain('GROUP BY ?c0');
		expect(q).not.toMatch(/LIMIT|OFFSET|ORDER BY/);
	});

	it('validates the model first', () => {
		const m = base();
		m.namespaces = [];
		expect(() => compileCountQuery(m, schema)).toThrow(QueryCompileError);
	});
});

describe('compileUnpagedQuery (STORY-193)', () => {
	it('is the paged query without LIMIT/OFFSET, same body and ordering', () => {
		const m = base();
		m.sort = [{ columnId: 'name', direction: 'desc' }];
		const paged = compileQuery(m, schema, page).sparql;
		const unpaged = compileUnpagedQuery(m, schema);
		expect(unpaged).not.toMatch(/LIMIT|OFFSET/);
		expect(paged.startsWith(unpaged)).toBe(true);
		expect(unpaged).toMatch(/ORDER BY DESC\(\?c0\) \?root$/);
	});

	it('throws QueryCompileError for an invalid model', () => {
		const m = base();
		m.namespaces = [];
		expect(() => compileUnpagedQuery(m, schema)).toThrow(QueryCompileError);
	});
});
