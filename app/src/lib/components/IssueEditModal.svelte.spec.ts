import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import IssueEditModal from './IssueEditModal.svelte';
import type { Issue } from '#lib/services/issues-client.js';

const issue: Issue = {
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
	followUpNeeded: false
};

const assignees = [
	{ sub: 'me', displayName: 'Me Myself' },
	{ sub: 'bo', displayName: 'Bo Lee' }
];

/** Routes the assignee list and the PATCH; `patch` decides the PATCH answer. */
function serve(patch: (body: Record<string, unknown>) => Response) {
	const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
		if (init?.method === 'PATCH') return patch(JSON.parse(String(init.body)));
		return new Response(JSON.stringify({ assignees }), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchFn);
	return fetchFn;
}

function mount(over: Record<string, unknown> = {}) {
	const props = {
		issue,
		trackerEnabled: true,
		trackerName: 'ServiceNow',
		onClose: vi.fn(),
		onApply: vi.fn(),
		onSaved: vi.fn(),
		...over
	};
	render(IssueEditModal, { props });
	return props;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('IssueEditModal (STORY-389)', () => {
	it('saves status, assignee, note and the external id, applying the change at once', async () => {
		const saved = { ...issue, status: 'in-progress', assignee: 'bo', assigneeName: 'Bo Lee', note: 'looking', externalId: 'INC1', externalUrl: 'https://sn/INC1' };
		const fetchFn = serve(() => new Response(JSON.stringify(saved), { status: 200 }));
		const props = mount();
		await screen.findByRole('option', { name: 'Bo Lee' });
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in-progress' } });
		await fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'bo' } });
		await fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'looking' } });
		await fireEvent.input(screen.getByLabelText('Ticket id'), { target: { value: 'INC1' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(saved));
		const patchCall = fetchFn.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
		expect(String(patchCall[0])).toContain(issue.id);
		expect(JSON.parse(String(patchCall[1]?.body))).toMatchObject({
			status: 'in-progress', assignee: 'bo', note: 'looking', externalSystem: 'ServiceNow', externalId: 'INC1'
		});
		// optimistic first, with the edited values
		expect(props.onApply.mock.calls[0][0]).toMatchObject({ status: 'in-progress', assignee: 'bo', assigneeName: 'Bo Lee', note: 'looking' });
		expect(props.onClose).toHaveBeenCalled();
	});

	it('keeps the modal open with the backend message and rolls the optimistic change back', async () => {
		serve(() => new Response(JSON.stringify({ message: 'note is too long' }), { status: 400 }));
		const props = mount();
		await screen.findByRole('option', { name: 'Bo Lee' });
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'resolved' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText('note is too long')).toBeTruthy();
		expect(props.onClose).not.toHaveBeenCalled();
		expect(props.onSaved).not.toHaveBeenCalled();
		expect(props.onApply).toHaveBeenLastCalledWith(issue);
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
	});

	it('lists the current user among the assignees', async () => {
		serve(() => new Response('{}', { status: 200 }));
		mount();
		expect(await screen.findByRole('option', { name: 'Me Myself' })).toBeTruthy();
		expect(screen.getByRole('option', { name: 'Unassigned' })).toBeTruthy();
	});

	it('hints that resolved and wontfix are not reopened automatically', async () => {
		serve(() => new Response('{}', { status: 200 }));
		mount();
		await screen.findByRole('option', { name: 'Bo Lee' });
		expect(screen.queryByText(/will not be re-opened automatically/)).toBeNull();
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'wontfix' } });
		expect(screen.getByText(/will not be re-opened automatically/)).toBeTruthy();
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'resolved' } });
		expect(screen.getByText(/will not be re-opened automatically/)).toBeTruthy();
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in-progress' } });
		expect(screen.queryByText(/will not be re-opened automatically/)).toBeNull();
	});

	it('shows the ticket fields only when a tracker is configured, with the link read-only', async () => {
		serve(() => new Response('{}', { status: 200 }));
		mount({ trackerEnabled: false });
		await screen.findByRole('option', { name: 'Bo Lee' });
		expect(screen.queryByLabelText('Ticket id')).toBeNull();
		cleanup();
		mount({ issue: { ...issue, externalId: 'INC1', externalUrl: 'https://sn/INC1' } });
		await screen.findByRole('option', { name: 'Bo Lee' });
		const link = screen.getByRole('link', { name: 'https://sn/INC1' });
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toContain('noopener');
	});

	it('refuses an over-long note before calling the backend', async () => {
		const fetchFn = serve(() => new Response(JSON.stringify(issue), { status: 200 }));
		const props = mount();
		await screen.findByRole('option', { name: 'Bo Lee' });
		await fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'x'.repeat(4001) } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText(/at most 4000 characters/)).toBeTruthy();
		expect(fetchFn.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
		expect(props.onClose).not.toHaveBeenCalled();
	});
});

