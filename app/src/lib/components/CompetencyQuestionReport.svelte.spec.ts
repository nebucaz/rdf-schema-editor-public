import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import CompetencyQuestionReport from './CompetencyQuestionReport.svelte';
import { buildReportRows } from '#lib/services/competency-question-report.js';
import type { CompetencyQuestion, CompetencyQuestionRun } from '#lib/services/competency-question.js';

const q = (iri: string, question: string): CompetencyQuestion => ({
	iri,
	question,
	expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'SELECT * {}' },
	linkedElements: [],
	owner: '',
	lastReviewed: ''
});
const run = (questionIri: string, day: number, over: Partial<CompetencyQuestionRun>): CompetencyQuestionRun => ({
	questionIri,
	ranAt: `2026-11-0${day}T08:00:00Z`,
	outcome: 'pass',
	actual: '3 rows',
	rowCount: 3,
	durationMs: 42,
	...over
});

function setup(over: { runningIri?: string | null; runningAll?: boolean } = {}) {
	const onRun = vi.fn();
	const onRunAll = vi.fn();
	const rows = buildReportRows(
		[q('A', 'Passes?'), q('B', 'Regressed?'), q('C', 'Broken?'), q('D', 'Never?')],
		[
			run('A', 1, {}),
			run('B', 1, {}),
			run('B', 2, { outcome: 'fail', actual: '0 rows', rowCount: 0 }),
			run('C', 1, { outcome: 'error', actual: '', message: 'Parse error' })
		]
	);
	render(CompetencyQuestionReport, {
		props: { rows, runningIri: over.runningIri ?? null, runningAll: over.runningAll ?? false, onRun, onRunAll }
	});
	return { onRun, onRunAll };
}

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

describe('CompetencyQuestionReport', () => {
	it('shows pass, fail with a regression marker, error with its message, and never run', () => {
		setup();
		expect(within(rowOf('Passes?')).getByText('Pass')).toBeTruthy();
		expect(within(rowOf('Passes?')).getByText('3 rows')).toBeTruthy();
		expect(within(rowOf('Passes?')).getByText('42 ms')).toBeTruthy();
		expect(within(rowOf('Regressed?')).getByText('Fail')).toBeTruthy();
		expect(within(rowOf('Regressed?')).getByText('Regression')).toBeTruthy();
		expect(within(rowOf('Passes?')).queryByText('Regression')).toBeNull();
		expect(within(rowOf('Broken?')).getByText('Error')).toBeTruthy();
		expect(within(rowOf('Broken?')).getByText('Parse error')).toBeTruthy();
		expect(within(rowOf('Never?')).getByText('Not run')).toBeTruthy();
	});

	it('draws one strip cell per stored run, labelled with its outcome', () => {
		setup();
		const cells = within(rowOf('Regressed?')).getAllByLabelText(/^(pass|fail|error) /);
		expect(cells.map((c) => c.getAttribute('aria-label')?.split(' ')[0])).toEqual(['pass', 'fail']);
	});

	it('runs one question or all of them', async () => {
		const { onRun, onRunAll } = setup();
		await fireEvent.click(within(rowOf('Passes?')).getByRole('button', { name: 'Run' }));
		expect(onRun).toHaveBeenCalledWith('A');
		await fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
		expect(onRunAll).toHaveBeenCalled();
	});

	it('disables the run buttons while a run is in progress', () => {
		setup({ runningAll: true });
		expect((screen.getByRole('button', { name: 'Running…' }) as HTMLButtonElement).disabled).toBe(true);
		for (const b of screen.getAllByRole('button', { name: 'Run' })) expect((b as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('CompetencyQuestionReport read-only (STORY-335)', () => {
	it('shows the results without any control', () => {
		const rows = buildReportRows([q('A', 'Passes?')], [run('A', 1, {})]);
		render(CompetencyQuestionReport, { props: { rows, runningIri: null, runningAll: false, onRun: vi.fn(), onRunAll: vi.fn(), readonly: true } });
		expect(screen.getByText('Passes?')).toBeTruthy();
		expect(screen.getByText('Pass')).toBeTruthy();
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
});
