import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Host from './documentation-context.fixture.svelte';

describe('documentation context (process-description STORY-346)', () => {
	it('hands the opener the layout provides to a page below it', async () => {
		const open = vi.fn();
		render(Host, { props: { open } });
		await fireEvent.click(screen.getByRole('button', { name: 'ask for guide' }));
		expect(open).toHaveBeenCalledWith('guide-ontology');
	});

	it('gives a page with no provider nothing, so it can simply leave the guide links out', () => {
		render(Host, { props: { open: undefined } });
		expect(screen.getByTestId('provided').textContent).toBe('none');
	});
});
