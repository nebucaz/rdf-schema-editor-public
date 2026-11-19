import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import ConceptNeighborhood from './ConceptNeighborhood.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (id: string, over: Partial<Concept> = {}): Concept =>
	({
		iri: `urn:c:${id}`,
		prefLabels: [{ text: id, lang: 'en' }],
		altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
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
