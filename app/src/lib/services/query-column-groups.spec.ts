import { describe, expect, it } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import { buildColumnGroups, columnMarkers, filterableProperties, filterMarkers, filtersForColumn } from './query-column-groups';
import { emptyQueryModel, type Column, type Filter, type Hop, type QueryModel } from './query-model';
import type { FetchedSchema } from './sparql-connector';
import { RUNBOOK_QUERIES } from './soc-runbook-queries';
import { buildSocFetchedSchema, loadSocQuads } from './soc-test-support';

const NS = 'http://example.org/org';
const o = (n: string) => `${NS}#${n}`;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const cls = (n: string, label = n) => ({ iri: o(n), label, comment: null, namespaceBaseIri: NS });
const dp = (n: string, domain: string, range: string, label = n) => ({
	iri: o(n), label, domain: o(domain), range, namespaceBaseIri: NS, required: false, repeatable: false
});
const rel = (n: string, domain: string, range: string, label = n) => ({
	...dp(n, domain, o(range), label), relationKind: 'specific' as const
});

const fetched: FetchedSchema = {
	classes: [cls('Org', 'Organisation'), cls('Team'), cls('Person')],
	datatypeProperties: [
		dp('orgName', 'Org', XSD_STRING, 'Name'),
		dp('teamName', 'Team', XSD_STRING, 'Team name'),
		dp('personName', 'Person', XSD_STRING, 'Person name')
	],
	objectProperties: [rel('hasTeam', 'Org', 'Team', 'has team'), rel('hasMember', 'Team', 'Person', 'has member')],
	individuals: [],
	subClassOf: [],
	shapeInConstraints: []
} as unknown as FetchedSchema;
const schema = buildBuilderSchema(fetched);

const hop = (id: string, parent: string | null, p: string, target: string, direction: Hop['direction'] = 'forward'): Hop => ({
	id, parentHopId: parent, propertyIri: o(p), direction, targetClassIri: o(target)
});
const col = (id: string, hopId: string | null, source: Column['source'], header = id): Column => ({
	id, hopId, source, header
});
const prop = (n: string) => ({ propertyIri: o(n) });
const base = (patch: Partial<QueryModel> = {}): QueryModel => ({ ...emptyQueryModel(o('Org'), [NS]), ...patch });

