/**
 * Pure helpers of the Issues page (validation-issues-tracker STORY-388): the filter the form holds
 * becomes a `listIssues` query, and the page of issues can be viewed grouped by identity. Grouping is
 * only a view — there is still one issue per finding id.
 */
import type { Issue, IssueFilter } from './issues-client';

export const PAGE_SIZE = 50;

export interface IssueFilterForm {
	status: string;
	/** `''` (anyone), `'mine'` or an assignee `sub`. */
	assignee: string;
	ruleId: string;
	individualIri: string;
}

export function toIssueQuery(form: IssueFilterForm, currentUser: string | null, offset: number): IssueFilter {
	const assignee = form.assignee === 'mine' ? (currentUser ?? '') : form.assignee;
	return {
		status: form.status,
		assignee,
		ruleId: form.ruleId.trim(),
		individualIri: form.individualIri.trim(),
		limit: PAGE_SIZE,
		offset: offset > 0 ? offset : undefined
	};
}

export interface IssueGroup {
	key: string;
	label: string;
	issues: Issue[];
}

/** One group per identity, in the order the identities first appear. */
export function groupByIdentity(issues: Issue[]): IssueGroup[] {
	const groups = new Map<string, IssueGroup>();
	for (const issue of issues) {
		let group = groups.get(issue.individualIri);
		if (!group) {
			group = { key: issue.individualIri, label: issue.individualLabel.trim() || issue.individualIri, issues: [] };
			groups.set(issue.individualIri, group);
		}
		group.issues.push(issue);
	}
	return [...groups.values()];
}
