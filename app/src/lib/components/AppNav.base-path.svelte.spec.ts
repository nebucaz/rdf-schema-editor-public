import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('#lib/utils/urls.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/utils/urls.js')>();
	return { ...original, ...original.createUrls({ appBasePath: '/path', apiPrefix: '' }) };
});

import AppNav from './AppNav.svelte';
import { resolveRouteView } from '#lib/utils/route-views.js';

describe('AppNav under a base path', () => {
	it('links carry the base and the tab for the current route is active', () => {
		render(AppNav, { props: { routeView: resolveRouteView('/path/workbench') } });
		const links = screen.getAllByRole('link');
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/path/identities',
			'/path/',
			'/path/workbench',
			'/path/validation'
		]);
		const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
		expect(current.map((a) => a.textContent?.trim())).toEqual(['Report']);
	});
});
