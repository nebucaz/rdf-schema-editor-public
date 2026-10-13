import { describe, it, expect } from 'vitest';
import {
	emptyQueryModel,
	serializeQueryModel,
	parseQueryModel,
	validateQueryModel,
	canExtendPath,
	encodeModelForUrl,
	decodeModelFromUrl,
	MAX_SHARE_PARAM_LENGTH,
	type QueryModel
} from './query-model';
import type { BuilderClass, BuilderSchema } from './query-builder-schema';

const NS = 'http://example.org/ns';

function fullModel(): QueryModel {
	return {
		version: 1,
		root: { classIri: `${NS}#Application`, includeSubclasses: true },
		hops: [
			{ id: 'h1', parentHopId: null, propertyIri: `${NS}#hostedOn`, direction: 'forward', targetClassIri: `${NS}#Server` },
			{ id: 'h2', parentHopId: 'h1', propertyIri: `${NS}#hasIP`, direction: 'forward', targetClassIri: `${NS}#IP` }
		],
		filters: [
			{ id: 'f1', hopId: null, propertyIri: `${NS}#lifecycle`, op: 'eq', value: 'Production' },
			{ id: 'f2', hopId: 'h1', propertyIri: null, op: 'in', value: [`${NS}#a`, `${NS}#b`] }
		],
		columns: [
			{ id: 'c1', hopId: null, source: 'label', header: 'Name' },
			{ id: 'c2', hopId: 'h1', source: { propertyIri: `${NS}#hostname` }, header: 'Host' }
		],
		sort: [{ columnId: 'c1', direction: 'asc' }],
		aggregation: { groupBy: ['c1'], measures: [{ fn: 'count', of: 'root', alias: 'total' }] },
		namespaces: [NS],
		columnRules: []
	};
}

describe('query model serialisation', () => {
	it('emptyQueryModel builds a version-1 model for a root class', () => {
		const m = emptyQueryModel(`${NS}#Application`);
		expect(m.version).toBe(1);
		expect(m.root.classIri).toBe(`${NS}#Application`);
		expect(m.hops).toEqual([]);
	});

	it('round-trips a fully populated model', () => {
		const m = fullModel();
		const r = parseQueryModel(serializeQueryModel(m));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.model).toEqual(m);
	});

	it.each([
		['invalid JSON', '{not json'],
		['non-object', '42'],
		['wrong version', JSON.stringify({ ...fullModel(), version: 2 })],
		['wrong root type', JSON.stringify({ ...fullModel(), root: 'x' })],
		['hops not an array', JSON.stringify({ ...fullModel(), hops: {} })],
		['namespaces of wrong type', JSON.stringify({ ...fullModel(), namespaces: [1] })],
		['null', 'null']
	])('returns an error value for %s', (_n, text) => {
		const r = parseQueryModel(text);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
	});
});

