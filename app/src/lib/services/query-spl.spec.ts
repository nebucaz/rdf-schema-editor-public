import { describe, it, expect } from 'vitest';
import { printSplPipeline } from './query-spl';
import { emptyQueryModel, type QueryModel } from './query-model';
import { buildBuilderSchema } from './query-builder-schema';
import type { FetchedSchema } from './sparql-connector';

const NS = 'http://example.org/ns';
const iri = (n: string) => `${NS}#${n}`;
const X = 'http://www.w3.org/2001/XMLSchema#string';

const fetched: FetchedSchema = {
	classes: [
		{ iri: iri('Application'), label: 'Application', comment: null, namespaceBaseIri: NS },
		{ iri: iri('Server'), label: 'Server', comment: null, namespaceBaseIri: NS },
		{ iri: iri('IP'), label: 'IP', comment: null, namespaceBaseIri: NS },
		{ iri: iri('Lifecycle'), label: 'Lifecycle', comment: null, namespaceBaseIri: NS }
	],
	datatypeProperties: [
		{ iri: iri('lifecycle'), label: 'lifecycle', domain: iri('Application'), range: X, namespaceBaseIri: NS, required: false, repeatable: true },
		{ iri: iri('owner'), label: 'owner', domain: iri('Application'), range: X, namespaceBaseIri: NS, required: false, repeatable: true },
		{ iri: iri('criticality'), label: 'criticality', domain: iri('Application'), range: X, namespaceBaseIri: NS, required: false, repeatable: true },
		{ iri: iri('hostname'), label: 'hostname', domain: iri('Server'), range: X, namespaceBaseIri: NS, required: false, repeatable: true }
	],
	objectProperties: [
		{ iri: iri('hostedOn'), label: 'hostedOn', domain: iri('Application'), range: iri('Server'), namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific' },
		{ iri: iri('hasIP'), label: 'hasIP', domain: iri('Server'), range: iri('IP'), namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific' }
	],
	subClassOf: [],
	individuals: [
		{ iri: iri('prod'), label: 'Production', classIri: iri('Lifecycle'), namespaceBaseIri: NS, syncSource: null, syncStatus: null }
	],
	individualClassRelations: [],
	individualIndividualRelations: []
};
const schema = buildBuilderSchema(fetched);

const model = (): QueryModel => emptyQueryModel(iri('Application'), [NS]);
const hop = (id: string, parent: string | null, p: string, t: string) => ({
	id, parentHopId: parent, propertyIri: iri(p), direction: 'forward' as const, targetClassIri: iri(t)
});
const prop = (n: string) => ({ propertyIri: iri(n) });

describe('printSplPipeline', () => {
	it('prints the root class alone', () => {
		expect(printSplPipeline(model(), schema)).toBe('Application');
		const m = model();
		m.root.includeSubclasses = false;
		expect(printSplPipeline(m, schema)).toBe('Application (exact)');
	});

	it('prints the chat-doc example as a recognisable pipeline', () => {
		const m = model();
		m.filters = [
			{ id: 'a', hopId: null, propertyIri: iri('lifecycle'), op: 'eq', value: 'Production' },
			{ id: 'b', hopId: null, propertyIri: iri('owner'), op: 'eq', value: 'PlatformTeam' }
		];
		expect(printSplPipeline(m, schema)).toBe(
			'Application\n| where lifecycle="Production"\n| where owner="PlatformTeam"'
		);
	});

	it('prints each filter operator', () => {
		const f = (op: QueryModel['filters'][number]['op'], value?: string | string[]) => {
			const m = model();
			m.filters = [{ id: 'f', hopId: null, propertyIri: iri('owner'), op, value }];
			return printSplPipeline(m, schema).split('\n')[1];
		};
		expect(f('neq', 'x')).toBe('| where owner!="x"');
		expect(f('contains', 'ab')).toBe('| where like(owner, "%ab%")');
		expect(f('in', ['a', 'b'])).toBe('| where owner IN ("a", "b")');
		expect(f('isEmpty')).toBe('| where isnull(owner)');
		expect(f('isNotEmpty')).toBe('| where isnotnull(owner)');
	});

	it('prints single and chained hops as dotted paths, and filters on hop fields', () => {
		const m = model();
		m.hops = [hop('a', null, 'hostedOn', 'Server'), hop('b', 'a', 'hasIP', 'IP')];
		m.filters = [{ id: 'f', hopId: 'a', propertyIri: iri('hostname'), op: 'eq', value: 'srv1' }];
		expect(printSplPipeline(m, schema)).toBe(
			'Application\n| hostedOn\n| hostedOn.hasIP\n| where hostedOn.hostname="srv1"'
		);
	});

	it('prints columns as a fields stage', () => {
		const m = model();
		m.hops = [hop('a', null, 'hostedOn', 'Server')];
		m.columns = [
			{ id: 'c1', hopId: null, source: prop('owner'), header: 'x' },
			{ id: 'c2', hopId: 'a', source: prop('hostname'), header: 'y' },
			{ id: 'c3', hopId: 'a', source: 'label', header: 'z' },
			{ id: 'c4', hopId: null, source: 'iri', header: 'w' }
		];
		expect(printSplPipeline(m, schema).split('\n').pop()).toBe(
			'| fields owner, hostedOn.hostname, hostedOn.label, iri'
		);
	});

	it('prints aggregation as stats and omits fields', () => {
		const m = model();
		m.hops = [hop('a', null, 'hostedOn', 'Server')];
		m.columns = [
			{ id: 'c1', hopId: null, source: prop('owner'), header: 'Owner' },
			{ id: 'c2', hopId: 'a', source: prop('hostname'), header: 'Host' }
		];
		m.aggregation = {
			groupBy: ['c1'],
			measures: [
				{ fn: 'count', of: 'root', alias: 'total' },
				{ fn: 'countDistinct', of: 'c2', alias: 'hosts' }
			]
		};
		const out = printSplPipeline(m, schema);
		expect(out).toContain('| stats count as total, dc(hostedOn.hostname) as hosts by owner');
		expect(out).not.toContain('| fields');
	});

	it('prints sort with - for descending, including measure aliases', () => {
		const m = model();
		m.columns = [
			{ id: 'c1', hopId: null, source: prop('lifecycle'), header: 'L' },
			{ id: 'c2', hopId: null, source: prop('criticality'), header: 'C' }
		];
		m.sort = [{ columnId: 'c1', direction: 'asc' }, { columnId: 'c2', direction: 'desc' }];
		expect(printSplPipeline(m, schema).split('\n').pop()).toBe('| sort lifecycle, -criticality');
	});

	it('quotes and escapes values, and prints labels instead of IRIs', () => {
		const m = model();
		m.filters = [
			{ id: 'a', hopId: null, propertyIri: iri('owner'), op: 'eq', value: 'say "hi"\\\n' },
			{ id: 'b', hopId: null, propertyIri: iri('lifecycle'), op: 'eq', value: iri('prod') }
		];
		const out = printSplPipeline(m, schema);
		expect(out).toContain('| where owner="say \\"hi\\"\\\\\\n"');
		expect(out).toContain('| where lifecycle="Production"');
		expect(out).not.toContain(NS);
	});

	it('is deterministic and independent of object key order', () => {
		const a = model();
		a.filters = [{ id: 'f', hopId: null, propertyIri: iri('owner'), op: 'eq', value: 'x' }];
		const b = JSON.parse(JSON.stringify(a));
		b.filters = [{ value: 'x', op: 'eq', propertyIri: iri('owner'), hopId: null, id: 'f' }];
		expect(printSplPipeline(b, schema)).toBe(printSplPipeline(a, schema));
		expect(printSplPipeline(a, schema)).toBe(printSplPipeline(a, schema));
	});
});
