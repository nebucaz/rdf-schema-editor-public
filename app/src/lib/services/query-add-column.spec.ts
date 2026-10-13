import { describe, expect, it } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import {
	applyGroupColumns,
	applyStartClass,
	applyStep,
	applyToGroup,
	columnChoices,
	filterSteps,
	nearestPath,
	reachableSteps,
	startClassOptions
} from './query-add-column';
import { addHop } from './query-model-edit';
import { emptyQueryModel, type QueryModel } from './query-model';
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

const fetched = (extra: Partial<FetchedSchema> = {}): FetchedSchema =>
	({
		classes: [cls('Org', 'Organisation'), cls('Team'), cls('Person'), cls('Status'), cls('Ext', 'Ext', OTHER_NS)],
		datatypeProperties: [dp('orgName', 'Org', XSD_STRING)],
		objectProperties: [
			rel('hasTeam', 'Org', 'Team', 'has team'),
			rel('hasMember', 'Team', 'Person', 'has member'),
			rel('leadBy', 'Team', 'Person', 'led by'),
			rel('hasStatus', 'Team', 'Status', 'has status'),
			rel('owns', 'Person', 'Org', 'owns')
		],
		individuals: [{ iri: o('Active'), label: 'Active', classIri: o('Status'), namespaceBaseIri: NS, syncSource: null, syncStatus: null }],
		subClassOf: [],
		shapeInConstraints: [],
		...extra
	}) as unknown as FetchedSchema;

const schema = buildBuilderSchema(fetched());
const root = (c: string): QueryModel => emptyQueryModel(o(c), [NS]);
const step = (s: { relationshipIri: string; direction: string; fromHopId: string | null }) =>
	`${s.fromHopId ?? 'root'}:${s.direction === 'inverse' ? '^' : ''}${s.relationshipIri.split('#')[1]}`;

describe('reachableSteps', () => {
	it('offers nothing before a start class is chosen', () => {
		expect(reachableSteps(null, schema)).toEqual([]);
	});

	it('lists outbound and inbound steps of the root, with labels and no disabled reason', () => {
		const steps = reachableSteps(root('Org'), schema);
		expect(steps.map(step).sort()).toEqual(['root:^owns', 'root:hasTeam']);
		const out = steps.find((s) => s.direction === 'forward')!;
		expect(out).toMatchObject({
			fromHopId: null,
			relationshipIri: o('hasTeam'),
			targetClassIri: o('Team'),
			label: 'has team',
			fromLabel: 'Organisation',
			targetLabel: 'Team',
			disabledReason: null
		});
		const inb = steps.find((s) => s.direction === 'inverse')!;
		expect(inb).toMatchObject({ targetClassIri: o('Person'), fromLabel: 'Organisation', targetLabel: 'Person', disabledReason: null });
	});

	it('branches from every group, not only the root or the last hop', () => {
		let m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const teamHop = m.hops[0].id;
		m = addHop(m, teamHop, { iri: o('hasMember'), targetClassIri: o('Person') });
		const personHop = m.hops[1].id;
		const fromTeam = reachableSteps(m, schema).filter((s) => s.fromHopId === teamHop);
		// outbound hasMember/leadBy/hasStatus plus the inbound hasTeam (from Organisation)
		expect(fromTeam.map(step).sort()).toEqual([`${teamHop}:^hasTeam`, `${teamHop}:hasMember`, `${teamHop}:hasStatus`, `${teamHop}:leadBy`]);
		expect(reachableSteps(m, schema).some((s) => s.fromHopId === personHop && s.relationshipIri === o('owns'))).toBe(true);
		expect(reachableSteps(m, schema).some((s) => s.fromHopId === null)).toBe(true);
	});

	it('disables a step that already exists as a sibling hop', () => {
		const m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const dup = reachableSteps(m, schema).find((s) => s.fromHopId === null && s.relationshipIri === o('hasTeam'))!;
		expect(dup.disabledReason).toMatch(/already expanded/i);
	});

	it('disables a repeated property+direction on the path and an immediate undo', () => {
		// Org -hasTeam-> Team ; from Team, inbound hasTeam would undo the parent step.
		const m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const teamHop = m.hops[0].id;
		const undo = reachableSteps(m, schema).find(
			(s) => s.fromHopId === teamHop && s.relationshipIri === o('hasTeam') && s.direction === 'inverse'
		)!;
		expect(undo.targetClassIri).toBe(o('Org'));
		expect(undo.disabledReason).toMatch(/undo/i);

		// Org -hasTeam-> Team -hasMember-> Person -owns-> Org -hasTeam->: same property+direction on the path.
		let m2 = m;
		m2 = addHop(m2, teamHop, { iri: o('hasMember'), targetClassIri: o('Person') });
		m2 = addHop(m2, m2.hops[1].id, { iri: o('owns'), targetClassIri: o('Org') });
		const orgAgain = m2.hops[2].id;
		const repeat = reachableSteps(m2, schema).find(
			(s) => s.fromHopId === orgAgain && s.relationshipIri === o('hasTeam') && s.direction === 'forward'
		)!;
		expect(repeat.disabledReason).not.toBeNull();
	});

	it('yields two distinct steps for one target class reached through two relationships', () => {
		const steps = reachableSteps(
			addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') }),
			schema
		).filter((s) => s.fromLabel === 'Team' && s.targetClassIri === o('Person') && s.direction === 'forward');
		expect(steps.map((s) => s.relationshipIri).sort()).toEqual([o('hasMember'), o('leadBy')]);
	});

	it('offers a step to an enumeration class', () => {
		const m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const toStatus = reachableSteps(m, schema).find((s) => s.relationshipIri === o('hasStatus'))!;
		expect(toStatus).toMatchObject({ targetClassIri: o('Status'), targetLabel: 'Status', disabledReason: null });
	});

	it('offers nothing for a class with no relationships and an empty schema', () => {
		expect(reachableSteps(root('Status'), schema).filter((s) => s.direction === 'forward')).toEqual([]);
		const empty = buildBuilderSchema(fetched({ classes: [], objectProperties: [], datatypeProperties: [], individuals: [] }));
		expect(reachableSteps(root('Org'), empty)).toEqual([]);
	});

	it('never offers a relationship the schema does not declare', () => {
		const m: QueryModel = {
			...root('Org'),
			hops: [{ id: 'h1', parentHopId: null, propertyIri: o('vanished'), direction: 'forward', targetClassIri: o('Gone') }]
		};
		const steps = reachableSteps(m, schema);
		expect(steps.every((s) => s.relationshipIri !== o('vanished'))).toBe(true);
		expect(steps.filter((s) => s.fromHopId === 'h1')).toEqual([]);
	});
});

