import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SchemeScopeForm from './SchemeScopeForm.svelte';

const scheme = {
	iri: 'urn:s',
	name: 'Glossary',
	description: '',
	scope: { purpose: 'Shared terms', decisionsSupported: '', outOfScope: '', stakeholders: 'Data Office' }
};

describe('SchemeScopeForm (STORY-323, book p. 22)', () => {
	it('shows the stored scope and saves the edited record', async () => {
		const onSave = vi.fn(async () => {});
		render(SchemeScopeForm, { props: { scheme, onSave } });
		expect((screen.getByLabelText('Purpose') as HTMLTextAreaElement).value).toBe('Shared terms');
		await fireEvent.input(screen.getByLabelText('Decisions supported'), { target: { value: ' Which systems hold PII ' } });
		await fireEvent.input(screen.getByLabelText('Out of scope'), { target: { value: 'Product codes' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save scope' }));
		expect(onSave).toHaveBeenCalledWith({
			purpose: 'Shared terms',
			decisionsSupported: 'Which systems hold PII',
			outOfScope: 'Product codes',
			stakeholders: 'Data Office'
		});
	});

	it('shows an error from the connector', async () => {
		const onSave = vi.fn(async () => {
			throw new Error('Concept scheme not found');
		});
		render(SchemeScopeForm, { props: { scheme, onSave } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save scope' }));
		expect(await screen.findByText('Concept scheme not found')).toBeTruthy();
	});
});
