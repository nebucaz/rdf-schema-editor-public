import { describe, expect, it, vi } from 'vitest';
import { createLoadTiming } from './load-timing';

function setup(enabled: boolean) {
	let t = 1000;
	let requests = 0;
	const table = vi.fn();
	const timing = createLoadTiming({ enabled, now: () => t, requestCount: () => requests, table });
	return {
		timing,
		table,
		advance: (ms: number) => (t += ms),
		addRequests: (n: number) => (requests += n)
	};
}

describe('createLoadTiming', () => {
	it('returns the step result and records its duration', async () => {
		const { timing, table, advance } = setup(true);
		const result = await timing.timed('namespaces', async () => {
			advance(40);
			return 'ok';
		});
		expect(result).toBe('ok');
		timing.report();
		expect(table).toHaveBeenCalledTimes(1);
		expect(table.mock.calls[0][0]).toEqual([{ step: 'namespaces', ms: 40 }, expect.anything()]);
	});

	it('reports one row per step plus total ms and request count', async () => {
		const { timing, table, advance, addRequests } = setup(true);
		await timing.timed('a', async () => advance(10));
		addRequests(3);
		await timing.timed('b', async () => advance(25));
		addRequests(2);
		timing.report();
		expect(table.mock.calls[0][0]).toEqual([
			{ step: 'a', ms: 10 },
			{ step: 'b', ms: 25 },
			{ step: 'TOTAL (5 requests)', ms: 35 }
		]);
	});

	it('counts only requests started after the timer was created', async () => {
		let requests = 7;
		const table = vi.fn();
		const timing = createLoadTiming({ enabled: true, now: () => 0, requestCount: () => requests, table });
		requests += 2;
		await timing.timed('x', async () => {});
		timing.report();
		expect(table.mock.calls[0][0].at(-1).step).toBe('TOTAL (2 requests)');
	});

	it('records a step that rejects, and rethrows', async () => {
		const { timing, table, advance } = setup(true);
		await expect(
			timing.timed('bad', async () => {
				advance(5);
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		timing.report();
		expect(table.mock.calls[0][0][0]).toEqual({ step: 'bad (failed)', ms: 5 });
	});

	it('does nothing when disabled but still runs the step', async () => {
		const { timing, table } = setup(false);
		await expect(timing.timed('a', async () => 1)).resolves.toBe(1);
		timing.report();
		expect(table).not.toHaveBeenCalled();
	});

	it('starts a fresh report after reporting', async () => {
		const { timing, table, advance } = setup(true);
		await timing.timed('a', async () => advance(1));
		timing.report();
		await timing.timed('b', async () => advance(2));
		timing.report();
		expect(table.mock.calls[1][0][0]).toEqual({ step: 'b', ms: 2 });
	});
});
