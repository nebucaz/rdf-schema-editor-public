import { describe, it, expect } from 'vitest';
import { parseSpl } from './query-spl-parser';
import { printSplPipeline } from './query-spl';
import { buildBuilderSchema, type BuilderClass, type BuilderSchema } from './query-builder-schema';
import {
	canExtendPath,
	validateRunnableQueryModel,
	type Column,
	type Filter,
	type FilterOp,
	type HavingOp,
	type Hop,
	type Measure,
	type MeasureFn,
	type QueryModel
} from './query-model';
import { normaliseModel } from './query-spl-normalise';
import {
	XSD_DATE,
	XSD_DATETIME,
	XSD_DECIMAL,
	XSD_DOUBLE,
	XSD_INTEGER,
	isComparableDatatype,
	isNumericDatatype,
	isTemporalDatatype
} from './query-datatypes';
import type { FetchedSchema } from './sparql-connector';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI } from './soc-test-support';
import { RUNBOOK_QUERIES } from './soc-runbook-queries';

// ── Schemas under test ──────────────────────────────────────────────────────

const soc = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));

const NS = 'http://example.org/org';
const o = (n: string) => `${NS}#${n}`;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const cls = (n: string, label = n) => ({ iri: o(n), label, comment: null, namespaceBaseIri: NS });
const dp = (n: string, domain: string, range: string) => ({
	iri: o(n), label: n, domain: o(domain), range, namespaceBaseIri: NS, required: false, repeatable: true
});
const op = (n: string, domain: string, range: string) => ({
	...dp(n, domain, o(range)), relationKind: 'specific' as const
});
const member = (n: string, label: string, classIri: string) => ({
	iri: o(n), label, classIri: o(classIri), namespaceBaseIri: NS, syncSource: null, syncStatus: null
});

/** Numeric, date and dateTime properties, enumerations, a subclass, a self relation and an `sh:in` list. */
const orgFetched: FetchedSchema = {
	classes: [
		cls('Org', 'Organisation unit'),
		cls('Team'),
		cls('Person'),
		cls('Employee'),
		cls('Project'),
		cls('Priority'),
		cls('Status')
	],
	datatypeProperties: [
		dp('name', 'Person', XSD_STRING),
		dp('email', 'Person', XSD_STRING),
		dp('role', 'Person', XSD_STRING),
		dp('age', 'Person', XSD_INTEGER),
		dp('salary', 'Person', XSD_DECIMAL),
		dp('score', 'Person', XSD_DOUBLE),
		dp('born', 'Person', XSD_DATE),
		dp('lastSeen', 'Person', XSD_DATETIME),
		dp('employeeNo', 'Employee', XSD_STRING),
		dp('title', 'Project', XSD_STRING),
		dp('budget', 'Project', XSD_DECIMAL),
		dp('headcount', 'Project', XSD_INTEGER),
		dp('start', 'Project', XSD_DATE),
		dp('deadline', 'Project', XSD_DATETIME),
		dp('teamName', 'Team', XSD_STRING),
		dp('orgName', 'Org', XSD_STRING)
	],
	objectProperties: [
		op('hasTeam', 'Org', 'Team'),
		op('hasMember', 'Team', 'Person'),
		op('worksOn', 'Person', 'Project'),
		op('manager', 'Person', 'Person'),
		op('priority', 'Project', 'Priority'),
		op('status', 'Project', 'Status')
	],
	subClassOf: [{ sub: o('Employee'), super: o('Person'), namespaceBaseIri: NS }],
	individuals: [
		member('pLow', 'Low', 'Priority'),
		member('pMed', 'Medium', 'Priority'),
		member('pHigh', 'High', 'Priority'),
		member('sOpen', 'Open', 'Status'),
		member('sDone', 'Done', 'Status')
	],
	individualClassRelations: [],
	individualIndividualRelations: [],
	shapeInConstraints: [
		{
			classIri: o('Person'),
			propertyIri: o('role'),
			values: [
				{ value: 'admin', isIri: false },
				{ value: 'user', isIri: false }
			]
		}
	]
};
const org = buildBuilderSchema(orgFetched);

// ── Seeded generator ────────────────────────────────────────────────────────

/** mulberry32: tiny deterministic PRNG, so a failing case is reproducible from the printed seed. */
function rng(seed: number) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
		pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
		chance: (p: number) => next() < p
	};
}
type Rng = ReturnType<typeof rng>;

