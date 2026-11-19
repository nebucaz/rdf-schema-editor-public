import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import OntologyTabs from './OntologyTabs.svelte';

describe('OntologyTabs (STORY-466)', () => {
	it('renders Overview and Model checks in a tablist and marks the selected one', () => {
		render(OntologyTabs, { props: { tab: 'checks', onSelect: () => {} } });
		expect(screen.getByRole('tablist', { name: 'Ontology views' })).toBeInTheDocument();
		expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Overview', 'Model checks']);
		expect(screen.getByRole('tab', { name: 'Model checks' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
	});

	it('reports a clicked tab and arrow-key moves', async () => {
		const onSelect = vi.fn();
		render(OntologyTabs, { props: { tab: 'overview', onSelect } });
		await fireEvent.click(screen.getByRole('tab', { name: 'Model checks' }));
		expect(onSelect).toHaveBeenLastCalledWith('checks');
		await fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
		expect(onSelect).toHaveBeenLastCalledWith('checks');
	});
});
