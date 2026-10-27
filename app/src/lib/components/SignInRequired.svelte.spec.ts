import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SignInRequired from './SignInRequired.svelte';

const ok = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);

describe('SignInRequired', () => {
	it('says access needs a sign-in and offers no login button without dev login', () => {
		render(SignInRequired, { props: { devLoginEnabled: false, onSignedIn: vi.fn(), fetchFn: ok() } });
		expect(screen.getByRole('heading', { name: 'Sign in required' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Login with user role' })).toBeNull();
	});

	it('logs in through the backend and reports it when dev login is enabled', async () => {
		const fetchFn = ok();
		const onSignedIn = vi.fn();
		render(SignInRequired, { props: { devLoginEnabled: true, onSignedIn, fetchFn } });
		await fireEvent.click(screen.getByRole('button', { name: 'Login with user role' }));
		await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
		expect(fetchFn).toHaveBeenCalledWith('/api/auth/dev-login', expect.objectContaining({ method: 'POST' }));
	});

	it('shows an inline error and does not report a sign-in when login fails', async () => {
		const fetchFn = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ message: 'dev login disabled' }) }) as Response);
		const onSignedIn = vi.fn();
		render(SignInRequired, { props: { devLoginEnabled: true, onSignedIn, fetchFn } });
		await fireEvent.click(screen.getByRole('button', { name: 'Login with user role' }));
		expect((await screen.findByRole('alert')).textContent).toContain('dev login disabled');
		expect(onSignedIn).not.toHaveBeenCalled();
	});
});