describe('buildColumnGroups', () => {
	it('returns a single removable root group for a root-only model', () => {
		const groups = buildColumnGroups(base(), schema);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			hopId: null, classIri: o('Org'), label: 'Organisation', isRoot: true, removable: true,
			viaLabel: null, direction: null, parentHopId: null, depth: 0, columns: [], hiddenFilters: [], entityFilter: null
		});
	});

	it('lists groups in tree order with depth, via labels and columns attached to their hop', () => {
		const m = base({
			hops: [hop('h1', null, 'hasTeam', 'Team'), hop('h2', 'h1', 'hasMember', 'Person')],
			columns: [
				col('c1', null, prop('orgName'), 'Org'),
				col('c3', 'h2', prop('personName'), 'Who'),
				col('c2', 'h1', prop('teamName'))
			]
		});
		const groups = buildColumnGroups(m, schema);
		expect(groups.map((g) => [g.hopId, g.depth, g.viaLabel, g.label])).toEqual([
			[null, 0, null, 'Organisation'],
			['h1', 1, 'has team →', 'Team'],
			['h2', 2, 'has member →', 'Person']
		]);
		expect(groups.map((g) => g.columns.map((c) => c.column.id))).toEqual([['c1'], ['c2'], ['c3']]);
		expect(groups[0].removable).toBe(false); // children exist
		expect(groups[1].removable).toBe(true);
		expect(groups[2]).toMatchObject({ parentHopId: 'h1', isRoot: false, direction: 'forward' });
	});

	it('orders branches depth-first, siblings in hop order, regardless of array order', () => {
		const m = base({
			hops: [
				hop('h1', null, 'hasTeam', 'Team'),
				hop('h3', 'h2', 'hasMember', 'Person'),
				hop('h2', null, 'hasMember', 'Person')
			]
		});
		expect(buildColumnGroups(m, schema).map((g) => g.hopId)).toEqual([null, 'h1', 'h2', 'h3']);
	});

	it('labels an inverse hop "← label" and carries its direction', () => {
		const m = base({
			root: { classIri: o('Team'), includeSubclasses: true },
			hops: [hop('h1', null, 'hasTeam', 'Org', 'inverse')]
		});
		const g = buildColumnGroups(m, schema)[1];
		expect(g).toMatchObject({ direction: 'inverse', label: 'Organisation' });
		expect(g.viaLabel).toBe('← has team');
	});

	it('keeps a hop that has no columns', () => {
		const groups = buildColumnGroups(base({ hops: [hop('h1', null, 'hasTeam', 'Team')] }), schema);
		expect(groups[1].columns).toEqual([]);
	});

	it('attaches filters to the column they target and reports others as hiddenFilters', () => {
		const onCol: Filter = { id: 'f1', hopId: null, propertyIri: o('orgName'), op: 'eq', value: 'x' };
		const hidden: Filter = { id: 'f2', hopId: 'h1', propertyIri: o('teamName'), op: 'contains', value: 'y' };
		const m = base({
			hops: [hop('h1', null, 'hasTeam', 'Team')],
			columns: [col('c1', null, prop('orgName'))],
			filters: [onCol, hidden]
		});
		const [root, team] = buildColumnGroups(m, schema);
		expect(root.columns[0].filters).toEqual([onCol]);
		expect(root.hiddenFilters).toEqual([]);
		expect(team.columns).toEqual([]);
		expect(team.hiddenFilters).toEqual([hidden]);
	});

	it('exposes entity filters (propertyIri null) at group level, not as column or hidden filters', () => {
		const ef: Filter = { id: 'f1', hopId: 'h1', propertyIri: null, op: 'eq', value: 'http://x/y' };
		const m = base({ hops: [hop('h1', null, 'hasTeam', 'Team')], filters: [ef] });
		const [root, team] = buildColumnGroups(m, schema);
		expect(root.entityFilter).toBeNull();
		expect(team.entityFilter).toEqual(ef);
		expect(team.hiddenFilters).toEqual([]);
	});

	it('attaches sort rank (1-based) and direction to columns', () => {
		const m = base({
			columns: [col('c1', null, prop('orgName')), col('c2', null, 'label'), col('c3', null, 'iri')],
			sort: [
				{ columnId: 'c2', direction: 'desc' },
				{ columnId: 'c1', direction: 'asc' }
			]
		});
		const cols = buildColumnGroups(m, schema)[0].columns;
		expect(cols.map((c) => [c.column.id, c.sortRank, c.sortDirection])).toEqual([
			['c1', 2, 'asc'],
			['c2', 1, 'desc'],
			['c3', null, null]
		]);
		expect(cols.every((c) => c.sortable)).toBe(true);
	});

	it('marks columns that are not group-by columns of an aggregated model as not sortable', () => {
		const m = base({
			columns: [col('c1', null, prop('orgName')), col('c2', null, 'iri')],
			aggregation: {
				groupBy: ['c1'],
				measures: [{ fn: 'count', of: 'root', alias: 'n' }]
			}
		});
		const cols = buildColumnGroups(m, schema)[0].columns;
		expect(cols.map((c) => [c.column.id, c.sortable])).toEqual([
			['c1', true],
			['c2', false]
		]);
	});

	it('falls back to local names and never throws on schema drift', () => {
		const m = base({
			root: { classIri: 'http://gone.example/Vanished', includeSubclasses: true },
			hops: [{ id: 'h1', parentHopId: null, propertyIri: 'http://gone.example/rel', direction: 'forward', targetClassIri: 'http://gone.example/Other' }],
			columns: [col('c1', 'h1', { propertyIri: 'http://gone.example/prop' }, 'p')],
			filters: [{ id: 'f1', hopId: 'h1', propertyIri: 'http://gone.example/prop', op: 'eq', value: 'a' }]
		});
		const groups = buildColumnGroups(m, schema);
		expect(groups.map((g) => g.label)).toEqual(['Vanished', 'Other']);
		expect(groups[1].viaLabel).toBe('http://gone.example/rel →');
		expect(groups[1].columns[0].filters).toHaveLength(1);
		expect(groups[1].columns[0].propertyLabel).toBe('prop');
	});

	it('does not throw on orphaned hops, columns or filters, and does not drop orphan hops', () => {
		const m = base({
			hops: [hop('h1', 'missing', 'hasTeam', 'Team')],
			columns: [col('c1', 'nope', prop('orgName'))],
			filters: [{ id: 'f1', hopId: 'nope', propertyIri: null, op: 'isEmpty' }]
		});
		const groups = buildColumnGroups(m, schema);
		expect(groups.map((g) => g.hopId)).toEqual([null, 'h1']);
	});

	it('does not mutate its inputs', () => {
		const m = base({ hops: [hop('h1', null, 'hasTeam', 'Team')], columns: [col('c1', null, 'label')] });
		const copy = JSON.stringify(m);
		buildColumnGroups(m, schema);
		expect(JSON.stringify(m)).toBe(copy);
	});

	it('builds groups for every SOC runbook query without throwing', () => {
		const soc = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
		for (const [id, q] of Object.entries(RUNBOOK_QUERIES)) {
			const groups = buildColumnGroups(q.model, soc);
			expect(groups.length, id).toBe(q.model.hops.length + 1);
			expect(groups.flatMap((g) => g.columns).length, id).toBe(q.model.columns.length);
		}
	});
});

