import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MemberForm from './MemberForm.svelte';
import { conceptOptionsMoreKey } from '#lib/services/concept-value-options.js';

const FIELD = 'urn:p/lifecycleStage';
const SCHEME = 'http://example.org/core/vocab#Lifecycle';
const field = {
	iri: FIELD, name: 'lifecycleStage', targetClassIri: '', targetClassName: '', valueSchemeIri: SCHEME,
	required: false, repeatable: false
};
const planned = { iri: 'urn:c/Planned', label: 'Planned' };
const active = { iri: 'urn:c/Active', label: 'Active' };
const assertion = (objectIri: string, objectLabel: string) => ({
	individualIri: 'urn:i', predicateIri: FIELD, predicateLabel: 'lifecycleStage', objectIri, objectLabel
});

function setup(over: Record<string, unknown> = {}) {
	const onSubmit = vi.fn(async () => {});
	render(MemberForm, {
		props: {
			mode: 'edit', initialLabel: 'Thing', submitLabel: 'Save', individualIri: 'urn:i', onSubmit, onCancel: () => {},
			assertions: [], objectOptions: [], relationFields: [field],
			relationTargetOptions: { [FIELD]: [planned, active] },
			...over
		}
	});
	return { onSubmit };
}

const input = () => screen.getByPlaceholderText('Select a concept…') as HTMLInputElement;
const listed = () => [...document.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);

describe('MemberForm concept field (STORY-438)', () => {
	it('lists only the options it was given', () => {
		setup();
		expect(listed()).toEqual(['Planned', 'Active']);
	});

	it('accepts a listed label and asserts that concept', async () => {
		const { onSubmit } = setup();
		await fireEvent.input(input(), { target: { value: 'Planned' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		const submissions = (onSubmit.mock.calls[0] as unknown[])[4] as { predicateIri: string; added: string[]; removed: string[] }[];
		expect(submissions).toEqual([expect.objectContaining({ predicateIri: FIELD, added: [planned.iri], removed: [] })]);
	});

	it('rejects a label that is not in the list with the existing message', async () => {
		const { onSubmit } = setup();
		await fireEvent.input(input(), { target: { value: 'Nonsense' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText('lifecycleStage must be selected from the list.')).toBeTruthy();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('keeps a value that is no longer offered: shown, selectable, and unchanged on save', async () => {
		const { onSubmit } = setup({
			relationTargetOptions: { [FIELD]: [planned] },
			assertions: [assertion('urn:c/Retired', 'Retired stage')]
		});
		expect(input().value).toBe('Retired stage');
		expect(listed()).toContain('Retired stage');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		const submissions = (onSubmit.mock.calls[0] as unknown[])[4] as { added: string[]; removed: string[] }[];
		expect(submissions.flatMap((s) => [...s.added, ...s.removed])).toEqual([]);
	});

	it('does not offer a deprecated concept for a new pick', () => {
		setup({ relationTargetOptions: { [FIELD]: [planned] } });
		expect(listed()).not.toContain('Retired stage');
	});

	it('shows two same-labelled concepts under different labels', () => {
		setup({ relationTargetOptions: { [FIELD]: [{ iri: 'urn:c/1', label: 'Open [O-1]' }, { iri: 'urn:c/2', label: 'Open [Open2]' }] } });
		expect(listed()).toEqual(['Open [O-1]', 'Open [Open2]']);
	});

	it('shows the limit notice only when more concepts exist', () => {
		setup({ relationTargetOptions: { [FIELD]: [planned], [conceptOptionsMoreKey(FIELD)]: [] } });
		expect(screen.getByText('Showing the first 1000 concepts')).toBeTruthy();
	});

	it('shows no limit notice otherwise', () => {
		setup();
		expect(screen.queryByText('Showing the first 1000 concepts')).toBeNull();
	});
});
