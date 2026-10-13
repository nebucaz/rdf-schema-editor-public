import { describe, it, expect } from 'vitest';
import { classOptions, groupClassesByNamespace, propertyHints } from './query-class-picker';
import type { BuilderClass, BuilderSchema } from '../services/query-builder-schema';

const cls = (iri: string, label: string, ns: string, extra: Partial<BuilderClass> = {}): BuilderClass => ({
	iri, label, namespaceBaseIri: ns, properties: [], relationships: [], inboundRelationships: [], subclasses: [], members: [],
	isEnumeration: false, ...extra
});
const A = 'http://a.org/ns';
const B = 'http://b.org/ns';
const schema: BuilderSchema = {
	classes: new Map([
		[`${A}#Server`, cls(`${A}#Server`, 'Server', A)],
		[`${A}#Application`, cls(`${A}#Application`, 'Application', A)],
		[`${B}#Person`, cls(`${B}#Person`, 'Person', B)]
	])
};
const namespaces = [
	{ baseIri: A, prefix: 'aa', description: '' },
	{ baseIri: B, prefix: 'bb', description: '' }
] as never[];

describe('groupClassesByNamespace', () => {
	it('groups by namespace, labelled by prefix, classes sorted by label', () => {
		const g = groupClassesByNamespace(schema, namespaces, '');
		expect(g.map((x) => x.label)).toEqual(['aa', 'bb']);
		expect(g[0].classes.map((c) => c.label)).toEqual(['Application', 'Server']);
	});

	it('filters case-insensitively and drops empty groups', () => {
		const g = groupClassesByNamespace(schema, namespaces, 'PERS');
		expect(g).toHaveLength(1);
		expect(g[0].classes[0].label).toBe('Person');
	});

	it('falls back to the base IRI when the namespace is unknown', () => {
		const g = groupClassesByNamespace(schema, [], '');
		expect(g.map((x) => x.label).sort()).toEqual([A, B]);
	});
});

describe('propertyHints', () => {
	it('reports required / multi-valued / bounds', () => {
		expect(propertyHints({ required: true, repeatable: false })).toEqual(['required']);
		expect(propertyHints({ required: false, repeatable: true })).toEqual(['multi-valued']);
		expect(propertyHints({ required: false, repeatable: false, minCount: 1, maxCount: 3 })).toEqual(['1..3']);
		expect(propertyHints({ required: false, repeatable: false })).toEqual([]);
	});
});

describe('classOptions', () => {
	it('lists every class, prefix-qualified and sorted, when no namespace is chosen', () => {
		const o = classOptions(schema, namespaces, null);
		expect(o.map((x) => x.label)).toEqual(['aa:Application', 'aa:Server', 'bb:Person']);
	});

	it('narrows to the chosen namespace', () => {
		const o = classOptions(schema, namespaces, B);
		expect(o.map((x) => x.iri)).toEqual([`${B}#Person`]);
	});
});
