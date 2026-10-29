import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import UnclassifiedBulkBar from './UnclassifiedBulkBar.svelte';

const classOptions = [
	{ iri: 'urn:A', label: 'Alpha' },
	{ iri: 'urn:B', label: 'Beta' }
];

function setup(over: Record<string, unknown> = {}) {
	const cb = {
		onSelectPage: vi.fn(),
		onSelectAllMatching: vi.fn(),
		onClear: vi.fn(),
		onApply: vi.fn(),
		onCancelRun: vi.fn(),
		onUndo: vi.fn()
	};
	render(UnclassifiedBulkBar, {
		props: {
			selectionCount: 0,
			pageSelected: false,
			allMatching: false,
			total: 40,
			classOptions,
			progress: null,
			canUndo: false,
			...cb,
			...over
		}
	});
	return cb;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('UnclassifiedBulkBar', () => {
	it('selects the visible page', async () => {
		const cb = setup();
		await click('Select this page');
		expect(cb.onSelectPage).toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: /Set class/ })).toBeNull();
	});

	it('shows the selection size and offers Set class and Clear', async () => {
		const cb = setup({ selectionCount: 3 });
		expect(screen.getByText('3 selected')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Set class/ })).toBeTruthy();
		await click('Clear');
		expect(cb.onClear).toHaveBeenCalled();
	});

	it('offers to select all matching only after the page is selected and more match', async () => {
		const cb = setup({ selectionCount: 25, pageSelected: true, total: 4000 });
		await click(/Select all 4,000 matching/);
		expect(cb.onSelectAllMatching).toHaveBeenCalled();
	});

	it('does not offer select-all when nothing more matches or it is already all', () => {
		setup({ selectionCount: 25, pageSelected: true, total: 25 });
		expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull();
	});

	it('confirm step shows the count; Cancel writes nothing', async () => {
		const cb = setup({ selectionCount: 3 });
		await click(/Set class/);
		expect(screen.getByText(/3 individuals/)).toBeTruthy();
		await click('Cancel');
		expect(cb.onApply).not.toHaveBeenCalled();
	});

	it('applies the chosen class after confirming', async () => {
		const cb = setup({ selectionCount: 3 });
		await click(/Set class/);
		const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		await fireEvent.change(screen.getByLabelText('Class to assign'), { target: { value: 'urn:B' } });
		expect(apply.disabled).toBe(false);
		await fireEvent.click(apply);
		expect(cb.onApply).toHaveBeenCalledWith('urn:B');
	});

	it('requires typing the count above 1,000', async () => {
		const cb = setup({ selectionCount: 2500, allMatching: true, total: 2500 });
		await click(/Set class/);
		await fireEvent.change(screen.getByLabelText('Class to assign'), { target: { value: 'urn:A' } });
		const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Type the number to confirm'), { target: { value: '2499' } });
		expect(apply.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Type the number to confirm'), { target: { value: '2500' } });
		expect(apply.disabled).toBe(false);
		await fireEvent.click(apply);
		expect(cb.onApply).toHaveBeenCalledWith('urn:A');
	});

	it('does not ask for the count at 1,000 or below', async () => {
		setup({ selectionCount: 1000, allMatching: true, total: 1000 });
		await click(/Set class/);
		expect(screen.queryByLabelText('Type the number to confirm')).toBeNull();
	});

	it('shows progress with a Cancel while running', async () => {
		const cb = setup({ selectionCount: 10, progress: { assigned: 4, total: 10 } });
		expect(screen.getByText(/4 of 10/)).toBeTruthy();
		await click('Cancel run');
		expect(cb.onCancelRun).toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: /Set class/ })).toBeNull();
	});

	it('offers Undo only when it is possible', async () => {
		const cb = setup({ canUndo: true, undoLabel: 'Gave 5 individuals the class Alpha.' });
		await click('Undo');
		expect(cb.onUndo).toHaveBeenCalled();
	});

	it('has no Undo otherwise', () => {
		setup();
		expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
	});
});
