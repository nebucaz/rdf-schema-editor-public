/**
 * Pure merge of a reconcile run's issue outcomes into the report (validation-issues-tracker STORY-387):
 * findings and outcomes meet only through the finding id the backend derived.
 */
import type { IssueOutcome } from './issues-client';

export function issuesByFinding(outcomes: IssueOutcome[]): Map<string, IssueOutcome> {
	return new Map(outcomes.map((o) => [o.findingId, o]));
}

export interface IssueCounts {
	/** Findings whose issue this run created. */
	new: number;
	/** Findings that already had an issue. */
	tracked: number;
	/** Issues this run resolved because their finding is gone (the whole run, not only what is visible). */
	resolved: number;
}

export function issueCounts(findingIds: string[], issues: Map<string, IssueOutcome>, resolvedBySystem: number): IssueCounts {
	let created = 0;
	let tracked = 0;
	for (const id of findingIds) {
		const issue = issues.get(id);
		if (!issue) continue;
		if (issue.isNew) created++;
		else tracked++;
	}
	return { new: created, tracked, resolved: resolvedBySystem };
}