describe('startClassOptions', () => {
	const namespaces = [
		{ baseIri: NS, prefix: 'org' },
		{ baseIri: OTHER_NS, prefix: 'ext' }
	];
	it('lists every class prefixed and sorted when no namespace is selected', () => {
		expect(startClassOptions(schema, namespaces, null).map((c) => c.label)).toEqual([
			'ext:Ext', 'org:Organisation', 'org:Person', 'org:Status', 'org:Team'
		]);
	});
	it('restricts to one namespace', () => {
		expect(startClassOptions(schema, namespaces, OTHER_NS).map((c) => c.iri)).toEqual([`${OTHER_NS}#Ext`]);
	});
});

describe('columnChoices', () => {
	it('lists Label, IRI, then the properties with default headers', () => {
		const choices = columnChoices(schema.classes.get(o('Org'))!);
		expect(choices.map((c) => c.header)).toEqual(['Organisation', 'Organisation IRI', 'orgName']);
		expect(choices[0].source).toBe('label');
		expect(choices[1].source).toBe('iri');
		expect(choices[2].source).toEqual({ propertyIri: o('orgName') });
		expect(choices[2].datatype).toBe(XSD_STRING);
	});
});

describe('applyStartClass', () => {
	const org = schema.classes.get(o('Org'))!;
	it('creates the root with the namespace scope and the picked columns in order', () => {
		const picks = columnChoices(org).filter((c) => c.source !== 'iri');
		const model = applyStartClass(o('Org'), [NS], picks);
		expect(model.root.classIri).toBe(o('Org'));
		expect(model.namespaces).toEqual([NS]);
		expect(model.hops).toEqual([]);
		expect(model.columns.map((c) => [c.hopId, c.header])).toEqual([
			[null, 'Organisation'],
			[null, 'orgName']
		]);
		expect(new Set(model.columns.map((c) => c.id)).size).toBe(2);
	});
});

