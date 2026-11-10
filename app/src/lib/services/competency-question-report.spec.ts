import { describe, expect, it } from 'vitest';
import { buildReportRows } from './competency-question-report.js';
import type { CompetencyQuestion, CompetencyQuestionRun } from './competency-question.js';

const q = (iri: string, question = iri): CompetencyQuestion => ({
	iri,
	question,
	expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'SELECT * {}' },
	linkedElements: [],
	owner: '',
	lastReviewed: ''
});
const run = (questionIri: string, day: number, outcome: CompetencyQuestionRun['outcome']): CompetencyQuestionRun => ({
	questionIri,
	ranAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`,
	outcome,
	actual: '',
	durationMs: 1
});

describe('buildReportRows', () => {
	it('takes the newest run as the latest and flags a pass followed by a fail as a regression', () => {
		const [row] = buildReportRows([q('A')], [run('A', 1, 'pass'), run('A', 3, 'fail'), run('A', 2, 'pass')]);
		expect(row.latest?.ranAt).toBe('2026-11-03T00:00:00Z');
		expect(row.regression).toBe(true);
		expect(row.strip.map((r) => r.outcome)).toEqual(['pass', 'pass', 'fail']);
	});

	it('does not flag a question that failed before, errored, or never ran', () => {
		const rows = buildReportRows(
			[q('A'), q('B'), q('C')],
			[run('A', 1, 'fail'), run('A', 2, 'fail'), run('B', 1, 'pass'), run('B', 2, 'error')]
		);
		expect(rows.map((r) => r.regression)).toEqual([false, false, false]);
		expect(rows[2].latest).toBeUndefined();
		expect(rows[2].strip).toEqual([]);
	});

	it('limits the strip to the history limit and ignores runs of unknown questions', () => {
		const many = Array.from({ length: 15 }, (_, i) => run('A', i + 1, 'pass'));
		const [row] = buildReportRows([q('A')], [...many, run('ghost', 1, 'fail')]);
		expect(row.strip).toHaveLength(10);
	});

	it('sorts by question text', () => {
		const rows = buildReportRows([q('1', 'Zebra?'), q('2', 'Apple?')], []);
		expect(rows.map((r) => r.question.question)).toEqual(['Apple?', 'Zebra?']);
	});
});
