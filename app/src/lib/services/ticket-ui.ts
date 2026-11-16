/**
 * Pure rules the ticket UI shares (spec/service-now-ticket STORY-403): what the ticket button offers, the sync
 * badge of a row and the counts of a bulk dry-run. The backend decides every request; these only explain
 * beforehand, so a refusal it still gives (e.g. an unroutable finding) is shown as its message.
 */
import type { Issue, SyncState, Ticket } from './issues-client';
import { toIssueQuery, type IssueFilterForm } from './issues-view';
import type { TicketRun, TicketSelection } from './tickets-client';

/** The latest ticket of the issue (the history is oldest first), or null without one. */
export function currentTicket(issue: Issue): Ticket | null {
	return issue.tickets.length > 0 ? issue.tickets[issue.tickets.length - 1] : null;
}

/** A ticket is closed once ServiceNow stamped `closedAt`; the finding returning after it makes a follow-up due. */
function isClosed(ticket: Ticket): boolean {
	return ticket.closedAt !== '';
}

export interface TicketAction {
	kind: 'create' | 'follow-up';
	label: string;
	/** Why the button is disabled; null when the ticket may be created. */
	disabledReason: string | null;
}

export function ticketAction(issue: Issue): TicketAction {
	const current = currentTicket(issue);
	const followUp = current !== null && (isClosed(current) || issue.followUpNeeded);
	const kind = followUp ? 'follow-up' : 'create';
	const label = followUp ? 'Create follow-up ticket' : 'Create ticket';
	const refuse = (disabledReason: string): TicketAction => ({ kind, label, disabledReason });
	if (issue.status === 'wontfix') return refuse("The issue is marked won't fix; no ticket is created.");
	if (issue.status === 'resolved') return refuse('The issue is resolved; no ticket is created.');
	if (!current && issue.externalId) return refuse('The issue has a manually entered external id; clear it first.');
	if (current && !followUp) return refuse(`The issue already has an open ticket (${current.number}).`);
	return { kind, label, disabledReason: null };
}

export interface SyncBadge {
	state: Exclude<SyncState, 'none'>;
	label: string;
	/** The last error for `error`, else empty; shown as the tooltip. */
	title: string;
}

/** The badge of a ticketed issue's sync state; null for an issue without a ticket or sync state. */
export function syncBadge(issue: Issue): SyncBadge | null {
	if (issue.tickets.length === 0) return null;
	const state = issue.syncState;
	if (state !== 'synced' && state !== 'pending' && state !== 'error') return null;
	return { state, label: state, title: state === 'error' ? issue.lastError : '' };
}

export interface BulkCounts {
	create: number;
	followUp: number;
	skip: number;
	blocked: number;
	deferred: number;
	total: number;
}

/** What a dry-run or run holds; a create the cap cuts off counts as deferred only. */
export function bulkCounts(run: TicketRun): BulkCounts {
	const counts: BulkCounts = { create: 0, followUp: 0, skip: 0, blocked: 0, deferred: 0, total: run.items.length };
	for (const item of run.items) {
		if (item.result === 'deferred') counts.deferred++;
		else if (item.action === 'create') counts.create++;
		else if (item.action === 'follow-up') counts.followUp++;
		else if (item.action === 'skip') counts.skip++;
		else if (item.action === 'blocked') counts.blocked++;
	}
	return counts;
}

/**
 * What a bulk run covers: the selected rows, else the Issues page's active filter (empty fields left out,
 * "mine" resolved to the signed-in user). Ids and filter fields never travel together.
 */
export function toTicketSelection(form: IssueFilterForm, currentUser: string | null, selectedIds: string[]): TicketSelection {
	if (selectedIds.length > 0) return { ids: [...selectedIds] };
	const query = toIssueQuery(form, currentUser, 0);
	const selection: TicketSelection = {};
	if (query.status) selection.status = query.status;
	if (query.assignee) selection.assignee = query.assignee;
	if (query.ruleId) selection.ruleId = query.ruleId;
	if (query.individualIri) selection.individualIri = query.individualIri;
	return selection;
}
