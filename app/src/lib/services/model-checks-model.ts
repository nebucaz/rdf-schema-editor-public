/**
 * The Model checks list (ontology-dashboard STORY-462): the gates' problems filtered by stage, severity and
 * search text, paged, with the filter state kept in the URL. Pure; the view only renders what this returns.
 */
import { PIPELINE_STAGES, type GateFinding, type GateSeverity, type PipelineStage } from './gates/types.js';
import { clampPage } from './list-paging.js';

export const MODEL_CHECKS_PAGE_SIZE = 25;

export const STAGE_LABEL: Record<PipelineStage, string> = {
	vocabulary: 'Vocabulary',
	metadata: 'Metadata',
	taxonomy: 'Taxonomy',
	thesaurus: 'Thesaurus',
	ontology: 'Ontology',
	knowledgeGraph: 'Knowledge graph',
	governance: 'Governance'
};

export interface ModelChecksState {
	/** `''` is every stage. */
	stage: PipelineStage | '';
	/** `''` is every severity. */
	severity: GateSeverity | '';
	q: string;
	/** 1-based. */
	page: number;
}

export const DEFAULT_MODEL_CHECKS_STATE: ModelChecksState = { stage: '', severity: '', q: '', page: 1 };

type ParamsLike = { get(name: string): string | null; toString(): string };

export const MODEL_CHECKS_KEYS = ['stage', 'severity', 'q', 'page'] as const;
const KEYS = MODEL_CHECKS_KEYS;
const SEVERITIES: readonly string[] = ['warning', 'info'];

/** Reads the state from a query string; anything unknown or malformed becomes the default. */
export function parseModelChecksState(params: ParamsLike): ModelChecksState {
	const stage = params.get('stage') ?? '';
	const severity = params.get('severity') ?? '';
	const page = params.get('page') ?? '';
	return {
		stage: (PIPELINE_STAGES as readonly string[]).includes(stage) ? (stage as PipelineStage) : '',
		severity: SEVERITIES.includes(severity) ? (severity as GateSeverity) : '',
		q: params.get('q') ?? '',
		page: /^[1-9]\d*$/.test(page) && Number.isSafeInteger(Number(page)) ? Number(page) : 1
	};
}

/** A copy of `params` with the four list keys set from `state` (defaults removed); other parameters, such as `tab`, are kept. */
export function withModelChecksState(params: ParamsLike, state: ModelChecksState): URLSearchParams {
	const next = new URLSearchParams(params.toString());
	for (const key of KEYS) next.delete(key);
	if (state.stage) next.set('stage', state.stage);
	if (state.severity) next.set('severity', state.severity);
	if (state.q) next.set('q', state.q);
	if (state.page !== 1) next.set('page', String(state.page));
	return next;
}

/** Applies a change; a changed filter starts again at page 1 unless the change names a page. */
export function patchModelChecksState(state: ModelChecksState, patch: Partial<ModelChecksState>): ModelChecksState {
	const next = { ...state, ...patch };
	const filterChanged = next.stage !== state.stage || next.severity !== state.severity || next.q !== state.q;
	return patch.page === undefined && filterChanged ? { ...next, page: 1 } : next;
}

/** The problems matching the filters, warnings first; the gates' own order is kept within a severity. */
export function filterProblems(problems: GateFinding[], state: ModelChecksState): GateFinding[] {
	const needle = state.q.trim().toLowerCase();
	return problems
		.filter(
			(p) =>
				(!state.stage || p.stage === state.stage) &&
				(!state.severity || p.severity === state.severity) &&
				(!needle || p.message.toLowerCase().includes(needle) || STAGE_LABEL[p.stage].toLowerCase().includes(needle))
		)
		.sort((a, b) => Number(b.severity === 'warning') - Number(a.severity === 'warning'));
}

/** One 1-based page of `problems`; a page past the end shows the last one. */
export function pageOfProblems(problems: GateFinding[], page: number): GateFinding[] {
	const pages = Math.max(1, Math.ceil(problems.length / MODEL_CHECKS_PAGE_SIZE));
	const current = clampPage(page, pages);
	return problems.slice((current - 1) * MODEL_CHECKS_PAGE_SIZE, current * MODEL_CHECKS_PAGE_SIZE);
}
