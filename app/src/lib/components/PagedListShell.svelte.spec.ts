import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import PagedListShell from './PagedListShell.svelte';

const text = (html: string) => createRawSnippet(() => ({ render: () => html }));

function setup(over: Record<string, unknown> = {}) {
	const onChange = vi.fn();
	render(PagedListShell, {
		props: {
			label: 'Concepts',
			total: 60,
			pageSize: 25,
			page: 2,
			search: '',
			onChange,
			toolbar: text('<button type="button">Add concept</button>'),
			children: text('<ul><li>row</li></ul>'),
			...over
		}
	});
	return { onChange };
}

describe('PagedListShell (STORY-446)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('renders the search box, the toolbar, the list, the result count and the pager', () => {
		setup();
		expect(screen.getByRole('searchbox', { name: 'Search Concepts' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add concept' })).toBeInTheDocument();
		expect(screen.getByText('row')).toBeInTheDocument();
		expect(screen.getByText('60 results')).toBeInTheDocument();
		const nav = screen.getByRole('navigation', { name: 'Concepts pages' });
		expect(nav).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
	});

	it('puts the toolbar above the list', () => {
		setup();
		const add = screen.getByRole('button', { name: 'Add concept' });
		const row = screen.getByText('row');
		expect(add.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('changes the page with next, previous and a page number', async () => {
		const { onChange } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
		expect(onChange).toHaveBeenLastCalledWith({ search: '', page: 3 });
		await fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
		expect(onChange).toHaveBeenLastCalledWith({ search: '', page: 1 });
		await fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
		expect(onChange).toHaveBeenLastCalledWith({ search: '', page: 3 });
	});

	it('disables previous on the first page and next on the last', () => {
		setup({ page: 1 });
		expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
	});

	it('disables next on the last page', () => {
		setup({ page: 3 });
		expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
	});

	it('debounces the search by 300 ms and resets to page 1', async () => {
		const { onChange } = setup();
		const box = screen.getByRole('searchbox');
		await fireEvent.input(box, { target: { value: 'ba' } });
		await fireEvent.input(box, { target: { value: 'bank' } });
		vi.advanceTimersByTime(299);
		expect(onChange).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith({ search: 'bank', page: 1 });
	});

	it('shows "No results" and no pager for an empty result', () => {
		setup({ total: 0, page: 1, children: text('') });
		expect(screen.getByText('No results')).toBeInTheDocument();
		expect(screen.queryByRole('navigation')).toBeNull();
	});

	it('shows no pager for a single page but keeps the count', () => {
		setup({ total: 10, page: 1 });
		expect(screen.getByText('10 results')).toBeInTheDocument();
		expect(screen.queryByRole('navigation')).toBeNull();
	});

	it('says "1 result" for one', () => {
		setup({ total: 1, page: 1 });
		expect(screen.getByText('1 result')).toBeInTheDocument();
	});
});
