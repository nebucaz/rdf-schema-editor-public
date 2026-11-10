import { describe, expect, it, vi } from 'vitest';
import {
	connectorRunnerDeps,
	runAllCompetencyQuestions,
	runCompetencyQuestion,
	type RunnerDeps
} from './competency-question-runner.js';
import type { CompetencyQuestion } from './competency-question.js';

const q = (over: Partial<CompetencyQuestion> = {}): CompetencyQuestion => ({
	iri: 'http://e/Q1',
	question: 'Which?',
	expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'SELECT ?x WHERE { ?x ?p ?o }' },
	linkedElements: [],
	owner: '',
	lastReviewed: '',
	...over
});

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
	let t = 1000;
	return {
		resolveSavedText: () => undefined,
		select: async () => [{ x: 'a' }],
		ask: async () => true,
		saveRun: async () => {},
		now: () => (t += 25),
		clock: () => new Date('2026-11-10T08:00:00Z'),
		...over
	};
}

describe('runCompetencyQuestion', () => {
	it('passes a SELECT with enough rows and records duration and time', async () => {
		const run = await runCompetencyQuestion(q(), deps());
		expect(run).toMatchObject({
			questionIri: 'http://e/Q1',
			outcome: 'pass',
			actual: '1 row',
			rowCount: 1,
			durationMs: 25,
			ranAt: '2026-11-10T08:00:00.000Z'
		});
	});

	it('runs an ASK query and fails on the wrong answer', async () => {
		const run = await runCompetencyQuestion(
			q({ expected: { kind: 'ask', value: false }, query: { kind: 'sparql', text: 'ASK { ?s ?p ?o }' } }),
			deps()
		);
		expect(run.outcome).toBe('fail');
		expect(run.actual).toBe('true');
	});

	it('resolves a saved query and reports an unknown one as an error', async () => {
		const select = vi.fn(async () => [{ x: 'a' }]);
		const saved = q({ query: { kind: 'saved', iri: 'http://e/S' } });
		const ok = await runCompetencyQuestion(saved, deps({ select, resolveSavedText: () => 'SELECT ?x {}' }));
		expect(ok.outcome).toBe('pass');
		expect(select).toHaveBeenCalledWith('SELECT ?x {}');

		const missing = await runCompetencyQuestion(saved, deps());
		expect(missing).toMatchObject({ outcome: 'error', message: 'The saved query no longer exists.' });
	});

	it('reports a failing query as an error with its message, not as a fail', async () => {
		const run = await runCompetencyQuestion(
			q(),
			deps({
				select: async () => {
					throw new Error('Parse error at line 1');
				}
			})
		);
		expect(run).toMatchObject({ outcome: 'error', message: 'Parse error at line 1' });
	});

	it('reports a query that is neither SELECT nor ASK as an error', async () => {
		const run = await runCompetencyQuestion(q({ query: { kind: 'sparql', text: 'CONSTRUCT {} WHERE {}' } }), deps());
		expect(run).toMatchObject({ outcome: 'error', message: 'Only SELECT and ASK queries can be run.' });
	});
});

describe('runAllCompetencyQuestions', () => {
	it('runs one question at a time, saves each run and reports progress', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const select = vi.fn(async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((r) => setTimeout(r, 1));
			inFlight--;
			return [{ x: 'a' }];
		});
		const saveRun = vi.fn(async () => {});
		const seen: string[] = [];
		const runs = await runAllCompetencyQuestions(
			[q({ iri: 'http://e/A' }), q({ iri: 'http://e/B' }), q({ iri: 'http://e/C' })],
			deps({ select, saveRun }),
			(r) => seen.push(r.questionIri)
		);

		expect(maxInFlight).toBe(1);
		expect(runs).toHaveLength(3);
		expect(saveRun).toHaveBeenCalledTimes(3);
		expect(seen).toEqual(['http://e/A', 'http://e/B', 'http://e/C']);
	});
});

describe('connectorRunnerDeps', () => {
	it('sends both query forms with inference off', async () => {
		const connector = {
			selectQuery: vi.fn(async () => ({
				head: { vars: ['x'] },
				results: { bindings: [{ x: { type: 'literal', value: 'a' } }] }
			})),
			askQuery: vi.fn(async () => true),
			insertCompetencyQuestionRun: vi.fn(async () => {})
		};
		const d = connectorRunnerDeps(connector as never, [{ iri: 'http://e/S', sparqlText: 'SELECT 1' }]);

		expect(await d.select('SELECT ?x {}')).toEqual([{ x: 'a' }]);
		expect(await d.ask('ASK {}')).toBe(true);
		expect(connector.selectQuery).toHaveBeenCalledWith('SELECT ?x {}', { infer: false });
		expect(connector.askQuery).toHaveBeenCalledWith('ASK {}', { infer: false });
		expect(d.resolveSavedText('http://e/S')).toBe('SELECT 1');
		expect(d.resolveSavedText('http://e/none')).toBeUndefined();
	});
});
