import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ConceptReview from './ConceptReview.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [{ text: `${id} is defined.`, lang: '' }],
	scopeNotes: [], disambiguation: '', schemeIri: 'urn:s', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', broader: [], related: [], mappings: [], ...over
});

describe('ConceptReview (STORY-335)', () => {
	const bank = concept('Bank', {
		altLabels: [{ text: 'Credit house', lang: 'en' }], scopeNotes: [{ text: 'Financial sense only.', lang: '' }], disambiguation: 'finance',
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
		expect(screen.getAllByText('Institution').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Lender').length).toBeGreaterThan(0);
		expect(screen.getByText('http://xmlns.com/foaf/0.1/Organization')).toBeTruthy();
	});

	it('shows why and by what a deprecated concept was replaced', () => {
		setup(concept('Old', { status: 'deprecated', deprecationReason: 'Merged', replacedBy: 'urn:c:Lender', deprecatedOn: '2026-01-01' }));
		expect(screen.getByText(/Merged/)).toBeTruthy();
		expect(screen.getAllByText('Lender').length).toBeGreaterThan(0);
	});

	it('renders no edit controls', () => {
		setup();
		expect(screen.queryAllByRole('button')).toHaveLength(0);
		expect(screen.queryAllByRole('textbox')).toHaveLength(0);
		expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
		expect(screen.queryAllByRole('combobox')).toHaveLength(0);
	});

	it('shows examples but never editorial notes or a history (STORY-407)', () => {
		const { container } = render(ConceptReview, {
			props: { concept: concept('Hub', { example: ['Rotterdam hub'], editorialNote: ['SECRET-NOTE'] }), concepts: all }
		});
		expect(screen.getByText('Rotterdam hub')).toBeTruthy();
		expect(container.textContent).not.toContain('SECRET-NOTE');
		expect(container.textContent).not.toMatch(/Editorial/i);
		expect(container.textContent).not.toMatch(/History/);
	});
});

describe('ConceptReview navigation (read-only sharing)', () => {
	const hub = concept('Hub', { schemeIri: 'urn:s', broader: ['urn:c:Top'], related: ['urn:c:Side'] });
	const all = [hub, concept('Top'), concept('Side'), concept('Leaf', { broader: ['urn:c:Hub'] })];
	const hrefOf = (name: string) => (screen.getByRole('link', { name }) as HTMLAnchorElement).getAttribute('href');

	it('links broader, narrower and related concepts to their own read-only pages', () => {
		render(ConceptReview, { props: { concept: hub, concepts: all, schemeName: 'Glossary' } });
		for (const id of ['Top', 'Leaf', 'Side']) expect(screen.getAllByRole('link', { name: id }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole('link', { name: 'Top' })[0].getAttribute('href')).toContain('/review/concept?iri=urn%3Ac%3ATop');
	});

	it('links the scheme name to the read-only scheme page when given a link', () => {
		render(ConceptReview, { props: { concept: hub, concepts: all, schemeName: 'Glossary', schemeHref: '/review/scheme?scheme=g' } });
		expect(hrefOf('Glossary')).toBe('/review/scheme?scheme=g');
	});

	it('draws the neighbourhood with a link per neighbour, and no buttons', () => {
		render(ConceptReview, { props: { concept: hub, concepts: all, schemeName: 'Glossary' } });
		expect(screen.getByRole('group', { name: /Neighbourhood of Hub/ })).toBeTruthy();
		expect(screen.getByRole('link', { name: /Select Leaf \(narrower\)/ }).getAttribute('href')).toContain('urn%3Ac%3ALeaf');
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
});

describe('ConceptReview graph drawing', () => {
	it('draws the neighbours as SVG shapes, not HTML elements', () => {
		const hub = concept('Hub', { related: ['urn:c:Side'] });
		const { container } = render(ConceptReview, { props: { concept: hub, concepts: [hub, concept('Side')] } });
		const rect = container.querySelector('a g.neighbor rect');
		expect(rect?.namespaceURI).toBe('http://www.w3.org/2000/svg');
	});
});

describe('ConceptReview flat concept', () => {
	it('draws a concept without relations hanging off its scheme, linking to the scheme page', () => {
		const flat = concept('Draft', { schemeIri: 'urn:s:life' });
		const schemes = [{ iri: 'urn:s:life', name: 'Lifecycle', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }];
		render(ConceptReview, { props: { concept: flat, concepts: [flat], schemeName: 'Lifecycle', schemes, schemeUrl: (iri: string) => `/review/scheme?scheme=${iri}` } });
		expect(screen.getByRole('link', { name: 'Select Lifecycle (scheme)' }).getAttribute('href')).toBe('/review/scheme?scheme=urn:s:life');
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
});
