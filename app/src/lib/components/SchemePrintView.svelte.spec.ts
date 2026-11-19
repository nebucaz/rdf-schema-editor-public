import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { vi } from 'vitest';
import SchemePrintView from './SchemePrintView.svelte';
import type { Concept, ConceptScheme } from '#lib/services/skos-concept.js';

const scheme: ConceptScheme = {
	iri: 's',
	name: 'Workforce',
	description: 'Roles in the hospital',
	scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' },
	metadata: { title: 'Workforce thesaurus', creator: 'HR', publisher: 'Hospital', rights: 'CC-BY', modified: '2026-11-01T10:00:00Z' }
};
const c = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [],
	hiddenLabels: [],
	definition: `About ${label}`,
	scopeNote: '',
	disambiguation: '',
	schemeIri: 's',
	topConcept: false,
	status: 'active',
	source: '',
	authority: '',
	replacedBy: '',
	deprecationReason: '',
	created: '',
	modified: '',
	deprecatedOn: '',
	...over
});
const concepts = [
	c('staff', 'Staff', { topConcept: true }),
	c('nurse', 'Nurse', {
		broader: ['staff'],
		altLabels: [{ text: 'Carer', lang: 'en' }],
		hiddenLabels: [{ text: 'Sister', lang: 'en' }],
		editorialNote: ['internal remark'],
		scopeNote: 'Registered only',
		example: ['Ward nurse']
	}),
	c('elsewhere', 'Elsewhere', { schemeIri: 'other' })
];
const collections = [{ iri: 'col', prefLabels: [{ text: 'Clinical', lang: 'en' }], ordered: false, members: ['nurse'] }];

describe('SchemePrintView', () => {
	it('renders metadata, the hierarchy and the concept details', () => {
		const { container } = render(SchemePrintView, { props: { scheme, concepts, collections } });
		const text = container.textContent ?? '';
		expect(screen.getByRole('heading', { level: 1, name: 'Workforce thesaurus' })).toBeTruthy();
		for (const expected of ['HR', 'Hospital', 'CC-BY', 'Roles in the hospital', 'About Staff', 'About Nurse', 'Carer', 'Registered only', 'Ward nurse', 'Clinical']) {
			expect(text).toContain(expected);
		}
		expect(text).not.toContain('Elsewhere');
		expect(container.querySelector('section.concept section.concept')).not.toBeNull();
	});

	it('never renders hidden labels or editorial notes', () => {
		const { container } = render(SchemePrintView, { props: { scheme, concepts, collections } });
		expect(container.textContent).not.toContain('Sister');
		expect(container.textContent).not.toContain('internal remark');
	});

	it('shows a not-found state without a scheme', () => {
		render(SchemePrintView, { props: { scheme: null, concepts, collections } });
		expect(screen.getByRole('alert').textContent).toMatch(/not found/i);
	});

	describe('graph (vocabulary-graph-and-tabs STORY-455)', () => {
		it('offers no graph without an open handler', () => {
			render(SchemePrintView, { props: { scheme, concepts, collections } });
			expect(screen.queryByRole('button', { name: 'Show graph' })).toBeNull();
		});

		it('shows the graph on demand and opens a concept through the handler', async () => {
			const onOpenConcept = vi.fn();
			render(SchemePrintView, { props: { scheme, concepts, collections, onOpenConcept } });
			expect(screen.queryByRole('group', { name: /Graph of/ })).toBeNull();
			await fireEvent.click(screen.getByRole('button', { name: 'Show graph' }));
			expect(screen.getByRole('group', { name: 'Graph of Workforce' })).toBeTruthy();
			await fireEvent.click(screen.getByRole('button', { name: /^Open Nurse/ }));
			expect(onOpenConcept).toHaveBeenCalledWith('nurse');
			await fireEvent.click(screen.getByRole('button', { name: 'Hide graph' }));
			expect(screen.queryByRole('group', { name: /Graph of/ })).toBeNull();
		});

		it('keeps hidden labels and editorial notes out of the graph and hides the toggle from print', async () => {
			const { container } = render(SchemePrintView, { props: { scheme, concepts, collections, onOpenConcept: vi.fn() } });
			await fireEvent.click(screen.getByRole('button', { name: 'Show graph' }));
			const graph = container.querySelector('svg')!;
			expect(graph.textContent).not.toContain('Sister');
			expect(graph.textContent).not.toContain('internal remark');
			expect(container.querySelector('.graph-toggle')?.className).toContain('no-print');
		});
	});
});
