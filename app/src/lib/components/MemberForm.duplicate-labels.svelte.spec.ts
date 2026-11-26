import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MemberForm from './MemberForm.svelte';
import { buildConceptOptions } from '#lib/services/concept-value-options.js';
import type { Concept } from '#lib/services/skos-concept.js';

const FIELD = 'urn:p/consumes';
const field = {
	iri: FIELD, name: 'consumes', targetClassIri: 'urn:C/Api', targetClassName: 'Api', required: false, repeatable: true
};
// What the page hands over after `disambiguateOptionLabels`: same source label, two individuals.
const first = { iri: 'urn:i/Meter1', label: '[api] DelayMeter Public API (Meter1)' };
const second = { iri: 'urn:i/Meter2', label: '[api] DelayMeter Public API (Meter2)' };

function setup(over: Record<string, unknown> = {}) {
	const onSubmit = vi.fn(async () => {});
	render(MemberForm, {
		props: {
			mode: 'edit', initialLabel: 'App', submitLabel: 'Save', individualIri: 'urn:i/App', onSubmit, onCancel: () => {},
			assertions: [], objectOptions: [], relationFields: [field],
			relationTargetOptions: { [FIELD]: [first, second] },
			...over
		}
	});
	return { onSubmit };
}

const input = () => screen.getByPlaceholderText(/^Select a/) as HTMLInputElement;
const add = async (label: string) => {
	await fireEvent.input(input(), { target: { value: label } });
	await fireEvent.click(screen.getByRole('button', { name: 'Add consumes value' }));
};

describe('MemberForm relation field with same-label targets', () => {
	it('shows the disambiguated label of a value the individual already holds', () => {
		setup({
			assertions: [
				{ individualIri: 'urn:i/App', predicateIri: FIELD, predicateLabel: 'consumes', objectIri: second.iri, objectLabel: 'DelayMeter Public API' }
			]
		});
		expect(screen.getByRole('link', { name: second.label })).toBeTruthy();
	});

	it('adding a value renders without error and lists both targets once, in a single datalist', async () => {
		setup();
		const lists = document.querySelectorAll('datalist[id]');
		const ids = [...lists].map((l) => l.id).filter((id) => id.includes('rel'));
		expect(new Set(ids).size).toBe(ids.length);
		const values = [...document.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);
		expect(values.filter((v) => v === first.label)).toHaveLength(1);
		expect(values.filter((v) => v === second.label)).toHaveLength(1);
	});

	it('each typed label resolves to its own IRI on submit', async () => {
		const { onSubmit } = setup();
		await add(first.label);
		await add(second.label);
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		const subs = (onSubmit.mock.calls[0] as unknown[])[4] as { predicateIri: string; added: string[] }[];
		expect(subs).toEqual([expect.objectContaining({ predicateIri: FIELD, added: [first.iri, second.iri] })]);
	});

	it('an exact duplicate label (helper bypassed) is rejected, never linked to the first', async () => {
		const dup = { iri: 'urn:i/Meter2', label: first.label };
		const { onSubmit } = setup({ relationTargetOptions: { [FIELD]: [first, dup] } });
		await add(first.label);
		expect(await screen.findByText('consumes must be selected from the list.')).toBeTruthy();
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe('MemberForm concept field with colliding concept labels', () => {
	const concept = (id: string): Concept =>
		({
			iri: `urn:c/${id}`, prefLabels: [{ text: 'Open', lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [],
			scopeNotes: [], notation: ['O-1'], example: [], editorialNote: [], disambiguation: '', schemeIri: 'urn:s', topConcept: false,
			status: 'active', source: '', authority: '', replacedBy: '', deprecationReason: '', created: '', modified: '',
			deprecatedOn: '', broader: [], related: [], mappings: []
		}) as Concept;

	it('offers both concepts and resolves each to its own IRI', async () => {
		const options = buildConceptOptions([concept('A'), concept('B')]);
		const conceptField = { ...field, targetClassIri: '', targetClassName: '', valueSchemeIri: 'urn:s' };
		const onSubmit = vi.fn(async () => {});
		render(MemberForm, {
			props: {
				mode: 'edit', initialLabel: 'App', submitLabel: 'Save', individualIri: 'urn:i/App', onSubmit, onCancel: () => {},
				assertions: [], objectOptions: [], relationFields: [conceptField], relationTargetOptions: { [FIELD]: options }
			}
		});
		await fireEvent.input(screen.getAllByPlaceholderText('Select a concept…')[0], { target: { value: options[1].label } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add consumes value' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		const subs = (onSubmit.mock.calls[0] as unknown[])[4] as { added: string[] }[];
		expect(subs[0].added).toEqual(['urn:c/B']);
	});
});
