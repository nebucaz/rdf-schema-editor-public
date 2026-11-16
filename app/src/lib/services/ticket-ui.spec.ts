import { describe, expect, it } from 'vitest';
import type { Issue, Ticket } from './issues-client';
import { bulkCounts, currentTicket, syncBadge, ticketAction } from './ticket-ui';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
	correlationId: 'f', number: 'INC1', sysId: 's', state: '1', stateLabel: 'New', createdAt: '', closedAt: '', url: 'https://sn/1', ...over
});
const issue = (over: Partial<Issue> = {}) => ({ id: 'f', status: 'open', externalId: '', tickets: [], syncState: 'none', followUpNeeded: false, lastError: '', ...over }) as Issue;

describe('ticket-ui (STORY-403)', () => {
	it('offers Create ticket for an open issue without a ticket', () => {
		expect(ticketAction(issue())).toEqual({ kind: 'create', label: 'Create ticket', disabledReason: null });
	});

	it('offers a follow-up when the current ticket is closed', () => {
		const a = ticketAction(issue({ tickets: [ticket({ closedAt: '2026-01-01 10:00:00' })], followUpNeeded: true }));
		expect(a).toEqual({ kind: 'follow-up', label: 'Create follow-up ticket', disabledReason: null });
	});

	it('disables the button with the reason for wontfix, resolved, an open ticket and a manual id', () => {
		expect(ticketAction(issue({ status: 'wontfix' })).disabledReason).toMatch(/won't fix/);
		expect(ticketAction(issue({ status: 'resolved' })).disabledReason).toMatch(/resolved/);
		expect(ticketAction(issue({ tickets: [ticket()] })).disabledReason).toMatch(/open ticket \(INC1\)/);
		expect(ticketAction(issue({ externalId: 'X-1' })).disabledReason).toMatch(/external id/);
	});

	it('takes the latest ticket as the current one', () => {
		expect(currentTicket(issue())).toBeNull();
		expect(currentTicket(issue({ tickets: [ticket({ number: 'INC1' }), ticket({ number: 'INC2' })] }))?.number).toBe('INC2');
	});

	it('badges the sync state and says nothing for an issue without a ticket', () => {
		expect(syncBadge(issue())).toBeNull();
		expect(syncBadge(issue({ tickets: [ticket()], syncState: '' }))).toBeNull();
		expect(syncBadge(issue({ tickets: [ticket()], syncState: 'synced' }))).toEqual({ state: 'synced', label: 'synced', title: '' });
		expect(syncBadge(issue({ tickets: [ticket()], syncState: 'pending' }))).toMatchObject({ state: 'pending', label: 'pending' });
		expect(syncBadge(issue({ tickets: [ticket()], syncState: 'error', lastError: 'rate limited' }))).toEqual({ state: 'error', label: 'error', title: 'rate limited' });
	});

	it('counts a bulk run by action; an item the cap cuts off is deferred, not created', () => {
		const items = [
			{ action: 'create' }, { action: 'create' }, { action: 'follow-up' }, { action: 'skip' }, { action: 'blocked' },
			{ action: 'create', result: 'deferred' }, { action: 'follow-up', result: 'deferred' }
		].map((i) => ({ issueId: '', individualLabel: '', ruleId: '', ...i }));
		expect(bulkCounts({ dryRun: true, cap: 3, items })).toEqual({ create: 2, followUp: 1, skip: 1, blocked: 1, deferred: 2, total: 7 });
	});
});

describe('toTicketSelection (STORY-403)', () => {
	const form = { status: 'open', assignee: 'mine', ruleId: ' arm-s:1 ', individualIri: '' };
	it('prefers the selected rows over the filter', async () => {
		const { toTicketSelection } = await import('./ticket-ui');
		expect(toTicketSelection(form, 'me', ['a', 'b'])).toEqual({ ids: ['a', 'b'] });
	});
	it('falls back to the active filter, leaving empty fields out and resolving "mine"', async () => {
		const { toTicketSelection } = await import('./ticket-ui');
		expect(toTicketSelection(form, 'me', [])).toEqual({ status: 'open', assignee: 'me', ruleId: 'arm-s:1' });
	});
});
