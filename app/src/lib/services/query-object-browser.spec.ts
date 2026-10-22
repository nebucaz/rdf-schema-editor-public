import { describe, expect, it } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import { addHop } from './query-model-edit';
import { emptyQueryModel, type QueryModel } from './query-model';
import {
	applyBrowserSelection,
	classPane,
	resolvePath,
	rootPane,
	pathBreadcrumb,
	searchBrowserTree,
	type BrowsePath
} from './query-object-browser';
import { compileQuery } from './query-compiler';
import { validateQueryModel } from './query-model';
import type { FetchedSchema } from './sparql-connector';

const NS = 'http://example.org/org';
const OTHER_NS = 'http://example.org/other';
const o = (n: string) => `${NS}#${n}`;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const cls = (n: string, label = n, ns = NS) => ({ iri: `${ns}#${n}`, label, comment: null, namespaceBaseIri: ns });
const dp = (n: string, domain: string, range: string, label = n) => ({
	iri: o(n), label, domain: o(domain), range, namespaceBaseIri: NS, required: false, repeatable: false
});
const rel = (n: string, domain: string, range: string, label = n) => ({
	...dp(n, domain, o(range), label), relationKind: 'specific' as const
});

const fetched = (): FetchedSchema =>
	({
		classes: [cls('Org', 'Organisation'), cls('Team'), cls('Person'), cls('Ext', 'Ext', OTHER_NS)],
		datatypeProperties: [dp('orgName', 'Org', XSD_STRING), dp('teamName', 'Team', XSD_STRING)],
		objectProperties: [
			rel('hasTeam', 'Org', 'Team', 'has team'),
			rel('sponsors', 'Org', 'Team', 'sponsors'),
			rel('hasMember', 'Team', 'Person', 'has member'),
			rel('leadBy', 'Team', 'Person', 'led by'),
			rel('owns', 'Person', 'Org', 'owns')
		],
		individuals: [],
		subClassOf: [],
		shapeInConstraints: [],
	}) as unknown as FetchedSchema;

const schema = buildBuilderSchema(fetched());
const namespaces = [
	{ baseIri: NS, prefix: 'org' },
	{ baseIri: OTHER_NS, prefix: 'oth' }
];
const root = (c: string): QueryModel => emptyQueryModel(o(c), [NS]);
const fwd = (rel: string, target: string) => ({
	relationshipIri: o(rel),
	direction: 'forward' as const,
	targetClassIri: o(target)
});
const inv = (rel: string, target: string) => ({ ...fwd(rel, target), direction: 'inverse' as const });
const at = (hopId: string | null, ...steps: BrowsePath['steps']): BrowsePath => ({ anchor: { hopId }, steps });

describe('rootPane', () => {
	it('lists every class, narrowed by namespace, before a query exists', () => {
		const all = rootPane(null, schema, namespaces, null);
		expect(all.mode).toBe('start');
		if (all.mode !== 'start') return;
		expect(all.options.map((c) => c.label).sort()).toEqual(
			['org:Organisation', 'org:Person', 'org:Team', 'oth:Ext']
		);
		const one = rootPane(null, schema, namespaces, OTHER_NS);
		expect(one.mode === 'start' && one.options.map((c) => c.label)).toEqual(['oth:Ext']);
	});

	it('lists the root and each hop class once a query exists', () => {
		const m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const pane = rootPane(m, schema, namespaces, null);
		expect(pane.mode).toBe('groups');
		if (pane.mode !== 'groups') return;
		expect(pane.groups.map((g) => [g.hopId, g.label, g.depth])).toEqual([
			[null, 'Organisation', 0],
			['h1', 'Team', 1]
		]);
	});
});

