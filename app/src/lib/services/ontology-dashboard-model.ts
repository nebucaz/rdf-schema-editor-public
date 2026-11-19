/**
 * What the dashboard tiles show (spec/ontology-dashboard STORY-472), computed from data the page already loaded.
 * Pure. The Model checks counts go through the list's own `filterProblems`, so a tile count and the list it links
 * to cannot disagree.
 */
import type { CompetencyQuestion, CompetencyQuestionRun } from './competency-question';
import { buildReportRows } from './competency-question-report';
import { PIPELINE_STAGES, type GateFinding, type GateSeverity, type PipelineStage } from './gates/types';
import { DEFAULT_MODEL_CHECKS_STATE, STAGE_LABEL, filterProblems, withModelChecksState } from './model-checks-model';
import { unlinkedQuestionCount } from './pipeline-summary';
import { appUrl } from '#lib/utils/urls.js';

const checksUrl = (patch: { stage?: PipelineStage; severity?: GateSeverity }) => {
	const params = withModelChecksState(new URLSearchParams('tab=checks'), { ...DEFAULT_MODEL_CHECKS_STATE, ...patch });
	return appUrl(`/pipeline?${params.toString()}`);
};

export interface ChecksTileModel {
	total: number;
	/** Opens the whole list. */
	allHref: string;
	severities: { severity: GateSeverity; label: string; count: number; href: string }[];
	/** Only stages that have problems, in the method's order. */
	stages: { stage: PipelineStage; label: string; count: number; href: string }[];
}

export function checksTileModel(problems: GateFinding[]): ChecksTileModel {
	const count = (patch: { stage?: PipelineStage; severity?: GateSeverity }) =>
		filterProblems(problems, { ...DEFAULT_MODEL_CHECKS_STATE, stage: patch.stage ?? '', severity: patch.severity ?? '' }).length;
	return {
		total: problems.length,
		allHref: checksUrl({}),
		severities: (['warning', 'info'] as const).map((severity) => ({
			severity,
			label: severity === 'warning' ? 'Warnings' : 'Info',
			count: count({ severity }),
			href: checksUrl({ severity })
		})),
		stages: PIPELINE_STAGES.map((stage) => ({ stage, label: STAGE_LABEL[stage], count: count({ stage }), href: checksUrl({ stage }) })).filter((s) => s.count > 0)
	};
}

export interface QuestionsTileModel {
	total: number;
	/** Latest run passed. */
	passing: number;
	/** Latest run failed or errored, as the failing-question gate counts it. */
	failing: number;
	notRun: number;
	/** Questions linked to no class, property or concept. */
	unlinked: number;
	href: string;
}

export function questionsTileModel(questions: CompetencyQuestion[], runs: CompetencyQuestionRun[]): QuestionsTileModel {
	const rows = buildReportRows(questions, runs);
	const passing = rows.filter((r) => r.latest?.outcome === 'pass').length;
	const failing = rows.filter((r) => r.latest && r.latest.outcome !== 'pass').length;
	return {
		total: questions.length,
		passing,
		failing,
		notRun: rows.filter((r) => !r.latest).length,
		unlinked: unlinkedQuestionCount(questions),
		href: appUrl('/questions')
	};
}
