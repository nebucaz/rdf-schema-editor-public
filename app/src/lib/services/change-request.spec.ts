import { describe, expect, it } from 'vitest';
import {
	allowedOutcomes,
	approvedRequestEntry,
	canDecide,
	canStartReview,
	validateOutcome,
	validateRequestDraft,
	type ChangeRequest,
	type ChangeRequestDraft
} from './change-request';

const draft = (over: Partial<ChangeRequestDraft> = {}): ChangeRequestDraft => ({
	title: 'Add Bank', requestor: 'alice', proposedTerm: 'Bank', proposedDefinition: 'A financial institution.',
	proposedRelations: '', rationale: 'Needed to answer CQ-3', questionIri: 'urn:q:3', changeKind: 'addition', ...over
});
const request = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
	...draft(), iri: 'urn:cr:1', status: 'open', outcomeRationale: '', decidedBy: '', decidedAt: '', createdAt: '2026-01-01',
	baseline: null, impact: null, ...over
});

describe('validateRequestDraft (STORY-332)', () => {
	it('accepts a complete request', () => {
		expect(validateRequestDraft(draft())).toEqual([]);
	});

	it('wants a title, a requestor and a rationale, but not a question', () => {
		const errors = validateRequestDraft(draft({ title: ' ', requestor: '', rationale: '', questionIri: '' }));
		expect(errors).toHaveLength(3);
	});

	it('wants something proposed', () => {
		expect(validateRequestDraft(draft({ proposedTerm: '', proposedDefinition: '', proposedRelations: '' }))).toHaveLength(1);
	});
});

describe('allowedOutcomes', () => {
	it('lets a request with a competency question be approved, rejected or returned', () => {
		expect(allowedOutcomes(request())).toEqual(['approved', 'rejected', 'returned']);
	});

	it('lets a request without one only be returned or marked as a scope change', () => {
		expect(allowedOutcomes(request({ questionIri: '' }))).toEqual(['returned', 'scope-change']);
	});

	it('allows nothing once decided', () => {
		expect(allowedOutcomes(request({ status: 'approved' }))).toEqual([]);
		expect(canDecide(request({ status: 'rejected' }))).toBe(false);
	});
});

describe('lifecycle', () => {
	it('starts a review only on an open request', () => {
		expect(canStartReview(request())).toBe(true);
		expect(canStartReview(request({ status: 'in-review' }))).toBe(false);
		expect(canStartReview(request({ status: 'approved' }))).toBe(false);
	});

	it('decides from open or in review', () => {
		expect(canDecide(request({ status: 'in-review' }))).toBe(true);
		expect(canDecide(request())).toBe(true);
	});
});

describe('validateOutcome', () => {
	it('wants a rationale', () => {
		expect(validateOutcome(request(), 'approved', ' ')).toMatch(/rationale/i);
		expect(validateOutcome(request(), 'approved', 'fits CQ-3')).toBeNull();
	});

	it('refuses an outcome that is not allowed, naming the missing question', () => {
		expect(validateOutcome(request({ questionIri: '' }), 'approved', 'x')).toMatch(/competency question/i);
		expect(validateOutcome(request({ status: 'approved' }), 'rejected', 'x')).toMatch(/already/i);
	});
});

describe('approvedRequestEntry (STORY-332)', () => {
	it('turns an approved request into a change log entry with its question and kind', () => {
		expect(approvedRequestEntry(request({ changeKind: 'rename', proposedTerm: '' }), 'fits CQ-3')).toEqual({
			kind: 'change',
			summary: 'Approved change request "Add Bank"',
			rationale: 'fits CQ-3',
			question: 'urn:q:3',
			changeKind: 'rename'
		});
	});

	it('names the proposed term when there is one', () => {
		expect(approvedRequestEntry(request({ proposedTerm: 'Bank' }), 'x').summary).toBe('Approved change request "Add Bank": Bank');
	});
});
