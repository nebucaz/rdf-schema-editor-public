import { describe, expect, it, vi } from 'vitest';
import { createTicket, createTickets, dryRunTickets, syncTickets } from './tickets-client';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const call = (fetchFn: ReturnType<typeof vi.fn>) => fetchFn.mock.calls[0] as unknown as [string, RequestInit | undefined];

describe('tickets client (STORY-402)', () => {
	it('creates the ticket of one issue with an empty JSON POST', async () => {
		const issue = { id: 'a b', tickets: [{ number: 'INC1' }], syncState: 'pending' };
		const fetchFn = vi.fn(async () => ok(issue));
		expect(await createTicket(fetchFn as never, 'a b')).toEqual(issue);
		const [url, init] = call(fetchFn);
		expect(url).toMatch(/\/issues\/a%20b\/ticket$/);
		expect(init?.method).toBe('POST');
		expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
		expect(init?.body).toBe('{}');
	});

	it('posts a dry-run with only the declared selection fields', async () => {
		const run = { dryRun: true, cap: 25, items: [] };
		const fetchFn = vi.fn(async () => ok(run));
		expect(await dryRunTickets(fetchFn as never, { ids: ['a'], status: 'open', evil: 1 } as never)).toEqual(run);
		const [url, init] = call(fetchFn);
		expect(url).toMatch(/\/issues\/tickets\/dry-run$/);
		expect(init?.method).toBe('POST');
		expect(JSON.parse(init?.body as string)).toEqual({ ids: ['a'], status: 'open' });
	});

	it('creates tickets in bulk from a filter selection', async () => {
		const run = { dryRun: false, cap: 25, items: [{ issueId: 'a', action: 'create', result: 'created', number: 'INC1' }] };
		const fetchFn = vi.fn(async () => ok(run));
		expect(await createTickets(fetchFn as never, { ruleId: 'arm-s:1', assignee: 'u' })).toEqual(run);
		const [url, init] = call(fetchFn);
		expect(url).toMatch(/\/issues\/tickets$/);
		expect(JSON.parse(init?.body as string)).toEqual({ ruleId: 'arm-s:1', assignee: 'u' });
	});

	it('runs a sync pass', async () => {
		const report = { dryRun: false, pulled: 2, pushed: 1, skipped: 0, deferred: 0, errors: 0 };
		const fetchFn = vi.fn(async () => ok(report));
		expect(await syncTickets(fetchFn as never)).toEqual(report);
		const [url, init] = call(fetchFn);
		expect(url).toMatch(/\/issues\/tickets\/sync$/);
		expect(init?.method).toBe('POST');
	});

	it('surfaces the backend message, a status fallback and network failures', async () => {
		const refused = vi.fn(async () => new Response(JSON.stringify({ message: 'The issue has an open ticket' }), { status: 409 }));
		await expect(createTicket(refused as never, 'x')).rejects.toThrow('The issue has an open ticket');
		const plain = vi.fn(async () => new Response('boom', { status: 502 }));
		await expect(syncTickets(plain as never)).rejects.toThrow('Request failed (502)');
		const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
		await expect(dryRunTickets(down as never, {})).rejects.toThrow(/Network error/);
	});
});
