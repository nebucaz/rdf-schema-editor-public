/**
 * Competency question coverage gates (ontology-dashboard STORY-460, ported from the semantic debt list): a model
 * class no question needs, and a question whose latest run fails or errors. Both are silent without
 * `GateOptions.questions`; the failing-question gate also needs `GateOptions.runs`.
 */
import { latestOutcomes } from '../impact-assessment';
import { modelClasses } from './link';
import type { Gate } from './types';

export const classWithoutQuestionGate: Gate = {
	id: 'class-without-question',
	stage: 'ontology',
	run: (schema, options) => {
		if (!options.questions) return [];
		const linked = new Set(options.questions.flatMap((q) => q.linkedElements));
		return modelClasses(schema)
			.filter((c) => !linked.has(c.iri))
			.map((c) => ({
				gateId: 'class-without-question',
				stage: 'ontology' as const,
				severity: 'info' as const,
				elementIri: c.iri,
				message: `Class "${c.label}" is not needed by any competency question.`
			}));
	}
};

export const failingQuestionGate: Gate = {
	id: 'failing-question',
	stage: 'governance',
	run: (_schema, options) => {
		if (!options.questions || !options.runs) return [];
		const outcome = new Map(latestOutcomes(options.runs).map((r) => [r.questionIri, r.outcome]));
		return options.questions.flatMap((q) => {
			const latest = outcome.get(q.iri);
			if (latest !== 'fail' && latest !== 'error') return [];
			return [
				{
					gateId: 'failing-question',
					stage: 'governance' as const,
					severity: 'warning' as const,
					elementIri: q.iri,
					message: `The competency question "${q.question}" ${latest === 'fail' ? 'fails' : 'errors'} in its latest run.`
				}
			];
		});
	}
};

export const QUESTION_COVERAGE_GATES: Gate[] = [classWithoutQuestionGate, failingQuestionGate];