describe('classPane', () => {
	it('lists Label, IRI, properties, outbound then inbound links in a stable order', () => {
		const pane = classPane(root('Team'), schema, at(null));
		expect(pane.label).toBe('Team');
		expect(pane.columns.map((c) => c.name)).toEqual(['Label', 'IRI', 'teamName']);
		expect(pane.links.map((l) => l.label)).toEqual(['has member', 'led by']);
		expect(pane.inbound.map((l) => l.label)).toEqual(['has team', 'sponsors']);
		expect(pane.links[0].step).toEqual(fwd('hasMember', 'Person'));
		expect(pane.inbound[0].step).toEqual(inv('hasTeam', 'Org'));
		expect(pane.inbound[0].targetLabel).toBe('Organisation');
	});

	it('opens the pane of a class reached through steps', () => {
		const pane = classPane(root('Org'), schema, at(null, fwd('hasTeam', 'Team')));
		expect(pane.classIri).toBe(o('Team'));
		expect(pane.columns.map((c) => c.name)).toContain('teamName');
	});

	it('works without a model by starting from a class', () => {
		const pane = classPane(null, schema, { anchor: { startClassIri: o('Org') }, steps: [] });
		expect(pane.label).toBe('Organisation');
		expect(pane.links.map((l) => l.label)).toEqual(['has team', 'sponsors']);
	});
});

describe('classPane link validity', () => {
	it('reuses an existing hop: enabled and flagged, with the column it already has', () => {
		let m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		m = { ...m, columns: [{ id: 'c1', hopId: 'h1', source: { propertyIri: o('teamName') }, header: 'T' }] };
		const pane = classPane(m, schema, at(null));
		const link = pane.links.find((l) => l.label === 'has team')!;
		expect(link.disabledReason).toBeNull();
		expect(link.existingHopId).toBe('h1');
		const team = classPane(m, schema, at(null, fwd('hasTeam', 'Team')));
		expect(team.columns.find((c) => c.name === 'teamName')!.existingColumnId).toBe('c1');
		expect(team.columns.find((c) => c.name === 'Label')!.existingColumnId).toBeNull();
	});

	it('applies the cycle rule to hops that only exist earlier in the path', () => {
		// Org -hasTeam-> Team -hasMember-> Person -owns-> Org -hasTeam-> would repeat hasTeam on the path
		const path = at(
			null,
			fwd('hasTeam', 'Team'),
			fwd('hasMember', 'Person'),
			fwd('owns', 'Org')
		);
		const pane = classPane(root('Org'), schema, path);
		expect(pane.classIri).toBe(o('Org'));
		const again = pane.links.find((l) => l.label === 'has team')!;
		expect(again.disabledReason).toMatch(/Already expanded/);
		expect(again.existingHopId).toBeNull();
		expect(pane.links.find((l) => l.label === 'sponsors')!.disabledReason).toBeNull();
	});

	it('blocks an immediate undo of the previous (virtual) step', () => {
		const pane = classPane(root('Org'), schema, at(null, fwd('hasTeam', 'Team')));
		const back = pane.inbound.find((l) => l.step.relationshipIri === o('hasTeam'))!;
		expect(back.disabledReason).toMatch(/undo the previous step/);
	});

	it('gives the same target class through two relationships two distinct rows', () => {
		const pane = classPane(root('Org'), schema, at(null));
		expect(pane.links.filter((l) => l.step.targetClassIri === o('Team')).map((l) => l.label)).toEqual([
			'has team',
			'sponsors'
		]);
	});
});

