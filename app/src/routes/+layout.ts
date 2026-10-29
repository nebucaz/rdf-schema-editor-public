import { error } from '@sveltejs/kit';
import { runtimeConfigError } from '$lib/config';
import { toSessionUser, type SessionUser } from '$lib/services/session-user';
import type { LayoutLoad } from './$types';

// SPA mode: no server rendering or prerendering; `index.html` (the adapter fallback) serves every route.
export const ssr = false;
export const prerender = false;

export type { SessionUser };

/**
 * Identity comes from the backend (`GET /api/me`, verified `Oglala` cookie) — `null` when absent or the
 * request fails, so browsing still works and identity-requiring actions stay disabled. `/api/config` is
 * already settled by the time `$lib/config` is imported; if it failed there is nothing to render.
 */
export const load: LayoutLoad = async ({ fetch }) => {
	if (runtimeConfigError) {
		error(503, `Could not load the application configuration (${runtimeConfigError}). Is the backend reachable?`);
	}
	let user: SessionUser | null = null;
	try {
		const response = await fetch('/api/me');
		if (response.ok) {
			const body = (await response.json()) as { user: Record<string, unknown> | null };
			user = toSessionUser(body.user);
		}
	} catch {
		user = null;
	}
	return { user };
};
