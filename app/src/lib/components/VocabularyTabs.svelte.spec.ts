import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import VocabularyTabs from './VocabularyTabs.svelte';

describe('VocabularyTabs (STORY-447)', () => {
	it('renders the three tabs in a labelled tablist and marks the selected one', () => {
		render(VocabularyTabs, { props: { tab: 'schemes', onSelect: () => {} } });
		expect(screen.getByRole('tablist', { name: 'Vocabulary sections' })).toBeInTheDocument();
		const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
		expect(tabs).toEqual(['Concepts', 'Schemes', 'Collections']);
		expect(screen.getByRole('tab', { name: 'Schemes' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tab', { name: 'Concepts' })).toHaveAttribute('aria-selected', 'false');
	});

	it('reports the clicked tab', async () => {
		const onSelect = vi.fn();
		render(VocabularyTabs, { props: { tab: 'concepts', onSelect } });
		await fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));
		expect(onSelect).toHaveBeenCalledWith('collections');
	});

	it('moves between tabs with the arrow keys', async () => {
		const onSelect = vi.fn();
		render(VocabularyTabs, { props: { tab: 'concepts', onSelect } });
		await fireEvent.keyDown(screen.getByRole('tab', { name: 'Concepts' }), { key: 'ArrowRight' });
		expect(onSelect).toHaveBeenLastCalledWith('schemes');
		await fireEvent.keyDown(screen.getByRole('tab', { name: 'Concepts' }), { key: 'ArrowLeft' });
		expect(onSelect).toHaveBeenLastCalledWith('collections');
	});
});