describe('classPane depth and robustness', () => {
	// Org -hasTeam-> Team -hasMember-> Person -owns-> Org -sponsors-> Team -leadBy-> Person
	const deepSteps = [
		fwd('hasTeam', 'Team'),
		fwd('hasMember', 'Person'),
		fwd('owns', 'Org'),
		fwd('sponsors', 'Team'),
		fwd('leadBy', 'Person')
	];

	it('flags deep only from the fifth hop on and never blocks by depth', () => {
		const four = classPane(root('Org'), schema, at(null, ...deepSteps.slice(0, 4)));
		expect([four.depth, four.deep]).toEqual([4, false]);
		const five = classPane(root('Org'), schema, at(null, ...deepSteps));
		expect([five.depth, five.deep]).toEqual([5, true]);
		expect(five.links.every((l) => l.disabledReason === null || /Already/.test(l.disabledReason))).toBe(true);
	});

	it('counts the anchor group depth', () => {
		let m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		m = addHop(m, 'h1', { iri: o('hasMember'), targetClassIri: o('Person') });
		expect(classPane(m, schema, at('h2')).depth).toBe(2);
	});

	it('yields an empty pane for an unknown class or an unresolvable path', () => {
		const ghost = { relationshipIri: o('hasGhost'), direction: 'forward' as const, targetClassIri: o('Ghost') };
		const unknown = classPane(root('Org'), schema, at(null, ghost));
		expect([unknown.columns, unknown.links, unknown.inbound]).toEqual([[], [], []]);
		const gone = classPane(root('Org'), schema, at('nope'));
		expect(gone.columns).toEqual([]);
		expect(resolvePath(root('Org'), at('nope'))).toBeNull();
	});
});

describe('applyBrowserSelection', () => {
	const name = (c: string) => ({ propertyIri: o(c) });
	const pick = (path: BrowsePath, source: 'label' | 'iri' | { propertyIri: string }, header = 'H') => ({
		path,
		source,
		header
	});
	const deep = [fwd('hasTeam', 'Team'), fwd('hasMember', 'Person')];
	const ok = (r: ReturnType<typeof applyBrowserSelection>) => {
		if (!r.ok) throw new Error(`pick ${r.failedPick} rejected`);
		return r.model;
	};

	it('adds three parent-linked hops and one column under the last for a three-step pick', () => {
		const steps = [...deep, fwd('owns', 'Org')];
		const m = ok(applyBrowserSelection(root('Org'), [pick(at(null, ...steps), { propertyIri: o('orgName') })]));
		expect(m.hops.map((h) => [h.id, h.parentHopId, h.propertyIri.split('#')[1]])).toEqual([
			['h1', null, 'hasTeam'],
			['h2', 'h1', 'hasMember'],
			['h3', 'h2', 'owns']
		]);
		expect(m.columns).toHaveLength(1);
		expect(m.columns[0].hopId).toBe('h3');
	});

	it('reuses the hops a second pick shares with the first', () => {
		const m = ok(
			applyBrowserSelection(root('Org'), [
				pick(at(null, fwd('hasTeam', 'Team')), { propertyIri: o('teamName') }),
				pick(at(null, ...deep), 'label')
			])
		);
		expect(m.hops).toHaveLength(2);
		expect(m.columns.map((c) => c.hopId)).toEqual(['h1', 'h2']);
	});

	it('reuses a hop already in the model and skips a column it already has', () => {
		let base = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		base = { ...base, columns: [{ id: 'c1', hopId: 'h1', source: 'label', header: 'T' }] };
		const m = ok(
			applyBrowserSelection(base, [
				pick(at(null, fwd('hasTeam', 'Team')), 'label'),
				pick(at('h1'), { propertyIri: o('teamName') })
			])
		);
		expect(m.hops).toHaveLength(1);
		expect(m.columns.map((c) => [c.hopId, c.source])).toEqual([
			['h1', 'label'],
			['h1', name('teamName')]
		]);
	});

	it('keeps intermediate hops that carry no column, and the model stays valid', () => {
		const m = ok(applyBrowserSelection(root('Org'), [pick(at(null, ...deep), 'label')]));
		expect(m.hops).toHaveLength(2);
		expect(m.columns.map((c) => c.hopId)).toEqual(['h2']);
		expect(validateQueryModel(m, undefined, schema)).toEqual([]);
	});

	it('removes unticked columns together with their ties, in the same change', () => {
		let base = root('Org');
		base = {
			...base,
			columns: [{ id: 'c1', hopId: null, source: 'label', header: 'O' }],
			sort: [{ columnId: 'c1', direction: 'asc' }]
		};
		const m = ok(applyBrowserSelection(base, [pick(at(null), 'iri')], ['c1']));
		expect(m.columns.map((c) => c.source)).toEqual(['iri']);
		expect(m.sort).toEqual([]);
	});

	it('returns the same model instance and names the failing pick when a step is rejected', () => {
		const base = root('Org');
		const cycle = [
			fwd('hasTeam', 'Team'),
			fwd('hasMember', 'Person'),
			fwd('owns', 'Org'),
			fwd('hasTeam', 'Team')
		];
		const r = applyBrowserSelection(base, [pick(at(null), 'label'), pick(at(null, ...cycle), 'label')]);
		expect(r).toMatchObject({ ok: false, failedPick: 1 });
		expect(r.model).toBe(base);
	});

	it('starts a new query from the start class with a deep pick', () => {
		const start = { startClassIri: o('Org') };
		const r = applyBrowserSelection(
			null,
			[pick({ anchor: start, steps: deep }, 'label'), pick({ anchor: start, steps: [] }, 'label')],
			[],
			{ namespaces: [NS] }
		);
		const m = ok(r);
		expect(m.root.classIri).toBe(o('Org'));
		expect(m.namespaces).toEqual([NS]);
		expect(m.hops).toHaveLength(2);
		expect(m.columns.map((c) => c.hopId)).toEqual(['h2', null]);
	});

	it('is deterministic and compiles to SPARQL', () => {
		const picks = [pick(at(null, ...deep), { propertyIri: o('orgName') }), pick(at(null), 'label')];
		const a = ok(applyBrowserSelection(root('Org'), picks));
		expect(ok(applyBrowserSelection(root('Org'), picks))).toEqual(a);
		expect(compileQuery(a, schema, { limit: 10, offset: 0 }).sparql).toContain('SELECT');
	});

	it('returns the model unchanged for an empty selection', () => {
		const base = root('Org');
		expect(applyBrowserSelection(base, [])).toEqual({ ok: true, model: base });
	});
});

