import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import VocabularyCollectionsTab from './VocabularyCollectionsTab.svelte';
import { DEFAULT_LIST_STATE, type ListUrlState } from '#lib/services/list-url-state.js';
import type { SkosCollection } from '#lib/services/skos-collection.js';

const col = (iri: string, label: string, ordered: boolean, members: string[] = []): SkosCollection => ({
	iri, prefLabels: label ? [{ text: label, lang: 'en' }] : [], ordered, members
});
const collections = [col('urn:regions', 'Regions', false, ['urn:a', 'urn:b']), col('urn:steps', 'Steps', true, ['urn:a']), col('http://x/vocab#Unlabelled', '', false)];

function setup(over: { state?: Partial<ListUrlState>; collections?: SkosCollection[] } = {}) {
	const props = {
		collections: over.collections ?? collections,
		concepts: [],
		namespaces: [],
		listState: { ...DEFAULT_LIST_STATE, tab: 'collections' as const, ...over.state },
		onStateChange: vi.fn(),
		onCreate: vi.fn(async () => {}),
		onSaveLabels: vi.fn(async () => {}),
		onAddMember: vi.fn(async () => {}),
		onRemoveMember: vi.fn(async () => {}),
		onReorder: vi.fn(async () => {}),
		onDelete: vi.fn(async () => ({ deleted: true, members: [] })),
		onCreateEnumeration: vi.fn(async () => 'ok')
	};
	render(VocabularyCollectionsTab, { props });
	return props;
}

describe('VocabularyCollectionsTab (STORY-450)', () => {
	it('explains what a collection is next to a scheme, without calling concepts individuals', () => {
		setup();
		const text = screen.getByTestId('collections-explainer').textContent ?? '';
		expect(text).toMatch(/collection groups concepts/i);
		expect(text).toMatch(/scheme/i);
		expect(text).not.toMatch(/individual/i);
	});

	it('lists collections with kind and member count, falling back to the local name', () => {
		setup();
		const rows = screen.getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent?.trim()).join(' '));
		expect(rows).toEqual(['Regions Unordered 2', 'Steps Ordered 1', 'Unlabelled Unordered 0']);
		expect(screen.getByText('3 results')).toBeInTheDocument();
	});

	it('filters by the search text of the state and reports a typed search', async () => {
		setup({ state: { q: 'reg' } });
		expect(screen.getByText('1 result')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Steps' })).toBeNull();
	});

	it('reports a typed search as page 1', async () => {
		vi.useFakeTimers();
		const props = setup();
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search Collections' }), { target: { value: 'st' } });
		vi.advanceTimersByTime(300);
		vi.useRealTimers();
		expect(props.onStateChange).toHaveBeenLastCalledWith({ ...DEFAULT_LIST_STATE, tab: 'collections', q: 'st', page: 1 });
	});

	it('Add collection in the toolbar creates a collection', async () => {
		const props = setup();
		await fireEvent.click(screen.getByTestId('add-collection'));
		expect(screen.getByRole('button', { name: 'Create collection' })).toBeDisabled();
		await fireEvent.input(screen.getByLabelText('Label'), { target: { value: 'Products' } });
		await fireEvent.click(screen.getByLabelText('Ordered collection'));
		await fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
		await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith({ prefLabels: [{ text: 'Products', lang: 'en' }], ordered: true }));
	});

	it('opens the existing panel for the selected collection only', async () => {
		const props = setup();
		expect(screen.queryByLabelText('Label of Regions')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Regions' }));
		expect(screen.getByLabelText('Label of Regions')).toBeInTheDocument();
		expect(screen.queryByLabelText('Label of Steps')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Regions' }));
		expect(props.onDelete).toHaveBeenCalledWith('urn:regions', false);
	});

	it('shows No results for no collections', () => {
		setup({ collections: [] });
		expect(screen.getByText('No results')).toBeInTheDocument();
	});
});
