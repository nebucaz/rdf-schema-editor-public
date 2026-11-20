import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import MergeConceptDialog from './MergeConceptDialog.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const c = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [], scopeNotes: [], disambiguation: '',
	schemeIri: 'urn:s:1', topConcept: false, status: 'active', source: '', authority: '', replacedBy: '', deprecationReason: '', created: '',
	modified: '', deprecatedOn: '', ...over
});
const concepts = [
	c('Staff', { definitions: [{ text: 'People who work here.', lang: '' }], notation: ['S1'] }),
	c('Employee', { definitions: [{ text: 'A person employed.', lang: '' }], altLabels: [{ text: 'Worker', lang: 'en' }], notation: ['E1'] }),
	c('Other')
];

function open(onConfirm = vi.fn().mockResolvedValue(undefined)) {
	render(MergeConceptDialog, {
		props: { duplicate: concepts[1], concepts, collections: [], classLinks: [{ classIri: 'http://e#Person', label: 'Person' }], onConfirm, onCancel: vi.fn() }
	});
	return onConfirm;
}

describe('MergeConceptDialog (STORY-423)', () => {
	it('lists what moves once a survivor is chosen, and disables merging before', async () => {
		open();
		expect((screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.change(screen.getByLabelText('Merge into'), { target: { value: 'urn:c:Other' } });
		expect(screen.getByText(/Alternative label "Worker"/)).toBeTruthy();
		expect(screen.getByText(/Class "Person" is now defined by the survivor/)).toBeTruthy();
	});

	it('needs a decision for a definition conflict before it can merge', async () => {
		const onConfirm = open();
		await fireEvent.change(screen.getByLabelText('Merge into'), { target: { value: 'urn:c:Staff' } });
		const merge = screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement;
		expect(merge.disabled).toBe(true);
		expect(screen.getByText('A person employed.')).toBeTruthy();
		await fireEvent.click(screen.getByLabelText(/Keep the survivor's definition/));
		await fireEvent.click(screen.getByLabelText(/Keep both notations/));
		expect(merge.disabled).toBe(false);
		await fireEvent.click(merge);
		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm.mock.calls[0][0].survivor).toBe('urn:c:Staff');
	});

	it('warns about a merge into another scheme', async () => {
		render(MergeConceptDialog, {
			props: { duplicate: concepts[1], concepts: [...concepts, c('Far', { schemeIri: 'urn:s:2' })], collections: [], classLinks: [], onConfirm: vi.fn(), onCancel: vi.fn() }
		});
		await fireEvent.change(screen.getByLabelText('Merge into'), { target: { value: 'urn:c:Far' } });
		expect(screen.getByRole('status').textContent).toMatch(/another scheme/);
	});
});