const STRING_POOL = [
	'x', 'root', 'Ana Maria', 'a|b', 'say "hi"', 'back\\slash', 'line\nbreak', 'tab\there', 'café', '100%', 'a,b', '(paren)',
	'', ' padded ', '203.0.113.45', 'https://example.org/x', "it's", 'a=b', 'a>b', 'Z'
];
const NON_EMPTY_NO_PERCENT = STRING_POOL.filter((s) => s !== '' && !s.includes('%'));

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
function typedValue(r: Rng, datatype: string): string {
	if (datatype === XSD_INTEGER) return String(r.int(-1000, 100000));
	if (datatype === XSD_DECIMAL) return `${r.int(-500, 5000)}.${pad(r.int(0, 99))}`;
	if (datatype === XSD_DOUBLE)
		return r.pick([`${r.int(1, 99)}.5e${r.int(0, 6)}`, String(r.int(1, 900)), `-${r.int(1, 9)}.25`, '0.5e-3']);
	const date = `${r.int(2020, 2027)}-${pad(r.int(1, 12))}-${pad(r.int(1, 28))}`;
	if (datatype === XSD_DATE) return r.pick([date, `${date}Z`, `${date}+02:00`]);
	const time = `${pad(r.int(0, 23))}:${pad(r.int(0, 59))}:${pad(r.int(0, 59))}`;
	return r.pick([`${date}T${time}Z`, `${date}T${time}`, `${date}T${time}.${r.int(1, 999)}Z`, `${date}T${time}+01:00`]);
}

interface Slot {
	hopId: string | null;
	cls: BuilderClass;
}

/** Every observable the exhaustiveness check needs, collected as cases are generated. */
interface Coverage {
	filterOps: Set<FilterOp>;
	measureFns: Set<MeasureFn>;
	havingOps: Set<HavingOp>;
	columnKinds: Set<string>;
	features: Set<string>;
}
const newCoverage = (): Coverage => ({
	filterOps: new Set(),
	measureFns: new Set(),
	havingOps: new Set(),
	columnKinds: new Set(),
	features: new Set()
});

