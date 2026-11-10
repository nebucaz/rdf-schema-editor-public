import { describe, expect, it } from 'vitest';
import { composeMappingTarget, relationsOf, validateRelation } from './concept-relations';
import type { Concept } from './skos-concept';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [],
	...over
});
const all = [concept('Bank'), concept('Lender'), concept('River', { schemeIri: 'urn:scheme:b' })];

describe('validateRelation (STORY-329)', () => {
	it('refuses a mapping to a concept of the same scheme', () => {
		expect(validateRelation(all, 'urn:c:Bank', 'exactMatch', 'urn:c:Lender')).toMatch(/same scheme/i);
	});

	it('accepts a mapping to a concept of another scheme or to an outside IRI', () => {
		expect(validateRelation(all, 'urn:c:Bank', 'closeMatch', 'urn:c:River')).toBeNull();
		expect(validateRelation(all, 'urn:c:Bank', 'broadMatch', 'http://xmlns.com/foaf/0.1/Agent')).toBeNull();
	});

	it('refuses a target that is not an IRI or is the concept itself', () => {
		expect(validateRelation(all, 'urn:c:Bank', 'exactMatch', 'not an iri')).toMatch(/IRI/);
		expect(validateRelation(all, 'urn:c:Bank', 'exactMatch', 'urn:c:Bank')).toMatch(/itself/i);
		expect(validateRelation(all, 'urn:c:Bank', 'related', 'urn:c:Bank')).toMatch(/itself/i);
	});

	it('only relates a concept to a concept of the vocabulary', () => {
		expect(validateRelation(all, 'urn:c:Bank', 'related', 'urn:c:Lender')).toBeNull();
		expect(validateRelation(all, 'urn:c:Bank', 'related', 'http://elsewhere/x')).toMatch(/vocabulary/i);
	});

	it('refuses a duplicate relation', () => {
		const withRel = [concept('Bank', { related: ['urn:c:Lender'] }), concept('Lender')];
		expect(validateRelation(withRel, 'urn:c:Bank', 'related', 'urn:c:Lender')).toMatch(/already/i);
		expect(validateRelation(withRel, 'urn:c:Lender', 'related', 'urn:c:Bank')).toMatch(/already/i);
	});
});

describe('relationsOf', () => {
	it('lists related concepts from both directions and the concept\'s own mappings', () => {
		const concepts = [
			concept('Bank', { related: ['urn:c:Lender'], mappings: [{ kind: 'exactMatch', target: 'http://x/Bank' }] }),
			concept('Lender'),
			concept('Shore', { related: ['urn:c:Bank'] })
		];
		const r = relationsOf(concepts[0], concepts);
		expect(r.related.sort()).toEqual(['urn:c:Lender', 'urn:c:Shore']);
		expect(r.mappings).toEqual([{ kind: 'exactMatch', target: 'http://x/Bank' }]);
	});
});

describe('composeMappingTarget', () => {
	it('joins a registered vocabulary and a local name, or keeps a full IRI', () => {
		expect(composeMappingTarget('http://xmlns.com/foaf/0.1/', 'Agent')).toBe('http://xmlns.com/foaf/0.1/Agent');
		expect(composeMappingTarget('http://schema.org/', 'Person')).toBe('http://schema.org/Person');
		expect(composeMappingTarget('http://example.org/vocab#', 'Thing')).toBe('http://example.org/vocab#Thing');
		expect(composeMappingTarget('', 'http://other/Thing')).toBe('http://other/Thing');
		expect(composeMappingTarget('http://schema.org/', 'http://other/Thing')).toBe('http://other/Thing');
	});
});
