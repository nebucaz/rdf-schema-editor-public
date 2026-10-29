import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import UserMenu from './UserMenu.svelte';

type LogoutResult = { ok: true } | { ok: false; message: string };

function setup(opts: { logoutEnabled?: boolean; onLogout?: () => Promise<LogoutResult> } = {}) {
	const onProfile = vi.fn();
	const onLogout = opts.onLogout ?? vi.fn(async (): Promise<LogoutResult> => ({ ok: true }));
	render(UserMenu, {
		props: {
			user: { displayName: 'Ada Lovelace' },
			logoutEnabled: opts.logoutEnabled ?? true,
			onProfile,
			onLogout
		}
	});
	return { onProfile, onLogout };
}

const toggle = () => screen.getByRole('button', { name: /^User menu/ });

describe('UserMenu', () => {
	it('shows the display name on the toggle and a title', () => {
		setup();
		expect(toggle().textContent).toContain('Ada Lovelace');
		expect(toggle().getAttribute('title')).toContain('Ada Lovelace');
	});

	it('keeps the full name in the title and accessible name when it is long', () => {
		const long = 'Bartholomew '.repeat(6).trim();
		render(UserMenu, {
			props: { user: { displayName: long }, logoutEnabled: false, onProfile: vi.fn(), onLogout: vi.fn() }
		});
		const btn = screen.getByRole('button', { name: new RegExp(long) });
		expect(btn.getAttribute('title')).toContain(long);
		expect(long.length).toBeGreaterThanOrEqual(60);
	});

	it('is closed until the toggle is clicked', async () => {
		setup();
		expect(screen.queryByRole('menuitem', { name: 'Profile' })).toBeNull();
		await fireEvent.click(toggle());
		expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeTruthy();
	});

	it('calls onProfile from Profile', async () => {
		const { onProfile } = setup();
		await fireEvent.click(toggle());
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
		expect(onProfile).toHaveBeenCalledOnce();
	});

	it('offers Logout only when enabled', async () => {
		setup({ logoutEnabled: false });
		await fireEvent.click(toggle());
		expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: /Logout/ })).toBeNull();
	});

	it('calls onLogout and closes the menu on success', async () => {
		const { onLogout } = setup();
		await fireEvent.click(toggle());
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
		expect(onLogout).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Profile' })).toBeNull());
	});

	it('shows the retry label after a failed logout', async () => {
		setup({ onLogout: async () => ({ ok: false, message: 'boom' }) });
		await fireEvent.click(toggle());
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
		expect(await screen.findByRole('menuitem', { name: 'Logout failed – retry' })).toBeTruthy();
	});

	it('closes on Escape', async () => {
		setup();
		await fireEvent.click(toggle());
		await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
		expect(screen.queryByRole('menuitem', { name: 'Profile' })).toBeNull();
	});
});
