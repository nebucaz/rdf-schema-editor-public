import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';

vi.mock('#lib/stores/namespace-store.svelte.js', () => ({
	namespaceStore: { namespaces: [], ensureLoaded: vi.fn(async () => {}) }
}));

import IssuesView from './IssuesView.svelte';
import type { Issue } from '#lib/services/issues-client.js';

function issue(over: Partial<Issue> = {}): Issue {
	return {
		id: 'f2f2f2f2f2f2f2f2',
		individualIri: 'http://ns#alice',
		typeIri: 'http://ns#Person',
		ruleId: 'arm-s:1',
		shapeIri: 'http://ns#S',
		path: 'http://ns#name',
		constraint: 'minCount',
		individualLabel: 'Alice',
		message: 'needs a name',
		qualityDimension: '',
		status: 'open',
		resolvedBy: '',
		assignee: '',
		assigneeName: '',
		note: '',
		externalSystem: '',
		externalId: '',
		externalUrl: '',
		createdAt: '',
		updatedBy: '',
		updatedByName: '',
		updatedAt: '',
		lastSeenAt: '',
		tickets: [],
		serviceNowAssignee: '',
		serviceNowGroup: '',
		syncState: 'none',
		lastSyncedAt: '',
		lastError: '',
		serviceNowResolution: '',
		followUpNeeded: false,
		...over
	};
}