describe('searchBrowserTree', () => {
	it('returns nothing for an empty or blank query', () => {
		expect(searchBrowserTree(root('Org'), schema, '')).toEqual({ results: [], more: false });
		expect(searchBrowserTree(root('Org'), schema, '   ').results).toEqual([]);
	});

	it('finds a property below the root with the path to its class', () => {
		const { results } = searchBrowserTree(root('Org'), schema, 'teamname');
		// Team is reachable through two relationships (hasTeam, sponsors): two distinct one-step paths,
		// then longer ones that revisit Team through other relationships
		const near = results.filter((r) => r.path.steps.length === 1);
		expect(near).toHaveLength(2);
		expect(results.every((r) => r.disabledReason === null)).toBe(true);
		expect(results[1].breadcrumb).toEqual(['Organisation', 'sponsors', 'Team', 'teamName']);
		expect(results[0]).toMatchObject({ kind: 'property', propertyIri: o('teamName'), step: null });
		expect(results[0].path).toEqual(at(null, fwd('hasTeam', 'Team')));
		expect(results[0].breadcrumb).toEqual(['Organisation', 'has team', 'Team', 'teamName']);
		expect(results[0].disabledReason).toBeNull();
	});

	it('finds a link by its label or its target class, outbound and inbound', () => {
		const out = searchBrowserTree(root('Org'), schema, 'has team').results[0];
		expect(out).toMatchObject({ kind: 'link', step: fwd('hasTeam', 'Team'), path: at(null) });
		const inbound = searchBrowserTree(root('Org'), schema, 'owns').results[0];
		expect(inbound.step).toEqual(inv('owns', 'Person'));
	});

	it('orders by depth then text and reports when the limit cut results off', () => {
		const all = searchBrowserTree(root('Org'), schema, 'e').results;
		const depths = all.map((r) => r.path.steps.length);
		expect(depths).toEqual([...depths].sort((a, b) => a - b));
		const cut = searchBrowserTree(root('Org'), schema, 'e', { limit: 2 });
		expect(cut.results).toHaveLength(2);
		expect(cut.more).toBe(true);
		expect(cut.results).toEqual(all.slice(0, 2));
		expect(searchBrowserTree(root('Org'), schema, 'e', { limit: 500 }).more).toBe(false);
	});

	it('terminates on a cyclic schema and respects maxDepth', () => {
		// Org -> Team -> Person -> Org is a cycle; nothing matches 'zzz'
		expect(searchBrowserTree(root('Org'), schema, 'zzz').results).toEqual([]);
		const shallow = searchBrowserTree(root('Org'), schema, 'led by', { maxDepth: 0 });
		expect(shallow.results).toEqual([]);
		// Team (via hasTeam and via sponsors) and Person (inverse owns) all carry a 'led by' link
		expect(searchBrowserTree(root('Org'), schema, 'led by', { maxDepth: 1 }).results).toHaveLength(3);
	});

	it('returns a path the cycle rule rejects flagged disabled with its reason', () => {
		const hits = searchBrowserTree(root('Org'), schema, 'has team').results;
		const forward = hits.filter((h) => h.kind === 'link' && h.step!.direction === 'forward');
		expect(forward[0].disabledReason).toBeNull();
		expect(forward[0].path.steps).toHaveLength(0);
		const rejected = forward.filter((h) => h.disabledReason !== null);
		expect(rejected.length).toBeGreaterThan(0);
		expect(rejected[0].disabledReason).toMatch(/Already expanded/);
	});

	it('searches from every class when there is no query yet', () => {
		const { results } = searchBrowserTree(null, schema, 'orgname');
		expect(results[0]).toMatchObject({ kind: 'property', path: { anchor: { startClassIri: o('Org') } } });
	});

	it('stays fast on a large generated schema', () => {
		const n = 80;
		const big = buildBuilderSchema({
			classes: Array.from({ length: n }, (_, i) => cls(`C${i}`)),
			datatypeProperties: Array.from({ length: n }, (_, i) => dp(`p${i}`, `C${i}`, XSD_STRING)),
			objectProperties: Array.from({ length: n * 3 }, (_, i) =>
				rel(`r${i}`, `C${i % n}`, `C${((i % n) + 1 + Math.floor(i / n) * 13) % n}`)
			),
			individuals: [],
			subClassOf: [],
			shapeInConstraints: []
		} as unknown as FetchedSchema);
		const started = performance.now();
		const m = emptyQueryModel(o('C0'), [NS]);
		expect(searchBrowserTree(m, big, 'p41').results.length).toBeGreaterThan(0);
		// a miss walks as far as the node cap allows
		expect(searchBrowserTree(m, big, 'zzz').results).toEqual([]);
		expect(performance.now() - started).toBeLessThan(3000);
	});
});

describe('pathBreadcrumb', () => {
	it('alternates class and link labels along the path, using the inbound label for inverse steps', () => {
		expect(pathBreadcrumb(root('Org'), schema, at(null, fwd('hasTeam', 'Team'), fwd('hasMember', 'Person')))).toEqual([
			'Organisation', 'has team', 'Team', 'has member', 'Person'
		]);
		expect(pathBreadcrumb(root('Org'), schema, at(null, inv('owns', 'Person')))).toEqual([
			'Organisation', 'owns', 'Person'
		]);
	});

	it('starts from a hop anchor or a start class and survives unknown ids', () => {
		const m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		expect(pathBreadcrumb(m, schema, at('h1'))).toEqual(['Team']);
		expect(pathBreadcrumb(null, schema, { anchor: { startClassIri: o('Org') }, steps: [] })).toEqual(['Organisation']);
		expect(pathBreadcrumb(root('Org'), schema, at(null, { ...fwd('hasGhost', 'Ghost') }))).toEqual([
			'Organisation', 'hasGhost', 'Ghost'
		]);
	});
});
