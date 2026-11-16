/**
 * Browser-side client for the ServiceNow ticket routes of `/api/issues` (spec/service-now-ticket STORY-402).
 * Requests are JSON and errors are read from the backend's `{message}`. Nothing of the ServiceNow connection
 * (URL, credential, table) is known here: the backend owns it and `/config` only says whether it exists.
 */
import { apiUrl } from '#lib/utils/urls.js';
import { JSON_HEADERS, request, type Issue } from './issues-client';

/** Which issues a bulk run covers: explicit ids, or the Issues-page filter fields (never both). */
export interface TicketSelection {
	ids?: string[];
	status?: string;
	assignee?: string;
	ruleId?: string;
	individualIri?: string;
}

/** What a dry-run plans for one issue. */
export type BulkAction = 'create' | 'follow-up' | 'skip' | 'blocked';

/** What a run did with one issue; `deferred` is also set by the dry-run for what the cap cuts off. */
export type BulkOutcome = 'created' | 'skipped' | 'blocked' | 'deferred' | 'error';

/** One issue of a dry-run (`BulkPlanItem`) or a real run (`BulkResult`: `result`, `number`, `error` set). */
export interface BulkItem {
	issueId: string;
	individualLabel: string;
	ruleId: string;
	action: BulkAction | (string & {});
	reason?: string;
	headline?: string;
	/** Routing the ticket would get (`TicketRouting`). */
	assignmentGroup?: string;
	contact?: string;
	category?: string;
	impact?: string;
	urgency?: string;
	/** Why the identity gave no authoritative entity, so the fallback routing applies. */
	unrouted?: string;
	warnings?: string[];
	result?: BulkOutcome | (string & {});
	number?: string;
	error?: string;
}

export type BulkPlanItem = BulkItem;
export type BulkResult = BulkItem;

/** The answer of a dry-run or a real bulk run (`issues.TicketRun`). */
export interface TicketRun {
	dryRun: boolean;
	/** The most tickets one run creates. */
	cap: number;
	items: BulkItem[];
}

/** The answer of one sync pass (`issues.SyncReport`). */
export interface SyncReport {
	dryRun: boolean;
	pulled: number;
	pushed: number;
	skipped: number;
	deferred: number;
	errors: number;
	message?: string;
}

function post<T>(fetchFn: typeof fetch, path: string, body: unknown, what: string): Promise<T> {
	return request<T>(fetchFn, apiUrl(path), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }, what);
}

/** Only the declared selection fields travel, whatever the caller's object carries. */
function selectionBody(sel: TicketSelection): TicketSelection {
	const { ids, status, assignee, ruleId, individualIri } = sel;
	return Object.fromEntries(Object.entries({ ids, status, assignee, ruleId, individualIri }).filter(([, v]) => v !== undefined));
}

/** Opens the ServiceNow ticket of one issue (`POST /issues/{id}/ticket`); the updated issue comes back. */
export function createTicket(fetchFn: typeof fetch, issueId: string): Promise<Issue> {
	return post(fetchFn, `/issues/${encodeURIComponent(issueId)}/ticket`, {}, 'the ticket was not created');
}

/** What a bulk creation would do, changing nothing (`POST /issues/tickets/dry-run`). */
export function dryRunTickets(fetchFn: typeof fetch, selection: TicketSelection): Promise<TicketRun> {
	return post(fetchFn, '/issues/tickets/dry-run', selectionBody(selection), 'the preview could not be made');
}

/** The bulk creation, bounded by the backend's per-run cap (`POST /issues/tickets`). */
export function createTickets(fetchFn: typeof fetch, selection: TicketSelection): Promise<TicketRun> {
	return post(fetchFn, '/issues/tickets', selectionBody(selection), 'the tickets were not created');
}

/** One pull-then-push pass with ServiceNow (`POST /issues/tickets/sync`). */
export function syncTickets(fetchFn: typeof fetch): Promise<SyncReport> {
	return post(fetchFn, '/issues/tickets/sync', {}, 'the sync could not run');
}
