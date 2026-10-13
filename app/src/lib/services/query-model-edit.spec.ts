import { describe, it, expect } from 'vitest';
import {
	emptyQueryModel,
	validateQueryModel,
	validateRunnableQueryModel,
	type QueryModel
} from './query-model';
import { compileQuery } from './query-compiler';
import { buildBuilderSchema } from './query-builder-schema';
import type { FetchedSchema } from './sparql-connector';
import {
	startQueryFromClass,
	startQueryFromSearchHit,
	setIncludeSubclasses,
	setNamespaces,
	addColumn,
	removeColumn,
	hasColumn,
	addFilter,
	removeFilter,
	addHop,
	hopViaLabel,
	removeHop,
	upsertFilter,
	moveColumn,
	setColumnHeader,
	setSort,
	removeSort,
	moveSort,
	allowedSortKeys,
	enableAggregation,
	disableAggregation,
	toggleGroupBy,
	addMeasure,
	removeMeasure,
	cycleSort
} from './query-model-edit';

const NS = 'http://example.org/ns';
const APP = `${NS}#Application`;

describe('starting a query', () => {
	it('startQueryFromClass creates an empty model with that root and scope', () => {
		const m = startQueryFromClass(APP, [NS]);
		expect(m).toEqual(emptyQueryModel(APP, [NS]));
		expect(m.root.includeSubclasses).toBe(true);
		expect(m.columns).toEqual([]);
		expect(m.filters).toEqual([]);
	});

	it('startQueryFromSearchHit roots at the hit class with an eq filter on the individual IRI', () => {
		const m = startQueryFromSearchHit({ classIri: APP, iri: `${NS}#SAP`, label: 'SAP' }, [NS]);
		expect(m.root.classIri).toBe(APP);
		expect(m.filters).toHaveLength(1);
		expect(m.filters[0]).toMatchObject({ hopId: null, propertyIri: null, op: 'eq', value: `${NS}#SAP` });
		expect(validateQueryModel(m)).toEqual([]);
	});
});

describe('immutability', () => {
	const base = (): QueryModel => startQueryFromClass(APP, [NS]);

	it('setIncludeSubclasses returns a new model and leaves the input untouched', () => {
		const m = base();
		const next = setIncludeSubclasses(m, false);
		expect(next.root.includeSubclasses).toBe(false);
		expect(m.root.includeSubclasses).toBe(true);
		expect(next).not.toBe(m);
	});

	it('setNamespaces replaces the scope without mutating', () => {
		const m = base();
		const next = setNamespaces(m, ['a', 'b']);
		expect(next.namespaces).toEqual(['a', 'b']);
		expect(m.namespaces).toEqual([NS]);
	});

	it('addColumn appends a column with a fresh unique id and does not mutate', () => {
		const m = base();
		const a = addColumn(m, { hopId: null, source: { propertyIri: `${NS}#name` }, header: 'Name' });
		const b = addColumn(a, { hopId: null, source: 'iri', header: 'IRI' });
		expect(m.columns).toEqual([]);
		expect(a.columns).toHaveLength(1);
		expect(b.columns.map((c) => c.id)).toHaveLength(2);
		expect(new Set(b.columns.map((c) => c.id)).size).toBe(2);
		expect(validateQueryModel(b)).toEqual([]);
	});

	it('addColumn does not reuse an id after a column was removed', () => {
		let m = base();
		m = addColumn(m, { hopId: null, source: 'label', header: 'A' });
		m = addColumn(m, { hopId: null, source: 'iri', header: 'B' });
		const firstId = m.columns[0].id;
		m = removeColumn(m, firstId);
		m = addColumn(m, { hopId: null, source: { propertyIri: `${NS}#x` }, header: 'C' });
		expect(new Set(m.columns.map((c) => c.id)).size).toBe(2);
	});

	it('addColumn is a no-op when the same hop+source column already exists', () => {
		let m = base();
		const col = { hopId: null, source: { propertyIri: `${NS}#name` }, header: 'Name' };
		m = addColumn(m, col);
		const again = addColumn(m, col);
		expect(again.columns).toHaveLength(1);
		expect(hasColumn(again, null, { propertyIri: `${NS}#name` })).toBe(true);
		expect(hasColumn(again, null, 'label')).toBe(false);
	});

	it('removeColumn drops the column and any sort / aggregation references to it', () => {
		let m = base();
		m = addColumn(m, { hopId: null, source: 'label', header: 'A' });
		m = addColumn(m, { hopId: null, source: 'iri', header: 'B' });
		const [a, b] = m.columns.map((c) => c.id);
		m = {
			...m,
			sort: [{ columnId: a, direction: 'asc' }, { columnId: b, direction: 'desc' }],
			aggregation: { groupBy: [a, b], measures: [{ fn: 'count', of: a, alias: 'n' }] }
		};
		const next = removeColumn(m, a);
		expect(next.columns.map((c) => c.id)).toEqual([b]);
		expect(next.sort.map((s) => s.columnId)).toEqual([b]);
		expect(next.aggregation?.groupBy).toEqual([b]);
		expect(next.aggregation?.measures[0].of).toBe('root');
		expect(m.columns).toHaveLength(2);
		expect(validateQueryModel(next)).toEqual([]);
	});

	it('addFilter / removeFilter work on a fresh id and never mutate', () => {
		const m = base();
		const a = addFilter(m, { hopId: null, propertyIri: `${NS}#lifecycle`, op: 'eq', value: 'Prod' });
		expect(m.filters).toEqual([]);
		expect(a.filters).toHaveLength(1);
		const b = removeFilter(a, a.filters[0].id);
		expect(b.filters).toEqual([]);
		expect(a.filters).toHaveLength(1);
	});
});

