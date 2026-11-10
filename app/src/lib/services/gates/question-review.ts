/**
 * Question review gate (ontology-pipeline STORY-334; book p. 240): a competency question that has not been
 * reviewed within the review period (default quarterly) or never. Silent without `GateOptions.questions`.
 */
import { DEFAULT_DEBT_SETTINGS, monthsAgo } from '../debt-settings';
import type { Gate } from './types';

export const questionReviewOverdueGate: Gate = {
	id: 'question-review-overdue',
	stage: 'governance',
	run: (_schema, options) => {
		const period = options.reviewPeriodMonths ?? DEFAULT_DEBT_SETTINGS.reviewPeriodMonths;
		const now = options.now ?? new Date();
		return (options.questions ?? []).flatMap((q) => {
			const age = monthsAgo(q.lastReviewed, now);
			if (age !== null && age < period) return [];
			return [
				{
					gateId: 'question-review-overdue',
					stage: 'governance' as const,
					severity: 'warning' as const,
					elementIri: q.iri,
					message:
						age === null
							? `The competency question "${q.question}" has never been reviewed (every ${period} months).`
							: `The competency question "${q.question}" was last reviewed ${age} months ago (every ${period} months).`
				}
			];
		});
	}
};

export const QUESTION_REVIEW_GATES: Gate[] = [questionReviewOverdueGate];