describe('filterableProperties', () => {
	it('lists every property of every used class by group, flagging which are columns', () => {
		const m = base({
			hops: [hop('h1', null, 'hasTeam', 'Team')],
			columns: [col('c1', null, prop('orgName')), col('c2', 'h1', 'label')]
		});
		const list = filterableProperties(m, schema);
		expect(list.map((p) => [p.hopId, p.property.iri, p.isColumn, p.columnId])).toEqual([
			[null, o('orgName'), true, 'c1'],
			['h1', o('teamName'), false, null]
		]);
		expect(list[0]).toMatchObject({ classIri: o('Org'), groupLabel: 'Organisation' });
	});

	it('lists a class once per group when it is used twice', () => {
		const m = base({ hops: [hop('h1', null, 'hasTeam', 'Team'), hop('h2', null, 'hasTeam', 'Team')] });
		expect(filterableProperties(m, schema).map((p) => p.hopId)).toEqual([null, 'h1', 'h2']);
	});

	it('uses the properties the schema gives each class (own, not inherited) and keeps enumerations', () => {
		const withSub = buildBuilderSchema({
			...fetched,
			classes: [...fetched.classes, cls('SubOrg')],
			subClassOf: [{ subClass: o('SubOrg'), superClass: o('Org') }],
			shapeInConstraints: [
				{ classIri: o('Org'), propertyIri: o('orgName'), values: [{ value: 'A', isIri: false }] }
			]
		} as unknown as FetchedSchema);
		const sub = filterableProperties(base({ root: { classIri: o('SubOrg'), includeSubclasses: false } as never }), withSub);
		expect(sub).toEqual([]);
		const org = filterableProperties(base(), withSub);
		expect(org[0].property.allowedValues).toEqual([{ value: 'A', label: 'A', isIri: false }]);
	});
});