describe('validateQueryModel', () => {
	const paths = (m: QueryModel, known?: ReadonlySet<string>) =>
		validateQueryModel(m, known).map((e) => e.path);

	it('returns [] for a valid model', () => {
		expect(validateQueryModel(fullModel())).toEqual([]);
	});

	it('reports a hop whose parent is missing', () => {
		const m = fullModel();
		m.hops[1].parentHopId = 'nope';
		expect(paths(m)).toContain('hops[1].parentHopId');
	});

	it('reports duplicate ids and parent cycles', () => {
		const m = fullModel();
		m.hops[0].parentHopId = 'h2';
		expect(paths(m)).toContain('hops[0].parentHopId');
		const d = fullModel();
		d.hops[1].id = 'h1';
		expect(paths(d)).toContain('hops[1].id');
	});

	it('reports filters and columns referencing a missing hop', () => {
		const m = fullModel();
		m.filters[0].hopId = 'ghost';
		m.columns[0].hopId = 'ghost';
		expect(paths(m)).toEqual(expect.arrayContaining(['filters[0].hopId', 'columns[0].hopId']));
	});

	it('reports unknown column ids in sort and groupBy', () => {
		const m = fullModel();
		m.sort = [{ columnId: 'zzz', direction: 'asc' }];
		m.aggregation = { groupBy: ['zzz'], measures: [] };
		expect(paths(m)).toEqual(expect.arrayContaining(['sort[0].columnId', 'aggregation.groupBy[0]']));
	});

	it('reports a measure referencing a missing column', () => {
		const m = fullModel();
		m.aggregation = { groupBy: ['c1'], measures: [{ fn: 'countDistinct', of: 'zzz', alias: 'n' }] };
		expect(paths(m)).toContain('aggregation.measures[0].of');
	});

	it('reports invalid or duplicate measure aliases', () => {
		const m = fullModel();
		m.aggregation = {
			groupBy: [],
			measures: [
				{ fn: 'count', of: 'root', alias: 'bad alias' },
				{ fn: 'count', of: 'root', alias: 'n' },
				{ fn: 'count', of: 'root', alias: 'n' }
			]
		};
		const p = paths(m);
		expect(p).toContain('aggregation.measures[0].alias');
		expect(p).toContain('aggregation.measures[2].alias');
	});

	it('rejects sorting by a non-grouped column in an aggregated model', () => {
		const m = fullModel();
		m.columns.push({ id: 'c3', hopId: null, source: 'iri', header: 'IRI' });
		m.sort = [{ columnId: 'c3', direction: 'asc' }];
		expect(paths(m)).toContain('sort[0].columnId');
		m.sort = [{ columnId: 'total', direction: 'desc' }, { columnId: 'c1', direction: 'asc' }];
		expect(paths(m)).not.toContain('sort[0].columnId');
		expect(paths(m)).not.toContain('sort[1].columnId');
	});

	it('reports empty namespaces and an empty root', () => {
		const m = fullModel();
		m.namespaces = [];
		m.root.classIri = '';
		expect(paths(m)).toEqual(expect.arrayContaining(['namespaces', 'root.classIri']));
	});

	it('reports unknown classes only when a schema is supplied', () => {
		const m = fullModel();
		expect(paths(m)).not.toContain('root.classIri');
		expect(paths(m, new Set())).toContain('root.classIri');
		expect(paths(m, new Set([`${NS}#Application`]))).toContain('hops[0].targetClassIri');
	});

	it('requires a value for eq/neq/contains/in', () => {
		const m = fullModel();
		m.filters = [{ id: 'f', hopId: null, propertyIri: null, op: 'eq' }];
		expect(paths(m)).toContain('filters[0].value');
	});
});

describe('inverse hops', () => {
	const inverseModel = (): QueryModel => ({
		...emptyQueryModel(`${NS}#Server`, [NS]),
		hops: [
			{ id: 'h1', parentHopId: null, propertyIri: `${NS}#hostedOn`, direction: 'inverse', targetClassIri: `${NS}#Application` }
		],
		columns: [{ id: 'c1', hopId: 'h1', source: 'label', header: 'App' }]
	});
	const cls = (iri: string, relationships: BuilderClass['relationships'] = [], subclasses: string[] = []): BuilderClass => ({
		iri, label: iri, namespaceBaseIri: NS, properties: [], relationships, inboundRelationships: [], subclasses, members: [], isEnumeration: false
	});
	const rel = (iri: string, targetClassIri: string) => ({
		iri, label: iri, targetClassIri, targetLabel: targetClassIri, required: false, repeatable: true
	});
	const schemaOf = (...classes: BuilderClass[]): BuilderSchema => ({
		classes: new Map(classes.map((c) => [c.iri, c]))
	});
	const validate = (m: QueryModel, schema?: BuilderSchema) =>
		validateQueryModel(m, undefined, schema);

	it('round-trips an inverse hop through serialise/parse', () => {
		const m = inverseModel();
		const parsed = parseQueryModel(serializeQueryModel(m));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.model).toEqual(m);
	});

	it('still rejects an unknown direction', () => {
		const m = JSON.parse(serializeQueryModel(inverseModel()));
		m.hops[0].direction = 'sideways';
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(false);
	});

	it('leaves forward-only models unaffected', () => {
		expect(parseQueryModel(serializeQueryModel(fullModel())).ok).toBe(true);
	});

	it('accepts an inverse hop whose relationship points at the parent class', () => {
		const schema = schemaOf(
			cls(`${NS}#Server`),
			cls(`${NS}#Application`, [rel(`${NS}#hostedOn`, `${NS}#Server`)])
		);
		expect(validate(inverseModel(), schema)).toEqual([]);
	});

	it('accepts a relationship that points at a superclass or subclass of the parent', () => {
		const sup = schemaOf(
			cls(`${NS}#Server`),
			cls(`${NS}#Host`, [], [`${NS}#Server`]),
			cls(`${NS}#Application`, [rel(`${NS}#hostedOn`, `${NS}#Host`)])
		);
		expect(validate(inverseModel(), sup)).toEqual([]);
		const sub = schemaOf(
			cls(`${NS}#Server`, [], [`${NS}#VirtualServer`]),
			cls(`${NS}#VirtualServer`),
			cls(`${NS}#Application`, [rel(`${NS}#hostedOn`, `${NS}#VirtualServer`)])
		);
		expect(validate(inverseModel(), sub)).toEqual([]);
	});

	it('accepts a relationship declared on a superclass of the hop target', () => {
		const schema = schemaOf(
			cls(`${NS}#Server`),
			cls(`${NS}#Software`, [rel(`${NS}#hostedOn`, `${NS}#Server`)], [`${NS}#Application`]),
			cls(`${NS}#Application`)
		);
		expect(validate(inverseModel(), schema)).toEqual([]);
	});

	it('names the hop and the missing relationship when nothing points at the parent', () => {
		const schema = schemaOf(
			cls(`${NS}#Server`),
			cls(`${NS}#Application`, [rel(`${NS}#hostedOn`, `${NS}#Database`)]),
			cls(`${NS}#Database`)
		);
		const issues = validate(inverseModel(), schema);
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toBe('hops[0]');
		expect(issues[0].message).toContain('h1');
		expect(issues[0].message).toContain(`${NS}#hostedOn`);
		expect(issues[0].message).toContain(`${NS}#Server`);
	});

	it('checks an inverse hop against its parent hop class, not the root', () => {
		const m = inverseModel();
		m.hops.push({
			id: 'h2', parentHopId: 'h1', propertyIri: `${NS}#ownedBy`, direction: 'inverse', targetClassIri: `${NS}#Team`
		});
		const schema = schemaOf(
			cls(`${NS}#Server`),
			cls(`${NS}#Application`, [rel(`${NS}#hostedOn`, `${NS}#Server`)]),
			cls(`${NS}#Team`, [rel(`${NS}#ownedBy`, `${NS}#Server`)]) // points at the root, not at Application
		);
		const issues = validate(m, schema);
		expect(issues.map((i) => i.path)).toEqual(['hops[1]']);
	});

	it('skips the relationship check without a schema', () => {
		expect(validate(inverseModel())).toEqual([]);
	});
});

