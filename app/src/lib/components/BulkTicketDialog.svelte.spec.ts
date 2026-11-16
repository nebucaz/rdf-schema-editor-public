import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import BulkTicketDialog from './BulkTicketDialog.svelte';

const item = (over: Record<string, unknown>) => ({ issueId: 'a', individualLabel: 'Alice', ruleId: 'arm-s:1', action: 'create', ...over });

const plan = {
	dryRun: true,
	cap: 2,
	items: [
		item({ issueId: 'a', headline: 'Fix Alice', assignmentGroup: 'ITAM' }),
		item({ issueId: 'b', individualLabel: 'Bob', action: 'follow-up' }),
		item({ issueId: 'c', individualLabel: 'Carl', action: 'skip', reason: 'The issue is resolved' }),
		item({ issueId: 'd', individualLabel: 'Dana', action: 'blocked', reason: 'Cannot be routed: no owner' }),
		item({ issueId: 'e', individualLabel: 'Eve', result: 'deferred', reason: 'Over the per-run cap of 2' })
	]
};
const done = {
	dryRun: false,
	cap: 2,
	items: [
		item({ issueId: 'a', result: 'created', number: 'INC001' }),
		item({ issueId: 'b', individualLabel: 'Bob', action: 'follow-up', result: 'error', error: 'ServiceNow said no' })
	]
};

function serve(run = done, dry: Response | null = null) {
	const fetchFn = vi.fn(async (url: string, _init?: RequestInit) =>
		String(url).endsWith('/dry-run') ? (dry ?? new Response(JSON.stringify(plan), { status: 200 })) : new Response(JSON.stringify(run), { status: 200 })
	);
	vi.stubGlobal('fetch', fetchFn);
	return fetchFn;
}

function mount(over: Record<string, unknown> = {}) {
	const props = { selection: { ids: ['a', 'b'] }, onClose: vi.fn(), onDone: vi.fn(), ...over };
	render(BulkTicketDialog, { props });
	return props;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('BulkTicketDialog (STORY-403)', () => {
	it('runs the dry-run first and keeps Create disabled until it has answered', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const fetchFn = vi.fn(async (_url: string) => {
			await gate;
			return new Response(JSON.stringify(plan), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchFn);
		mount();
		const create = screen.getByRole('button', { name: /^Create/ }) as HTMLButtonElement;
		expect(create.disabled).toBe(true);
		release();
		await screen.findByText('Fix Alice');
		await waitFor(() => expect((screen.getByRole('button', { name: /^Create/ }) as HTMLButtonElement).disabled).toBe(false));
		expect(fetchFn.mock.calls.every(([u]) => String(u).endsWith('/dry-run'))).toBe(true);
	});

	it('shows the cap, the counts, the reasons and the routing', async () => {
		serve();
		mount();
		await screen.findByText('Fix Alice');
		expect(screen.getByText(/at most 2 tickets per run/)).toBeTruthy();
		const counts = document.querySelector('.counts')!.textContent!;
		expect(counts).toMatch(/1 to create/);
		expect(counts).toMatch(/1 follow-up/);
		expect(counts).toMatch(/1 skipped/);
		expect(counts).toMatch(/1 blocked/);
		expect(counts).toMatch(/1 deferred/);
		expect(screen.getByText('The issue is resolved')).toBeTruthy();
		expect(screen.getByText('Cannot be routed: no owner')).toBeTruthy();
		expect(screen.getByText('Over the per-run cap of 2')).toBeTruthy();
		expect(screen.getByText('ITAM')).toBeTruthy();
	});

	it('sends the same selection to the dry-run and the real run, then shows the result per issue', async () => {
		const fetchFn = serve();
		const props = mount({ selection: { status: 'open', ruleId: 'arm-s:1' } });
		await screen.findByText('Fix Alice');
		await fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
		await screen.findByText('INC001');
		expect(screen.getByText('ServiceNow said no')).toBeTruthy();
		const bodies = fetchFn.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
		expect(bodies).toEqual([{ status: 'open', ruleId: 'arm-s:1' }, { status: 'open', ruleId: 'arm-s:1' }]);
		expect(String(fetchFn.mock.calls[1][0])).toMatch(/\/issues\/tickets$/);
		expect(props.onDone).toHaveBeenCalled();
		// a second run is not offered
		expect(screen.queryByRole('button', { name: /^Create/ })).toBeNull();
	});

	it('disables Create when the dry-run has nothing to create', async () => {
		serve(done, new Response(JSON.stringify({ dryRun: true, cap: 2, items: [item({ action: 'skip', reason: 'x' })] }), { status: 200 }));
		mount();
		await screen.findByText('x');
		expect((screen.getByRole('button', { name: /^Create/ }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows a dry-run failure and offers no Create', async () => {
		serve(done, new Response(JSON.stringify({ message: 'Too many issues selected' }), { status: 400 }));
		mount();
		expect(await screen.findByText('Too many issues selected')).toBeTruthy();
		expect((screen.getByRole('button', { name: /^Create/ }) as HTMLButtonElement).disabled).toBe(true);
	});
});
