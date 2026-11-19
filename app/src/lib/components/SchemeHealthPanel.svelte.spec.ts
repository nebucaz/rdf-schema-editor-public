import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import SchemeHealthPanel from './SchemeHealthPanel.svelte';
import { analyseSchemeHealth } from '#lib/services/scheme-health.js';
import type { Concept } from '#lib/services/skos-concept.js';

const c = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id.toUpperCase(), lang: 'en' }], altLabels: [], hiddenLabels: [], definition: 'd',
	scopeNote: '', disambiguation: '', schemeIri: 'urn:s:hr#staff', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', ...over
});
const concepts = [c('a', { topConcept: true }), c('b', { broader: ['urn:c:a'] }), c('e', { broader: ['urn:c:a', 'urn:c:b'] }), c('lonely')];

describe('SchemeHealthPanel (STORY-422)', () => {
	it('shows the metrics of a scheme with Open links to the concepts concerned', () => {
		render(SchemeHealthPanel, { props: { reports: analyseSchemeHealth(concepts), concepts } });
		const region = screen.getByRole('region', { name: 'Scheme health' });
		expect(within(region).getByText('staff')).toBeTruthy();
		expect(within(region).getByTestId('metric-concepts').textContent).toContain('4');
		expect(within(region).getByTestId('metric-orphans').textContent).toContain('1');
		const orphan = within(within(region).getByTestId('list-orphans')).getByRole('link', { name: 'LONELY' });
		expect(orphan.getAttribute('href')).toContain('/vocabulary?concept=urn%3Ac%3Alonely');
		expect(within(within(region).getByTestId('list-polyhierarchy')).getByRole('link', { name: 'E' })).toBeTruthy();
	});

	it('says so when there are no concepts', () => {
		render(SchemeHealthPanel, { props: { reports: [], concepts: [] } });
		expect(screen.getByText('No concepts to analyse.')).toBeTruthy();
	});
});
