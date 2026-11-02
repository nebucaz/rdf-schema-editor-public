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
