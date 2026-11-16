import { describe, expect, it } from 'vitest';
import type { IssueOutcome } from './issues-client';
import { issueCounts, issuesByFinding } from './issue-merge';

const outcome = (over: Partial<IssueOutcome> = {}): IssueOutcome => ({
	findingId: 'f1', issueId: 'f1', status: 'open', assignee: '', externalUrl: '', isNew: false, ...over
});

describe('issue merge (STORY-387)', () => {
	it('indexes the outcomes by finding id', () => {
		const map = issuesByFinding([outcome(), outcome({ findingId: 'f2', issueId: 'f2', isNew: true })]);
		expect(map.get('f2')?.isNew).toBe(true);
		expect(map.get('f1')?.status).toBe('open');
		expect(map.get('nope')).toBeUndefined();
	});

	it('counts new, tracked and system-resolved over the findings shown', () => {
		const outcomes = [outcome({ findingId: 'a' }), outcome({ findingId: 'b', isNew: true }), outcome({ findingId: 'c' })];
		expect(issueCounts(['a', 'b', 'c'], issuesByFinding(outcomes), 4)).toEqual({ new: 1, tracked: 2, resolved: 4 });
		// a namespace filter hides b: only the visible findings count, the resolved number is run-wide
		expect(issueCounts(['a', 'c'], issuesByFinding(outcomes), 4)).toEqual({ new: 0, tracked: 2, resolved: 4 });
	});

	it('ignores a finding without an outcome', () => {
		expect(issueCounts(['x'], issuesByFinding([]), 0)).toEqual({ new: 0, tracked: 0, resolved: 0 });
	});
});
