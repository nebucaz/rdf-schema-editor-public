import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ConceptList from './ConceptList.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const c = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definitions: [], scopeNotes: [], disambiguation: '',
	schemeIri: 'urn:s1', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});

const scope = { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' };
const schemes = [
	{ iri: 'urn:s1', name: 'Glossary', description: '', scope },
	{ iri: 'urn:s2', name: 'Products', description: '', scope }
];
const concepts = [
	c('urn:1', 'Customer'),
	c('urn:2', 'Invoice', { status: 'proposed', schemeIri: 'urn:s2' }),
	c('urn:3', 'Bank', { disambiguation: 'finance', status: 'deprecated', schemeIri: '' })
];

const rows = () => screen.getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim());

describe('ConceptList (STORY-448)', () => {
	it('lists the concepts in the given order with title, status and scheme name, without group headings', () => {
		render(ConceptList, { props: { concepts, schemes, onSelect: () => {} } });
		expect(rows()).toEqual(['Customer active Glossary', 'Invoice proposed Products', 'Bank (finance) deprecated No scheme']);
		expect(screen.queryAllByRole('heading')).toHaveLength(0);
	});

	it('shows the local name for a scheme without a label (STORY-444)', () => {
		const unnamed = [{ ...schemes[0], iri: 'http://x.org/core/vocab#Glossary', name: '' }];
		render(ConceptList, { props: { concepts: [c('urn:1', 'Customer', { schemeIri: unnamed[0].iri })], schemes: unnamed, onSelect: () => {} } });
		expect(rows()).toEqual(['Customer active Glossary']);
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
		expect(screen.getByLabelText('2 findings').textContent).toBe('2');
		expect(screen.queryAllByLabelText(/finding/)).toHaveLength(1);
	});
});
