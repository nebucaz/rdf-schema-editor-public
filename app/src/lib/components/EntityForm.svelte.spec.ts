import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import EntityForm from './EntityForm.svelte';
import type { FetchedNamespace, NameableEntity } from '#lib/services/sparql-connector.js';
import type { Concept } from '#lib/services/skos-concept.js';

const CORE = 'http://example.org/core';
const ARO = 'http://example.org/aro-eac-mvp';
const namespaceOptions = [
	{ baseIri: CORE, prefix: 'core', description: '' },
	{ baseIri: ARO, prefix: 'aro-eac-mvp', description: '' }
] as unknown as FetchedNamespace[];
const coreBla: NameableEntity = { iri: `${CORE}#Bla`, label: 'Bla', kind: 'class' };
const aroBla: NameableEntity = { iri: `${ARO}#Bla`, label: 'Bla', kind: 'class' };
const other: NameableEntity = { iri: `${CORE}#Blub`, label: 'Blub', kind: 'class' };

function setup(over: Record<string, unknown> = {}) {
	const props = {
		submitLabel: 'Create',
		namespaceOptions,
		initialNamespaceBaseIri: CORE,
		existingOptions: [coreBla, aroBla, other],
		onSubmit: vi.fn().mockResolvedValue(undefined),
		onSelectExisting: vi.fn().mockResolvedValue(undefined),
		onCancel: vi.fn(),
		...over
	};
	render(EntityForm, { props });
	return props;
}
const nameInput = () => screen.getByPlaceholderText('e.g. Person') as HTMLInputElement;
const pickerOptions = () => within(screen.getByRole('listbox')).getAllByRole('option');
const type = (v: string) => fireEvent.input(nameInput(), { target: { value: v } });

describe('EntityForm — existing-element picker', () => {
	it('lists same-named entries from both namespaces, distinguishable by prefix', async () => {
		setup();
		await type('Bla');
		const options = pickerOptions();
		expect(options).toHaveLength(2);
		expect(options[0].textContent).toContain('core');
		expect(options[1].textContent).toContain('aro-eac-mvp');
	});

	it('adds exactly the entry that was picked, not the first same-named match', async () => {
		const props = setup();
		await type('Bla');
		await fireEvent.click(pickerOptions()[1]);
		await fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
		expect(props.onSelectExisting).toHaveBeenCalledWith(aroBla);
		expect(props.onSubmit).not.toHaveBeenCalled();
	});

	it('adds the core entry when that one is picked', async () => {
		const props = setup();
		await type('Bla');
		await fireEvent.click(pickerOptions()[0]);
		await fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
		expect(props.onSelectExisting).toHaveBeenCalledWith(coreBla);
	});

	it('still offers "Add New" in the selected namespace when the picked entry lives elsewhere', async () => {
		const props = setup();
		await type('Bla');
		await fireEvent.click(pickerOptions()[1]);
		await fireEvent.click(screen.getByRole('button', { name: 'Add New' }));
		expect(props.onSubmit).toHaveBeenCalled();
		expect(props.onSelectExisting).not.toHaveBeenCalled();
	});

	it('drops the pick when the name is edited and falls back to label matching', async () => {
		const props = setup();
		await type('Bla');
		await fireEvent.click(pickerOptions()[1]);
		await type('Blub');
		await fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
		expect(props.onSelectExisting).toHaveBeenCalledWith(other);
	});

	it('supports keyboard selection', async () => {
		const props = setup();
		await type('Bla');
		await fireEvent.keyDown(nameInput(), { key: 'ArrowDown' });
		await fireEvent.keyDown(nameInput(), { key: 'ArrowDown' });
		await fireEvent.keyDown(nameInput(), { key: 'Enter' });
		await fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
		expect(props.onSelectExisting).toHaveBeenCalledWith(aroBla);
	});
});

describe('EntityForm — defining concept (ontology-pipeline STORY-325)', () => {
	const concept: Concept = {
		iri: 'http://e/core/vocab#Customer',
		prefLabels: [{ text: 'Customer', lang: 'en' }],
		altLabels: [], hiddenLabels: [], definition: 'A party that buys.', scopeNote: '', disambiguation: '',
		schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
		replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: ''
	};

	it('offers no concept field when the vocabulary has no concepts', () => {
		setup();
		expect(screen.queryByLabelText('Defined by concept')).toBeNull();
	});

	it('suggests a matching concept while the new class is named and submits the chosen one', async () => {
		const props = setup({ concepts: [concept], existingOptions: [] });
		await type('Customers');
		await fireEvent.click(screen.getByRole('button', { name: 'Use Customer' }));
		expect(screen.getByText('A party that buys.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		const args = (props.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(args[0]).toBe('Customers');
		expect(args[7]).toBe(concept.iri);
	});

	it('submits an empty concept when none is chosen, and keeps the initial one when editing', async () => {
		const none = setup({ concepts: [concept], existingOptions: [] });
		await type('Order');
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		expect((none.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][7]).toBe('');
	});
});

describe('EntityForm — defining concept when editing (ontology-pipeline STORY-325)', () => {
	it('shows the linked concept and submits its removal', async () => {
		const concept: Concept = {
			iri: 'http://e/core/vocab#Customer',
			prefLabels: [{ text: 'Customer', lang: 'en' }],
			altLabels: [], hiddenLabels: [], definition: 'A party that buys.', scopeNote: '', disambiguation: '',
			schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
			replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: ''
		};
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		render(EntityForm, {
			props: { mode: 'edit', iri: `${CORE}#Person`, initialName: 'Person', concepts: [concept], initialConceptIri: concept.iri, submitLabel: 'Save', onSubmit, onCancel: vi.fn() }
		});
		expect(screen.getByText('A party that buys.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onSubmit.mock.calls[0][7]).toBe('');
	});
});

describe('EntityForm — gate findings of the class (ontology-pipeline STORY-327)', () => {
	it('lists the findings about the class being edited', () => {
		render(EntityForm, {
			props: {
				mode: 'edit',
				iri: `${CORE}#Person`,
				initialName: 'Person',
				gateFindings: [
					{ gateId: 'definition-drift', stage: 'ontology', severity: 'warning', elementIri: `${CORE}#Person`, message: 'The description differs from the concept.' }
				],
				submitLabel: 'Save',
				onSubmit: vi.fn(),
				onCancel: vi.fn()
			}
		});
		expect(screen.getByText('The description differs from the concept.')).toBeTruthy();
	});

	it('shows nothing without findings', () => {
		setup();
		expect(screen.queryByLabelText('Gate findings')).toBeNull();
	});
});