describe('canExtendPath', () => {
	const hop = (id: string, parentHopId: string | null, propertyIri: string) => ({
		id, parentHopId, propertyIri, direction: 'forward' as const, targetClassIri: `${NS}#X`
	});
	const base = (): QueryModel => ({
		...emptyQueryModel(`${NS}#Root`, [NS]),
		hops: [hop('a', null, 'p:owner'), hop('b', 'a', 'p:member'), hop('c', null, 'p:hosted')]
	});

	it('allows a new property from the root', () => {
		expect(canExtendPath(base(), null, 'p:new', 'forward')).toBe(true);
	});

	it('forbids repeating the same property on one root-to-leaf path', () => {
		expect(canExtendPath(base(), 'b', 'p:owner', 'forward')).toBe(false);
		expect(canExtendPath(base(), 'b', 'p:member', 'forward')).toBe(false);
	});

	it('allows the same property on a different branch', () => {
		expect(canExtendPath(base(), 'c', 'p:owner', 'forward')).toBe(true);
		expect(canExtendPath(base(), 'a', 'p:hosted', 'forward')).toBe(true);
	});

	it('forbids expanding the same property twice from one parent', () => {
		expect(canExtendPath(base(), null, 'p:owner', 'forward')).toBe(false); // hop a already follows it
		expect(canExtendPath(base(), null, 'p:owner', 'forward', `${NS}#X`)).toBe(false);
		// ...unless the target class differs (a property can point at several classes)
		expect(canExtendPath(base(), null, 'p:owner', 'forward', `${NS}#Other`)).toBe(true);
		// ...or the direction does
		expect(canExtendPath(base(), null, 'p:owner', 'inverse')).toBe(true);
	});

	it('allows revisiting the same class through different properties', () => {
		const m = base();
		expect(m.hops.every((h) => h.targetClassIri === `${NS}#X`)).toBe(true);
		expect(canExtendPath(m, 'b', 'p:other', 'forward')).toBe(true);
	});

	it('rejects an unknown parent hop', () => {
		expect(canExtendPath(base(), 'ghost', 'p:new', 'forward')).toBe(false);
	});

	describe('direction', () => {
		const dhop = (id: string, parentHopId: string | null, propertyIri: string, direction: 'forward' | 'inverse') => ({
			id, parentHopId, propertyIri, direction, targetClassIri: `${NS}#X`
		});
		const withHops = (...hops: ReturnType<typeof dhop>[]): QueryModel => ({
			...emptyQueryModel(`${NS}#Root`, [NS]),
			hops
		});

		// [description, existing path (root-to-leaf), new (property, direction), allowed]
		const table: [string, ReturnType<typeof dhop>[], string, 'forward' | 'inverse', boolean][] = [
			['forward then a different forward property', [dhop('a', null, 'p:x', 'forward')], 'p:y', 'forward', true],
			['forward then a different inverse property', [dhop('a', null, 'p:x', 'forward')], 'p:y', 'inverse', true],
			['inverse then a different forward property', [dhop('a', null, 'p:x', 'inverse')], 'p:y', 'forward', true],
			['forward then the same forward property', [dhop('a', null, 'p:x', 'forward')], 'p:x', 'forward', false],
			['inverse then the same inverse property', [dhop('a', null, 'p:x', 'inverse')], 'p:x', 'inverse', false],
			['forward then its inverse (ping-pong)', [dhop('a', null, 'p:x', 'forward')], 'p:x', 'inverse', false],
			['inverse then its forward (ping-pong)', [dhop('a', null, 'p:x', 'inverse')], 'p:x', 'forward', false],
			[
				'inverse after a longer forward path of the same property further up is not ping-pong',
				[dhop('a', null, 'p:x', 'forward'), dhop('b', 'a', 'p:y', 'forward')],
				'p:x', 'inverse', true
			],
			[
				'forward again after an unrelated hop in between',
				[dhop('a', null, 'p:x', 'inverse'), dhop('b', 'a', 'p:y', 'forward')],
				'p:x', 'inverse', false
			]
		];

		it.each(table)('%s', (_name, path, property, direction, allowed) => {
			const leaf = path[path.length - 1].id;
			expect(canExtendPath(withHops(...path), leaf, property, direction)).toBe(allowed);
		});

		it('allows the opposite direction of the same property on a sibling branch', () => {
			const m = withHops(dhop('a', null, 'p:x', 'forward'));
			expect(canExtendPath(m, null, 'p:x', 'inverse')).toBe(true);
		});
	});
});

