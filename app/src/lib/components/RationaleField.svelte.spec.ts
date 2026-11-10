import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import RationaleField from './RationaleField.svelte';
import ConceptForm from './ConceptForm.svelte';
import EntityForm from './EntityForm.svelte';
import ConceptRelations from './ConceptRelations.svelte';

describe('RationaleField (STORY-331)', () => {
	it('shows the given value and takes input', async () => {
		render(RationaleField, { props: { value: 'CQ-1' } });
		const box = screen.getByLabelText(/Rationale/) as HTMLTextAreaElement;
		expect(box.value).toBe('CQ-1');
		await fireEvent.input(box, { target: { value: 'CQ-2' } });
		expect(box.value).toBe('CQ-2');
	});

	it('is offered by the concept form, the class form and the relations editor', () => {
		const noop = async () => {};
		render(ConceptForm, { props: { schemes: [], existing: [], onSave: noop, onCancel: () => {}, onAddAlternative: noop } });
		expect(screen.getAllByLabelText(/Rationale/)).toHaveLength(1);
	});

	it('is offered by the class form', () => {
		render(EntityForm, { props: { submitLabel: 'Create', onCancel: () => {}, onSubmit: async () => {} } });
		expect(screen.getAllByLabelText(/Rationale/)).toHaveLength(1);
	});

	it('is offered by the relations editor', () => {
		const concept = {
			iri: 'urn:c', prefLabels: [{ text: 'C', lang: 'en' }], altLabels: [], hiddenLabels: [], definition: '', scopeNote: '',
			disambiguation: '', schemeIri: '', topConcept: false, status: 'active', source: '', authority: '', replacedBy: '',
			deprecationReason: '', created: '', modified: '', deprecatedOn: ''
		} as never;
		render(ConceptRelations, { props: { concept, concepts: [concept], externals: [], onAdd: async () => {}, onRemove: async () => {} } });
		expect(screen.getAllByLabelText(/Rationale/)).toHaveLength(1);
	});
});
