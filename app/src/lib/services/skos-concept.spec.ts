import { describe, expect, it } from 'vitest';
import {
	CONCEPT_STATUSES,
	addAlternativeLabel,
	conceptTitle,
	filterConcepts,
	moveLabelToReplacement,
	type Concept,
	canTransition,
	findSimilarConcepts,
	nextStatuses,
	normaliseLabel,
	validateConceptDraft,
	validateStatusChange,
	type ConceptDraft
} from './skos-concept';

const draft = (over: Partial<ConceptDraft> = {}): ConceptDraft => ({
	prefLabels: [{ text: 'Customer', lang: 'en' }],
	altLabels: [],
	hiddenLabels: [],
	definition: 'A party that buys goods or services.',
	scopeNote: '',
	disambiguation: '',
	schemeIri: '',
	topConcept: false,
	status: 'proposed',
	source: '',
	authority: '',
	replacedBy: '',
	deprecationReason: '',
	...over
});

describe('status transitions (STORY-322)', () => {
	it('lists the lifecycle in order', () => {
		expect(CONCEPT_STATUSES).toEqual(['proposed', 'approved', 'active', 'deprecated', 'retired']);
	});

	it('allows only the next step forward', () => {
		expect(canTransition('proposed', 'approved')).toBe(true);
		expect(canTransition('approved', 'active')).toBe(true);
		expect(canTransition('active', 'deprecated')).toBe(true);
		expect(canTransition('deprecated', 'retired')).toBe(true);
		expect(canTransition('proposed', 'active')).toBe(false);
		expect(canTransition('active', 'proposed')).toBe(false);
		expect(canTransition('retired', 'active')).toBe(false);
		expect(canTransition('active', 'active')).toBe(false);
	});

	it('nextStatuses returns the single allowed successor, none after retired', () => {
		expect(nextStatuses('approved')).toEqual(['active']);
		expect(nextStatuses('retired')).toEqual([]);
	});

	it('deprecating needs a reason; a replacement is optional', () => {
		expect(validateStatusChange('active', 'deprecated', { reason: '  ' })).toMatch(/reason/i);
		expect(validateStatusChange('active', 'deprecated', { reason: 'Merged into Client' })).toBeNull();
		expect(validateStatusChange('active', 'deprecated', { reason: 'Merged', replacedBy: 'not an iri' })).toMatch(/replacement/i);
		expect(validateStatusChange('active', 'deprecated', { reason: 'Merged', replacedBy: 'http://example.org/core/vocab#Client' })).toBeNull();
	});

	it('refuses an illegal jump', () => {
		expect(validateStatusChange('proposed', 'active', {})).toMatch(/proposed.*active/i);
	});

	it('other transitions need nothing extra', () => {
		expect(validateStatusChange('proposed', 'approved', {})).toBeNull();
	});
});

describe('validateConceptDraft (STORY-322)', () => {
	it('accepts a complete draft', () => {
		expect(validateConceptDraft(draft())).toEqual([]);
	});

	it('needs at least one preferred label with text', () => {
		expect(validateConceptDraft(draft({ prefLabels: [] }))).toContain('A preferred label is required');
		expect(validateConceptDraft(draft({ prefLabels: [{ text: ' ', lang: 'en' }] }))).toContain('A preferred label is required');
	});

	it('allows exactly one preferred label per language', () => {
		const errors = validateConceptDraft(
			draft({ prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Client', lang: 'en' }] })
		);
		expect(errors).toContain('Only one preferred label per language (en)');
		expect(
			validateConceptDraft(draft({ prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }] }))
		).toEqual([]);
	});

	it('keeps the preferred label free of parentheses; the qualifier goes in disambiguation', () => {
		expect(validateConceptDraft(draft({ prefLabels: [{ text: 'Bank (finance)', lang: 'en' }] }))).toContain(
			'Preferred label must not contain parentheses; use the disambiguation field'
		);
	});

	it('does not repeat an alternative label of the preferred label', () => {
		expect(validateConceptDraft(draft({ altLabels: [{ text: 'customer', lang: 'en' }] }))).toContain(
			'Alternative label "customer" repeats the preferred label'
		);
	});

	it('requires a definition once the concept leaves proposed', () => {
		expect(validateConceptDraft(draft({ status: 'approved', definition: '' }))).toContain(
			'A definition is required before a concept is approved'
		);
		expect(validateConceptDraft(draft({ status: 'proposed', definition: '' }))).toEqual([]);
	});

	it('a top concept needs a scheme', () => {
		expect(validateConceptDraft(draft({ topConcept: true, schemeIri: '' }))).toContain('A top concept needs a scheme');
	});
});