describe('hops', () => {
	const rel = (name: string, target: string) => ({ iri: `${NS}#${name}`, targetClassIri: `${NS}#${target}` });
	const base = () => startQueryFromClass(APP, [NS]);

	it('addHop expands from the root and from a hop, to depth 4, without mutating', () => {
		const m0 = base();
		const m1 = addHop(m0, null, rel('hostedOn', 'Server'));
		const h1 = m1.hops[0];
		const m2 = addHop(m1, h1.id, rel('hasIP', 'IP'));
		const m3 = addHop(m2, m2.hops[1].id, rel('inSubnet', 'Subnet'));
		const m4 = addHop(m3, m3.hops[2].id, rel('inZone', 'Zone'));
		expect(m0.hops).toEqual([]);
		expect(m4.hops).toHaveLength(4);
		expect(m4.hops.map((h) => h.parentHopId)).toEqual([null, h1.id, m2.hops[1].id, m3.hops[2].id]);
		expect(m4.hops[0]).toMatchObject({ propertyIri: `${NS}#hostedOn`, direction: 'forward', targetClassIri: `${NS}#Server` });
		expect(new Set(m4.hops.map((h) => h.id)).size).toBe(4);
		expect(validateQueryModel(m4)).toEqual([]);
	});

	it('addHop with direction "inverse" records an inverse hop to the source class', () => {
		const m = addHop(base(), null, rel('hostedOn', 'Server'), 'inverse');
		expect(m.hops[0]).toMatchObject({ propertyIri: `${NS}#hostedOn`, direction: 'inverse', targetClassIri: `${NS}#Server` });
	});

	it('addHop refuses a hop that immediately undoes its parent, and a repeated inverse hop', () => {
		const m1 = addHop(base(), null, rel('hostedOn', 'Server'));
		expect(addHop(m1, m1.hops[0].id, rel('hostedOn', 'Application'), 'inverse')).toBe(m1);
		const m2 = addHop(base(), null, rel('dependsOn', 'Application'), 'inverse');
		expect(addHop(m2, m2.hops[0].id, rel('dependsOn', 'Application'), 'inverse')).toBe(m2);
		// the same property in the other direction on a sibling branch is fine
		expect(addHop(m1, null, rel('hostedOn', 'Server'), 'inverse').hops).toHaveLength(2);
	});

	it('allows sibling expansions on one node', () => {
		let m = addHop(base(), null, rel('hostedOn', 'Server'));
		m = addHop(m, null, rel('ownedBy', 'Person'));
		expect(m.hops).toHaveLength(2);
		expect(m.hops.every((h) => h.parentHopId === null)).toBe(true);
	});

	it('addHop is a no-op when canExtendPath rejects (same property twice on one path)', () => {
		const m1 = addHop(base(), null, rel('dependsOn', 'Application'));
		const m2 = addHop(m1, m1.hops[0].id, rel('dependsOn', 'Application'));
		expect(m2).toBe(m1);
		// the same expansion twice from one parent is refused too
		expect(addHop(m1, null, rel('dependsOn', 'Application'))).toBe(m1);
		// a different branch is independent
		const m3 = addHop(m1, m1.hops[0].id, rel('ownedBy', 'Person'));
		expect(addHop(m3, null, rel('ownedBy', 'Person')).hops).toHaveLength(3);
	});

	it('addHop reuses no id after a removal', () => {
		let m = addHop(base(), null, rel('a', 'X'));
		m = addHop(m, null, rel('b', 'Y'));
		m = removeHop(m, m.hops[0].id);
		m = addHop(m, null, rel('c', 'Z'));
		expect(new Set(m.hops.map((h) => h.id)).size).toBe(2);
	});

	it('removeHop cascades to descendants and to dependent columns, filters, sorts and group-bys', () => {
		let m = addHop(base(), null, rel('hostedOn', 'Server'));
		const h1 = m.hops[0].id;
		m = addHop(m, h1, rel('hasIP', 'IP'));
		const h2 = m.hops[1].id;
		m = addHop(m, null, rel('ownedBy', 'Person'));
		const h3 = m.hops[2].id;
		m = addColumn(m, { hopId: null, source: 'label', header: 'App' });
		m = addColumn(m, { hopId: h1, source: 'label', header: 'Server' });
		m = addColumn(m, { hopId: h2, source: 'iri', header: 'IP' });
		m = addColumn(m, { hopId: h3, source: 'label', header: 'Owner' });
		const [cApp, cServer, cIp, cOwner] = m.columns.map((c) => c.id);
		m = addFilter(m, { hopId: h2, propertyIri: null, op: 'isNotEmpty' });
		m = addFilter(m, { hopId: h3, propertyIri: null, op: 'eq', value: 'x' });
		m = {
			...m,
			sort: [{ columnId: cIp, direction: 'asc' }, { columnId: cApp, direction: 'desc' }],
			aggregation: { groupBy: [cApp, cServer], measures: [{ fn: 'count', of: cIp, alias: 'n' }] }
		};
		const before = JSON.stringify(m);

		const next = removeHop(m, h1);
		expect(next.hops.map((h) => h.id)).toEqual([h3]);
		expect(next.columns.map((c) => c.id)).toEqual([cApp, cOwner]);
		expect(next.filters.map((f) => f.hopId)).toEqual([h3]);
		expect(next.sort.map((s) => s.columnId)).toEqual([cApp]);
		expect(next.aggregation?.groupBy).toEqual([cApp]);
		expect(next.aggregation?.measures[0].of).toBe('root');
		expect(JSON.stringify(m)).toBe(before);
		expect(validateQueryModel(next)).toEqual([]);
	});
});

