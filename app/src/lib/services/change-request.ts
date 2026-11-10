/**
 * Change requests (ontology-pipeline STORY-332; book pp. 51, 233-240, 311-313): a proposed change with a
 * rationale and the competency question that justifies it, a review, and an outcome with a rationale. Pure
 * types and rules; storage is in `SparqlConnector`.
 *
 * A request that names no competency question is not justified: it can only be returned for one, or marked
 * as a scope change (the model is being widened on purpose).
 */
import type { ChangeKind, ChangeLogEntryInput } from './change-log';
import type { Snapshot, SnapshotDiff } from './impact-assessment';

export const REQUEST_STATUSES = ['open', 'in-review', 'approved', 'rejected', 'returned', 'scope-change'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type RequestOutcome = Extract<RequestStatus, 'approved' | 'rejected' | 'returned' | 'scope-change'>;

export interface ChangeRequestDraft {
	title: string;
	requestor: string;
	proposedTerm: string;
	proposedDefinition: string;
	proposedRelations: string;
	rationale: string;
	/** IRI of the linked competency question; empty when none. */
	questionIri: string;
	/** What the change would do to the model; feeds the change log and so the release. */
	changeKind: ChangeKind;
}

export interface ChangeRequest extends ChangeRequestDraft {
	iri: string;
	status: RequestStatus;
	outcomeRationale: string;
	decidedBy: string;
	/** `YYYY-MM-DD` or empty. */
	decidedAt: string;
	createdAt: string;
	/** Question outcomes and gate findings when the request was made; the impact assessment diffs against it. */
	baseline: Snapshot | null;
	/** The last impact assessment run for the request. */
	impact: SnapshotDiff | null;
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
	open: 'Open',
	'in-review': 'In review',
	approved: 'Approved',
	rejected: 'Rejected',
	returned: 'Returned',
	'scope-change': 'Scope change'
};

export function validateRequestDraft(d: ChangeRequestDraft): string[] {
	const errors: string[] = [];
	if (!d.title.trim()) errors.push('Give the request a title');
	if (!d.requestor.trim()) errors.push('Name the requestor');
	if (!d.rationale.trim()) errors.push('A rationale is required');
	if (!d.proposedTerm.trim() && !d.proposedDefinition.trim() && !d.proposedRelations.trim()) {
		errors.push('Propose a term, a definition or relations');
	}
	return errors;
}

/** Only an undecided request can still be decided. */
export const canDecide = (r: Pick<ChangeRequest, 'status'>) => r.status === 'open' || r.status === 'in-review';

export const canStartReview = (r: Pick<ChangeRequest, 'status'>) => r.status === 'open';

export function allowedOutcomes(r: Pick<ChangeRequest, 'status' | 'questionIri'>): RequestOutcome[] {
	if (!canDecide(r)) return [];
	return r.questionIri ? ['approved', 'rejected', 'returned'] : ['returned', 'scope-change'];
}

/** `null` when the request may take `outcome` with this rationale, else the reason it may not. */
export function validateOutcome(r: Pick<ChangeRequest, 'status' | 'questionIri'>, outcome: RequestOutcome, rationale: string): string | null {
	if (!canDecide(r)) return 'This request has already been decided';
	if (!allowedOutcomes(r).includes(outcome)) {
		return 'Without a linked competency question a request can only be returned or marked as a scope change';
	}
	if (!rationale.trim()) return 'Give the rationale for the outcome';
	return null;
}

/** The change log entry an approved request leaves behind; the backend adds who and when. */
export function approvedRequestEntry(r: ChangeRequest, rationale: string): ChangeLogEntryInput {
	const term = r.proposedTerm.trim();
	return {
		kind: 'change',
		summary: `Approved change request "${r.title}"${term ? `: ${term}` : ''}`,
		rationale,
		question: r.questionIri || undefined,
		changeKind: r.changeKind
	};
}
