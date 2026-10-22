import { describe, expect, it } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import {
	applyStartClass,
	columnChoices,
	startClassOptions
} from './query-add-column';
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





