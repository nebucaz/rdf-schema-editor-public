import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import ConceptNeighborhood from './ConceptNeighborhood.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (id: string, over: Partial<Concept> = {}): Concept =>
	({
		iri: `urn:c:${id}`,
		prefLabels: [{ text: id, lang: 'en' }],
		altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [], disambiguation: '',
		schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: '', authority: '',
		replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
		broader: [],
		...over
	}) as Concept;

const concepts = [
	concept('Animal', { topConcept: true }),
	concept('Dog', { broader: ['urn:c:Animal'], related: ['urn:c:Wolf'] }),
	concept('Puppy', { broader: ['urn:c:Dog'] }),
	concept('Wolf'),
	concept('Lonely')
];

describe('ConceptNeighborhood', () => {
	it('shows the broader, narrower and related concepts of the concept', () => {
		render(ConceptNeighborhood, { props: { concepts, iri: 'urn:c:Dog', onSelect: vi.fn() } });
		expect(screen.getByRole('group', { name: 'Neighbourhood of Dog' })).toBeTruthy();
		for (const name of ['Animal', 'Puppy', 'Wolf']) expect(screen.getByRole('button', { name: new RegExp(`^Select ${name}`) })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Select Animal \(broader\)/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Select Puppy \(narrower\)/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Select Wolf \(related\)/ })).toBeTruthy();
	});

	it('selects a neighbour on click and on Enter', async () => {
		const onSelect = vi.fn();
		render(ConceptNeighborhood, { props: { concepts, iri: 'urn:c:Dog', onSelect } });
		await fireEvent.click(screen.getByRole('button', { name: /^Select Puppy/ }));
		expect(onSelect).toHaveBeenLastCalledWith('urn:c:Puppy');
		await fireEvent.keyDown(screen.getByRole('button', { name: /^Select Animal/ }), { key: 'Enter' });
		expect(onSelect).toHaveBeenLastCalledWith('urn:c:Animal');
	});

	it('is hidden for a concept without relations', () => {
		const { container } = render(ConceptNeighborhood, { props: { concepts, iri: 'urn:c:Lonely', onSelect: vi.fn() } });
		expect(container.querySelector('details')).toBeNull();
		expect(screen.queryByText('Neighbourhood')).toBeNull();
	});

	it('is collapsible', () => {
		const { container } = render(ConceptNeighborhood, { props: { concepts, iri: 'urn:c:Dog', onSelect: vi.fn() } });
		expect(container.querySelector('details summary')?.textContent).toContain('Neighbourhood');
	});

	it('issues no writes: no connector in the source', () => {
		const source = readFileSync('src/lib/components/ConceptNeighborhood.svelte', 'utf8');
		expect(source).not.toMatch(/sparql-connector|sparqlConnector|fetch\(/);
	});
});
const flat = (id: string, over: Partial<Concept> = {}): Concept => concept(id, { schemeIri: 'urn:s:life', ...over });
const schemes = [{ iri: 'urn:s:life', name: 'Lifecycle', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }];

describe('ConceptNeighborhood scheme node', () => {
	it('draws a flat concept hanging off its scheme, where there used to be nothing', () => {
		render(ConceptNeighborhood, { props: { concepts: [flat('Draft')], iri: 'urn:c:Draft', schemes } });
		expect(screen.getByRole('group', { name: /Neighbourhood of Draft/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Select Lifecycle (scheme)' })).toBeTruthy();
	});

	it('reports the scheme to onSelectScheme, not onSelect', async () => {
		const onSelect = vi.fn();
		const onSelectScheme = vi.fn();
		render(ConceptNeighborhood, { props: { concepts: [flat('Draft')], iri: 'urn:c:Draft', schemes, onSelect, onSelectScheme } });
		await fireEvent.click(screen.getByRole('button', { name: 'Select Lifecycle (scheme)' }));
		expect(onSelectScheme).toHaveBeenCalledWith('urn:s:life');
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('links the scheme node on read-only pages', () => {
		render(ConceptNeighborhood, { props: { concepts: [flat('Draft')], iri: 'urn:c:Draft', schemes, href: (i: string) => `/c/${i}`, schemeHref: (i: string) => `/s/${i}` } });
		expect(screen.getByRole('link', { name: 'Select Lifecycle (scheme)' }).getAttribute('href')).toBe('/s/urn:s:life');
	});

	it('shows no scheme node when a broader concept exists, and nothing at all without relations or schemes', () => {
		const cs = [flat('Top', { topConcept: true }), flat('Kid', { broader: ['urn:c:Top'] })];
		render(ConceptNeighborhood, { props: { concepts: cs, iri: 'urn:c:Kid', schemes } });
		expect(screen.queryByRole('button', { name: /\(scheme\)/ })).toBeNull();
	});

	it('stays hidden for a concept with no relations when no schemes are given', () => {
		const { container } = render(ConceptNeighborhood, { props: { concepts: [flat('Draft')], iri: 'urn:c:Draft' } });
		expect(container.querySelector('svg')).toBeNull();
	});
});
