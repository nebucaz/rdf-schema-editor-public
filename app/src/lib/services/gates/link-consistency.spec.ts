import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { runGates } from './index';
import { LINK_CONSISTENCY_GATES } from './link-consistency';

const NS = 'http://e';
const concept = (id: string, broader: string[] = []): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: broader.length === 0, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: broader.map((b) => `urn:c:${b}`), related: [], mappings: []
});
const cls = (id: string, concept?: string) => ({
	iri: `${NS}#${id}`, label: id, comment: null, namespaceBaseIri: NS, definedByConcept: concept ? `urn:c:${concept}` : undefined
});
const sub = (a: string, b: string) => ({ sub: `${NS}#${a}`, super: `${NS}#${b}`, namespaceBaseIri: NS });
const schemaOf = (classes: ReturnType<typeof cls>[], subClassOf: ReturnType<typeof sub>[]) =>
	({ classes, subClassOf }) as unknown as FetchedSchema;
const run = (schema: FetchedSchema, concepts?: Concept[]) =>
	runGates(schema, { concepts, stages: ['taxonomy'] }, LINK_CONSISTENCY_GATES);

const concepts = [concept('Animal'), concept('Dog', ['Animal']), concept('Puppy', ['Dog']), concept('Plant')];

describe('link consistency gate (STORY-330)', () => {
	it('is silent without a vocabulary', () => {
		expect(run(schemaOf([cls('A', 'Dog'), cls('B', 'Animal')], [sub('A', 'B')]), undefined)).toEqual([]);
	});

	it('accepts a subclass whose concept is transitively narrower than its superclass concept', () => {
		expect(run(schemaOf([cls('Pup', 'Puppy'), cls('Animal2', 'Animal')], [sub('Pup', 'Animal2')]), concepts)).toEqual([]);
	});

	it('warns when the subclass concept is not narrower, explaining both chains', () => {
		const schema = schemaOf([cls('Dog2', 'Dog'), cls('Plant2', 'Plant'), cls('Thing')], [sub('Dog2', 'Plant2'), sub('Plant2', 'Thing')]);
		const found = run(schema, concepts);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ gateId: 'class-concept-hierarchy', stage: 'taxonomy', severity: 'warning', elementIri: `${NS}#Dog2` });
		expect(found[0].message).toContain('Dog2 → Plant2 → Thing');
		expect(found[0].message).toContain('Dog → Animal');
		expect(found[0].message).toContain('Plant');
	});

	it('warns when the subclass concept is above the superclass concept', () => {
		const found = run(schemaOf([cls('A', 'Animal'), cls('B', 'Dog')], [sub('A', 'B')]), concepts);
		expect(found).toHaveLength(1);
	});

	it('leaves classes without a concept, and unknown concepts, alone', () => {
		expect(run(schemaOf([cls('A'), cls('B', 'Dog')], [sub('A', 'B')]), concepts)).toEqual([]);
		expect(run(schemaOf([cls('A', 'Gone'), cls('B', 'Dog')], [sub('A', 'B')]), concepts)).toEqual([]);
	});

	it('does not loop on a class cycle or a concept cycle', () => {
		const cyc = [concept('X', ['Y']), concept('Y', ['X'])];
		const schema = schemaOf([cls('A', 'X'), cls('B', 'Y'), cls('C', 'Animal')], [sub('A', 'B'), sub('B', 'A'), sub('A', 'C')]);
		expect(() => run(schema, [...cyc, ...concepts])).not.toThrow();
	});
});