describe('upsertFilter', () => {
	const base = () => startQueryFromClass(APP, [NS]);
	it('adds when no filter exists for that hop+property, replaces in place when one does', () => {
		let m = upsertFilter(base(), { hopId: null, propertyIri: `${NS}#p`, op: 'eq', value: 'a' });
		const id = m.filters[0].id;
		m = upsertFilter(m, { hopId: null, propertyIri: `${NS}#p`, op: 'contains', value: 'b' });
		expect(m.filters).toHaveLength(1);
		expect(m.filters[0]).toMatchObject({ id, op: 'contains', value: 'b' });
		m = upsertFilter(m, { hopId: 'h1', propertyIri: `${NS}#p`, op: 'eq', value: 'c' });
		expect(m.filters).toHaveLength(2);
	});
	it('drops a stale value when the new draft has none (isEmpty)', () => {
		let m = upsertFilter(base(), { hopId: null, propertyIri: `${NS}#p`, op: 'eq', value: 'a' });
		m = upsertFilter(m, { hopId: null, propertyIri: `${NS}#p`, op: 'isEmpty' });
		expect(m.filters[0].value).toBeUndefined();
	});
	it('treats the entity filter (propertyIri null) as one per hop', () => {
		let m = upsertFilter(base(), { hopId: null, propertyIri: null, op: 'eq', value: `${NS}#A` });
		m = upsertFilter(m, { hopId: null, propertyIri: null, op: 'eq', value: `${NS}#B` });
		expect(m.filters).toHaveLength(1);
		expect(m.filters[0].value).toBe(`${NS}#B`);
	});
});

