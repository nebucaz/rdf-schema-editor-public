import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AppNav from './AppNav.svelte';
import { resolveRouteView } from '$lib/utils/route-views';

const LINKS = [
	['Identities', '/identities', '/identities'],
	['Schema', '/', '/'],
	['Report', '/workbench', '/workbench'],
	['Validation', '/validation', '/validation']
] as const;

function renderAt(pathname: string) {
	render(AppNav, { props: { routeView: resolveRouteView(pathname) } });
}

function currentLabels() {
	return screen
		.getAllByRole('link')
		.filter((a) => a.getAttribute('aria-current') === 'page')
		.map((a) => a.textContent?.trim());
}

describe('AppNav', () => {
	it('renders a Main nav with the four links in order', () => {
		renderAt('/');
		expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
		const links = screen.getAllByRole('link');
		expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual(
			LINKS.map(([label, href]) => [label, href])
		);
	});

	for (const [label, , path] of LINKS) {
		it(`marks only "${label}" current on ${path}`, () => {
			renderAt(path);
			expect(currentLabels()).toEqual([label]);
		});
	}

	it('marks no link current on a report route', () => {
		renderAt('/reports/abc');
		expect(currentLabels()).toEqual([]);
	});

	/** Click `el` and report whether the component's own handler cancelled the default. jsdom can't
	 *  navigate, so a bubbling listener records the state and then cancels it itself. */
	function clickPrevented(el: HTMLElement): boolean {
		let prevented = false;
		const spy = (e: Event) => {
			prevented = e.defaultPrevented;
			e.preventDefault();
		};
		document.addEventListener('click', spy);
		el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		document.removeEventListener('click', spy);
		return prevented;
	}

	it('does not navigate when the active link is clicked', () => {
		renderAt('/workbench');
		expect(clickPrevented(screen.getByRole('link', { name: 'Report' }))).toBe(true);
	});

	it('lets a non-active link navigate normally', () => {
		renderAt('/workbench');
		expect(clickPrevented(screen.getByRole('link', { name: 'Identities' }))).toBe(false);
	});

	describe('when the strip does not fit', () => {
		afterEach(() => vi.unstubAllGlobals());

		/** jsdom has no layout: fake a 100px container around a 400px-wide full strip. */
		function squeeze() {
			vi.stubGlobal(
				'ResizeObserver',
				class {
					constructor(private cb: () => void) {}
					observe() {
						this.cb();
					}
					disconnect() {}
					unobserve() {}
				}
			);
			vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
			vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400);
		}

		it('keeps only the active tab visible and moves the others into a menu', async () => {
			squeeze();
			renderAt('/workbench');
			expect(screen.getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Report']);
			await fireEvent.click(screen.getByRole('button', { name: 'Navigation' }));
			const items = screen.getAllByRole('menuitem').map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
			expect(items).toEqual([
				['Identities', '/identities'],
				['Schema', '/'],
				['Validation', '/validation']
			]);
		});

		it('lists every area in the menu on a report route (no active tab)', async () => {
			squeeze();
			renderAt('/reports/abc');
			expect(screen.queryAllByRole('link')).toHaveLength(0);
			await fireEvent.click(screen.getByRole('button', { name: 'Navigation' }));
			expect(screen.getAllByRole('menuitem')).toHaveLength(4);
		});
	});
});