describe('share links (encodeModelForUrl / decodeModelFromUrl)', () => {
	it('round-trips a fully populated model to a deep-equal model', () => {
		const m = fullModel();
		const enc = encodeModelForUrl(m);
		expect(enc.ok).toBe(true);
		if (!enc.ok) return;
		const dec = decodeModelFromUrl(enc.param);
		expect(dec.ok).toBe(true);
		if (dec.ok) expect(dec.model).toEqual(m);
	});

	it('produces a URL-safe parameter (base64url, no padding) and survives non-ASCII values', () => {
		const m = fullModel();
		m.filters[0].value = 'Zürich — Größe ✓ 日本';
		const enc = encodeModelForUrl(m);
		expect(enc.ok).toBe(true);
		if (!enc.ok) return;
		expect(enc.param).toMatch(/^[A-Za-z0-9_-]+$/);
		const dec = decodeModelFromUrl(enc.param);
		expect(dec.ok && dec.model.filters[0].value).toBe('Zürich — Größe ✓ 日本');
	});

	it('refuses an over-long encoding and tells the user to save the query', () => {
		const m = fullModel();
		m.filters = Array.from({ length: 200 }, (_, i) => ({
			id: `f${i}`, hopId: null, propertyIri: `${NS}#p${i}`, op: 'eq' as const, value: `value-${i}`
		}));
		const enc = encodeModelForUrl(m);
		expect(enc.ok).toBe(false);
		if (!enc.ok) expect(enc.error).toMatch(/save/i);
		expect(MAX_SHARE_PARAM_LENGTH).toBe(4000);
	});

	it('rejects malformed, tampered and non-model input with a friendly error and no model', () => {
		const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		const cases = [
			'',
			'!!!not base64!!!',
			'a',
			b64('not json'),
			b64('[]'),
			b64(JSON.stringify({ version: 2 })),
			b64(JSON.stringify({ version: 1, root: 'x' })),
			'x'.repeat(MAX_SHARE_PARAM_LENGTH + 1)
		];
		for (const c of cases) {
			const r = decodeModelFromUrl(c);
			expect(r.ok, c.slice(0, 20)).toBe(false);
			if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
		}
	});

	it('never trusts the payload: a tampered column rule is still caught by validation', () => {
		const m = fullModel();
		m.columnRules = [{ columnId: 'c1', match: { op: 'eq', value: 'x' }, color: '#ff0000' as never }];
		const enc = encodeModelForUrl(m);
		if (!enc.ok) throw new Error('should encode');
		const dec = decodeModelFromUrl(enc.param);
		expect(dec.ok).toBe(true); // structurally a model …
		if (dec.ok) expect(validateQueryModel(dec.model).map((i) => i.path)).toContain('columnRules[0].color');
	});
});