describe('column order and header', () => {
	const three = () => {
		let m = startQueryFromClass(APP, [NS]);
		m = addColumn(m, { hopId: null, source: 'label', header: 'A' });
		m = addColumn(m, { hopId: null, source: 'iri', header: 'B' });
		m = addColumn(m, { hopId: null, source: { propertyIri: `${NS}#x` }, header: 'C' });
		return m;
	};
	it('moveColumn reorders by one step, clamps at the ends and never mutates', () => {
		const m = three();
		const [a, b, c] = m.columns.map((x) => x.id);
		expect(moveColumn(m, c, -1).columns.map((x) => x.id)).toEqual([a, c, b]);
		expect(moveColumn(m, a, 1).columns.map((x) => x.id)).toEqual([b, a, c]);
		expect(moveColumn(m, a, -1)).toBe(m);
		expect(moveColumn(m, c, 1)).toBe(m);
		expect(m.columns.map((x) => x.id)).toEqual([a, b, c]);
	});
	it('setColumnHeader edits only that header', () => {
		const m = three();
		const next = setColumnHeader(m, m.columns[1].id, 'Renamed');
		expect(next.columns.map((c) => c.header)).toEqual(['A', 'Renamed', 'C']);
		expect(m.columns[1].header).toBe('B');
	});
});

describe('multi-column sort', () => {
	const two = () => {
		let m = startQueryFromClass(APP, [NS]);
		m = addColumn(m, { hopId: null, source: { propertyIri: `${NS}#lifecycle` }, header: 'Lifecycle' });
		m = addColumn(m, { hopId: null, source: { propertyIri: `${NS}#criticality` }, header: 'Criticality' });
		return m;
	};
	it('setSort appends in order, re-setting a column changes direction in place', () => {
		let m = two();
		const [l, c] = m.columns.map((x) => x.id);
		m = setSort(m, l, 'asc');
		m = setSort(m, c, 'desc');
		expect(m.sort).toEqual([{ columnId: l, direction: 'asc' }, { columnId: c, direction: 'desc' }]);
		m = setSort(m, l, 'desc');
		expect(m.sort).toEqual([{ columnId: l, direction: 'desc' }, { columnId: c, direction: 'desc' }]);
		expect(validateQueryModel(m)).toEqual([]);
	});
	it('moveSort changes precedence; removeSort drops one key', () => {
		let m = two();
		const [l, c] = m.columns.map((x) => x.id);
		m = setSort(setSort(m, l, 'asc'), c, 'desc');
		expect(moveSort(m, c, -1).sort.map((s) => s.columnId)).toEqual([c, l]);
		expect(removeSort(m, l).sort.map((s) => s.columnId)).toEqual([c]);
	});
	it('setSort ignores a column that does not exist', () => {
		const m = two();
		expect(setSort(m, 'nope', 'asc')).toBe(m);
	});
});

