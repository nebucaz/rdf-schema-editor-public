import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ConceptPicker from './ConceptPicker.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const c = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: `${label} definition.`, scopeNote: '', disambiguation: '',
	schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});

const concepts = [
	c('urn:1', 'Customer', { altLabels: [{ text: 'Client', lang: 'en' }] }),
	c('urn:2', 'Invoice'),
	c('urn:3', 'Buyer', { status: 'retired' })
];

describe('ConceptPicker (STORY-325)', () => {
	it('searches the vocabulary by label and synonym, leaving out retired concepts', async () => {
		const onChange = vi.fn();
		render(ConceptPicker, { props: { concepts, value: '', onChange } });
		await fireEvent.input(screen.getByLabelText('Defined by concept'), { target: { value: 'client' } });
		const options = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		expect(options).toEqual(['Customer']);
		await fireEvent.input(screen.getByLabelText('Defined by concept'), { target: { value: 'buyer' } });
		expect(screen.queryAllByRole('option')).toHaveLength(0);
		expect(screen.getByText('No matching concept.')).toBeTruthy();
	});

	it('picks a concept', async () => {
		const onChange = vi.fn();
		render(ConceptPicker, { props: { concepts, value: '', onChange } });
		await fireEvent.input(screen.getByLabelText('Defined by concept'), { target: { value: 'inv' } });
		await fireEvent.click(screen.getByRole('option', { name: 'Invoice' }));
		expect(onChange).toHaveBeenCalledWith('urn:2');
	});

	it('shows the linked concept definition read-only with a link to the concept and a way to clear it', async () => {
		const onChange = vi.fn();
		render(ConceptPicker, { props: { concepts, value: 'urn:1', onChange } });
		expect(screen.getByText('Customer definition.')).toBeTruthy();
		expect(screen.queryByLabelText('Defined by concept')).toBeNull();
		const link = screen.getByRole('link', { name: /Open in Vocabulary/ });
		expect(link.getAttribute('href')).toBe('/vocabulary?concept=urn%3A1');
		await fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
		expect(onChange).toHaveBeenCalledWith('');
	});

	it('still names a linked concept that is not among the loaded ones', () => {
		render(ConceptPicker, { props: { concepts, value: 'http://e/core/vocab#Gone', onChange: () => {} } });
		expect(screen.getByText(/Gone/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove link' })).toBeTruthy();
	});

	it('suggests matching concepts for the name being typed, before a class is created', async () => {
		const onChange = vi.fn();
		render(ConceptPicker, { props: { concepts, value: '', suggestFor: 'Customers', onChange } });
		expect(screen.getByText(/Existing concepts that match/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Use Customer' }));
		expect(onChange).toHaveBeenCalledWith('urn:1');
	});

	it('suggests nothing for an unrelated name or once a concept is chosen', () => {
		const { unmount } = render(ConceptPicker, { props: { concepts, value: '', suggestFor: 'Warehouse', onChange: () => {} } });
		expect(screen.queryByText(/Existing concepts that match/)).toBeNull();
		unmount();
		render(ConceptPicker, { props: { concepts, value: 'urn:2', suggestFor: 'Customer', onChange: () => {} } });
		expect(screen.queryByText(/Existing concepts that match/)).toBeNull();
	});

	it('offers the replacement of a deprecated concept as a retarget (STORY-327)', async () => {
		const onChange = vi.fn();
		const all = [c('urn:old', 'Client', { status: 'deprecated', replacedBy: 'urn:1' }), ...concepts];
		render(ConceptPicker, { props: { concepts: all, value: 'urn:old', onChange } });
		expect(screen.getByText(/deprecated/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Retarget to Customer' }));
		expect(onChange).toHaveBeenCalledWith('urn:1');
	});

	it('offers no retarget when the deprecated concept has no live replacement (STORY-327)', () => {
		const all = [c('urn:old', 'Client', { status: 'deprecated' }), ...concepts];
		render(ConceptPicker, { props: { concepts: all, value: 'urn:old', onChange: () => {} } });
		expect(screen.queryByRole('button', { name: /Retarget/ })).toBeNull();
	});
});