/** Answers every `GET /issues` with the page the caller builds from the requested query. */
function serve(build: (params: URLSearchParams) => { issues: Issue[]; total: number }) {
	const fetchFn = vi.fn(async (url: string) => {
		const params = new URL(url, 'http://x').searchParams;
		return new Response(JSON.stringify(build(params)), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchFn);
	return fetchFn;
}

const lastParams = (fetchFn: ReturnType<typeof serve>) =>
	new URL(fetchFn.mock.calls.at(-1)![0] as string, 'http://x').searchParams;

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('IssuesView', () => {
	it('lists the stored issues without running a validation', async () => {
		const fetchFn = serve(() => ({ issues: [issue({ status: 'in-progress', assigneeName: 'Bo Lee', assignee: 'bo' })], total: 1 }));
		render(IssuesView, { props: { currentUser: 'me' } });
		expect(await screen.findByText('Alice')).toBeTruthy();
		expect(document.querySelector('.status-chip')?.textContent).toBe('in-progress');
		expect(screen.getByText('Bo Lee')).toBeTruthy();
		expect(fetchFn.mock.calls.every(([u]) => !String(u).includes('reconcile'))).toBe(true);
		const link = screen.getByRole('link', { name: 'Finding' });
		expect(link.getAttribute('href')).toContain('/validation?finding=f2f2f2f2f2f2f2f2');
	});

	it('shows the external link only when one is set, opening in a new tab', async () => {
		serve(() => ({
			issues: [
				issue({ id: 'a2a2a2a2a2a2a2a2', externalUrl: 'https://snow.example/INC1', externalId: 'INC1' }),
				issue({ id: 'b3b3b3b3b3b3b3b3', individualLabel: 'Bob' })
			],
			total: 2
		}));
		render(IssuesView, { props: { currentUser: 'me' } });
		await screen.findByText('Bob');
		const links = screen.getAllByRole('link', { name: 'INC1' });
		expect(links).toHaveLength(1);
		expect(links[0].getAttribute('href')).toBe('https://snow.example/INC1');
		expect(links[0].getAttribute('target')).toBe('_blank');
		expect(links[0].getAttribute('rel')).toContain('noopener');
	});

	it('filters by status and by "mine", starting again at the first page', async () => {
		const fetchFn = serve(() => ({ issues: [issue()], total: 1 }));
		render(IssuesView, { props: { currentUser: 'me' } });
		await screen.findByText('Alice');
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
		await waitFor(() => expect(lastParams(fetchFn).get('status')).toBe('open'));
		expect(lastParams(fetchFn).get('offset')).toBeNull();
		await fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'mine' } });
		await waitFor(() => expect(lastParams(fetchFn).get('assignee')).toBe('me'));
		await fireEvent.input(screen.getByLabelText('Rule'), { target: { value: 'arm-s:1' } });
		await waitFor(() => expect(lastParams(fetchFn).get('ruleId')).toBe('arm-s:1'));
		await fireEvent.input(screen.getByLabelText('Identity IRI'), { target: { value: 'http://ns#alice' } });
		await waitFor(() => expect(lastParams(fetchFn).get('individualIri')).toBe('http://ns#alice'));
	});

	it('pages on the server', async () => {
		const fetchFn = serve((p) => ({ issues: [issue({ individualLabel: `Row ${p.get('offset') ?? '0'}` })], total: 120 }));
		render(IssuesView, { props: { currentUser: 'me' } });
		await screen.findByText('Row 0');
		expect(screen.getByText('1–50 of 120')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await screen.findByText('Row 50');
		expect(lastParams(fetchFn).get('limit')).toBe('50');
		expect(screen.getByText('51–100 of 120')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
		await screen.findByText('Row 0');
	});

	it('groups by identity as a view only', async () => {
		const fetchFn = serve(() => ({
			issues: [
				issue({ id: 'a2a2a2a2a2a2a2a2', ruleId: 'r1' }),
				issue({ id: 'b3b3b3b3b3b3b3b3', ruleId: 'r2' }),
				issue({ id: 'c4c4c4c4c4c4c4c4', individualIri: 'http://ns#bob', individualLabel: 'Bob' })
			],
			total: 3
		}));
		render(IssuesView, { props: { currentUser: 'me' } });
		await screen.findByText('Bob');
		const requests = fetchFn.mock.calls.length;
		await fireEvent.click(screen.getByLabelText('Group by identity'));
		expect(screen.getByText('Alice (2)')).toBeTruthy();
		expect(screen.getByText('Bob (1)')).toBeTruthy();
		expect(fetchFn.mock.calls.length).toBe(requests);
		// every group table carries the same fixed column set, so the columns line up
		const tables = [...document.querySelectorAll('table.issues')];
		expect(tables).toHaveLength(2);
		for (const t of tables) expect(t.querySelectorAll('colgroup col')).toHaveLength(t.querySelectorAll('thead th').length);
	});

	it('shows an empty state and the backend error', async () => {
		serve(() => ({ issues: [], total: 0 }));
		render(IssuesView, { props: { currentUser: 'me' } });
		expect(await screen.findByText(/No issues/)).toBeTruthy();
		cleanup();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'store down' }), { status: 500 })));
		render(IssuesView, { props: { currentUser: 'me' } });
		expect(await screen.findByText('store down')).toBeTruthy();
	});

	it('edits an issue from its row and shows the change at once, rolling back on failure', async () => {
		const original = issue({ status: 'open' });
		const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === 'PATCH') return new Response(JSON.stringify({ message: 'nope' }), { status: 500 });
			if (String(url).includes('/assignees')) return new Response(JSON.stringify({ assignees: [] }), { status: 200 });
			return new Response(JSON.stringify({ issues: [original], total: 1 }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchFn);
		render(IssuesView, { props: { currentUser: 'me' } });
		await screen.findByText('Alice');
		await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		await fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Status'), { target: { value: 'resolved' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText('nope')).toBeTruthy();
		expect(document.querySelector('tr .status-chip')?.textContent).toBe('open');
	});

	it('shows a saved edit in the row', async () => {
		const original = issue({ status: 'open' });
		const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === 'PATCH') return new Response(JSON.stringify({ ...original, status: 'wontfix' }), { status: 200 });
			if (String(url).includes('/assignees')) return new Response(JSON.stringify({ assignees: [] }), { status: 200 });
			return new Response(JSON.stringify({ issues: [original], total: 1 }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchFn);
		render(IssuesView, { props: { currentUser: 'me' } });
		await screen.findByText('Alice');
		await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		await fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Status'), { target: { value: 'wontfix' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(document.querySelector('tr .status-chip')?.textContent).toBe('wontfix');
	});
});

const sn = { enabled: true, name: 'ServiceNow', bulkCap: 25, syncEnabled: true };
const tk = { correlationId: 'f', number: 'INC001', sysId: 's', state: '2', stateLabel: 'In Progress', createdAt: '', closedAt: '', url: 'https://sn/INC001' };