describe('aggregation mode', () => {
	const withCols = () => {
		let m = startQueryFromClass(APP, [NS]);
		m = addColumn(m, { hopId: null, source: { propertyIri: `${NS}#owner` }, header: 'Owner' });
		m = addColumn(m, { hopId: null, source: { propertyIri: `${NS}#lifecycle` }, header: 'Lifecycle' });
		return m;
	};
	it('enableAggregation starts with one COUNT of the root and no group-by, and stays valid', () => {
		const m = enableAggregation(withCols());
		expect(m.aggregation).toEqual({
			groupBy: [],
			measures: [{ fn: 'count', of: 'root', alias: 'total' }]
		});
		expect(validateQueryModel(m)).toEqual([]);
	});
	it('toggleGroupBy adds then removes; removing prunes sort keys that need the grouping', () => {
		let m = enableAggregation(withCols());
		const [owner, life] = m.columns.map((c) => c.id);
		m = toggleGroupBy(m, owner);
		m = setSort(m, owner, 'asc');
		expect(m.aggregation?.groupBy).toEqual([owner]);
		expect(validateQueryModel(m)).toEqual([]);
		m = toggleGroupBy(m, owner);
		expect(m.aggregation?.groupBy).toEqual([]);
		expect(m.sort).toEqual([]);
		expect(toggleGroupBy(withCols(), life).aggregation).toBeUndefined();
	});
	it('allowedSortKeys is restricted to grouped columns and measures in aggregate mode', () => {
		let m = enableAggregation(withCols());
		const [owner, life] = m.columns.map((c) => c.id);
		expect(allowedSortKeys(withCols()).map((k) => k.id)).toEqual([owner, life]);
		m = toggleGroupBy(m, owner);
		expect(allowedSortKeys(m).map((k) => k.id)).toEqual([owner, 'total']);
		expect(setSort(m, life, 'asc')).toBe(m);
		expect(validateQueryModel(setSort(m, 'total', 'desc'))).toEqual([]);
	});
	it('addMeasure generates unique valid aliases; removeMeasure prunes sort on it', () => {
		let m = enableAggregation(withCols());
		const owner = m.columns[0].id;
		m = addMeasure(m, 'countDistinct', owner);
		m = addMeasure(m, 'count', 'root');
		const aliases = m.aggregation!.measures.map((x) => x.alias);
		expect(new Set(aliases).size).toBe(3);
		expect(validateQueryModel(m)).toEqual([]);
		m = setSort(m, aliases[1], 'desc');
		m = removeMeasure(m, aliases[1]);
		expect(m.sort).toEqual([]);
		expect(m.aggregation!.measures).toHaveLength(2);
	});
	it('disableAggregation removes it and prunes sort keys that only existed as measures', () => {
		let m = enableAggregation(withCols());
		m = toggleGroupBy(m, m.columns[0].id);
		m = setSort(m, 'total', 'desc');
		const off = disableAggregation(m);
		expect(off.aggregation).toBeUndefined();
		expect(off.sort).toEqual([]);
		expect(validateQueryModel(off)).toEqual([]);
	});
});

describe('validateRunnableQueryModel', () => {
	it('flags a model with no columns with a helpful message', () => {
		const issues = validateRunnableQueryModel(startQueryFromClass(APP, [NS]));
		expect(issues.map((i) => i.path)).toContain('columns');
		expect(issues.find((i) => i.path === 'columns')?.message).toMatch(/at least one column/i);
	});
	it('accepts a model with a column', () => {
		const m = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'A' });
		expect(validateRunnableQueryModel(m)).toEqual([]);
	});
	it('flags an aggregation with no group-by and no measure', () => {
		let m = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'A' });
		m = { ...m, aggregation: { groupBy: [], measures: [] } };
		expect(validateRunnableQueryModel(m).map((i) => i.path)).toContain('aggregation');
	});
	it('still reports structural issues', () => {
		const m = { ...startQueryFromClass(APP, []), columns: [] };
		expect(validateRunnableQueryModel(m).map((i) => i.path)).toContain('namespaces');
	});
});

describe('chat-doc aggregation examples built through the edit helpers', () => {
	const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
	const i = (n: string) => `${NS}#${n}`;
	const fetched: FetchedSchema = {
		classes: ['Application', 'Server', 'Person'].map((n) => ({
			iri: i(n), label: n, comment: null, namespaceBaseIri: NS
		})),
		datatypeProperties: [
			{ iri: i('platform'), label: 'platform', domain: i('Server'), range: XSD_STRING, namespaceBaseIri: NS, required: false, repeatable: false }
		],
		objectProperties: [
			{ iri: i('ownedBy'), label: 'ownedBy', domain: i('Application'), range: i('Person'), namespaceBaseIri: NS, required: false, repeatable: false, relationKind: 'specific' }
		],
		subClassOf: [], individuals: [], individualClassRelations: [], individualIndividualRelations: []
	};
	const schema = buildBuilderSchema(fetched);
	const page = { limit: 50, offset: 0 };

	it('count Applications by Owner', () => {
		let m = startQueryFromClass(i('Application'), [NS]);
		m = addHop(m, null, { iri: i('ownedBy'), targetClassIri: i('Person') });
		m = addColumn(m, { hopId: m.hops[0].id, source: 'label', header: 'Owner' });
		m = enableAggregation(m);
		m = toggleGroupBy(m, m.columns[0].id);
		m = setSort(m, 'total', 'desc');
		expect(validateRunnableQueryModel(m, new Set(schema.classes.keys()))).toEqual([]);
		const q = compileQuery(m, schema, page);
		expect(q.rowKind).toBe('aggregate');
		expect(q.sparql).toContain('(COUNT(?root) AS ?m_total)');
		expect(q.sparql).toMatch(/GROUP BY \?c0/);
		expect(q.sparql).toMatch(/ORDER BY DESC\(\?m_total\)/);
	});

	it('count Servers by Platform', () => {
		let m = startQueryFromClass(i('Server'), [NS]);
		m = addColumn(m, { hopId: null, source: { propertyIri: i('platform') }, header: 'Platform' });
		m = enableAggregation(m);
		m = toggleGroupBy(m, m.columns[0].id);
		expect(validateRunnableQueryModel(m, new Set(schema.classes.keys()))).toEqual([]);
		const q = compileQuery(m, schema, page);
		expect(q.sparql).toContain('(COUNT(?root) AS ?m_total)');
		expect(q.sparql).toMatch(/GROUP BY \?c0/);
		expect(q.columns.map((c) => c.header)).toEqual(['Platform', 'total']);
	});
});

