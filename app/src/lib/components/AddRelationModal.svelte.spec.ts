import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AddRelationModal from './AddRelationModal.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [], disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [],
	...over
});

const bank = concept('Bank');
const concepts = [bank, concept('Shore')];
const externals = [{ prefix: 'foaf', baseIri: 'http://xmlns.com/foaf/0.1/', builtIn: true }];

function setup(onAdd = vi.fn(async () => {})) {
	const onClose = vi.fn();
	const view = render(AddRelationModal, { props: { isOpen: true, concept: bank, concepts, externals, onAdd, onClose } });
	return { onAdd, onClose, ...view };
}

describe('AddRelationModal (STORY-478)', () => {
	it('offers Relation, Related concept, rationale, Apply and Cancel', () => {
		setup();
		expect(screen.getByLabelText('Relation')).toBeTruthy();
		expect(screen.getByLabelText('Related concept')).toBeTruthy();
		expect(screen.getByLabelText(/Rationale/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
	});

	it('swaps the fields when a mapping kind is chosen', async () => {
		setup();
		await fireEvent.change(screen.getByLabelText('Relation'), { target: { value: 'closeMatch' } });
		expect(screen.getByLabelText('Vocabulary')).toBeTruthy();
		expect(screen.getByLabelText('Term or IRI')).toBeTruthy();
		expect(screen.queryByLabelText('Related concept')).toBeNull();
	});

	it('apply with a valid relation calls onAdd with the rationale and closes', async () => {
		const { onAdd, onClose } = setup();
		await fireEvent.change(screen.getByLabelText('Related concept'), { target: { value: 'urn:c:Shore' } });
		await fireEvent.input(screen.getByLabelText(/Rationale/), { target: { value: 'Q3' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => expect(onAdd).toHaveBeenCalledWith('related', 'urn:c:Shore', 'Q3'));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it('apply with an invalid relation stays open and shows the message', async () => {
		const { onAdd, onClose } = setup();
		await fireEvent.change(screen.getByLabelText('Relation'), { target: { value: 'exactMatch' } });
		await fireEvent.input(screen.getByLabelText('Term or IRI'), { target: { value: 'urn:c:Shore' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		expect(screen.getByRole('alert').textContent).toMatch(/same scheme/i);
		expect(onAdd).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('apply when onAdd rejects stays open and shows the message', async () => {
		const { onClose } = setup(vi.fn(async () => { throw new Error('write failed'); }));
		await fireEvent.change(screen.getByLabelText('Related concept'), { target: { value: 'urn:c:Shore' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('write failed'));
		expect(onClose).not.toHaveBeenCalled();
	});

	it('cancel closes and reopening starts empty', async () => {
		const onAdd = vi.fn(async () => {});
		const onClose = vi.fn();
		const view = render(AddRelationModal, { props: { isOpen: true, concept: bank, concepts, externals, onAdd, onClose } });
		await fireEvent.change(screen.getByLabelText('Related concept'), { target: { value: 'urn:c:Shore' } });
		await fireEvent.input(screen.getByLabelText(/Rationale/), { target: { value: 'typed' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalled();
		await view.rerender({ isOpen: false });
		await view.rerender({ isOpen: true });
		expect((screen.getByLabelText('Related concept') as HTMLSelectElement).value).toBe('');
		expect((screen.getByLabelText(/Rationale/) as HTMLTextAreaElement).value).toBe('');
	});

	it('escape does not discard typed input', async () => {
		const { onClose } = setup();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).not.toHaveBeenCalled();
	});
});
