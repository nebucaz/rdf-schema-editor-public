/**
 * Impact assessment of a change request (ontology-pipeline STORY-332): the competency question outcomes and the
 * gate findings are recorded as a snapshot, and a later snapshot is compared with it. There is no reasoner: the
 * assessment shows what the questions and gates say now, against what they said when the request was made.
 */
import type { RunOutcome } from './competency-question';
import type { GateFinding } from './gates/types';

export interface FindingKey {
	gateId: string;
	elementIri: string;
	message: string;
}

export interface Snapshot {
	/** Latest outcome per question IRI. */
	questions: Record<string, RunOutcome>;
	findings: FindingKey[];
}

export interface QuestionChange {
	questionIri: string;
	/** `null` when the question did not exist (or was not run) on that side. */
	before: RunOutcome | null;
	after: RunOutcome | null;
}

export interface SnapshotDiff {
	questions: QuestionChange[];
	newFindings: FindingKey[];
	resolvedFindings: FindingKey[];
}

export function takeSnapshot(runs: { questionIri: string; outcome: RunOutcome }[], findings: GateFinding[]): Snapshot {
	return {
		questions: Object.fromEntries(runs.map((r) => [r.questionIri, r.outcome])),
		findings: findings.map(({ gateId, elementIri, message }) => ({ gateId, elementIri, message }))
	};
}

const keyOf = (f: FindingKey) => `${f.gateId}|${f.elementIri}|${f.message}`;

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
	const iris = [...new Set([...Object.keys(before.questions), ...Object.keys(after.questions)])].sort();
	const questions = iris
		.map((questionIri) => ({ questionIri, before: before.questions[questionIri] ?? null, after: after.questions[questionIri] ?? null }))
		.filter((c) => c.before !== c.after);
	const beforeKeys = new Set(before.findings.map(keyOf));
	const afterKeys = new Set(after.findings.map(keyOf));
	return {
		questions,
		newFindings: after.findings.filter((f) => !beforeKeys.has(keyOf(f))),
		resolvedFindings: before.findings.filter((f) => !afterKeys.has(keyOf(f)))
	};
}

/** The newest run of each question, by `ranAt`. */
export function latestOutcomes(runs: { questionIri: string; ranAt: string; outcome: RunOutcome }[]): { questionIri: string; outcome: RunOutcome }[] {
	const latest = new Map<string, { ranAt: string; outcome: RunOutcome }>();
	for (const r of runs) {
		const seen = latest.get(r.questionIri);
		if (!seen || r.ranAt > seen.ranAt) latest.set(r.questionIri, { ranAt: r.ranAt, outcome: r.outcome });
	}
	return [...latest].map(([questionIri, { outcome }]) => ({ questionIri, outcome }));
}

/** What changed since `baseline` (null: since an empty model), given the runs and findings of now. */
export function assessAgainst(
	baseline: Snapshot | null,
	runs: { questionIri: string; ranAt: string; outcome: RunOutcome }[],
	findings: GateFinding[]
): SnapshotDiff {
	return diffSnapshots(baseline ?? { questions: {}, findings: [] }, takeSnapshot(latestOutcomes(runs), findings));
}
