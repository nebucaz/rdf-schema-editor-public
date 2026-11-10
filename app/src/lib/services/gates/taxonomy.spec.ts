import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { runGates } from './index';
import { TAXONOMY_GATES } from './taxonomy';

const S = 'urn:scheme:a';
const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'A thing that is described elsewhere.', scopeNote: '', disambiguation: '',
	schemeIri: S, topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [],
	...over
});
const top = (id: string, over: Partial<Concept> = {}) => concept(id, { topConcept: true, ...over });
const under = (id: string, parents: string[], over: Partial<Concept> = {}) =>
	concept(id, { broader: parents.map((p) => `urn:c:${p}`), ...over });

const schema = { classes: [], subClassOf: [] } as unknown as FetchedSchema;
const run = (concepts: Concept[] | undefined, gateId?: string) =>
	runGates(schema, { concepts, stages: ['taxonomy', 'vocabulary'] }, TAXONOMY_GATES).filter((f) => !gateId || f.gateId === gateId);

describe('taxonomy gates (STORY-330)', () => {
	it('is silent without a vocabulary', () => {
		expect(run(undefined)).toEqual([]);
	});

	it('is silent on a clean taxonomy, including a polyhierarchy', () => {
		const concepts = [
			top('Pet'),
			top('Wild'),
			under('Fox', ['Pet', 'Wild'], { definition: 'A small wild canine kept by few.' }),
			under('Cat', ['Pet'], { definition: 'A domestic feline.' })
		];
		expect(run(concepts)).toEqual([]);
	});

	it('flags every concept on a broader cycle', () => {
		const found = run([top('Root'), under('A', ['B']), under('B', ['A']), under('C', ['A'])], 'taxonomy-cycle');
		expect(found.map((f) => f.elementIri).sort()).toEqual(['urn:c:A', 'urn:c:B']);
		expect(found[0].severity).toBe('warning');
	});

	it('flags a top concept that has a broader concept', () => {
		const found = run([top('Animal'), top('Odd', { broader: ['urn:c:Animal'] })], 'top-concept-with-broader');
		expect(found.map((f) => f.elementIri)).toEqual(['urn:c:Odd']);
	});

	it('flags a concept that is in no scheme', () => {
		const found = run([concept('Loose', { schemeIri: '' }), top('Fine')], 'concept-without-scheme');
		expect(found.map((f) => f.elementIri)).toEqual(['urn:c:Loose']);
	});

	it('leaves deprecated and retired concepts out', () => {
		expect(run([concept('Old', { schemeIri: '', status: 'retired' })])).toEqual([]);
	});

	it('flags a definition that contains the term, as a warning', () => {
		const found = run([top('Customer', { definition: 'A customer is a person who buys.' })], 'definition-circular');
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ severity: 'warning', stage: 'vocabulary', elementIri: 'urn:c:Customer' });
		expect(run([top('Customer', { definition: 'A person who buys goods.' })], 'definition-circular')).toEqual([]);
	});

	it('does not read a longer word as the term', () => {
		expect(run([top('Car', { definition: 'A carpet-like cover for floors.' })], 'definition-circular')).toEqual([]);
	});

	it('flags a definition of more than two sentences', () => {
		const long = 'It is one. It is two. It is three.';
		expect(run([top('Thing', { definition: long })], 'definition-length')).toHaveLength(1);
		expect(run([top('Thing', { definition: 'It is one. It is two.' })], 'definition-length')).toEqual([]);
		expect(run([top('Thing', { definition: 'Costs about 3.5 euros e.g. per unit' })], 'definition-length')).toEqual([]);
	});

	it('asks for review when branches differ much in depth, as info for human judgement', () => {
		const concepts = [
			top('Shallow'),
			top('Deep'),
			under('D1', ['Deep']),
			under('D2', ['D1']),
			under('D3', ['D2']),
			under('D4', ['D3'])
		];
		const found = run(concepts, 'depth-inconsistent');
		expect(found.map((f) => [f.elementIri, f.severity])).toEqual([['urn:c:Shallow', 'info']]);
		expect(found[0].message).toMatch(/for human judgement/i);
	});

	it('asks for review of siblings whose definitions overlap, as info for human judgement', () => {
		const concepts = [
			top('Vehicle'),
			under('Car', ['Vehicle'], { definition: 'A wheeled motor vehicle used for transporting passengers on roads.' }),
			under('Automobile', ['Vehicle'], { definition: 'A wheeled motor vehicle used for transporting passengers on roads.' }),
			under('Boat', ['Vehicle'], { definition: 'A craft that floats and carries cargo over water.' })
		];
		const found = run(concepts, 'sibling-overlap');
		expect(found).toHaveLength(1);
		expect(found[0].severity).toBe('info');
		expect(found[0].message).toMatch(/for human judgement/i);
		expect(found[0].message).toMatch(/Car/);
		expect(found[0].message).toMatch(/Automobile/);
	});

	it('every review prompt is info and labelled', () => {
		for (const f of run([top('Shallow'), top('A'), under('B', ['A']), under('C', ['B']), under('D', ['C'])])) {
			if (f.severity === 'info') expect(f.message).toMatch(/for human judgement/i);
		}
	});
});
