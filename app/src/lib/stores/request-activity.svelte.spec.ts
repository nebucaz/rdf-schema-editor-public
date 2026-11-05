import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { requestActivity } from './request-activity.svelte';

describe('requestActivity', () => {
	beforeEach(() => requestActivity.reset());

	it('starts idle', () => {
		expect(requestActivity.pending).toBe(0);
		expect(requestActivity.busy).toBe(false);
	});

	it('counts concurrent requests and is busy while any is pending', async () => {
		let release1!: () => void;
		let release2!: () => void;
		const p1 = requestActivity.track(() => new Promise<void>((r) => (release1 = r)));
		const p2 = requestActivity.track(() => new Promise<void>((r) => (release2 = r)));
		expect(requestActivity.pending).toBe(2);
		expect(requestActivity.busy).toBe(true);
		release1();
		await p1;
		expect(requestActivity.pending).toBe(1);
		expect(requestActivity.busy).toBe(true);
		release2();
		await p2;
		expect(requestActivity.pending).toBe(0);
		expect(requestActivity.busy).toBe(false);
	});

	it('returns the tracked result', async () => {
		await expect(requestActivity.track(async () => 42)).resolves.toBe(42);
	});

	it('decrements when the tracked call rejects, and rethrows', async () => {
		await expect(requestActivity.track(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		expect(requestActivity.pending).toBe(0);
	});

	it('decrements when the tracked function throws synchronously', async () => {
		await expect(
			requestActivity.track(() => {
				throw new Error('sync');
			})
		).rejects.toThrow('sync');
		expect(requestActivity.pending).toBe(0);
	});

	it('reset clears the count', () => {
		void requestActivity.track(() => new Promise<void>(() => {}));
		requestActivity.reset();
		expect(requestActivity.pending).toBe(0);
	});
});

describe('requestActivity.started', () => {
	beforeEach(() => requestActivity.reset());

	it('counts every tracked request ever begun, including failed ones', async () => {
		await requestActivity.track(async () => 1);
		await requestActivity.track(() => Promise.reject(new Error('x'))).catch(() => {});
		expect(requestActivity.started).toBe(2);
		expect(requestActivity.pending).toBe(0);
	});

	it('is cleared by reset', async () => {
		await requestActivity.track(async () => 1);
		requestActivity.reset();
		expect(requestActivity.started).toBe(0);
	});
});

describe('requestActivity.track inside an $effect', () => {
	beforeEach(() => requestActivity.reset());

	it('does not make the calling effect depend on pending', async () => {
		let runs = 0;
		const releases: Array<() => void> = [];
		const dispose = $effect.root(() => {
			$effect(() => {
				runs++;
				void requestActivity.track(() => new Promise<void>((r) => releases.push(r)));
			});
		});
		flushSync();
		expect(runs).toBe(1);
		// Finishing the request writes `pending` again; the effect must not re-run for it.
		releases.forEach((r) => r());
		await Promise.resolve();
		flushSync();
		expect(runs).toBe(1);
		dispose();
	});

	it('keeps pending and busy reactive for readers outside track', async () => {
		const seen: number[] = [];
		const dispose = $effect.root(() => {
			$effect(() => {
				seen.push(requestActivity.pending);
			});
		});
		flushSync();
		let release!: () => void;
		const p = requestActivity.track(() => new Promise<void>((r) => (release = r)));
		flushSync();
		release();
		await p;
		flushSync();
		expect(seen).toEqual([0, 1, 0]);
		dispose();
	});
});
