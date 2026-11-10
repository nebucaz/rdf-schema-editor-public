import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import { lintLabel, runVocabularyGates, VOCABULARY_GATES } from './vocabulary';
import { runGates } from './index';
import type { FetchedSchema } from '../sparql-connector';

const concept = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [],
	hiddenLabels: [],
	definition: 'A defined thing.',
	scopeNote: '',
	disambiguation: '',
	schemeIri: '',
	topConcept: false,
	status: 'active',
	source: 'ISO 704',
	authority: 'Data Office',
	replacedBy: '',
	deprecationReason: '',
	created: '',
	modified: '',
	deprecatedOn: '',
	...over
});

const ids = (concepts: Concept[], gateId?: string) =>
	runVocabularyGates(concepts)
		.filter((f) => !gateId || f.gateId === gateId)
		.map((f) => [f.gateId, f.elementIri, f.severity]);

describe('lintLabel (STORY-324)', () => {
	it('accepts a plain label', () => {
		expect(lintLabel('Customer account')).toEqual([]);
		expect(lintLabel('Terms of service')).toEqual([]);
		expect(lintLabel('customer')).toEqual([]);
	});

	it('asks for review above four words', () => {
		expect(lintLabel('One two three four')).toEqual([]);
		expect(lintLabel('One two three four five')).toEqual([{ kind: 'long', detail: '5 words' }]);
	});

	it.each([':', ';', '(', ')', '?', '!'])('flags the character %s', (ch) => {
		expect(lintLabel(`Order ${ch} line`).map((i) => i.kind)).toEqual(['punctuation']);
	});

	it('does not flag other punctuation', () => {
		expect(lintLabel("Customer's order, final-state & more")).toEqual([]);
	});

	it('flags markup', () => {
		for (const label of ['<b>Customer</b>', '**Customer**', '`Customer`', '[Customer](x)', '_Customer_']) {
			expect(lintLabel(label).map((i) => i.kind), label).toContain('markup');
		}
	});

	it('flags odd capitalisation: internal capitals and mixed word case', () => {
		expect(lintLabel('customerAccount').map((i) => i.kind)).toEqual(['capitalisation']);
		expect(lintLabel('cUSTomer').map((i) => i.kind)).toEqual(['capitalisation']);
		expect(lintLabel('Customer account Type').map((i) => i.kind)).toEqual(['capitalisation']);
	});

	it('accepts consistent capitalisation, small words and acronyms', () => {
		expect(lintLabel('Customer Account Type')).toEqual([]);
		expect(lintLabel('customer account type')).toEqual([]);
		expect(lintLabel('Terms Of Service')).toEqual([]);
		expect(lintLabel('Customer account')).toEqual([]);
		expect(lintLabel('Open API')).toEqual([]);
	});
});

