import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import SchemeHealthTile from './SchemeHealthTile.svelte';
import { analyseSchemeHealth } from '#lib/services/scheme-health.js';
import type { Concept } from '#lib/services/skos-concept.js';

const c = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id.toUpperCase(), lang: 'en' }], altLabels: [], hiddenLabels: [], definition: 'd',
	scopeNote: '', disambiguation: '', schemeIri: 'urn:s:hr#staff', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', ...over
});
const concepts = [c('a', { topConcept: true }), c('b', { broader: ['urn:c:a'] }), c('e', { broader: ['urn:c:a', 'urn:c:b'] }), c('lonely')];

describe('SchemeHealthTile (STORY-472)', () => {
	it('shows the metrics of each scheme and lists no concept', () => {
		render(SchemeHealthTile, { props: { reports: analyseSchemeHealth(concepts) } });
		const table = screen.getByRole('table', { name: 'Scheme health' });
		expect(within(table).getByRole('rowheader').textContent).toBe('staff');
		expect(within(table).getByTestId('metric-concepts').textContent).toBe('4');
		expect(within(table).getByTestId('metric-orphans').textContent).toBe('1');
		expect(within(table).getByTestId('metric-clusters').textContent).toBe('2');
		expect(screen.queryByText('LONELY')).toBeNull();
		expect(screen.queryByText('Orphan concepts')).toBeNull();
		expect(screen.queryByTestId('list-orphans')).toBeNull();
	});

	it('uses the given scheme name', () => {
		render(SchemeHealthTile, { props: { reports: analyseSchemeHealth(concepts), schemeNames: { 'urn:s:hr#staff': 'Staff scheme' } } });
		expect(screen.getByRole('rowheader').textContent).toBe('Staff scheme');
	});

	it('says so when there are no concepts', () => {
		render(SchemeHealthTile, { props: { reports: [] } });
		expect(screen.getByText('No concepts to analyse.')).toBeTruthy();
	});
});
