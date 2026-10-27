import { error } from '@sveltejs/kit';
import { runtimeConfigError } from '$lib/config';
import type { LayoutLoad } from './$types';

// SPA mode: no server rendering or prerendering; `index.html` (the adapter fallback) serves every route.
export const ssr = false;
export const prerender = false;

export interface SessionUser {
	sub: string;
	displayName: string;
}

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
			const body = (await response.json()) as { user: (SessionUser & Record<string, unknown>) | null };
			user = body.user ? { sub: body.user.sub, displayName: body.user.displayName } : null;
		}
	} catch {
		user = null;
	}
	return { user };
};
