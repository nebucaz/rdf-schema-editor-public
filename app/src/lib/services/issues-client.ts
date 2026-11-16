/**
 * Browser-side client for `/api/issues*` (validation-issues-tracker STORY-386). Requests are JSON and
 * errors are read from the backend's `{message}`. A patch carries only the fields a client may change:
 * who and when are stamped, and the external URL is built, by the backend.
 */
import { apiUrl } from '#lib/utils/urls.js';
import type { NotCheckedEntry } from './validation-report-export';
import type { ValidationFinding } from './validation-report-model';

export type IssueStatus = 'open' | 'in-progress' | 'resolved' | 'wontfix';

export const ISSUE_STATUSES: readonly IssueStatus[] = ['open', 'in-progress', 'resolved', 'wontfix'];

/** One ServiceNow ticket of an issue (`issues.Ticket`); the latest in `Issue.tickets` is the current one. */
export interface Ticket {
	correlationId: string;
	number: string;
	sysId: string;
	/** ServiceNow `state` value. */
	state: string;
	/** Display text of the state. */
	stateLabel: string;
	createdAt: string;
	closedAt: string;
	url: string;
}

/** Ticket sync state of an issue; `none` (or empty) is an issue without a ticket. */
export type SyncState = 'none' | 'pending' | 'synced' | 'error';

/** One stored issue (`backend/internal/issues/store.go`'s `Issue`); `id` is the finding id. */
export interface Issue {
	id: string;
	individualIri: string;
	typeIri: string;
	ruleId: string;
	shapeIri: string;
	path: string;
	constraint: string;
	individualLabel: string;
	message: string;
	qualityDimension: string;
	status: IssueStatus;
	/** `system` when the backend resolved it because the finding was gone. */
	resolvedBy: string;
	assignee: string;
	assigneeName: string;
	note: string;
	externalSystem: string;
	externalId: string;
	externalUrl: string;
	createdAt: string;
	updatedBy: string;
	updatedByName: string;
	updatedAt: string;
	lastSeenAt: string;
	/** Ticket history, oldest first; empty without a ticket. */
	tickets: Ticket[];
	/** Written by the ServiceNow sync only; display text of the assignee there. */
	serviceNowAssignee: string;
	serviceNowGroup: string;
	syncState: SyncState | '';
	lastSyncedAt: string;
	/** Why the last sync failed; `''` when it did not. */
	lastError: string;
	serviceNowResolution: string;
	/** The finding returned after ServiceNow resolved its ticket; a new ticket is a manual act. */
	followUpNeeded: boolean;
}

/** What a run reports per current finding (`issues.Outcome`). */
export interface IssueOutcome {
	findingId: string;
	issueId: string;
	status: IssueStatus;
	assignee: string;
	externalUrl: string;
	/** True only on the run that created the issue. */
	isNew: boolean;
}

export interface IssueReconcileResponse {
	violations: ValidationFinding[];
	notChecked: NotCheckedEntry[];
	issues: IssueOutcome[];
	/** Issues this run resolved because their finding is gone. */
	resolvedBySystem: number;
}

/** The last run as the backend stored it (`GET /issues/report`); `runAt` is `''` before the first run. */
export interface StoredReport {
	runAt: string;
	violations: ValidationFinding[];
	notChecked: NotCheckedEntry[];
	issues: IssueOutcome[];
}

export interface IssueFilter {
	status?: string;
	assignee?: string;
	ruleId?: string;
	individualIri?: string;
	limit?: number;
	offset?: number;
}

export interface IssuePage {
	issues: Issue[];
	total: number;
}

export interface IssuePatch {
	status?: IssueStatus;
	assignee?: string;
	note?: string;
	externalSystem?: string;
	externalId?: string;
}

export interface Assignee {
	sub: string;
	displayName: string;
}

export async function failure(response: Response): Promise<Error> {
	let message = '';
	try {
		const data = (await response.json()) as { message?: unknown };
		if (typeof data.message === 'string') message = data.message;
	} catch {
		/* not JSON: fall through to the status message */
	}
	return new Error(message || `Request failed (${response.status})`);
}

export async function request<T>(fetchFn: typeof fetch, url: string, init: RequestInit | undefined, what: string): Promise<T> {
	let response: Response;
	try {
		response = await fetchFn(url, init);
	} catch {
		throw new Error(`Network error — ${what}.`);
	}
	if (!response.ok) throw await failure(response);
	return (await response.json()) as T;
}

export const JSON_HEADERS = { 'content-type': 'application/json' };

/** Runs the validation and reconciles the issues with it (`POST /issues/reconcile`). */
export function reconcile(fetchFn: typeof fetch): Promise<IssueReconcileResponse> {
	return request(fetchFn, apiUrl('/issues/reconcile'), { method: 'POST', headers: JSON_HEADERS, body: '{}' }, 'the validation could not run');
}

/** The findings of the last run, read without running the validation. */
export function fetchStoredReport(fetchFn: typeof fetch): Promise<StoredReport> {
	return request(fetchFn, apiUrl('/issues/report'), undefined, 'the last report could not be read');
}

export function listIssues(fetchFn: typeof fetch, filter: IssueFilter = {}): Promise<IssuePage> {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== '') params.set(key, String(value));
	const query = params.toString();
	const url = apiUrl('/issues');
	return request(fetchFn, query ? `${url}?${query}` : url, undefined, 'the issues could not be read');
}

export function updateIssue(fetchFn: typeof fetch, id: string, patch: IssuePatch): Promise<Issue> {
	// Only the declared fields travel, whatever the caller's object carries.
	const { status, assignee, note, externalSystem, externalId } = patch;
	return request(
		fetchFn,
		apiUrl(`/issues/${encodeURIComponent(id)}`),
		{ method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status, assignee, note, externalSystem, externalId }) },
		'the issue was not saved'
	);
}

export async function fetchAssignees(fetchFn: typeof fetch): Promise<Assignee[]> {
	return (await request<{ assignees: Assignee[] }>(fetchFn, apiUrl('/issues/assignees'), undefined, 'the assignees could not be read')).assignees;
}
