import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MemberForm from './MemberForm.svelte';

const FIELD = 'urn:p/worksFor';
const field = (over: Record<string, unknown> = {}) => ({
	iri: FIELD, name: 'worksFor', targetClassIri: 'urn:C/Org', targetClassName: 'Organisation', required: false, repeatable: true, ...over
});
const acme = { iri: 'urn:i/acme', label: 'Acme' };
const globex = { iri: 'urn:i/globex', label: 'Globex' };
const held = (o = acme) => ({ individualIri: 'urn:i/p', predicateIri: FIELD, predicateLabel: 'worksFor', objectIri: o.iri, objectLabel: o.label });

function setup(over: Record<string, unknown> = {}) {
	const onSubmit = vi.fn(async () => {});
	const onAddRelation = vi.fn(async () => {});
	const onRemoveRelation = vi.fn(async () => {});
	render(MemberForm, {
		props: {
			mode: 'edit', initialLabel: 'Pat', submitLabel: 'Save', individualIri: 'urn:i/p', onSubmit, onCancel: () => {},
			onAddRelation, onRemoveRelation,
			assertions: [held()], objectOptions: [], relationFields: [field()],
			relationTargetOptions: { [FIELD]: [acme, globex] },
			...over
		}
	});
	return { onSubmit, onAddRelation, onRemoveRelation };
}

const picker = () => screen.getByPlaceholderText('Select a Organisation…') as HTMLInputElement;
const listed = () => [...document.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);

describe('MemberForm read-only relation values', () => {
	it('renders a held value as a read-only row with label, class and a link to the identity', () => {
		setup();
		const link = screen.getByRole('link', { name: 'Acme' }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/identities?node=urn%3Ai%2Facme');
		expect(screen.getByText('Organisation')).toBeTruthy();
		expect(screen.queryByDisplayValue('Acme')).toBeNull();
	});

	it('offers only targets that are not set yet', () => {
		setup();
		expect(listed()).toEqual(['Globex']);
	});

	it('hides the picker of a single-valued field while a value exists', () => {
		setup({ relationFields: [field({ repeatable: false })] });
		expect(screen.queryByPlaceholderText('Select a Organisation…')).toBeNull();
	});

	it('removes at once through onRemoveRelation and the row disappears', async () => {
		const { onRemoveRelation, onSubmit } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove worksFor Acme' }));
		await waitFor(() => expect(screen.queryByRole('link', { name: 'Acme' })).toBeNull());
		expect(onRemoveRelation).toHaveBeenCalledWith(FIELD, acme.iri);
		expect(listed()).toEqual(['Acme', 'Globex']);
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		expect((onSubmit.mock.calls[0] as unknown[])[4]).toEqual([]);
	});

	it('keeps the row and shows an inline error when the removal fails', async () => {
		const { onRemoveRelation } = setup();
		onRemoveRelation.mockRejectedValueOnce(new Error('GraphDB said no'));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove worksFor Acme' }));
		expect(await screen.findByText('GraphDB said no')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Acme' })).toBeTruthy();
	});

	it('adds at once through onAddRelation and shows the new value as a row', async () => {
		const { onAddRelation } = setup();
		await fireEvent.input(picker(), { target: { value: 'Globex' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add worksFor value' }));
		await waitFor(() => expect(screen.getByRole('link', { name: 'Globex' })).toBeTruthy());
		expect(onAddRelation).toHaveBeenCalledWith('worksFor', globex.iri);
	});

	it('rejects a picker text that is not in the list', async () => {
		const { onAddRelation } = setup();
		await fireEvent.input(picker(), { target: { value: 'Nope' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add worksFor value' }));
		expect(await screen.findByText('worksFor must be selected from the list.')).toBeTruthy();
		expect(onAddRelation).not.toHaveBeenCalled();
	});

	it('refuses to remove the last value of a required field', async () => {
		const { onRemoveRelation } = setup({ relationFields: [field({ required: true })] });
		await fireEvent.click(screen.getByRole('button', { name: 'Remove worksFor Acme' }));
		expect(await screen.findByText(/worksFor is required/)).toBeTruthy();
		expect(onRemoveRelation).not.toHaveBeenCalled();
		expect(screen.getByRole('link', { name: 'Acme' })).toBeTruthy();
	});

	it('create mode collects values locally and submits them', async () => {
		const onSubmit = vi.fn(async () => {});
		render(MemberForm, {
			props: {
				mode: 'create', submitLabel: 'Create', onSubmit, onCancel: () => {}, relationFields: [field({ required: true })],
				relationTargetOptions: { [FIELD]: [acme, globex] }
			}
		});
		await fireEvent.input(screen.getByPlaceholderText('e.g. nutzt'), { target: { value: 'Pat' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		expect(await screen.findByText('worksFor is required.')).toBeTruthy();
		await fireEvent.input(picker(), { target: { value: 'Acme' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add worksFor value' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		expect((onSubmit.mock.calls[0] as unknown[])[4]).toEqual([{ predicateIri: FIELD, predicateLabel: 'worksFor', added: [acme.iri], removed: [] }]);
	});

	it('keeps disambiguated labels for same-label targets', () => {
		const a = { iri: 'urn:i/m1', label: 'Meter (m1)' };
		const b = { iri: 'urn:i/m2', label: 'Meter (m2)' };
		setup({ assertions: [held({ iri: b.iri, label: 'Meter' })], relationTargetOptions: { [FIELD]: [a, b] } });
		expect(screen.getByRole('link', { name: 'Meter (m2)' })).toBeTruthy();
		expect(listed()).toEqual(['Meter (m1)']);
	});

	it('concept fields behave the same and omit the class', async () => {
		const c = { iri: 'urn:c/planned', label: 'Planned' };
		const { onRemoveRelation } = setup({
			relationFields: [field({ targetClassIri: '', targetClassName: '', valueSchemeIri: 'urn:s', repeatable: false })],
			assertions: [held({ iri: c.iri, label: 'Planned' })],
			relationTargetOptions: { [FIELD]: [c] }
		});
		expect(screen.getByRole('link', { name: 'Planned' })).toBeTruthy();
		expect(screen.queryByPlaceholderText('Select a concept…')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove worksFor Planned' }));
		await waitFor(() => expect(onRemoveRelation).toHaveBeenCalledWith(FIELD, c.iri));
		expect(await screen.findByPlaceholderText('Select a concept…')).toBeTruthy();
	});
});
