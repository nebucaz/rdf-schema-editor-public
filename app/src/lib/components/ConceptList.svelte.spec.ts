import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ConceptList from './ConceptList.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const c = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: '', scopeNote: '', disambiguation: '',
	schemeIri: 'urn:s1', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});

const schemes = [
	{ iri: 'urn:s1', name: 'Glossary', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } },
	{ iri: 'urn:s2', name: 'Products', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }
];
const concepts = [
	c('urn:1', 'Customer', { altLabels: [{ text: 'Client', lang: 'en' }] }),
	c('urn:2', 'Invoice', { status: 'proposed', schemeIri: 'urn:s2' }),
	c('urn:3', 'Bank', { disambiguation: 'finance', status: 'deprecated' })
];

const titles = () => screen.getAllByRole('button', { name: /^(Customer|Invoice|Bank)/ }).map((b) => b.textContent?.trim());

describe('ConceptList (STORY-323)', () => {
	it('lists every concept with its title and status', () => {
		render(ConceptList, { props: { concepts, schemes, onSelect: () => {} } });
		expect(titles()).toEqual(['Customer active', 'Invoice proposed', 'Bank (finance) deprecated']);
	});

	it('searches labels and alternative labels', async () => {
		render(ConceptList, { props: { concepts, schemes, onSelect: () => {} } });
		await fireEvent.input(screen.getByLabelText('Search'), { target: { value: 'client' } });
		expect(titles()).toEqual(['Customer active']);
	});

	it('filters by status and by scheme', async () => {
		render(ConceptList, { props: { concepts, schemes, onSelect: () => {} } });
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'proposed' } });
		expect(titles()).toEqual(['Invoice proposed']);
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
		await fireEvent.change(screen.getByLabelText('Scheme'), { target: { value: 'urn:s1' } });
		expect(titles()).toEqual(['Customer active', 'Bank (finance) deprecated']);
	});

	it('says so when nothing matches', async () => {
		render(ConceptList, { props: { concepts, schemes, onSelect: () => {} } });
		await fireEvent.input(screen.getByLabelText('Search'), { target: { value: 'zzz' } });
		expect(screen.getByText('No concepts match.')).toBeTruthy();
	});

	it('says so when the vocabulary is empty', () => {
		render(ConceptList, { props: { concepts: [], schemes, onSelect: () => {} } });
		expect(screen.getByText(/No concepts yet/)).toBeTruthy();
	});

	it('selects a concept on click and marks the selected one', async () => {
		const onSelect = vi.fn();
		render(ConceptList, { props: { concepts, schemes, selectedIri: 'urn:2', onSelect } });
		await fireEvent.click(screen.getByRole('button', { name: /^Customer/ }));
		expect(onSelect).toHaveBeenCalledWith('urn:1');
		expect(screen.getByRole('button', { name: /^Invoice/ }).getAttribute('aria-current')).toBe('true');
	});

	it('shows a badge with the number of gate findings per concept (STORY-324)', () => {
		const findings = [
			{ gateId: 'concept-without-definition', stage: 'vocabulary' as const, severity: 'warning' as const, elementIri: 'urn:2', message: 'm' },
			{ gateId: 'label-too-long', stage: 'vocabulary' as const, severity: 'info' as const, elementIri: 'urn:2', message: 'm' }
		];
		render(ConceptList, { props: { concepts, schemes, findings, onSelect: () => {} } });
		const badge = screen.getByLabelText('2 findings');
		expect(badge.textContent).toBe('2');
		expect(screen.queryAllByLabelText(/finding/)).toHaveLength(1);
	});
});
