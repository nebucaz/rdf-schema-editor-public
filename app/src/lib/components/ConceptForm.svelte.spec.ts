import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ConceptForm from './ConceptForm.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (over: Partial<Concept> = {}): Concept => ({
	iri: 'urn:c:1',
	prefLabels: [{ text: 'Customer', lang: 'en' }],
	altLabels: [{ text: 'Client', lang: 'en' }],
	hiddenLabels: [],
	definition: 'A party that buys goods.',
	scopeNote: '',
	disambiguation: '',
	schemeIri: 'urn:s:1',
	topConcept: false,
	status: 'active',
	source: '',
	authority: '',
	replacedBy: '',
	deprecationReason: '',
	created: '2026-11-01',
	modified: '2026-11-01',
	deprecatedOn: '',
	...over
});

const schemes = [{ iri: 'urn:s:1', name: 'Glossary', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }];

function setup(props: Record<string, unknown> = {}) {
	const onSave = vi.fn(async () => {});
	const onCancel = vi.fn();
	const onAddAlternative = vi.fn(async () => {});
	render(ConceptForm, { props: { schemes, existing: [concept()], onSave, onCancel, onAddAlternative, ...props } });
	return { onSave, onCancel, onAddAlternative };
}

const type = (label: string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe('ConceptForm (STORY-323)', () => {
	it('suggests an existing concept while the preferred label is typed and offers "add as alternative label"', async () => {
		const { onAddAlternative } = setup({ existing: [concept()] });
		await type('Preferred label', 'Customers');
		expect(screen.getByText(/Similar concept/i)).toBeTruthy();
		expect(screen.getByText('Customer')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Add as alternative label' }));
		expect(onAddAlternative).toHaveBeenCalledWith('urn:c:1', 'Customers', 'en');
	});

	it('shows no suggestion for an unrelated label', async () => {
		setup();
		await type('Preferred label', 'Warehouse');
		expect(screen.queryByText(/Similar concept/i)).toBeNull();
	});

	it('does not suggest the concept being edited', async () => {
		setup({ initial: concept() });
		expect(screen.queryByText(/Similar concept/i)).toBeNull();
	});

	it('shows validation messages and does not save an incomplete concept', async () => {
		const { onSave } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByText('A preferred label is required')).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
	});

	it('refuses parentheses in the preferred label and points to the disambiguation field', async () => {
		const { onSave } = setup();
		await type('Preferred label', 'Bank (finance)');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByText(/must not contain parentheses/)).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
	});

	it('prompts for a scope note when a disambiguation is entered', async () => {
		setup();
		expect(screen.queryByText(/Add a scope note/i)).toBeNull();
		await type('Disambiguation', 'finance');
		expect(screen.getByText(/Add a scope note/i)).toBeTruthy();
		await type('Scope note', 'The institution, not the river bank');
		expect(screen.queryByText(/Add a scope note/i)).toBeNull();
	});

	it('shows the genus and differentia hint next to the definition', () => {
		setup();
		expect(screen.getByText(/what kind of thing it is.*what sets it apart/i)).toBeTruthy();
	});

	it('saves a complete draft with alternative labels one per line', async () => {
		const { onSave } = setup({ existing: [] });
		await type('Preferred label', '  Invoice ');
		await type('Alternative labels (one per line)', 'Bill\nStatement ');
		await type('Definition', 'A request for payment.');
		await fireEvent.change(screen.getByLabelText('Scheme'), { target: { value: 'urn:s:1' } });
		await fireEvent.click(screen.getByLabelText('Top concept'));
		await type('Source', 'ISO 704');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(onSave).toHaveBeenCalledTimes(1);
		const saved = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(saved).toMatchObject({
			prefLabels: [{ text: 'Invoice', lang: 'en' }],
			altLabels: [{ text: 'Bill', lang: 'en' }, { text: 'Statement', lang: 'en' }],
			definition: 'A request for payment.',
			schemeIri: 'urn:s:1',
			topConcept: true,
			source: 'ISO 704',
			status: 'proposed'
		});
	});

	it('keeps the status and extra-language labels of the concept being edited', async () => {
		const initial = concept({ prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }] });
		const { onSave } = setup({ initial, existing: [initial] });
		await type('Definition', 'Changed.');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const saved = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(saved).toMatchObject({
			status: 'active',
			prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }],
			definition: 'Changed.'
		});
	});

	it('shows an error from the connector', async () => {
		const onSave = vi.fn(async () => {
			throw new Error('A concept "Invoice" already exists');
		});
		setup({ onSave, existing: [] });
		await type('Preferred label', 'Invoice');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText(/already exists/)).toBeTruthy();
	});
});
