import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MemberForm from './MemberForm.svelte';

const classOptions = [
	{ iri: 'urn:A', label: '[core] Alpha' },
	{ iri: 'urn:B', label: '[core] Beta' }
];
const nameAttr = { iri: 'urn:p/name', name: 'Name', datatype: 'string' as const, required: false, repeatable: false };
const noteAttr = { iri: 'urn:p/note', name: 'Note', datatype: 'string' as const, required: false, repeatable: false };

function setup(over: Record<string, unknown> = {}) {
	const onSubmit = vi.fn(async () => {});
	const onCancel = vi.fn();
	render(MemberForm, {
		props: {
			mode: 'edit',
			initialLabel: 'Thing',
			submitLabel: 'Save',
			individualIri: 'urn:i',
			onSubmit,
			onCancel,
			classOptions,
			classIri: 'urn:A',
			attributes: [nameAttr, noteAttr],
			attributeValues: { 'urn:p/name': 'n', 'urn:p/note': 'x' },
			onPlanClassChange: () => [{ iri: 'urn:p/name', name: 'Name' }],
			...over
		}
	});
	return { onSubmit, onCancel };
}

const select = () => screen.getByLabelText('Class') as HTMLSelectElement;

describe('MemberForm class selector', () => {
	it('lists the classes and preselects the current one', () => {
		setup();
		expect([...select().options].map((o) => o.value)).toEqual(['', 'urn:A', 'urn:B']);
		expect(select().value).toBe('urn:A');
	});

	it('is empty for an Unclassified individual', () => {
		setup({ classIri: '', attributes: [], attributeValues: {} });
		expect(select().value).toBe('');
	});

	it('is disabled when the class is locked (synced individual)', () => {
		setup({ classLocked: true });
		expect(select().disabled).toBe(true);
	});

	it('is not rendered without class options', () => {
		setup({ classOptions: undefined });
		expect(screen.queryByLabelText('Class')).toBeNull();
	});

	it('saves an Unclassified individual without a class, with no retype', async () => {
		const { onSubmit } = setup({ classIri: '', attributes: [], attributeValues: {} });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		expect((onSubmit.mock.calls[0] as unknown[])[5]).toBeUndefined();
	});

	it('assigning a class to an Unclassified individual submits the new class without a confirm step', async () => {
		const { onSubmit } = setup({ classIri: '', attributes: [], attributeValues: {} });
		await fireEvent.change(select(), { target: { value: 'urn:B' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		expect((onSubmit.mock.calls[0] as unknown[])[5]).toEqual({ classIri: 'urn:B', dropPredicateIris: [] });
	});

	it('lists dropped values in a confirm step and submits nothing until confirmed', async () => {
		const { onSubmit } = setup();
		await fireEvent.change(select(), { target: { value: 'urn:B' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getAllByRole('listitem').map((li) => li.textContent?.trim())).toContain('Note');
		await fireEvent.click(screen.getByRole('button', { name: 'Change class' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		expect((onSubmit.mock.calls[0] as unknown[])[5]).toEqual({
			classIri: 'urn:B',
			dropPredicateIris: ['urn:p/note']
		});
	});

	it('Back in the confirm step changes nothing', async () => {
		const { onSubmit } = setup();
		await fireEvent.change(select(), { target: { value: 'urn:B' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
	});

	it('does not submit a class change when the class is unchanged', async () => {
		const { onSubmit } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		expect((onSubmit.mock.calls[0] as unknown[])[5]).toBeUndefined();
	});
});
