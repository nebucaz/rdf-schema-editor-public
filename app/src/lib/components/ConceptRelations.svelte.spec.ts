import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ConceptRelations from './ConceptRelations.svelte';
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

const bank = concept('Bank', { related: ['urn:c:Lender'], mappings: [{ kind: 'exactMatch', target: 'http://xmlns.com/foaf/0.1/Organization' }] });
const concepts = [bank, concept('Lender'), concept('Shore'), concept('River', { schemeIri: 'urn:scheme:b' })];
const externals = [{ prefix: 'foaf', baseIri: 'http://xmlns.com/foaf/0.1/', builtIn: true }];

function setup() {
	const onAdd = vi.fn(async () => {});
	const onRemove = vi.fn(async () => {});
	render(ConceptRelations, { props: { concept: bank, concepts, externals, onAdd, onRemove } });
	return { onAdd, onRemove };
}

describe('ConceptRelations (STORY-329)', () => {
	it('lists the related concept and the mapping', () => {
		setup();
		expect(screen.getByText('Lender')).toBeTruthy();
		expect(screen.getByText('http://xmlns.com/foaf/0.1/Organization')).toBeTruthy();
	});

	it('has no inline add form; an Add relation button opens the dialog', async () => {
		setup();
		expect(screen.queryByLabelText('Related concept')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		expect(screen.getByLabelText('Related concept')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
	});

	it('adds a related concept through the dialog and closes it', async () => {
		const { onAdd } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		await fireEvent.change(screen.getByLabelText('Related concept'), { target: { value: 'urn:c:Shore' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => expect(onAdd).toHaveBeenCalledWith('related', 'urn:c:Shore'));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('cancel closes the dialog without writing', async () => {
		const { onAdd } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onAdd).not.toHaveBeenCalled();
	});

	it('adds a mapping from a registered vocabulary plus a local name', async () => {
		const { onAdd } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		await fireEvent.change(screen.getByLabelText('Relation'), { target: { value: 'closeMatch' } });
		await fireEvent.change(screen.getByLabelText('Vocabulary'), { target: { value: 'http://xmlns.com/foaf/0.1/' } });
		await fireEvent.input(screen.getByLabelText('Term or IRI'), { target: { value: 'Agent' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => expect(onAdd).toHaveBeenCalledWith('closeMatch', 'http://xmlns.com/foaf/0.1/Agent'));
	});

	it('refuses a mapping into the same scheme, keeps the dialog open and writes nothing', async () => {
		const { onAdd } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		await fireEvent.change(screen.getByLabelText('Relation'), { target: { value: 'exactMatch' } });
		await fireEvent.input(screen.getByLabelText('Term or IRI'), { target: { value: 'urn:c:Shore' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		expect(screen.getByRole('alert').textContent).toMatch(/same scheme/i);
		expect(screen.getByRole('dialog')).toBeTruthy();
		expect(onAdd).not.toHaveBeenCalled();
	});

	it('removes a relation', async () => {
		const { onRemove } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove related Lender' }));
		await waitFor(() => expect(onRemove).toHaveBeenCalledWith('related', 'urn:c:Lender'));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove exactMatch http://xmlns.com/foaf/0.1/Organization' }));
		await waitFor(() => expect(onRemove).toHaveBeenCalledWith('exactMatch', 'http://xmlns.com/foaf/0.1/Organization'));
	});
});

describe('ConceptRelations rationale field', () => {
	it('is not shown on a concept with nothing to remove', () => {
		render(ConceptRelations, { props: { concept: concept('A'), concepts: [concept('A')], externals: [], onAdd: vi.fn(), onRemove: vi.fn() } });
		expect(screen.queryByLabelText(/Rationale/)).toBeNull();
	});
});