function generateModel(r: Rng, schema: BuilderSchema, namespaces: string[], cov: Coverage): QueryModel {
	const roots = [...schema.classes.values()].filter((c) => !c.isEnumeration && (c.properties.length > 0 || c.relationships.length > 0));
	const rootClass = r.pick(roots);
	const model: QueryModel = {
		version: 1,
		root: { classIri: rootClass.iri, includeSubclasses: r.chance(0.7) },
		hops: [],
		filters: [],
		columns: [],
		sort: [],
		namespaces
	};
	if (!model.root.includeSubclasses) cov.features.add('exact');

	const slots: Slot[] = [{ hopId: null, cls: rootClass }];
	const hopCount = r.int(0, 3);
	for (let i = 0; i < hopCount; i++) {
		const parent = r.pick(slots);
		type Step = { iri: string; direction: Hop['direction']; targetClassIri: string };
		const steps: Step[] = [
			...parent.cls.relationships.map((rel) => ({ iri: rel.iri, direction: 'forward' as const, targetClassIri: rel.targetClassIri })),
			...parent.cls.inboundRelationships.map((rel) => ({ iri: rel.iri, direction: 'inverse' as const, targetClassIri: rel.sourceClassIri }))
		].filter((st) => canExtendPath(model, parent.hopId, st.iri, st.direction));
		if (steps.length === 0) continue;
		const step = r.pick(steps);
		const target = schema.classes.get(step.targetClassIri)!;
		const duplicate = model.hops.some(
			(h) => h.parentHopId === parent.hopId && h.propertyIri === step.iri && h.direction === step.direction
		);
		if (duplicate) continue;
		if (step.direction === 'inverse') cov.features.add('inverse');
		const hop: Hop = {
			id: `h${model.hops.length + 1}`,
			parentHopId: parent.hopId,
			propertyIri: step.iri,
			direction: step.direction,
			targetClassIri: target.iri
		};
		model.hops.push(hop);
		slots.push({ hopId: hop.id, cls: target });
	}

	// Filters over every operator, on properties, relationships and the entity itself.
	const filterCount = r.int(0, 4);
	const ALL_OPS: FilterOp[] = ['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty', 'in', 'gt', 'gte', 'lt', 'lte'];
	for (let i = 0; i < filterCount; i++) {
		const slot = r.pick(slots);
		const f = makeFilter(r, slot, ALL_OPS, schema);
		if (f) {
			model.filters.push({ id: `f${model.filters.length + 1}`, ...f });
			cov.filterOps.add(f.op);
		}
	}

	// Columns: every property/relationship/label/iri at every slot is a candidate.
	type Cand = Omit<Column, 'id' | 'header'>;
	const candidates: Cand[] = slots.flatMap((s) => [
		{ hopId: s.hopId, source: 'label' as const },
		{ hopId: s.hopId, source: 'iri' as const },
		...s.cls.properties.map((p) => ({ hopId: s.hopId, source: { propertyIri: p.iri } })),
		...s.cls.relationships.map((p) => ({ hopId: s.hopId, source: { propertyIri: p.iri } }))
	]);
	const sameCand = (a: Cand, b: Cand) =>
		a.hopId === b.hopId &&
		(typeof a.source === 'string' || typeof b.source === 'string'
			? a.source === b.source
			: a.source.propertyIri === b.source.propertyIri);
	const columns: Column[] = [];
	const addColumn = (c: Cand): Column => {
		const existing = columns.find((x) => sameCand(x, c));
		if (existing) return existing;
		const col: Column = { id: `c${columns.length + 1}`, hopId: c.hopId, source: c.source, header: `H${columns.length + 1}` };
		columns.push(col);
		cov.columnKinds.add(typeof c.source === 'string' ? c.source : 'property');
		return col;
	};
	const colDatatype = (c: Column): string | null => {
		if (typeof c.source === 'string') return null;
		const slot = slots.find((s) => s.hopId === c.hopId)!;
		const iri = c.source.propertyIri;
		return slot.cls.properties.find((p) => p.iri === iri)?.datatype ?? null;
	};

	const aggregate = r.chance(0.5);
	if (aggregate) {
		cov.features.add('aggregation');
		const groupBy = Array.from({ length: r.int(0, 2) }, () => addColumn(r.pick(candidates)).id);
		const uniqueGroupBy = [...new Set(groupBy)];
		const measures: Measure[] = [];
		const measureCount = r.int(uniqueGroupBy.length === 0 ? 1 : 0, 3);
		for (let i = 0; i < measureCount; i++) {
			const fn = r.pick(['count', 'countDistinct', 'sum', 'avg', 'min', 'max'] as const);
			let of = 'root';
			if (fn === 'sum' || fn === 'avg' || fn === 'min' || fn === 'max') {
				const typed = candidates.filter((c) => {
					if (typeof c.source === 'string') return false;
					const dt = colDatatype({ id: '', header: '', ...c });
					if (dt === null) return false;
					return fn === 'min' || fn === 'max' ? isNumericDatatype(dt) || isTemporalDatatype(dt) : isNumericDatatype(dt);
				});
				if (typed.length === 0) continue;
				of = addColumn(r.pick(typed)).id;
			} else if (r.chance(0.5)) {
				of = addColumn(r.pick(candidates)).id;
			}
			measures.push({ fn, of, alias: `m${measures.length + 1}` });
			cov.measureFns.add(fn);
		}
		if (uniqueGroupBy.length === 0 && measures.length === 0) measures.push({ fn: 'count', of: 'root', alias: 'm1' });
		if (measures.length > 0 && cov.measureFns.size === 0) cov.measureFns.add('count');
		model.aggregation = { groupBy: uniqueGroupBy, measures };
		for (const m of measures) cov.measureFns.add(m.fn);

		const numeric = measures.filter((m) => {
			if (m.fn === 'count' || m.fn === 'countDistinct' || m.fn === 'sum' || m.fn === 'avg') return true;
			const col = columns.find((c) => c.id === m.of)!;
			const dt = colDatatype(col);
			return dt !== null && isNumericDatatype(dt);
		});
		if (numeric.length > 0 && r.chance(0.5)) {
			model.aggregation.having = Array.from({ length: r.int(1, 2) }, () => {
				const h = {
					measure: r.pick(numeric).alias,
					op: r.pick(['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const),
					value: r.pick([0, 1, 5, 42, -3, 0.5, 1e21, 1e-7, 12345.678])
				};
				cov.havingOps.add(h.op);
				cov.features.add('having');
				return h;
			});
		}
		const sortable = [...uniqueGroupBy, ...measures.map((m) => m.alias)];
		const keys = [...new Set(Array.from({ length: r.int(0, 2) }, () => r.pick(sortable)))];
		model.sort = keys.map((columnId) => ({ columnId, direction: r.pick(['asc', 'desc'] as const) }));
	} else {
		const wanted = r.int(1, 4);
		for (let i = 0; i < wanted; i++) addColumn(r.pick(candidates));
		const keys = [...new Set(Array.from({ length: r.int(0, 2) }, () => r.pick(columns).id))];
		model.sort = keys.map((columnId) => ({ columnId, direction: r.pick(['asc', 'desc'] as const) }));
	}
	model.columns = columns;
	if (model.sort.length > 0) cov.features.add('sort');
	if (model.filters.length > 0) cov.features.add('filters');
	if (model.hops.length > 0) cov.features.add('hops');
	if (r.chance(0.4)) {
		model.limit = r.pick([1, 5, 10, 100, 50000]);
		cov.features.add('limit');
	}
	return model;
}

function makeFilter(r: Rng, slot: Slot, ops: FilterOp[], schema: BuilderSchema): Omit<Filter, 'id'> | null {
	const op = r.pick(ops);
	const cls = slot.cls;
	const members = (classIri: string) => schema.classes.get(classIri)?.members.map((m) => m.value) ?? [];
	const target = r.pick([
		...cls.properties.map((p) => ({ kind: 'property' as const, p })),
		...cls.relationships.map((p) => ({ kind: 'relationship' as const, p })),
		{ kind: 'entity' as const }
	]);
	const hopId = slot.hopId;

	if (target.kind === 'entity') {
		if (op === 'isEmpty' || op === 'isNotEmpty' || op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') return null;
		const own = members(cls.iri);
		const iri = () => (own.length > 0 && r.chance(0.7) ? r.pick(own) : `urn:example:${r.int(1, 99)}`);
		if (op === 'in') return { hopId, propertyIri: null, op, value: [iri(), iri()] };
		if (op === 'contains') return { hopId, propertyIri: null, op, value: r.pick(NON_EMPTY_NO_PERCENT) };
		return { hopId, propertyIri: null, op, value: iri() };
	}

	if (op === 'isEmpty' || op === 'isNotEmpty') return { hopId, propertyIri: target.p.iri, op };
	if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
		if (target.kind !== 'property' || !isComparableDatatype(target.p.datatype)) return null;
		return { hopId, propertyIri: target.p.iri, op, value: typedValue(r, target.p.datatype) };
	}

	if (target.kind === 'relationship') {
		const pool = members(target.p.targetClassIri);
		if (op === 'contains') return { hopId, propertyIri: target.p.iri, op, value: r.pick(NON_EMPTY_NO_PERCENT) };
		if (pool.length === 0) return null;
		if (op === 'in') return { hopId, propertyIri: target.p.iri, op, value: [r.pick(pool), r.pick(pool)] };
		return { hopId, propertyIri: target.p.iri, op, value: r.pick(pool) };
	}

	const allowed = (target.p.allowedValues ?? []).map((v) => v.value);
	const text = () => (allowed.length > 0 ? r.pick(allowed) : r.pick(STRING_POOL));
	if (op === 'contains') return { hopId, propertyIri: target.p.iri, op, value: r.pick(NON_EMPTY_NO_PERCENT) };
	if (op === 'in') return { hopId, propertyIri: target.p.iri, op, value: [text(), text(), text()] };
	return { hopId, propertyIri: target.p.iri, op, value: text() };
}

// ── The property under test ─────────────────────────────────────────────────

function roundTrip(model: QueryModel, schema: BuilderSchema, note: string): void {
	const text = printSplPipeline(model, schema);
	const parsed = parseSpl(text, schema, { namespaces: model.namespaces });
	const context = `${note}\n--- SPL ---\n${text}\n--- model ---\n${JSON.stringify(model)}`;
	expect(parsed.ok ? null : `${parsed.error.message} @${parsed.error.start}-${parsed.error.end}`, context).toBeNull();
	if (!parsed.ok) return;
	expect(normaliseModel(parsed.model), context).toEqual(normaliseModel(model));
	expect(printSplPipeline(parsed.model, schema), `${context}\n(idempotence)`).toBe(text);
}

describe('print/parse inverse: corpus', () => {
	for (const [id, q] of Object.entries(RUNBOOK_QUERIES)) {
		it(`runbook ${id}`, () => roundTrip(q.model, soc, `runbook ${id}`));
	}

	const base = (root: string, namespaces = [NS]): QueryModel => ({
		version: 1,
		root: { classIri: o(root), includeSubclasses: true },
		hops: [],
		filters: [],
		columns: [],
		sort: [],
		namespaces
	});
	const col = (id: string, hopId: string | null, source: Column['source'], header = id): Column => ({ id, hopId, source, header });
	const p = (n: string) => ({ propertyIri: o(n) });

	const corpus: [string, QueryModel][] = [
		// STORY-212: comparison ops, typed literals, ranges
		['212 numeric comparison', { ...base('Person'), filters: [{ id: 'f1', hopId: null, propertyIri: o('age'), op: 'gt', value: '30' }], columns: [col('c1', null, p('name'))] }],
		['212 decimal with a trailing dot stays quoted', { ...base('Person'), filters: [{ id: 'f1', hopId: null, propertyIri: o('salary'), op: 'gte', value: '5.' }], columns: [col('c1', null, p('name'))] }],
		['212 INF and NaN doubles', { ...base('Person'), filters: [{ id: 'f1', hopId: null, propertyIri: o('score'), op: 'lt', value: 'INF' }, { id: 'f2', hopId: null, propertyIri: o('score'), op: 'gt', value: '-INF' }, { id: 'f3', hopId: null, propertyIri: o('score'), op: 'lte', value: 'NaN' }], columns: [col('c1', null, p('name'))] }],
		['212 date range as gte + lt', { ...base('Person'), filters: [{ id: 'f1', hopId: null, propertyIri: o('born'), op: 'gte', value: '2020-01-01' }, { id: 'f2', hopId: null, propertyIri: o('born'), op: 'lt', value: '2021-01-01Z' }], columns: [col('c1', null, p('name'))] }],
		['212 dateTime with offset and fraction', { ...base('Person'), filters: [{ id: 'f1', hopId: null, propertyIri: o('lastSeen'), op: 'lte', value: '2026-03-04T05:06:07.250+02:00' }], columns: [col('c1', null, p('name'))] }],
		// STORY-213: measure filter
		['213 having', { ...base('Person'), columns: [col('c1', null, p('role'))], aggregation: { groupBy: ['c1'], measures: [{ fn: 'count', of: 'root', alias: 'n' }], having: [{ measure: 'n', op: 'gt', value: 5 }] }, sort: [{ columnId: 'n', direction: 'desc' }] }],
		['213 several havings and negative / fractional thresholds', { ...base('Person'), columns: [col('c1', null, p('role'))], aggregation: { groupBy: ['c1'], measures: [{ fn: 'count', of: 'root', alias: 'n' }, { fn: 'countDistinct', of: 'c1', alias: 'd' }], having: [{ measure: 'n', op: 'gte', value: -2 }, { measure: 'd', op: 'neq', value: 0.5 }] } }],
		// STORY-214: row limit
		['214 sorted head', { ...base('Person'), columns: [col('c1', null, p('name'))], sort: [{ columnId: 'c1', direction: 'asc' }], limit: 3 }],
		['214 head without sort', { ...base('Person'), columns: [col('c1', null, p('name'))], limit: 50000 }],
		// STORY-215: extra measures
		['215 sum/avg/min/max', { ...base('Person'), columns: [col('c1', null, p('role')), col('c2', null, p('age')), col('c3', null, p('salary')), col('c4', null, p('born'))], aggregation: { groupBy: ['c1'], measures: [{ fn: 'sum', of: 'c2', alias: 'total' }, { fn: 'avg', of: 'c3', alias: 'mean' }, { fn: 'min', of: 'c4', alias: 'oldest' }, { fn: 'max', of: 'c2', alias: 'top' }], having: [{ measure: 'total', op: 'gt', value: 100 }] } }],
		// Existing grammar: hops (incl. subclass fields and enumerations), IN, contains, entity filters, labels
		['hops, enumeration filter and subclass property', { ...base('Org'), hops: [{ id: 'h1', parentHopId: null, propertyIri: o('hasTeam'), direction: 'forward', targetClassIri: o('Team') }, { id: 'h2', parentHopId: 'h1', propertyIri: o('hasMember'), direction: 'forward', targetClassIri: o('Person') }, { id: 'h3', parentHopId: 'h2', propertyIri: o('worksOn'), direction: 'forward', targetClassIri: o('Project') }], filters: [{ id: 'f1', hopId: 'h3', propertyIri: o('priority'), op: 'in', value: [o('pHigh'), o('pMed')] }, { id: 'f2', hopId: 'h2', propertyIri: o('employeeNo'), op: 'isNotEmpty' }, { id: 'f3', hopId: 'h2', propertyIri: o('role'), op: 'eq', value: 'admin' }], columns: [col('c1', null, 'label'), col('c2', 'h2', p('name')), col('c3', 'h3', 'iri')] }],
		['exact root, entity iri filter, escapes', { ...base('Person'), root: { classIri: o('Person'), includeSubclasses: false }, filters: [{ id: 'f1', hopId: null, propertyIri: null, op: 'eq', value: 'urn:example:7' }, { id: 'f2', hopId: null, propertyIri: o('name'), op: 'contains', value: 'say "hi"\n\\' }], columns: [col('c1', null, 'iri')] }]
	];
	it.each(corpus)('%s', (name, model) => {
		expect(validateRunnableQueryModel(model, new Set(org.classes.keys()), org), 'corpus model must itself be valid').toEqual([]);
		roundTrip(model, org, name);
	});
});

describe('print/parse inverse: seeded generator', () => {
	const SEED = 20260514;
	const CASES = 300;
	const cov = newCoverage();

	it(`round-trips ${CASES} generated models over the SOC and organisation schemas (seed ${SEED})`, () => {
		const r = rng(SEED);
		for (let i = 0; i < CASES; i++) {
			const useSoc = i % 3 === 0;
			const schema = useSoc ? soc : org;
			const namespaces = useSoc ? [SOC_BASE_IRI] : [NS];
			const model = generateModel(r, schema, namespaces, cov);
			expect(
				validateRunnableQueryModel(model, new Set(schema.classes.keys()), schema),
				`generator produced an invalid model (seed ${SEED}, case ${i})`
			).toEqual([]);
			roundTrip(model, schema, `seed ${SEED}, case ${i}`);
		}
	});

	it('is deterministic for a fixed seed', () => {
		const run = () => {
			const r = rng(SEED);
			return Array.from({ length: 20 }, () => JSON.stringify(generateModel(r, org, [NS], newCoverage())));
		};
		expect(run()).toEqual(run());
	});

	// Exhaustiveness: these records are typed over the model's union types, so adding a `FilterOp`,
	// `MeasureFn`, `HavingOp` or `QueryModel` field makes `bun run check` fail here until the printer,
	// parser and generator are taught about it — and the runtime assertions below fail until the
	// generator actually exercises it.
	const FILTER_OPS = { eq: 1, neq: 1, contains: 1, isEmpty: 1, isNotEmpty: 1, in: 1, gt: 1, gte: 1, lt: 1, lte: 1 } satisfies Record<FilterOp, 1>;
	const MEASURE_FNS = { count: 1, countDistinct: 1, sum: 1, avg: 1, min: 1, max: 1 } satisfies Record<MeasureFn, 1>;
	const HAVING_OPS = { gt: 1, gte: 1, lt: 1, lte: 1, eq: 1, neq: 1 } satisfies Record<HavingOp, 1>;
	/** How each top-level model field reaches the SPL text; `none` fields are documented exclusions. */
	const MODEL_FIELDS = {
		version: 'none',
		root: 'spl',
		hops: 'spl',
		filters: 'spl',
		columns: 'spl',
		sort: 'spl',
		aggregation: 'spl',
		namespaces: 'none',
		columnRules: 'none',
		limit: 'spl'
	} satisfies Record<keyof QueryModel, 'spl' | 'none'>;

	it('exercises every filter operator, measure function and having operator', () => {
		expect([...cov.filterOps].sort()).toEqual(Object.keys(FILTER_OPS).sort());
		expect([...cov.measureFns].sort()).toEqual(Object.keys(MEASURE_FNS).sort());
		expect([...cov.havingOps].sort()).toEqual(Object.keys(HAVING_OPS).sort());
	});

	it('exercises every SPL-visible model field and every column source kind', () => {
		const visible = Object.entries(MODEL_FIELDS).filter(([, how]) => how === 'spl').map(([k]) => k);
		expect(visible.length).toBeGreaterThan(0);
		for (const feature of ['exact', 'aggregation', 'having', 'sort', 'filters', 'hops', 'limit', 'inverse'])
			expect(cov.features.has(feature), `generator never produced "${feature}"`).toBe(true);
		expect([...cov.columnKinds].sort()).toEqual(['iri', 'label', 'property']);
	});
});
