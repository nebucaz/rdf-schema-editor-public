import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { runGates } from './index';
import { THESAURUS_GATES } from './thesaurus';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [],
	...over
});
const schema = { classes: [], subClassOf: [] } as unknown as FetchedSchema;
const run = (concepts?: Concept[]) => runGates(schema, { concepts, stages: ['thesaurus'] });

describe('thesaurus gates (STORY-329)', () => {
	it('registers them under the thesaurus stage', () => {
		expect(THESAURUS_GATES.every((g) => g.stage === 'thesaurus')).toBe(true);
	});

	it('is silent without a vocabulary', () => {
		expect(run(undefined)).toEqual([]);
	});

	it('flags a mapping that points into the same scheme', () => {
		const found = run([
			concept('Bank', { mappings: [{ kind: 'exactMatch', target: 'urn:c:Lender' }] }),
			concept('Lender'),
			concept('River', { schemeIri: 'urn:scheme:b' }),
			concept('Shore', { mappings: [{ kind: 'closeMatch', target: 'urn:c:River' }] })
		]);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ gateId: 'mapping-within-scheme', severity: 'warning', elementIri: 'urn:c:Bank' });
	});

	it('flags a related link between a concept and its own ancestor, in either direction, as info', () => {
		const concepts = [
			concept('Animal', { topConcept: true }),
			concept('Dog', { broader: ['urn:c:Animal'] }),
			concept('Puppy', { broader: ['urn:c:Dog'], related: ['urn:c:Animal'] }),
			concept('Plant', { topConcept: true, related: ['urn:c:Dog'] })
		];
		const found = run(concepts);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ gateId: 'related-within-chain', severity: 'info', elementIri: 'urn:c:Puppy' });
		expect(found[0].message).toMatch(/for human judgement/i);
	});

	it('does not loop on a broader cycle', () => {
		const concepts = [
			concept('A', { broader: ['urn:c:B'], related: ['urn:c:B'] }),
			concept('B', { broader: ['urn:c:A'] })
		];
		expect(() => run(concepts)).not.toThrow();
	});
});
