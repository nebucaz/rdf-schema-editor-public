import { describe, expect, it } from 'vitest';
import { addIndividualToSchema, removeIndividualFromSchema, renameIndividualInSchema, setIndividualClassInSchema } from './individual-cache';
import type { FetchedIndividual, FetchedSchema } from './sparql-connector';

const individual = (iri: string, over: Partial<FetchedIndividual> = {}): FetchedIndividual => ({
	iri,
	label: iri,
	classIri: 'http://x/C',
	namespaceBaseIri: 'http://x',
	syncSource: null,
	syncStatus: null,
	...over
});

const schemaWith = (individuals: FetchedIndividual[]): FetchedSchema => ({
	classes: [],
	datatypeProperties: [],
	objectProperties: [],
	subClassOf: [],
	individuals,
	individualClassRelations: [],
	individualIndividualRelations: [],
	labelRequiredClassIris: [],
	shapeInConstraints: []
});

describe('addIndividualToSchema', () => {
	it('appends the individual', () => {
		const next = addIndividualToSchema(schemaWith([]), individual('http://x#a'));
		expect(next.individuals.map((i) => i.iri)).toEqual(['http://x#a']);
	});

	it('does not duplicate on repeat, replacing the earlier entry', () => {
		const once = addIndividualToSchema(schemaWith([]), individual('http://x#a', { label: 'old' }));
		const twice = addIndividualToSchema(once, individual('http://x#a', { label: 'new' }));
		expect(twice.individuals).toHaveLength(1);
		expect(twice.individuals[0].label).toBe('new');
	});

	it('does not mutate the input', () => {
		const schema = schemaWith([individual('http://x#a')]);
		const next = addIndividualToSchema(schema, individual('http://x#b'));
		expect(schema.individuals).toHaveLength(1);
		expect(next).not.toBe(schema);
	});
});

describe('removeIndividualFromSchema', () => {
	const base = (): FetchedSchema => ({
		...schemaWith([individual('http://x#a'), individual('http://x#b')]),
		individualClassRelations: [
			{ individualIri: 'http://x#a', predicateIri: 'http://x/p', name: 'p', classIri: 'http://x/C', namespaceBaseIri: 'http://x' },
			{ individualIri: 'http://x#b', predicateIri: 'http://x/p', name: 'p', classIri: 'http://x/C', namespaceBaseIri: 'http://x' }
		],
		individualIndividualRelations: [
			{ individualIri: 'http://x#a', predicateIri: 'http://x/q', name: 'q', targetIndividualIri: 'http://x#b', namespaceBaseIri: 'http://x' },
			{ individualIri: 'http://x#b', predicateIri: 'http://x/q', name: 'q', targetIndividualIri: 'http://x#a', namespaceBaseIri: 'http://x' },
			{ individualIri: 'http://x#b', predicateIri: 'http://x/q', name: 'q', targetIndividualIri: 'http://x#b', namespaceBaseIri: 'http://x' }
		]
	});

	it('removes the individual and every relation it is source or target of', () => {
		const next = removeIndividualFromSchema(base(), 'http://x#a');
		expect(next.individuals.map((i) => i.iri)).toEqual(['http://x#b']);
		expect(next.individualClassRelations.map((r) => r.individualIri)).toEqual(['http://x#b']);
		expect(next.individualIndividualRelations).toHaveLength(1);
		expect(next.individualIndividualRelations[0].targetIndividualIri).toBe('http://x#b');
	});

	it('does not mutate the input', () => {
		const schema = base();
		removeIndividualFromSchema(schema, 'http://x#a');
		expect(schema.individuals).toHaveLength(2);
		expect(schema.individualIndividualRelations).toHaveLength(3);
	});
});

describe('renameIndividualInSchema', () => {
	it('relabels only the matching individual', () => {
		const schema = schemaWith([individual('http://x#a'), individual('http://x#b')]);
		const next = renameIndividualInSchema(schema, 'http://x#a', 'Alpha');
		expect(next.individuals.map((i) => i.label)).toEqual(['Alpha', 'http://x#b']);
		expect(schema.individuals[0].label).toBe('http://x#a');
	});
});

describe('untyped individuals in the cache helpers', () => {
	const untyped = { iri: 'http://x#u', label: 'U', namespaceBaseIri: 'http://x' };
	const withUntyped = (): FetchedSchema => ({ ...schemaWith([]), untypedIndividuals: [untyped] });

	it('removeIndividualFromSchema drops an untyped individual', () => {
		expect(removeIndividualFromSchema(withUntyped(), 'http://x#u').untypedIndividuals).toEqual([]);
	});

	it('renameIndividualInSchema relabels an untyped individual', () => {
		expect(renameIndividualInSchema(withUntyped(), 'http://x#u', 'New').untypedIndividuals?.[0].label).toBe('New');
	});
});

describe('setIndividualClassInSchema', () => {
	const untyped = { iri: 'http://x#u', label: 'U', namespaceBaseIri: 'http://x' };

	it('moves an untyped individual into individuals with the class', () => {
		const schema: FetchedSchema = { ...schemaWith([]), untypedIndividuals: [untyped] };
		const next = setIndividualClassInSchema(schema, 'http://x#u', 'http://x/C');
		expect(next.untypedIndividuals).toEqual([]);
		expect(next.individuals).toEqual([
			{ iri: 'http://x#u', label: 'U', classIri: 'http://x/C', namespaceBaseIri: 'http://x', syncSource: null, syncStatus: null }
		]);
	});

	it('retypes a typed individual and drops relations on the dropped predicates', () => {
		const schema: FetchedSchema = {
			...schemaWith([individual('http://x#a')]),
			individualClassRelations: [
				{ individualIri: 'http://x#a', predicateIri: 'http://x/p', name: 'p', classIri: 'http://x/C', namespaceBaseIri: 'http://x' }
			],
			individualIndividualRelations: [
				{ individualIri: 'http://x#a', predicateIri: 'http://x/q', name: 'q', targetIndividualIri: 'http://x#b', namespaceBaseIri: 'http://x' }
			]
		};
		const next = setIndividualClassInSchema(schema, 'http://x#a', 'http://x/D', ['http://x/p']);
		expect(next.individuals[0].classIri).toBe('http://x/D');
		expect(next.individualClassRelations).toEqual([]);
		expect(next.individualIndividualRelations).toHaveLength(1);
	});
});

describe('untypedTotal stays in step with local edits', () => {
	const untyped = { iri: 'http://x#u', label: 'U', namespaceBaseIri: 'http://x' };
	const base = (): FetchedSchema => ({ ...schemaWith([]), untypedIndividuals: [untyped], untypedTotal: 500 });

	it('removing an Unclassified individual decrements it', () => {
		expect(removeIndividualFromSchema(base(), 'http://x#u').untypedTotal).toBe(499);
	});

	it('assigning a class to an Unclassified individual decrements it', () => {
		expect(setIndividualClassInSchema(base(), 'http://x#u', 'http://x/C').untypedTotal).toBe(499);
	});

	it('removing a typed individual leaves it alone', () => {
		const schema = { ...base(), individuals: [individual('http://x#a')] };
		expect(removeIndividualFromSchema(schema, 'http://x#a').untypedTotal).toBe(500);
	});
});
