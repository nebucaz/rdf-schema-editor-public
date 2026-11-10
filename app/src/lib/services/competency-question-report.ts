/** Rows of the competency question report (ontology-pipeline STORY-318): latest run, regression, strip. */
import {
	COMPETENCY_RUN_HISTORY_LIMIT,
	isRegression,
	stripRunHistory,
	type CompetencyQuestion,
	type CompetencyQuestionRun
} from './competency-question';

export interface ReportRow {
	question: CompetencyQuestion;
	latest?: CompetencyQuestionRun;
	regression: boolean;
	/** Newest runs, oldest first. */
	strip: CompetencyQuestionRun[];
}

export function buildReportRows(questions: CompetencyQuestion[], runs: CompetencyQuestionRun[]): ReportRow[] {
	const byQuestion = new Map<string, CompetencyQuestionRun[]>();
	for (const run of runs) byQuestion.set(run.questionIri, [...(byQuestion.get(run.questionIri) ?? []), run]);

	return [...questions]
		.sort((a, b) => a.question.localeCompare(b.question))
		.map((question) => {
			const ordered = stripRunHistory(byQuestion.get(question.iri) ?? [], Number.MAX_SAFE_INTEGER);
			const latest = ordered.at(-1);
			const previous = ordered.at(-2);
			return {
				question,
				latest,
				regression: !!latest && isRegression(previous?.outcome, latest.outcome),
				strip: ordered.slice(-COMPETENCY_RUN_HISTORY_LIMIT)
			};
		});
}
