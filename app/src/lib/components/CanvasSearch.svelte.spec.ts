import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import CanvasSearch from './CanvasSearch.svelte';
import { searchCanvasNodes } from '$lib/services/canvas-search';

const nodes = [
	{ id: 'urn:a', type: 'entity', hidden: false, data: { name: 'Person' } },
	{ id: 'urn:b', type: 'entity', hidden: false, data: { name: 'Personal Record' } },
	{ id: 'urn:c', type: 'entity', hidden: false, data: { name: 'Organisation' } }
];

function setup() {
	const onQueryChange = vi.fn();
	const onSelect = vi.fn();
	const view = render(CanvasSearch, {
		props: { matchesFor: (q: string) => searchCanvasNodes(nodes, q), onQueryChange, onSelect }
	});
	const input = screen.getByPlaceholderText('Search classes') as HTMLInputElement;
	return { input, onQueryChange, onSelect, view };
}

describe('CanvasSearch', () => {
	it('lists matching classes while typing and reports the query', async () => {
		const { input, onQueryChange } = setup();
		await fireEvent.input(input, { target: { value: 'per' } });
		const options = within(screen.getByRole('listbox')).getAllByRole('option');
		expect(options.map((o) => o.textContent?.trim())).toEqual(['Person', 'Personal Record']);
		expect(onQueryChange).toHaveBeenLastCalledWith('per');
	});

	it('reports the picked match and fills the box with its name', async () => {
		const { input, onSelect } = setup();
		await fireEvent.input(input, { target: { value: 'org' } });
		await fireEvent.click(within(screen.getByRole('listbox')).getByRole('option'));
		expect(onSelect).toHaveBeenCalledWith({ id: 'urn:c', name: 'Organisation' });
		expect(input.value).toBe('Organisation');
	});

	it('Escape clears the query and reports an empty search', async () => {
		const { input, onQueryChange } = setup();
		await fireEvent.input(input, { target: { value: 'per' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(input.value).toBe('');
		expect(onQueryChange).toHaveBeenLastCalledWith('');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('shows no list for an empty query', async () => {
		const { input } = setup();
		await fireEvent.input(input, { target: { value: '' } });
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('shows the match count and cycles through matches with next/previous, selecting each', async () => {
		const { input, onSelect } = setup();
		await fireEvent.input(input, { target: { value: 'per' } });
		expect(screen.getByTestId('canvas-search-count').textContent).toContain('2 matches');
		await fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
		expect(onSelect).toHaveBeenLastCalledWith({ id: 'urn:a', name: 'Person' });
		expect(screen.getByTestId('canvas-search-count').textContent).toContain('1 of 2');
		await fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
		expect(onSelect).toHaveBeenLastCalledWith({ id: 'urn:b', name: 'Personal Record' });
		await fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
		expect(onSelect).toHaveBeenLastCalledWith({ id: 'urn:a', name: 'Person' });
		await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
		expect(onSelect).toHaveBeenLastCalledWith({ id: 'urn:b', name: 'Personal Record' });
	});

	it('Enter jumps to the first match, and again to the next', async () => {
		const { input, onSelect } = setup();
		await fireEvent.input(input, { target: { value: 'per' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onSelect).toHaveBeenLastCalledWith({ id: 'urn:a', name: 'Person' });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onSelect).toHaveBeenLastCalledWith({ id: 'urn:b', name: 'Personal Record' });
	});

	it('shows "no matches" and does nothing on Enter when nothing matches', async () => {
		const { input, onSelect } = setup();
		await fireEvent.input(input, { target: { value: 'zzz' } });
		expect(screen.getByTestId('canvas-search-count').textContent).toContain('No matches');
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('"/" focuses the search box when no input is focused, and types normally inside inputs', async () => {
		const { input } = setup();
		await fireEvent.keyDown(document.body, { key: '/' });
		expect(document.activeElement).toBe(input);
		const other = document.createElement('input');
		document.body.appendChild(other);
		other.focus();
		await fireEvent.keyDown(other, { key: '/' });
		expect(document.activeElement).toBe(other);
		other.remove();
	});
});