describe('vocabulary gates (STORY-324)', () => {
	it('registers every gate under the vocabulary stage', () => {
		expect(VOCABULARY_GATES.length).toBeGreaterThanOrEqual(8);
		expect(new Set(VOCABULARY_GATES.map((g) => g.stage))).toEqual(new Set(['vocabulary']));
		expect(new Set(VOCABULARY_GATES.map((g) => g.id)).size).toBe(VOCABULARY_GATES.length);
	});

	it('a clean vocabulary has no findings', () => {
		expect(runVocabularyGates([concept('urn:1', 'Customer'), concept('urn:2', 'Invoice')])).toEqual([]);
	});

	it('concept-without-definition', () => {
		expect(ids([concept('urn:1', 'Customer', { definition: '  ' })], 'concept-without-definition')).toEqual([
			['concept-without-definition', 'urn:1', 'warning']
		]);
	});

	it('duplicate-preferred-label: case-insensitive, per language, homonyms with a qualifier are allowed', () => {
		const a = concept('urn:1', 'Customer');
		const b = concept('urn:2', 'customer');
		expect(ids([a, b], 'duplicate-preferred-label')).toEqual([
			['duplicate-preferred-label', 'urn:1', 'warning'],
			['duplicate-preferred-label', 'urn:2', 'warning']
		]);
		const bank1 = concept('urn:3', 'Bank', { disambiguation: 'finance' });
		const bank2 = concept('urn:4', 'Bank', { disambiguation: 'river' });
		expect(ids([bank1, bank2], 'duplicate-preferred-label')).toEqual([]);
		const de = concept('urn:5', 'Customer', { prefLabels: [{ text: 'Customer', lang: 'de' }] });
		expect(ids([a, de], 'duplicate-preferred-label')).toEqual([]);
	});

	it('alt-label-equals-other-preferred-label', () => {
		const a = concept('urn:1', 'Customer', { altLabels: [{ text: 'client', lang: 'en' }] });
		const b = concept('urn:2', 'Client');
		expect(ids([a, b], 'alt-label-equals-other-preferred-label')).toEqual([
			['alt-label-equals-other-preferred-label', 'urn:1', 'warning']
		]);
		expect(ids([concept('urn:1', 'Customer', { altLabels: [{ text: 'Buyer', lang: 'en' }] }), b], 'alt-label-equals-other-preferred-label')).toEqual([]);
	});

	it('label-too-long is info, the other style findings are warnings', () => {
		expect(ids([concept('urn:1', 'One two three four five')], 'label-too-long')).toEqual([['label-too-long', 'urn:1', 'info']]);
		expect(ids([concept('urn:1', 'Order: line')], 'label-punctuation')).toEqual([['label-punctuation', 'urn:1', 'warning']]);
		expect(ids([concept('urn:1', '**Order**')], 'label-markup')).toEqual([['label-markup', 'urn:1', 'warning']]);
		expect(ids([concept('urn:1', 'orderLine')], 'label-capitalisation')).toEqual([['label-capitalisation', 'urn:1', 'warning']]);
	});

	it('the linter also checks alternative labels', () => {
		const c = concept('urn:1', 'Customer', { altLabels: [{ text: 'Client (old)', lang: 'en' }] });
		expect(ids([c], 'label-punctuation')).toEqual([['label-punctuation', 'urn:1', 'warning']]);
	});

	it('acronym-as-preferred-label', () => {
		expect(ids([concept('urn:1', 'CRM')], 'acronym-as-preferred-label')).toEqual([['acronym-as-preferred-label', 'urn:1', 'warning']]);
		expect(ids([concept('urn:1', 'Customer relationship management')], 'acronym-as-preferred-label')).toEqual([]);
		expect(ids([concept('urn:1', 'A')], 'acronym-as-preferred-label')).toEqual([]);
	});

	it('concept-without-provenance', () => {
		expect(ids([concept('urn:1', 'Customer', { source: '' })], 'concept-without-provenance')).toEqual([['concept-without-provenance', 'urn:1', 'warning']]);
		expect(ids([concept('urn:1', 'Customer', { authority: ' ' })], 'concept-without-provenance')).toEqual([['concept-without-provenance', 'urn:1', 'warning']]);
	});

	it('multiple-preferred-labels-per-language', () => {
		const c = concept('urn:1', 'Customer', { prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Client', lang: 'en' }] });
		expect(ids([c], 'multiple-preferred-labels-per-language')).toEqual([['multiple-preferred-labels-per-language', 'urn:1', 'warning']]);
		const ok = concept('urn:1', 'Customer', { prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }] });
		expect(ids([ok], 'multiple-preferred-labels-per-language')).toEqual([]);
	});

	it('label-roles-overlap: preferred, alternative and hidden labels are disjoint', () => {
		const c = concept('urn:1', 'Customer', { altLabels: [{ text: 'Client', lang: 'en' }], hiddenLabels: [{ text: 'client', lang: 'en' }] });
		expect(ids([c], 'label-roles-overlap')).toEqual([['label-roles-overlap', 'urn:1', 'warning']]);
		const pref = concept('urn:2', 'Customer', { hiddenLabels: [{ text: 'CUSTOMER', lang: 'en' }] });
		expect(ids([pref], 'label-roles-overlap')).toEqual([['label-roles-overlap', 'urn:2', 'warning']]);
	});

	it('leaves deprecated and retired concepts out', () => {
		const bad = { definition: '', source: '' };
		expect(runVocabularyGates([concept('urn:1', 'CRM', { ...bad, status: 'deprecated' }), concept('urn:2', 'CRM', { ...bad, status: 'retired' })])).toEqual([]);
	});

	it('every finding names the concept in its message', () => {
		const [f] = runVocabularyGates([concept('urn:1', 'Customer', { definition: '' })]);
		expect(f.stage).toBe('vocabulary');
		expect(f.message).toContain('Customer');
	});
});

describe('vocabulary gates in the gate framework (STORY-324)', () => {
	const schema = { classes: [], dataProperties: [], objectProperties: [], subClassOf: [], individuals: [] } as unknown as FetchedSchema;

	it('runGates includes them when concepts are supplied', () => {
		const findings = runGates(schema, { concepts: [concept('urn:1', 'Customer', { definition: '' })], stages: ['vocabulary'] });
		expect(findings.map((f) => f.gateId)).toEqual(['concept-without-definition']);
	});

	it('runGates finds nothing for the vocabulary stage without concepts', () => {
		expect(runGates(schema, { stages: ['vocabulary'] })).toEqual([]);
	});
});
