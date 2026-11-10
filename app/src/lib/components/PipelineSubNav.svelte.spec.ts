import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import PipelineSubNav from './PipelineSubNav.svelte';
import { resolveRouteView } from '#lib/utils/route-views.js';

describe('PipelineSubNav', () => {
	it('lists the five pages and marks the current one', () => {
		render(PipelineSubNav, { props: { routeView: resolveRouteView('/taxonomy'), onOpenGuide: () => {} } });
		const links = screen.getAllByRole('link');
		expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['Overview', '/pipeline'],
			['Questions', '/questions'],
			['Vocabulary', '/vocabulary'],
			['Taxonomy', '/taxonomy'],
			['Governance', '/governance']
		]);
		expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent?.trim())).toEqual(['Taxonomy']);
	});

	it('opens the guide', async () => {
		const onOpenGuide = vi.fn();
		render(PipelineSubNav, { props: { routeView: resolveRouteView('/pipeline'), onOpenGuide } });
		await fireEvent.click(screen.getByRole('button', { name: 'Quick start' }));
		expect(onOpenGuide).toHaveBeenCalled();
	});
});
