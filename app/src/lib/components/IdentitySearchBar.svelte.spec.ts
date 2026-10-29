import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import IdentitySearchBar from './IdentitySearchBar.svelte';
import { UNCLASSIFIED_FACET } from '$lib/utils/identity-search-url';

const base = {
	query: '',
	classIri: null as string | null,
	namespaceBaseIri: null,
	syncSource: null,
	syncStatus: null
};

function setup(values = base, isLoading = false) {
	const onSearch = vi.fn();
	render(IdentitySearchBar, { props: { values, classes: [], namespaces: [], isLoading, onSearch, onClear: vi.fn() } });
	return onSearch;
}
const input = () => screen.getByLabelText('Search identities') as HTMLInputElement;

describe('IdentitySearchBar live search for Unclassified', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('searches as the user types (debounced) when Unclassified is selected', async () => {
		const onSearch = setup({ ...base, classIri: UNCLASSIFIED_FACET });
		await fireEvent.input(input(), { target: { value: 'Bulk 3' } });
		expect(onSearch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(400);
		expect(onSearch).toHaveBeenCalledTimes(1);
		expect(onSearch.mock.calls[0][0]).toMatchObject({ query: 'Bulk 3', classIri: UNCLASSIFIED_FACET });
	});

	it('runs one search for a burst of keystrokes', async () => {
		const onSearch = setup({ ...base, classIri: UNCLASSIFIED_FACET });
		for (const v of ['B', 'Bu', 'Bul']) await fireEvent.input(input(), { target: { value: v } });
		await vi.advanceTimersByTimeAsync(400);
		expect(onSearch).toHaveBeenCalledTimes(1);
		expect(onSearch.mock.calls[0][0].query).toBe('Bul');
	});

	it('does not search as you type for other class filters', async () => {
		const onSearch = setup();
		await fireEvent.input(input(), { target: { value: 'abc' } });
		await vi.advanceTimersByTimeAsync(400);
		expect(onSearch).not.toHaveBeenCalled();
	});

	it('keeps the input enabled while a search is running', () => {
		setup({ ...base, classIri: UNCLASSIFIED_FACET }, true);
		expect(input().disabled).toBe(false);
	});

	it('keeps a trailing space the user typed', async () => {
		const { rerender } = render(IdentitySearchBar, {
			props: { values: { ...base, classIri: UNCLASSIFIED_FACET }, classes: [], namespaces: [], onSearch: vi.fn(), onClear: vi.fn() }
		});
		await fireEvent.input(input(), { target: { value: 'Bulk ' } });
		await rerender({ values: { ...base, classIri: UNCLASSIFIED_FACET, query: 'Bulk' } });
		expect(input().value).toBe('Bulk ');
	});
});
