import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ConceptReview from './ConceptReview.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definition: `${id} is defined.`,
	scopeNote: '', disambiguation: '', schemeIri: 'urn:s', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', broader: [], related: [], mappings: [], ...over
});

describe('ConceptReview (STORY-335)', () => {
	const bank = concept('Bank', {
		altLabels: [{ text: 'Credit house', lang: 'en' }], scopeNote: 'Financial sense only.', disambiguation: 'finance',
		source: 'ISO 704', authority: 'Data Office', broader: ['urn:c:Institution'], related: ['urn:c:Lender'],
		mappings: [{ kind: 'exactMatch', target: 'http://xmlns.com/foaf/0.1/Organization' }]
	});
	const all = [bank, concept('Institution'), concept('Lender')];

	function setup(c = bank) {
		render(ConceptReview, { props: { concept: c, concepts: all, schemeName: 'Glossary' } });
	}

	it('shows the term, its status, scheme and definition', () => {
		setup();
		expect(screen.getByRole('heading', { name: 'Bank (finance)' })).toBeTruthy();
		expect(screen.getByText('active')).toBeTruthy();
		expect(screen.getByText(/Glossary/)).toBeTruthy();
		expect(screen.getByText('Bank is defined.')).toBeTruthy();
		expect(screen.getByText('Financial sense only.')).toBeTruthy();
	});

	it('shows alternative labels, the hierarchy, related concepts and mappings', () => {
		setup();
		expect(screen.getByText('Credit house')).toBeTruthy();
		expect(screen.getByText('Institution')).toBeTruthy();
		expect(screen.getByText('Lender')).toBeTruthy();
		expect(screen.getByText('http://xmlns.com/foaf/0.1/Organization')).toBeTruthy();
	});

	it('shows why and by what a deprecated concept was replaced', () => {
		setup(concept('Old', { status: 'deprecated', deprecationReason: 'Merged', replacedBy: 'urn:c:Lender', deprecatedOn: '2026-01-01' }));
		expect(screen.getByText(/Merged/)).toBeTruthy();
		expect(screen.getByText('Lender')).toBeTruthy();
	});

	it('renders no edit controls', () => {
		setup();
		expect(screen.queryAllByRole('button')).toHaveLength(0);
		expect(screen.queryAllByRole('textbox')).toHaveLength(0);
		expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
		expect(screen.queryAllByRole('combobox')).toHaveLength(0);
	});
});
