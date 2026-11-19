import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiDashboardLayoutStore } from './dashboard-layout-store.js';
import { DEFAULT_LAYOUT, TILE_IDS, moveTile } from '#lib/services/dashboard-layout.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiDashboardLayoutStore (STORY-469)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('loads the stored layout with one GET to the preference endpoint', async () => {
		const stored = moveTile(DEFAULT_LAYOUT, 'guides', 0);
		const fetchFn = vi.fn(async (_url: RequestInfo | URL) => json({ value: stored }));
		const layout = await new ApiDashboardLayoutStore({ fetchFn }).load();
		expect(layout).toEqual(stored);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn.mock.calls[0][0]).toBe('/api/preferences/ontology-dashboard');
	});

	it('falls back to the default when nothing is stored, the value is invalid, or the request fails', async () => {
		for (const fetchFn of [
			async () => json({ value: null }),
			async () => json({ value: { version: 9 } }),
			async () => json({ message: 'down' }, 502),
			async () => json({ message: 'Sign in required' }, 401),
			async () => {
				throw new Error('offline');
			}
		]) {
			expect(await new ApiDashboardLayoutStore({ fetchFn: fetchFn as typeof fetch }).load()).toEqual(DEFAULT_LAYOUT);
		}
	});

	it('debounces saves into one PUT with the latest layout', async () => {
		const fetchFn = vi.fn(async () => json({ updatedAt: 't' }));
		const store = new ApiDashboardLayoutStore({ fetchFn, debounceMs: 500 });
		store.save(moveTile(DEFAULT_LAYOUT, TILE_IDS[0], 2));
		store.save(moveTile(DEFAULT_LAYOUT, TILE_IDS[0], 3));
		await vi.advanceTimersByTimeAsync(499);
		expect(fetchFn).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/preferences/ontology-dashboard');
		expect(init.method).toBe('PUT');
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual({ value: moveTile(DEFAULT_LAYOUT, TILE_IDS[0], 3) });
	});

	it('reports a failed save and clears the notice after a later success', async () => {
		let ok = false;
		const fetchFn = vi.fn(async () => (ok ? json({ updatedAt: 't' }) : json({ message: 'down' }, 502)));
		const notices: (string | null)[] = [];
		const store = new ApiDashboardLayoutStore({ fetchFn, debounceMs: 10, onSaveError: (m) => notices.push(m) });
		store.save(DEFAULT_LAYOUT);
		await vi.advanceTimersByTimeAsync(10);
		expect(notices).toEqual(["Your arrangement could not be saved: down. It stays in this session."]);
		ok = true;
		store.save(DEFAULT_LAYOUT);
		await vi.advanceTimersByTimeAsync(10);
		expect(notices.at(-1)).toBeNull();
	});

	it('reports a network failure on save', async () => {
		const notices: (string | null)[] = [];
		const store = new ApiDashboardLayoutStore({
			fetchFn: (async () => {
				throw new Error('offline');
			}) as typeof fetch,
			debounceMs: 1,
			onSaveError: (m) => notices.push(m)
		});
		store.save(DEFAULT_LAYOUT);
		await vi.advanceTimersByTimeAsync(1);
		expect(notices[0]).toContain('offline');
	});
});