describe('cycleSort (header click)', () => {
	it('cycles none → asc → desc → none, appending new keys last', () => {
		let m = startQueryFromClass(APP, [NS]);
		m = addColumn(m, { hopId: null, source: 'label', header: 'A' });
		m = addColumn(m, { hopId: null, source: 'iri', header: 'B' });
		const [a, b] = m.columns.map((c) => c.id);
		m = cycleSort(m, a);
		expect(m.sort).toEqual([{ columnId: a, direction: 'asc' }]);
		m = cycleSort(m, b);
		expect(m.sort.map((s) => s.columnId)).toEqual([a, b]);
		m = cycleSort(m, a);
		expect(m.sort).toEqual([{ columnId: a, direction: 'desc' }, { columnId: b, direction: 'asc' }]);
		m = cycleSort(m, a);
		expect(m.sort).toEqual([{ columnId: b, direction: 'asc' }]);
	});
	it('ignores columns that cannot be sorted in aggregate mode', () => {
		let m = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'A' });
		m = enableAggregation(m);
		expect(cycleSort(m, m.columns[0].id)).toBe(m);
		expect(cycleSort(m, 'total').sort).toEqual([{ columnId: 'total', direction: 'asc' }]);
	});
});

describe('hopViaLabel', () => {
	const cls = (iri: string, label: string, over: Partial<import('./query-builder-schema').BuilderClass> = {}) => ({
		iri: `${NS}#${iri}`, label, namespaceBaseIri: NS, properties: [], relationships: [], inboundRelationships: [],
		subclasses: [], members: [], isEnumeration: false, ...over
	});
	const schema = {
		classes: new Map([
			[`${NS}#Application`, cls('Application', 'Application', {
				relationships: [{
					iri: `${NS}#hostedOn`, label: 'hosted on', targetClassIri: `${NS}#Server`, targetLabel: 'Server',
					required: false, repeatable: true
				}]
			})],
			[`${NS}#Server`, cls('Server', 'Server', {
				inboundRelationships: [{
					iri: `${NS}#hostedOn`, label: 'hosted on', sourceClassIri: `${NS}#Application`, sourceLabel: 'Application',
					displayLabel: 'hosted on', required: false, repeatable: true
				}]
			})]
		])
	};

	it('labels a forward hop with the relationship and an inverse hop with a leftwards arrow', () => {
		const fwd = startQueryFromClass(`${NS}#Application`, [NS]);
		const m1 = addHop(fwd, null, { iri: `${NS}#hostedOn`, targetClassIri: `${NS}#Server` });
		expect(hopViaLabel(m1, schema, m1.hops[0])).toBe('hosted on →');
		const inv = addHop(startQueryFromClass(`${NS}#Server`, [NS]), null, { iri: `${NS}#hostedOn`, targetClassIri: `${NS}#Application` }, 'inverse');
		expect(hopViaLabel(inv, schema, inv.hops[0])).toBe('← hosted on');
	});

	it('falls back to the IRI when the schema does not know the relationship', () => {
		const m = addHop(startQueryFromClass(`${NS}#Server`, [NS]), null, { iri: `${NS}#gone`, targetClassIri: `${NS}#Application` }, 'inverse');
		expect(hopViaLabel(m, schema, m.hops[0])).toBe(`← ${NS}#gone`);
	});
});
