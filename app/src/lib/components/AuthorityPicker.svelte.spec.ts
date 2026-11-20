import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AuthorityPicker from './AuthorityPicker.svelte';

const units = [{ iri: 'urn:bu:data', label: 'Data Office' }, { iri: 'urn:bu:fin', label: 'Finance' }];
const setup = (props: Record<string, unknown> = {}) => render(AuthorityPicker, { props: { units, text: '', iri: '', ...props } });
const type = (value: string) => fireEvent.input(screen.getByLabelText('Authority'), { target: { value } });

describe('AuthorityPicker', () => {
	it('is a typeahead: arrow keys and Enter choose a unit, Escape closes the list', async () => {
		setup();
		const input = screen.getByLabelText('Authority');
		await type('fin');
		expect(screen.getByRole('listbox')).toBeTruthy();
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect((input as HTMLInputElement).value).toBe('Finance');
		expect(screen.queryByRole('listbox')).toBeNull();
		await type('d');
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('offers existing business units while typing, and links the chosen one', async () => {
		const view = setup();
		await type('fin');
		await fireEvent.click(screen.getByRole('option', { name: 'Finance' }));
		expect((screen.getByLabelText('Authority') as HTMLInputElement).value).toBe('Finance');
		expect(screen.getByText(/Linked to the business unit/)).toBeTruthy();
		expect(screen.queryByRole('option', { name: 'Finance' })).toBeNull();
		view.unmount();
	});

	it('says a new unit will be created when nothing matches', async () => {
		setup();
		await type('Legal');
		expect(screen.queryByRole('option')).toBeNull();
		expect(screen.getByText(/new business unit "Legal"/i)).toBeTruthy();
	});

	it('treats a name equal to an existing unit as linked, without creating', async () => {
		setup();
		await type('data office');
		expect(screen.getByText(/Linked to the business unit "Data Office"/)).toBeTruthy();
	});

	it('shows an old text value as it is, with no notice about a new unit', () => {
		setup({ text: 'Data Governance', legacy: 'Data Governance' });
		expect((screen.getByLabelText('Authority') as HTMLInputElement).value).toBe('Data Governance');
		expect(screen.queryByText(/new business unit/i)).toBeNull();
	});

	it('typing after a link was set drops the link', async () => {
		setup({ text: 'Finance', iri: 'urn:bu:fin' });
		await type('Finances');
		expect(screen.queryByText(/Linked to the business unit "Finance"/)).toBeNull();
	});
});