const sn = { enabled: true, name: 'ServiceNow', bulkCap: 25, syncEnabled: true };
const tk = { correlationId: issue.id, number: 'INC001', sysId: 's', state: '2', stateLabel: 'In Progress', createdAt: '', closedAt: '', url: 'https://sn/INC001' };

describe('IssueEditModal ticket section (STORY-403)', () => {
	it('creates the ticket and shows its number and link, staying open', async () => {
		const created = { ...issue, tickets: [tk], syncState: 'synced', externalId: 'INC001', externalUrl: 'https://sn/INC001' };
		const fetchFn = vi.fn(async (url: string, init?: RequestInit) =>
			init?.method === 'POST' ? new Response(JSON.stringify(created), { status: 200 }) : new Response(JSON.stringify({ assignees }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchFn);
		const props = mount({ serviceNow: sn });
		await fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
		expect(await screen.findByText('INC001')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'INC001' }).getAttribute('href')).toBe('https://sn/INC001');
		expect(String(fetchFn.mock.calls.find(([, i]) => i?.method === 'POST')![0])).toMatch(new RegExp(`/issues/${issue.id}/ticket$`));
		expect(props.onSaved).toHaveBeenCalledWith(created);
		expect(props.onClose).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: 'Create ticket' })).toBeNull();
	});

	it('keeps the modal open with the backend message when the creation fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
			init?.method === 'POST' ? new Response(JSON.stringify({ message: 'The finding cannot be routed: no owner' }), { status: 409 }) : new Response(JSON.stringify({ assignees }), { status: 200 })
		));
		const props = mount({ serviceNow: sn });
		await fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
		expect(await screen.findByText('The finding cannot be routed: no owner')).toBeTruthy();
		expect(props.onClose).not.toHaveBeenCalled();
		expect(props.onSaved).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Create ticket' })).toBeTruthy();
	});

	it('disables the button with the reason for a wontfix issue', async () => {
		serve(() => new Response('{}', { status: 200 }));
		mount({ serviceNow: sn, issue: { ...issue, status: 'wontfix' } });
		const button = screen.getByRole('button', { name: 'Create ticket' }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(screen.getByText(/marked won't fix/)).toBeTruthy();
	});

	it('shows the current ticket and the history, and makes the local assignee read-only while it is open', async () => {
		serve(() => new Response('{}', { status: 200 }));
		const closed = { ...tk, correlationId: 'old', number: 'INC000', stateLabel: 'Closed', closedAt: '2026-01-01' };
		mount({ serviceNow: sn, issue: { ...issue, tickets: [closed, tk], serviceNowAssignee: 'Ann Agent', serviceNowGroup: 'ITAM', syncState: 'synced' } });
		await screen.findByRole('option', { name: 'Bo Lee' });
		expect(screen.getByRole('link', { name: 'INC001' })).toBeTruthy();
		expect(screen.getByText('INC000')).toBeTruthy();
		expect(screen.getByText(/Ann Agent/)).toBeTruthy();
		expect(screen.getByText(/ITAM/)).toBeTruthy();
		expect((screen.getByLabelText('Assignee') as HTMLSelectElement).disabled).toBe(true);
		expect(screen.getByText(/ServiceNow is the master/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Create (follow-up )?ticket/ })).toBeNull();
	});

	it('offers a follow-up ticket after a closed one and lets the assignee be edited again', async () => {
		serve(() => new Response('{}', { status: 200 }));
		const closed = { ...tk, stateLabel: 'Closed', closedAt: '2026-01-01' };
		mount({ serviceNow: sn, issue: { ...issue, tickets: [closed], followUpNeeded: true } });
		await screen.findByRole('option', { name: 'Bo Lee' });
		expect((screen.getByRole('button', { name: 'Create follow-up ticket' }) as HTMLButtonElement).disabled).toBe(false);
		expect((screen.getByLabelText('Assignee') as HTMLSelectElement).disabled).toBe(false);
	});

	it('hides the ticket section when the integration is off and keeps the assignee editable', async () => {
		serve(() => new Response('{}', { status: 200 }));
		mount({ issue: { ...issue, tickets: [tk] } });
		await screen.findByRole('option', { name: 'Bo Lee' });
		expect(screen.queryByRole('button', { name: /Create (follow-up )?ticket/ })).toBeNull();
		expect(screen.queryByText(/ServiceNow is the master/)).toBeNull();
		expect((screen.getByLabelText('Assignee') as HTMLSelectElement).disabled).toBe(false);
	});

	it('leaves an issue with a manual external id as before', async () => {
		serve(() => new Response('{}', { status: 200 }));
		mount({ serviceNow: sn, issue: { ...issue, externalId: 'MAN-1' } });
		await screen.findByRole('option', { name: 'Bo Lee' });
		expect((screen.getByRole('button', { name: 'Create ticket' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByLabelText('Ticket id') as HTMLInputElement).value).toBe('MAN-1');
		expect((screen.getByLabelText('Assignee') as HTMLSelectElement).disabled).toBe(false);
	});
});