describe('applyStep', () => {
	const team = schema.classes.get(o('Team'))!;
	const picks = columnChoices(team).filter((c) => c.source === 'label');

	it('adds exactly one hop with the picked columns under it', () => {
		const m0 = applyStartClass(o('Org'), [NS], [columnChoices(schema.classes.get(o('Org'))!)[0]]);
		const s = reachableSteps(m0, schema).find((x) => x.relationshipIri === o('hasTeam'))!;
		const m1 = applyStep(m0, s, picks);
		expect(m1.hops).toHaveLength(1);
		expect(m1.hops[0]).toMatchObject({ parentHopId: null, propertyIri: o('hasTeam'), direction: 'forward', targetClassIri: o('Team') });
		expect(m1.columns.filter((c) => c.hopId === m1.hops[0].id).map((c) => c.header)).toEqual(['Team']);
		expect(m1.columns).toHaveLength(2);
		expect(m0.hops).toHaveLength(0);
	});

	it('nests under the chosen group', () => {
		let m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const s = reachableSteps(m, schema).find((x) => x.relationshipIri === o('hasMember'))!;
		m = applyStep(m, s, [{ source: 'label', header: 'Member' }]);
		expect(m.hops[1]).toMatchObject({ parentHopId: m.hops[0].id, propertyIri: o('hasMember') });
		expect(m.columns[0].hopId).toBe(m.hops[1].id);
	});

	it('creates an inverse hop for an inbound step', () => {
		const m0 = root('Org');
		const s = reachableSteps(m0, schema).find((x) => x.direction === 'inverse')!;
		const m1 = applyStep(m0, s, [{ source: 'label', header: 'Person' }]);
		expect(m1.hops[0]).toMatchObject({ direction: 'inverse', targetClassIri: o('Person'), propertyIri: o('owns') });
	});

	it('returns the model unchanged for a disabled step', () => {
		const m0 = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const s = reachableSteps(m0, schema).find((x) => x.fromHopId === null && x.relationshipIri === o('hasTeam'))!;
		expect(s.disabledReason).not.toBeNull();
		expect(applyStep(m0, s, picks)).toBe(m0);
	});
});

describe('applyToGroup', () => {
	it('adds more properties to an existing group without a new hop, skipping duplicates', () => {
		let m = addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		const hopId = m.hops[0].id;
		m = applyToGroup(m, hopId, [{ source: 'label', header: 'Team' }]);
		m = applyToGroup(m, hopId, [
			{ source: 'label', header: 'Team again' },
			{ source: 'iri', header: 'Team IRI' }
		]);
		expect(m.hops).toHaveLength(1);
		expect(m.columns.map((c) => c.header)).toEqual(['Team', 'Team IRI']);
	});
});

describe('filterSteps', () => {
	const steps = reachableSteps(
		addHop(root('Org'), null, { iri: o('hasTeam'), targetClassIri: o('Team') }),
		schema
	);
	it('matches relationship, from and target labels case-insensitively', () => {
		expect(filterSteps(steps, 'MEMBER').map((s) => s.relationshipIri)).toEqual([o('hasMember')]);
		expect(filterSteps(steps, 'status').map((s) => s.targetLabel)).toEqual(['Status']);
		expect(filterSteps(steps, '  ')).toEqual(steps);
		expect(filterSteps(steps, 'zzz')).toEqual([]);
	});
});

describe('nearestPath', () => {
	it('names the shortest relationship path from a query class to an unreachable class', () => {
		const path = nearestPath(root('Org'), schema, o('Status'));
		expect(path).toEqual(['Organisation', 'has team', 'Team', 'has status', 'Status']);
	});
	it('is null when the class is unreachable or already one step away', () => {
		expect(nearestPath(root('Org'), schema, o('Ext'))).toBeNull();
		expect(nearestPath(root('Org'), schema, o('Team'))).toBeNull();
	});
});

describe('applyGroupColumns', () => {
	const m = applyStartClass(o('Org'), [NS], [
		{ source: 'iri', header: 'IRI' },
		{ source: { propertyIri: o('orgName') }, header: 'name' }
	]);

	it('adds the picks and removes the listed columns in one model value', () => {
		const iriId = m.columns.find((c) => c.source === 'iri')!.id;
		const next = applyGroupColumns(m, null, [{ source: 'label', header: 'Label' }], [iriId]);
		expect(next.columns.map((c) => c.source)).toEqual([{ propertyIri: o('orgName') }, 'label']);
	});

	it('drops sort and rules that belonged to a removed column', () => {
		const nameId = m.columns.find((c) => typeof c.source === 'object')!.id;
		const withSort: QueryModel = { ...m, sort: [{ columnId: nameId, direction: 'asc' }] };
		const next = applyGroupColumns(withSort, null, [], [nameId]);
		expect(next.sort).toEqual([]);
	});

	it('is a no-op for an empty change', () => {
		expect(applyGroupColumns(m, null, [], [])).toBe(m);
	});
});
