import { describe, expect, it, vi } from 'vitest';
import { fetchAssignees, listIssues, reconcile, updateIssue } from './issues-client';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const call = (fetchFn: ReturnType<typeof vi.fn>) => fetchFn.mock.calls[0] as unknown as [string, RequestInit | undefined];

describe('issues client (STORY-386)', () => {
	it('reconciles with a JSON POST and returns the envelope', async () => {
		const body = { violations: [], notChecked: [], issues: [{ findingId: 'f', issueId: 'f', status: 'open', assignee: '', externalUrl: '', isNew: true }] };
		const fetchFn = vi.fn(async () => ok(body));
		expect(await reconcile(fetchFn as never)).toEqual(body);
		const [url, init] = call(fetchFn);
		expect(url).toMatch(/\/issues\/reconcile$/);
		expect(init?.method).toBe('POST');
		expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
	});

	it('lists with the filters as query parameters, leaving empty ones out', async () => {
		const fetchFn = vi.fn(async () => ok({ issues: [], total: 0 }));
		await listIssues(fetchFn as never, { status: 'open', assignee: '', ruleId: 'arm-s:1', limit: 50, offset: 0 });
		const [url] = call(fetchFn);
		expect(url).toContain('/issues?');
		expect(url).toContain('status=open');
		expect(url).toContain('ruleId=arm-s%3A1');
		expect(url).toContain('limit=50');
		expect(url).not.toContain('assignee');
	});

	it('patches only the declared fields', async () => {
		const fetchFn = vi.fn(async () => ok({ id: 'a b', status: 'resolved' }));
		await updateIssue(fetchFn as never, 'a b', { status: 'resolved', updatedBy: 'mallory', externalUrl: 'x' } as never);
		const [url, init] = call(fetchFn);
		expect(url).toMatch(/\/issues\/a%20b$/);
		expect(init?.method).toBe('PATCH');
		expect(JSON.parse(init?.body as string)).toEqual({ status: 'resolved' });
	});

	it('reads the assignee pick list', async () => {
		const fetchFn = vi.fn(async () => ok({ assignees: [{ sub: 'u', displayName: 'U' }] }));
		expect(await fetchAssignees(fetchFn as never)).toEqual([{ sub: 'u', displayName: 'U' }]);
		expect(call(fetchFn)[0]).toMatch(/\/issues\/assignees$/);
	});

	it('surfaces the backend message on failure', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify({ message: 'Issue not found' }), { status: 404 }));
		await expect(updateIssue(fetchFn as never, 'x', { note: 'n' })).rejects.toThrow('Issue not found');
		const plain = vi.fn(async () => new Response('boom', { status: 502 }));
		await expect(reconcile(plain as never)).rejects.toThrow('Request failed (502)');
		const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
		await expect(listIssues(down as never)).rejects.toThrow(/Network error/);
	});
});

describe('issue ticket fields (STORY-402)', () => {
	it('types the additive ticket fields of an issue', () => {
		const issue: Partial<import('./issues-client').Issue> = {
			tickets: [{ correlationId: 'f', number: 'INC1', sysId: 's', state: '1', stateLabel: 'New', createdAt: '', closedAt: '', url: 'https://sn/1' }],
			serviceNowAssignee: 'Ann',
			serviceNowGroup: 'ITAM',
			syncState: 'error',
			lastSyncedAt: '',
			lastError: 'x',
			serviceNowResolution: '',
			followUpNeeded: true
		};
		expect(issue.tickets?.[0].number).toBe('INC1');
	});
});
