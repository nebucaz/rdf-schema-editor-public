import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CollectionPanel from './CollectionPanel.svelte';
import type { Concept } from '#lib/services/skos-concept.js';
import type { SkosCollection } from '#lib/services/skos-collection.js';

const concept = (id: string): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [],
	disambiguation: '', schemeIri: 'urn:s', topConcept: false, status: 'active', source: '', authority: '', replacedBy: '',
	deprecationReason: '', created: '', modified: '', deprecatedOn: ''
});
const concepts = [concept('Alpha'), concept('Beta'), concept('Gamma')];
const regions: SkosCollection = { iri: 'urn:coll:Regions', prefLabels: [{ text: 'Regions', lang: 'en' }], ordered: false, members: ['urn:c:Alpha'] };
const steps: SkosCollection = { iri: 'urn:coll:Steps', prefLabels: [{ text: 'Steps', lang: 'en' }], ordered: true, members: ['urn:c:Alpha', 'urn:c:Beta'] };

function setup(over: Record<string, unknown> = {}) {
	const handlers = {
		onCreate: vi.fn(async () => {}),
		onSaveLabels: vi.fn(async () => {}),
		onAddMember: vi.fn(async () => {}),
		onRemoveMember: vi.fn(async () => {}),
		onReorder: vi.fn(async () => {}),
		onDelete: vi.fn(async () => ({ deleted: true, members: [] as string[] }))
	};
	render(CollectionPanel, { props: { collections: [regions, steps], concepts, ...handlers, ...over } });
	return handlers;
}

describe('CollectionPanel (STORY-410)', () => {
	it('lists each collection with its kind and member titles', () => {
		setup();
		expect(screen.getByRole('heading', { name: 'Regions' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Steps' })).toBeTruthy();
		expect(screen.getByText('Ordered')).toBeTruthy();
		expect(screen.getAllByText('Alpha').length).toBe(2);
	});

	it('creates a collection from a label and the ordered switch', async () => {
		const { onCreate } = setup();
		await fireEvent.input(screen.getByLabelText('Collection label'), { target: { value: '  Facets ' } });
		await fireEvent.click(screen.getByLabelText('Ordered collection'));
		await fireEvent.click(screen.getByRole('button', { name: 'Add collection' }));
		expect(onCreate).toHaveBeenCalledWith({ prefLabels: [{ text: 'Facets', lang: 'en' }], ordered: true });
	});

	it('refuses an empty label and shows the validation message without calling out', async () => {
		const { onCreate } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add collection' }));
		expect(screen.getByText('A preferred label is required')).toBeTruthy();
		expect(onCreate).not.toHaveBeenCalled();
	});

	it('renames a collection', async () => {
		const { onSaveLabels } = setup();
		await fireEvent.input(screen.getByLabelText('Label of Regions'), { target: { value: 'Areas' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save label of Regions' }));
		expect(onSaveLabels).toHaveBeenCalledWith('urn:coll:Regions', [{ text: 'Areas', lang: 'en' }]);
	});

	it('adds a concept found by search as a member', async () => {
		const { onAddMember } = setup();
		await fireEvent.input(screen.getAllByLabelText('Add a concept')[0], { target: { value: 'gam' } });
		await fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
		expect(onAddMember).toHaveBeenCalledWith('urn:coll:Regions', 'urn:c:Gamma');
	});

	it('adds another collection as a member and removes a member', async () => {
		const { onAddMember, onRemoveMember } = setup();
		await fireEvent.change(screen.getByLabelText('Add a collection to Regions'), { target: { value: 'urn:coll:Steps' } });
		expect(onAddMember).toHaveBeenCalledWith('urn:coll:Regions', 'urn:coll:Steps');
		await fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from Regions' }));
		expect(onRemoveMember).toHaveBeenCalledWith('urn:coll:Regions', 'urn:c:Alpha');
	});

	it('reorders an ordered collection only, and moves a member up or down', async () => {
		const { onReorder } = setup();
		expect(screen.queryByRole('button', { name: /Move Alpha (up|down) in Regions/ })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Move Beta up in Steps' }));
		expect(onReorder).toHaveBeenCalledWith('urn:coll:Steps', ['urn:c:Beta', 'urn:c:Alpha']);
		expect(screen.queryByRole('button', { name: 'Move Alpha up in Steps' })).toBeNull();
	});

	it('asks for confirmation before deleting a collection that has members, then forces', async () => {
		const onDelete = vi.fn(async (_iri: string, force: boolean) => (force ? { deleted: true, members: ['urn:c:Alpha'] } : { deleted: false, members: ['urn:c:Alpha'] }));
		setup({ onDelete });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Regions' }));
		expect(onDelete).toHaveBeenLastCalledWith('urn:coll:Regions', false);
		expect(screen.getByText(/1 member/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
		expect(onDelete).toHaveBeenLastCalledWith('urn:coll:Regions', true);
	});

	it('shows an error from a failing action', async () => {
		setup({ onRemoveMember: vi.fn(async () => { throw new Error('boom'); }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from Regions' }));
		expect(await screen.findByText('boom')).toBeTruthy();
	});

	describe('enumerated class from a collection (STORY-424)', () => {
		const namespaces = [{ baseIri: 'http://e/hr', prefix: 'hr' }];

		it('creates the class in the chosen namespace', async () => {
			const onCreateEnumeration = vi.fn(async () => 'Created class Steps with 2 members.');
			setup({ namespaces, onCreateEnumeration });
			await fireEvent.click(screen.getByRole('button', { name: 'Create enumerated class from Steps' }));
			expect(screen.getByText(/2 members/)).toBeTruthy();
			await fireEvent.click(screen.getByRole('button', { name: 'Create class' }));
			expect(onCreateEnumeration).toHaveBeenCalledWith('urn:coll:Steps', 'http://e/hr');
			expect(await screen.findByText('Created class Steps with 2 members.')).toBeTruthy();
		});

		it('says why it cannot create a class from an empty collection', async () => {
			const empty: SkosCollection = { iri: 'urn:coll:Empty', prefLabels: [{ text: 'Empty', lang: 'en' }], ordered: false, members: [] };
			setup({ collections: [empty], namespaces, onCreateEnumeration: vi.fn() });
			await fireEvent.click(screen.getByRole('button', { name: 'Create enumerated class from Empty' }));
			expect(screen.getByRole('alert').textContent).toMatch(/no concepts/i);
			expect((screen.getByRole('button', { name: 'Create class' }) as HTMLButtonElement).disabled).toBe(true);
		});

		it('shows a refusal from the write', async () => {
			const onCreateEnumeration = vi.fn(async () => {
				throw new Error('A class named "Steps" already exists');
			});
			setup({ namespaces, onCreateEnumeration });
			await fireEvent.click(screen.getByRole('button', { name: 'Create enumerated class from Steps' }));
			await fireEvent.click(screen.getByRole('button', { name: 'Create class' }));
			expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/);
		});

		it('offers no button when the page gives no handler', () => {
			setup();
			expect(screen.queryByRole('button', { name: /Create enumerated class/ })).toBeNull();
		});
	});
});