describe('filtersForColumn / filterMarkers', () => {
	const f = (id: string, hopId: string | null, propertyIri: string | null, op: Filter['op'], value?: Filter['value']): Filter => ({
		id, hopId, propertyIri, op, ...(value === undefined ? {} : { value })
	});

	it('maps filters to the column of the same hop and property', () => {
		const c1 = col('c1', null, prop('orgName'));
		const m = base({
			columns: [c1],
			filters: [f('f1', null, o('orgName'), 'eq', 'Acme'), f('f2', 'h1', o('orgName'), 'eq', 'x'), f('f3', null, o('other'), 'eq', 'y')]
		});
		expect(filtersForColumn(m, c1).map((x) => x.id)).toEqual(['f1']);
		expect(filtersForColumn(m, col('c9', null, 'label'))).toEqual([]);
	});

	it('merges a gte + lt range into one marker with both bounds', () => {
		const m = base({
			columns: [col('c1', null, prop('orgName'), 'Size')],
			filters: [f('f1', null, o('orgName'), 'gte', '18'), f('f2', null, o('orgName'), 'lt', '65')]
		});
		const markers = filterMarkers(m, schema);
		expect(markers).toHaveLength(1);
		expect(markers[0]).toMatchObject({ columnId: 'c1', hidden: false, text: 'Name >= 18 and < 65' });
		expect(markers[0].filters.map((x) => x.id)).toEqual(['f1', 'f2']);
	});

	it('reports a filter on a non-column property as hidden', () => {
		const m = base({ filters: [f('f1', null, o('orgName'), 'contains', 'Ac')] });
		expect(filterMarkers(m, schema)).toMatchObject([{ columnId: null, hidden: true, text: 'Name contains Ac' }]);
	});

	it('keeps entity filters group-level and describes enumeration `in` values', () => {
		const m = base({
			columns: [col('c1', null, prop('orgName'))],
			filters: [f('f1', null, null, 'eq', o('acme')), f('f2', null, o('orgName'), 'in', ['A', 'B'])]
		});
		const markers = filterMarkers(m, schema);
		expect(markers.find((x) => x.propertyIri === null)).toMatchObject({ columnId: null, hidden: false });
		expect(markers.find((x) => x.propertyIri === o('orgName'))).toMatchObject({ columnId: 'c1', text: 'Name in (A, B)' });
	});
});

describe('columnMarkers', () => {
	const sortOn = (...ids: [string, 'asc' | 'desc'][]) => ids.map(([columnId, direction]) => ({ columnId, direction }));

	it('reports direction and rank for sorted columns, with accessible labels', () => {
		const m = base({
			columns: [col('c1', null, prop('orgName'), 'Name'), col('c2', null, 'label', 'Title')],
			sort: sortOn(['c2', 'desc'], ['c1', 'asc'])
		});
		const s = columnMarkers(m, schema);
		expect(s.get('c1')).toMatchObject({ sort: { direction: 'asc', rank: 2 }, multiSort: true, sortLabel: 'Sorted ascending, 2 of 2' });
		expect(s.get('c2')).toMatchObject({ sort: { direction: 'desc', rank: 1 }, sortLabel: 'Sorted descending, 1 of 2' });
	});

	it('uses a plain label for a single sort key and for an unsorted column', () => {
		const m = base({ columns: [col('c1', null, prop('orgName')), col('c2', null, 'label')], sort: sortOn(['c1', 'asc']) });
		const s = columnMarkers(m, schema);
		expect(s.get('c1')).toMatchObject({ multiSort: false, sortLabel: 'Sorted ascending' });
		expect(s.get('c2')).toMatchObject({ sort: null, sortLabel: 'Not sorted' });
	});

	it('carries the filter text for a filtered column and none for others', () => {
		const m = base({
			columns: [col('c1', null, prop('orgName')), col('c2', null, 'label')],
			filters: [{ id: 'f1', hopId: null, propertyIri: o('orgName'), op: 'eq', value: 'Acme' }]
		});
		const s = columnMarkers(m, schema);
		expect(s.get('c1')?.filterable).toBe(true);
		expect(s.get('c2')?.filterable).toBe(false);
		expect(s.get('c1')).toMatchObject({ filterActive: true, filterText: 'Name = Acme', filterLabel: 'Filtered: Name = Acme' });
		expect(s.get('c2')).toMatchObject({ filterActive: false, filterText: null, filterLabel: 'Not filtered' });
	});

	it('is keyed by column id, one entry per column, regardless of group', () => {
		const m = base({
			hops: [hop('h1', null, 'hasTeam', 'Team')],
			columns: [col('c1', null, prop('orgName')), col('c2', 'h1', prop('teamName'))]
		});
		expect([...columnMarkers(m, schema).keys()].sort()).toEqual(['c1', 'c2']);
	});
});
