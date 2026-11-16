import type { ValidationFinding, ReportView } from '#lib/services/validation-report-model.js';
import type { IssueOutcome } from '#lib/services/issues-client.js';
import type { NotCheckedEntry } from '#lib/services/validation-report-export.js';

/**
 * The last validation report of this browser tab, kept in memory so that leaving the page (for
 * example to an identity) and coming back with the browser's Back button shows the report where the
 * reader left it. Still transient by design (spec/validation Decision 4): nothing is written to
 * `localStorage`, and a reload or a new "Run Validation" starts from a clean slate.
 */
export interface ValidationReportSession {
	hasRun: boolean;
	loadError: string | null;
	violations: ValidationFinding[];
	notChecked: NotCheckedEntry[];
	/** The run's issue outcomes (validation-issues-tracker STORY-387); memory only, the issues themselves are stored by the backend. */
	issues: IssueOutcome[];
	/** Issues the run resolved because their finding is gone. */
	resolvedBySystem: number;
	runAt: Date | null;
	/** True while the report is the stored one the backend returned on open, not a run of this tab (STORY-393). */
	fromStore: boolean;
	view: ReportView;
	/** Identity blocks the reader folded (by identity IRI). */
	folded: Set<string>;
}

function initial(): ValidationReportSession {
	return { hasRun: false, loadError: null, violations: [], notChecked: [], issues: [], resolvedBySystem: 0, runAt: null, fromStore: false, view: 'identity', folded: new Set() };
}

export const validationReportSession: ValidationReportSession = $state(initial());

export function resetValidationReportSession(): void {
	Object.assign(validationReportSession, initial());
}
