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

	it('shows the dct: metadata, keeps modified read-only and saves the rest (STORY-408)', async () => {
		const onSave = vi.fn(async () => {});
		const onSaveMetadata = vi.fn(async () => {});
		const withMeta = { ...scheme, metadata: { title: 'Business glossary', creator: 'Ann', publisher: '', rights: '', modified: '2026-11-17T06:30:15Z' } };
		render(SchemeScopeForm, { props: { scheme: withMeta, onSave, onSaveMetadata } });
		expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Business glossary');
		const modified = screen.getByLabelText('Last modified') as HTMLInputElement;
		expect(modified.value).toBe('2026-11-17T06:30:15Z');
		expect(modified.readOnly).toBe(true);
		await fireEvent.input(screen.getByLabelText('Publisher'), { target: { value: ' Data Office ' } });
		await fireEvent.input(screen.getByLabelText('Rights'), { target: { value: 'CC-BY-4.0' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save scope' }));
		expect(onSaveMetadata).toHaveBeenCalledWith({
			title: 'Business glossary', creator: 'Ann', publisher: 'Data Office', rights: 'CC-BY-4.0', modified: '2026-11-17T06:30:15Z'
		});
	});

	it('a scheme without metadata loads with empty fields and still saves (STORY-408)', async () => {
		const onSave = vi.fn(async () => {});
		render(SchemeScopeForm, { props: { scheme, onSave, onSaveMetadata: async () => {} } });
		expect((screen.getByLabelText('Creator') as HTMLInputElement).value).toBe('');
		await fireEvent.click(screen.getByRole('button', { name: 'Save scope' }));
		expect(onSave).toHaveBeenCalledTimes(1);
	});
});