describe('duplicate and variant check (STORY-322, book p. 51)', () => {
	const existing = [
		{ iri: 'urn:c:1', prefLabels: [{ text: 'Customer', lang: 'en' }], altLabels: [{ text: 'Client', lang: 'en' }] },
		{ iri: 'urn:c:2', prefLabels: [{ text: 'Invoice', lang: 'en' }], altLabels: [] },
		{ iri: 'urn:c:3', prefLabels: [{ text: 'Product line', lang: 'en' }], altLabels: [] }
	];

	it('normalises case, accents, whitespace and punctuation', () => {
		expect(normaliseLabel('  Café  Latté! ')).toBe('cafe latte');
	});

	it('finds an equal preferred label', () => {
		expect(findSimilarConcepts('customer', existing)).toEqual([
			{ iri: 'urn:c:1', match: 'equal', via: 'preferred', label: 'Customer' }
		]);
	});

	it('finds an equal alternative label and says so', () => {
		expect(findSimilarConcepts('Client', existing)).toEqual([
			{ iri: 'urn:c:1', match: 'equal', via: 'alternative', label: 'Client' }
		]);
	});

	it('finds near labels: plural, one typo, word order', () => {
		expect(findSimilarConcepts('Customers', existing).map((m) => [m.iri, m.match])).toEqual([['urn:c:1', 'similar']]);
		expect(findSimilarConcepts('Invoise', existing).map((m) => m.iri)).toEqual(['urn:c:2']);
		expect(findSimilarConcepts('line product', existing).map((m) => m.iri)).toEqual(['urn:c:3']);
	});

	it('does not match unrelated labels or very short ones loosely', () => {
		expect(findSimilarConcepts('Warehouse', existing)).toEqual([]);
		expect(findSimilarConcepts('Cat', [{ iri: 'urn:c:9', prefLabels: [{ text: 'Car', lang: 'en' }], altLabels: [] }])).toEqual([]);
		expect(findSimilarConcepts('  ', existing)).toEqual([]);
	});

	it('can ignore the concept being edited', () => {
		expect(findSimilarConcepts('Customer', existing, { ignoreIri: 'urn:c:1' })).toEqual([]);
	});

	it('lists equal matches before similar ones', () => {
		const list = [
			{ iri: 'urn:a', prefLabels: [{ text: 'Customers', lang: 'en' }], altLabels: [] },
			{ iri: 'urn:b', prefLabels: [{ text: 'Customer', lang: 'en' }], altLabels: [] }
		];
		expect(findSimilarConcepts('Customer', list).map((m) => m.iri)).toEqual(['urn:b', 'urn:a']);
	});
});

describe('concept list helpers (STORY-323)', () => {
	const base = (over: Partial<Concept>): Concept => ({
		...draft(),
		iri: 'urn:c',
		created: '',
		modified: '',
		deprecatedOn: '',
		...over
	});
	const list = [
		base({ iri: 'urn:1', prefLabels: [{ text: 'Customer', lang: 'en' }], altLabels: [{ text: 'Client', lang: 'en' }], status: 'active', schemeIri: 'urn:s1' }),
		base({ iri: 'urn:2', prefLabels: [{ text: 'Invoice', lang: 'en' }], definition: 'A bill for a customer order', status: 'proposed', schemeIri: 'urn:s2' }),
		base({ iri: 'urn:3', prefLabels: [{ text: 'Café', lang: 'en' }], status: 'active', schemeIri: 'urn:s2' })
	];

	it('filters by search over labels, alternative labels and definition, ignoring case and accents', () => {
		expect(filterConcepts(list, { search: 'client' }).map((c) => c.iri)).toEqual(['urn:1']);
		expect(filterConcepts(list, { search: 'CUSTOMER' }).map((c) => c.iri)).toEqual(['urn:1', 'urn:2']);
		expect(filterConcepts(list, { search: 'cafe' }).map((c) => c.iri)).toEqual(['urn:3']);
	});

	it('filters by status and scheme and combines the filters', () => {
		expect(filterConcepts(list, { status: 'active' }).map((c) => c.iri)).toEqual(['urn:1', 'urn:3']);
		expect(filterConcepts(list, { schemeIri: 'urn:s2' }).map((c) => c.iri)).toEqual(['urn:2', 'urn:3']);
		expect(filterConcepts(list, { status: 'active', schemeIri: 'urn:s2' }).map((c) => c.iri)).toEqual(['urn:3']);
		expect(filterConcepts(list, {})).toHaveLength(3);
	});

	it('conceptTitle shows the preferred label with its qualifier', () => {
		expect(conceptTitle(base({ prefLabels: [{ text: 'Bank', lang: 'en' }], disambiguation: 'finance' }))).toBe('Bank (finance)');
		expect(conceptTitle(base({ prefLabels: [{ text: 'Bank', lang: 'en' }], disambiguation: '' }))).toBe('Bank');
		expect(conceptTitle(base({ prefLabels: [] }))).toBe('(no label)');
	});

	it('moveLabelToReplacement adds the old preferred label as a hidden label on the replacement', () => {
		const old = base({ prefLabels: [{ text: 'Client', lang: 'en' }] });
		const replacement = base({ iri: 'urn:r', prefLabels: [{ text: 'Customer', lang: 'en' }] });
		const moved = moveLabelToReplacement(old, replacement);
		expect(moved?.hiddenLabels).toEqual([{ text: 'Client', lang: 'en' }]);
		expect(moved?.prefLabels).toEqual(replacement.prefLabels);
	});

	it('moveLabelToReplacement does nothing when the replacement already carries the label', () => {
		const old = base({ prefLabels: [{ text: 'Client', lang: 'en' }] });
		expect(moveLabelToReplacement(old, base({ iri: 'urn:r', altLabels: [{ text: 'client', lang: 'en' }] }))).toBeNull();
		expect(moveLabelToReplacement(old, base({ iri: 'urn:r', hiddenLabels: [{ text: 'Client', lang: 'en' }] }))).toBeNull();
	});

	it('addAlternativeLabel appends a label once', () => {
		const c = base({ altLabels: [{ text: 'Client', lang: 'en' }] });
		expect(addAlternativeLabel(c, 'Buyer', 'en').altLabels).toEqual([{ text: 'Client', lang: 'en' }, { text: 'Buyer', lang: 'en' }]);
		expect(addAlternativeLabel(c, ' client ', 'en').altLabels).toEqual(c.altLabels);
	});
});
