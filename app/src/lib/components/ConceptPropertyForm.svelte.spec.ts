import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ConceptPropertyForm from './ConceptPropertyForm.svelte';

const schemes = [
	{ iri: 'http://example.org/core/vocab#Lifecycle', name: 'Lifecycle' },
	{ iri: 'http://example.org/core/vocab#Maturity', name: 'Maturity' }
];

function setup(props: Record<string, unknown> = {}) {
	const onSubmit = vi.fn(async () => {});
	const onCancel = vi.fn();
	render(ConceptPropertyForm, { props: { schemes, submitLabel: 'Add concept property', onSubmit, onCancel, ...props } });
	return { onSubmit, onCancel };
}

describe('ConceptPropertyForm (STORY-437)', () => {
	it('submits the name, the chosen scheme and the cardinality flags', async () => {
		const { onSubmit } = setup();
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: ' lifecycleStage ' } });
		await fireEvent.change(screen.getByLabelText('Scheme'), { target: { value: schemes[1].iri } });
		await fireEvent.click(screen.getByLabelText(/Required/));
		await fireEvent.click(screen.getByRole('button', { name: 'Add concept property' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('lifecycleStage', schemes[1].iri, true, false));
	});

	it('defaults to the first scheme and offers every scheme by name', () => {
		setup();
		const options = screen.getAllByRole('option').map((o) => o.textContent);
		expect(options).toEqual(['Lifecycle', 'Maturity']);
		expect((screen.getByLabelText('Scheme') as HTMLSelectElement).value).toBe(schemes[0].iri);
	});

	it('pre-fills in edit mode', () => {
		setup({ initialName: 'stage', initialSchemeIri: schemes[1].iri, initialRequired: true, initialRepeatable: true, submitLabel: 'Save' });
		expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('stage');
		expect((screen.getByLabelText('Scheme') as HTMLSelectElement).value).toBe(schemes[1].iri);
		expect((screen.getByLabelText(/Required/) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByLabelText(/Repeatable/) as HTMLInputElement).checked).toBe(true);
	});

	it('refuses an empty name without calling onSubmit', async () => {
		const { onSubmit } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add concept property' }));
		expect(screen.getByText('Name must not be empty')).toBeTruthy();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('shows the error a failed submit throws', async () => {
		setup({ onSubmit: vi.fn(async () => { throw new Error('already exists'); }) });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'x' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add concept property' }));
		await waitFor(() => expect(screen.getByText('already exists')).toBeTruthy());
	});

	it('calls onCancel', async () => {
		const { onCancel } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalled();
	});
});
