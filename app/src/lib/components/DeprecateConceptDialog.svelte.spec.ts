import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DeprecateConceptDialog from './DeprecateConceptDialog.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});

const old = concept('urn:old', 'Client');
const candidates = [concept('urn:new', 'Customer'), concept('urn:retired', 'Buyer', { status: 'retired' }), old];

function setup() {
	const onConfirm = vi.fn(async () => {});
	const onCancel = vi.fn();
	render(DeprecateConceptDialog, { props: { concept: old, candidates, onConfirm, onCancel } });
	return { onConfirm, onCancel };
}

describe('DeprecateConceptDialog (STORY-323)', () => {
	it('asks for a reason and does not confirm without one', async () => {
		const { onConfirm } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }));
		expect(screen.getByText(/needs a reason/i)).toBeTruthy();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('offers the other live concepts as replacement, not the concept itself nor a retired one', () => {
		setup();
		const options = screen.getAllByRole('option').map((o) => o.textContent);
		expect(options).toEqual(['(no replacement)', 'Customer']);
	});

	it('confirms with reason, replacement and the move-label choice', async () => {
		const { onConfirm } = setup();
		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'Merged into Customer' } });
		await fireEvent.change(screen.getByLabelText('Replaced by'), { target: { value: 'urn:new' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }));
		expect(onConfirm).toHaveBeenCalledWith({ reason: 'Merged into Customer', replacedBy: 'urn:new', moveLabel: true });
	});

	it('offers to move the old preferred label only once a replacement is chosen, and lets the user decline', async () => {
		const { onConfirm } = setup();
		expect(screen.queryByLabelText(/hidden label/i)).toBeNull();
		await fireEvent.change(screen.getByLabelText('Replaced by'), { target: { value: 'urn:new' } });
		const box = screen.getByLabelText(/hidden label on the replacement/i) as HTMLInputElement;
		expect(box.checked).toBe(true);
		await fireEvent.click(box);
		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'Merged' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }));
		expect(onConfirm).toHaveBeenCalledWith({ reason: 'Merged', replacedBy: 'urn:new', moveLabel: false });
	});

	it('allows deprecation without a replacement', async () => {
		const { onConfirm } = setup();
		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'No longer used' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }));
		expect(onConfirm).toHaveBeenCalledWith({ reason: 'No longer used', replacedBy: '', moveLabel: false });
	});

	it('shows an error from the connector', async () => {
		const onConfirm = vi.fn(async () => {
			throw new Error('Concept not found');
		});
		render(DeprecateConceptDialog, { props: { concept: old, candidates, onConfirm, onCancel: () => {} } });
		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'x' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }));
		expect(await screen.findByText('Concept not found')).toBeTruthy();
	});
});
