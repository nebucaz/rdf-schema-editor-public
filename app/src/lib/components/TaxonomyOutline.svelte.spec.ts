import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import TaxonomyOutline from './TaxonomyOutline.svelte';
import type { Concept, ConceptScheme } from '#lib/services/skos-concept.js';
import type { TaxonomyNode } from '#lib/services/taxonomy-tree.js';

const SCHEME = 'urn:scheme:a';
const scheme: ConceptScheme = {
	iri: SCHEME, name: 'Glossary', description: '',
	scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' }
};
const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: SCHEME, topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', broader: [],
	...over
});

const concepts = [
	concept('Animal', { topConcept: true }),
	concept('Plant', { topConcept: true }),
	concept('Dog', { broader: ['urn:c:Animal'] }),
	concept('Puppy', { broader: ['urn:c:Dog'] }),
	concept('Loose')
];

const classTree: TaxonomyNode[] = [
	{ iri: 'urn:k:Thing', label: 'Thing', depth: 0, markers: [], children: [{ iri: 'urn:k:Item', label: 'Item', depth: 1, markers: [], children: [] }] }
];

function setup(over: { concepts?: Concept[] } = {}) {
	const onMove = vi.fn(async () => {});
	const onTopChange = vi.fn(async () => {});
	render(TaxonomyOutline, { props: { concepts: over.concepts ?? concepts, schemes: [scheme], classTree, onMove, onTopChange } });
	return { onMove, onTopChange };
}

async function drop(dragged: string, target: string) {
	await fireEvent.dragStart(screen.getAllByText(dragged)[0]);
	await fireEvent.drop(screen.getAllByText(target)[0]);
}

describe('TaxonomyOutline (STORY-328)', () => {
	it('shows the tree of the scheme with a marker on an orphan', () => {
		setup();
		for (const label of ['Animal', 'Dog', 'Puppy', 'Plant', 'Loose']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
		expect(screen.getByText('orphan')).toBeTruthy();
	});

	it('asks the is-a question on a drop and writes nothing until it is confirmed', async () => {
		const { onMove } = setup();
		await drop('Dog', 'Plant');
		expect(screen.getByText(/Is every Dog a kind of Plant\?/)).toBeTruthy();
		expect(onMove).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Move' }));
		await waitFor(() => expect(onMove).toHaveBeenCalledWith('urn:c:Dog', 'urn:c:Animal', 'urn:c:Plant'));
	});

	it('cancelling the question changes nothing', async () => {
		const { onMove } = setup();
		await drop('Dog', 'Plant');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByText(/Is every Dog/)).toBeNull();
		expect(onMove).not.toHaveBeenCalled();
	});

	it('refuses a drop that would create a cycle with a message and no question', async () => {
		const { onMove } = setup();
		await drop('Dog', 'Puppy');
		expect(screen.getByRole('alert').textContent).toMatch(/cycle/i);
		expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
		expect(onMove).not.toHaveBeenCalled();
	});

	it('refuses to move a top concept below another concept', async () => {
		const { onMove } = setup();
		await drop('Plant', 'Dog');
		expect(screen.getByRole('alert').textContent).toMatch(/top concept/i);
		expect(onMove).not.toHaveBeenCalled();
	});

	it('detaches a concept from its parent when dropped on the root zone', async () => {
		const { onMove } = setup();
		await fireEvent.dragStart(screen.getAllByText('Dog')[0]);
		await fireEvent.drop(screen.getByTestId('detach-zone'));
		await fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
		await waitFor(() => expect(onMove).toHaveBeenCalledWith('urn:c:Dog', 'urn:c:Animal', null));
	});

	it('sets and clears the top concept mark', async () => {
		const { onTopChange } = setup();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Top concept: Loose' }));
		expect(onTopChange).toHaveBeenCalledWith('urn:c:Loose', true);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Top concept: Plant' }));
		expect(onTopChange).toHaveBeenCalledWith('urn:c:Plant', false);
	});

	it('shows the class hierarchy read-only', () => {
		setup();
		expect(screen.getByText('Thing')).toBeTruthy();
		expect(screen.getByText('Item')).toBeTruthy();
		const classPane = screen.getByTestId('class-tree');
		expect(classPane.querySelector('[draggable="true"]')).toBeNull();
		expect(classPane.querySelector('input')).toBeNull();
	});
});

describe('TaxonomyOutline findings (STORY-330)', () => {
	it('shows the gate findings next to the concept and class they are about', () => {
		const findings = [
			{ gateId: 'depth-inconsistent', stage: 'taxonomy' as const, severity: 'info' as const, elementIri: 'urn:c:Plant', message: 'Plant is shallow (for human judgement).' },
			{ gateId: 'class-concept-hierarchy', stage: 'taxonomy' as const, severity: 'warning' as const, elementIri: 'urn:k:Item', message: 'Item and its concept disagree.' }
		];
		render(TaxonomyOutline, { props: { concepts, schemes: [scheme], classTree, findings, onMove: vi.fn(), onTopChange: vi.fn() } });
		expect(screen.getByText('Plant is shallow (for human judgement).')).toBeTruthy();
		expect(screen.getByText('Item and its concept disagree.')).toBeTruthy();
	});
});
