import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import EntityForm from './EntityForm.svelte';
import type { FetchedNamespace, NameableEntity } from '$lib/services/sparql-connector';

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
