import { describe, expect, it } from 'vitest';
import { checksTileModel, questionsTileModel } from './ontology-dashboard-model.js';
import { filterProblems, DEFAULT_MODEL_CHECKS_STATE, parseModelChecksState } from './model-checks-model.js';
import type { GateFinding, GateSeverity, PipelineStage } from './gates/types.js';
import type { CompetencyQuestion, CompetencyQuestionRun } from './competency-question.js';

const f = (stage: PipelineStage, severity: GateSeverity, n = 0): GateFinding => ({ gateId: 'g', stage, severity, elementIri: `urn:e:${stage}${n}`, message: `m${n}` });
const PROBLEMS = [f('vocabulary', 'warning', 1), f('vocabulary', 'info', 2), f('ontology', 'warning', 3), f('ontology', 'warning', 4), f('governance', 'info', 5)];

describe('checksTileModel (STORY-472)', () => {
	it('counts the total, the severities and the stages that have problems, in the pipeline order', () => {
		const m = checksTileModel(PROBLEMS);
		expect(m.total).toBe(5);
		expect(m.severities.map((s) => [s.severity, s.count])).toEqual([['warning', 3], ['info', 2]]);
		expect(m.stages.map((s) => [s.stage, s.count])).toEqual([['vocabulary', 2], ['ontology', 2], ['governance', 1]]);
	});

	it('every count agrees with the Model checks list for the filter its link opens', () => {
		const m = checksTileModel(PROBLEMS);
		for (const entry of [...m.severities, ...m.stages]) {
			const url = new URL(entry.href, 'http://x');
			expect(url.pathname).toBe('/pipeline');
			expect(url.searchParams.get('tab')).toBe('checks');
			const list = filterProblems(PROBLEMS, parseModelChecksState(url.searchParams));
			expect(list.length, entry.href).toBe(entry.count);
		}
		expect(filterProblems(PROBLEMS, DEFAULT_MODEL_CHECKS_STATE)).toHaveLength(m.total);
		expect(m.allHref).toBe('/pipeline?tab=checks');
	});

	it('is empty and says so for no problems', () => {
		const m = checksTileModel([]);
		expect(m.total).toBe(0);
		expect(m.stages).toEqual([]);
		expect(m.severities.map((s) => s.count)).toEqual([0, 0]);
	});
});

const q = (id: string, linked = true): CompetencyQuestion => ({ iri: `urn:q:${id}`, question: id, linkedElements: linked ? ['urn:c'] : [] }) as CompetencyQuestion;
const run = (id: string, outcome: 'pass' | 'fail', at: string): CompetencyQuestionRun => ({ questionIri: `urn:q:${id}`, outcome, ranAt: at, actual: '', durationMs: 1 });

describe('questionsTileModel (STORY-472)', () => {
	it('counts questions by their latest run and the ones not linked to the model', () => {
		const m = questionsTileModel([q('a'), q('b'), q('c', false), q('d')], [run('a', 'fail', '2026-01-01T00:00:00Z'), run('a', 'pass', '2026-02-01T00:00:00Z'), run('b', 'fail', '2026-02-01T00:00:00Z')]);
		expect(m).toMatchObject({ total: 4, passing: 1, failing: 1, notRun: 2, unlinked: 1 });
	});

	it('has zeroes without questions', () => {
		expect(questionsTileModel([], [])).toMatchObject({ total: 0, passing: 0, failing: 0, notRun: 0, unlinked: 0 });
	});
});
