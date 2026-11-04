import { describe, expect, it } from 'vitest';
import { createConcurrencyLimiter } from './concurrency-limiter';

/** A task that stays running until `finish()` / `fail()` is called. */
function deferredTask(log: string[], name: string) {
	let finish!: (v: string) => void;
	let fail!: (e: Error) => void;
	const promise = new Promise<string>((res, rej) => {
		finish = res;
		fail = rej;
	});
	return {
		run: () => {
			log.push(`start ${name}`);
			return promise;
		},
		finish: () => finish(name),
		fail: () => fail(new Error(`${name} failed`))
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createConcurrencyLimiter', () => {
	it('never runs more tasks at once than the limit', async () => {
		const limiter = createConcurrencyLimiter(3);
		let running = 0;
		let peak = 0;
		const done = Array.from({ length: 20 }, () =>
			limiter.run(async () => {
				running++;
				peak = Math.max(peak, running);
				await tick();
				running--;
			})
		);
		await Promise.all(done);
		expect(peak).toBe(3);
	});

	it('starts tasks in submission order', async () => {
		const log: string[] = [];
		const limiter = createConcurrencyLimiter(1);
		const tasks = ['a', 'b', 'c'].map((n) => deferredTask(log, n));
		const results = tasks.map((t) => limiter.run(t.run));
		await tick();
		expect(log).toEqual(['start a']);
		tasks[0].finish();
		await tick();
		expect(log).toEqual(['start a', 'start b']);
		tasks[1].finish();
		tasks[2].finish();
		expect(await Promise.all(results)).toEqual(['a', 'b', 'c']);
		expect(log).toEqual(['start a', 'start b', 'start c']);
	});

	it('hands the result or the rejection of each task to its own caller', async () => {
		const limiter = createConcurrencyLimiter(2);
		await expect(limiter.run(async () => 42)).resolves.toBe(42);
		await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
	});

	it('releases the slot when a task fails, so queued tasks still run', async () => {
		const log: string[] = [];
		const limiter = createConcurrencyLimiter(1);
		const first = deferredTask(log, 'first');
		const second = deferredTask(log, 'second');
		const r1 = limiter.run(first.run);
		const r2 = limiter.run(second.run);
		await tick();
		first.fail();
		await expect(r1).rejects.toThrow('first failed');
		await tick();
		expect(log).toEqual(['start first', 'start second']);
		second.finish();
		await expect(r2).resolves.toBe('second');
	});

	it('releases the slot when a task throws synchronously', async () => {
		const limiter = createConcurrencyLimiter(1);
		await expect(
			limiter.run(() => {
				throw new Error('sync');
			})
		).rejects.toThrow('sync');
		await expect(limiter.run(async () => 'next')).resolves.toBe('next');
	});

	it('reports how many tasks run and wait', async () => {
		const log: string[] = [];
		const limiter = createConcurrencyLimiter(2);
		const tasks = ['a', 'b', 'c'].map((n) => deferredTask(log, n));
		const results = tasks.map((t) => limiter.run(t.run));
		await tick();
		expect(limiter.active).toBe(2);
		expect(limiter.queued).toBe(1);
		tasks.forEach((t) => t.finish());
		await Promise.all(results);
		expect(limiter.active).toBe(0);
		expect(limiter.queued).toBe(0);
	});

	it('treats a limit below 1 as 1 rather than never running anything', async () => {
		const limiter = createConcurrencyLimiter(0);
		await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
	});
});