/** Serves the issue list, the dry-run, the bulk run and the sync pass. */
function serveAll(issues: Issue[]) {
	const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
		const u = String(url);
		if (u.endsWith('/issues/tickets/dry-run')) return new Response(JSON.stringify({ dryRun: true, cap: 25, items: [{ issueId: issues[0].id, individualLabel: 'Alice', ruleId: 'arm-s:1', action: 'create', headline: 'Fix Alice' }] }), { status: 200 });
		if (u.endsWith('/issues/tickets/sync')) return new Response(JSON.stringify({ dryRun: false, pulled: 1, pushed: 2, skipped: 0, deferred: 0, errors: 0 }), { status: 200 });
		if (u.endsWith('/issues/tickets')) return new Response(JSON.stringify({ dryRun: false, cap: 25, items: [] }), { status: 200 });
		return new Response(JSON.stringify({ issues, total: issues.length }), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchFn);
	return fetchFn;
}

describe('IssuesView tickets (STORY-403)', () => {
	it('renders the sync badge, the error tooltip, the follow-up tag and a retry that runs a sync', async () => {
		const fetchFn = serveAll([
			issue({ id: 'a1a1a1a1a1a1a1a1', individualLabel: 'Alice', tickets: [tk], externalUrl: 'https://sn/INC001', externalId: 'INC001', syncState: 'synced' }),
			issue({ id: 'b2b2b2b2b2b2b2b2', individualLabel: 'Bob', tickets: [tk], syncState: 'error', lastError: 'rate limited' }),
			issue({ id: 'c3c3c3c3c3c3c3c3', individualLabel: 'Carl', tickets: [{ ...tk, closedAt: 'x' }], syncState: 'synced', followUpNeeded: true })
		]);
		render(IssuesView, { props: { currentUser: 'me', serviceNow: sn } });
		await screen.findByText('Bob');
		const badges = [...document.querySelectorAll('.sync-badge')];
		expect(badges.map((b) => b.textContent?.trim())).toEqual(['synced', 'error', 'synced']);
		expect(badges[1].getAttribute('title')).toBe('rate limited');
		expect(screen.getAllByText('follow-up needed')).toHaveLength(1);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(fetchFn.mock.calls.some(([u]) => String(u).endsWith('/issues/tickets/sync'))).toBe(true));
	});

	it('syncs on demand and reports the counts', async () => {
		serveAll([issue()]);
		render(IssuesView, { props: { currentUser: 'me', serviceNow: sn } });
		await screen.findByText('Alice');
		await fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
		expect(await screen.findByText(/1 pulled, 2 pushed/)).toBeTruthy();
	});

	it('notes that automatic sync is paused', async () => {
		serveAll([issue()]);
		render(IssuesView, { props: { currentUser: 'me', serviceNow: { ...sn, syncEnabled: false } } });
		await screen.findByText('Alice');
		expect(screen.getByText(/Automatic sync is paused/)).toBeTruthy();
	});

	it('opens the dry-run for the selected rows before anything is created', async () => {
		const fetchFn = serveAll([issue({ id: 'a1a1a1a1a1a1a1a1' }), issue({ id: 'b2b2b2b2b2b2b2b2', individualLabel: 'Bob' })]);
		render(IssuesView, { props: { currentUser: 'me', serviceNow: sn } });
		await screen.findByText('Bob');
		await fireEvent.click(screen.getByLabelText('Select Bob'));
		await fireEvent.click(screen.getByRole('button', { name: 'Create tickets…' }));
		await screen.findByText('Fix Alice');
		const posts = fetchFn.mock.calls.filter(([, i]) => i?.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(String(posts[0][0])).toMatch(/dry-run$/);
		expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ ids: ['b2b2b2b2b2b2b2b2'] });
	});

	it('uses the active filter when no row is selected', async () => {
		const fetchFn = serveAll([issue()]);
		render(IssuesView, { props: { currentUser: 'me', serviceNow: sn } });
		await screen.findByText('Alice');
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create tickets…' }));
		await screen.findByText('Fix Alice');
		const dry = fetchFn.mock.calls.find(([u]) => String(u).endsWith('/dry-run'))!;
		expect(JSON.parse(String((dry[1] as RequestInit).body))).toEqual({ status: 'open' });
	});

	it('renders no ticket control when the integration is off', async () => {
		serveAll([issue({ tickets: [tk], syncState: 'error', lastError: 'x', followUpNeeded: true })]);
		render(IssuesView, { props: { currentUser: 'me' } });
		await screen.findByText('Alice');
		expect(screen.queryByRole('button', { name: 'Create tickets…' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(document.querySelector('.sync-badge')).toBeNull();
		expect(screen.queryByText('follow-up needed')).toBeNull();
		expect(screen.queryByLabelText('Select Alice')).toBeNull();
	});
});

