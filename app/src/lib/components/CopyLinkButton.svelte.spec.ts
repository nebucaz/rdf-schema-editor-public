import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import CopyLinkButton from './CopyLinkButton.svelte';

describe('CopyLinkButton', () => {
	it('copies the absolute link and says so', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render(CopyLinkButton, { props: { path: '/review/glossary', label: 'Copy glossary link' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Copy glossary link' }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/review/glossary`));
		expect(screen.getByRole('status').textContent).toContain('Link copied');
	});

	it('shows the link to copy by hand when the clipboard is refused', async () => {
		Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
		render(CopyLinkButton, { props: { path: '/review/glossary', label: 'Copy glossary link' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Copy glossary link' }));
		await waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(`${window.location.origin}/review/glossary`));
	});
});
