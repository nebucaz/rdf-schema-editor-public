import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TaxonomyViews from './TaxonomyViews.svelte';
import type { Concept, ConceptScheme } from '#lib/services/skos-concept.js';

const mkScheme = (iri: string, name: string) =>
	({ iri, name, description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }) as ConceptScheme;
const A = mkScheme('urn:scheme:a', 'Alpha');
const B = mkScheme('urn:scheme:b', 'Beta');
const concept = (id: string, schemeIri: string, over: Partial<Concept> = {}): Concept =>
	({
		iri: `urn:c:${id}`,
		prefLabels: [{ text: id, lang: 'en' }],
		altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [], disambiguation: '',
		schemeIri, topConcept: true, status: 'active', source: '', authority: '',
		replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', broader: [],
		...over
	}) as Concept;
const concepts = [concept('Animal', A.iri), concept('Dog', A.iri, { topConcept: false, broader: ['urn:c:Animal'] }), concept('Tool', B.iri)];

function setup(over: Record<string, unknown> = {}) {
	const props = {
		concepts, schemes: [A, B], classTree: [], view: 'outline' as 'outline' | 'graph', scheme: '',
		onViewChange: vi.fn(), onSchemeChange: vi.fn(), onOpenConcept: vi.fn(),
		onMove: vi.fn(async () => {}), onTopChange: vi.fn(async () => {}),
		...over
	};
	render(TaxonomyViews, { props });
	return props;
}

describe('TaxonomyViews', () => {
	it('shows the outline by default and the graph in graph view', () => {
		const { unmount } = render(TaxonomyViews, {
			props: { concepts, schemes: [A, B], classTree: [], view: 'outline', scheme: '', onViewChange: vi.fn(), onSchemeChange: vi.fn(), onOpenConcept: vi.fn(), onMove: vi.fn(), onTopChange: vi.fn() }
		});
		expect(screen.getByText('Concepts (skos:broader)')).toBeTruthy();
		expect(screen.queryByRole('group', { name: /Graph of/ })).toBeNull();
		unmount();
		setup({ view: 'graph' });
		expect(screen.getByRole('group', { name: 'Graph of Alpha' })).toBeTruthy();
		expect(screen.queryByText('Concepts (skos:broader)')).toBeNull();
	});

	it('reports the chosen view', async () => {
		const p = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
		expect(p.onViewChange).toHaveBeenCalledWith('graph');
	});

	it('preselects the scheme from the URL in both views', () => {
		setup({ scheme: B.iri });
		expect(screen.getByDisplayValue('Beta')).toBeTruthy();
		expect(screen.getAllByText('Tool').length).toBeGreaterThan(0);
		expect(screen.queryByText('Dog')).toBeNull();
	});

	it('preselects the scheme in the graph view and reports a change', async () => {
		const p = setup({ view: 'graph', scheme: B.iri });
		expect(screen.getByRole('group', { name: 'Graph of Beta' })).toBeTruthy();
		await fireEvent.change(screen.getByLabelText('Scheme'), { target: { value: A.iri } });
		expect(p.onSchemeChange).toHaveBeenCalledWith(A.iri);
	});

	it('opens a concept of the graph in the Vocabulary page', async () => {
		const p = setup({ view: 'graph' });
		await fireEvent.click(screen.getByRole('button', { name: /^Open Dog/ }));
		expect(p.onOpenConcept).toHaveBeenCalledWith('urn:c:Dog');
	});
});
