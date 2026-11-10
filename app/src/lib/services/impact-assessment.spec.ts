import { describe, expect, it } from 'vitest';
import { assessAgainst, diffSnapshots, latestOutcomes, takeSnapshot } from './impact-assessment';
import type { GateFinding } from './gates/types';

const finding = (gateId: string, elementIri: string, message = 'm'): GateFinding => ({
	gateId, stage: 'ontology', severity: 'warning', elementIri, message
});

describe('takeSnapshot / diffSnapshots (STORY-332)', () => {
	const before = takeSnapshot(
		[{ questionIri: 'q1', outcome: 'pass' }, { questionIri: 'q2', outcome: 'pass' }, { questionIri: 'q3', outcome: 'fail' }],
		[finding('g1', 'a'), finding('g2', 'b')]
	);

	it('reports nothing when nothing changed', () => {
		const diff = diffSnapshots(before, before);
		expect(diff).toEqual({ questions: [], newFindings: [], resolvedFindings: [] });
	});

	it('lists questions whose outcome changed, including new and removed ones', () => {
		const after = takeSnapshot(
			[{ questionIri: 'q1', outcome: 'fail' }, { questionIri: 'q3', outcome: 'pass' }, { questionIri: 'q4', outcome: 'pass' }],
			[finding('g1', 'a'), finding('g2', 'b')]
		);
		const diff = diffSnapshots(before, after);
		expect(diff.questions).toEqual([
			{ questionIri: 'q1', before: 'pass', after: 'fail' },
			{ questionIri: 'q2', before: 'pass', after: null },
			{ questionIri: 'q3', before: 'fail', after: 'pass' },
			{ questionIri: 'q4', before: null, after: 'pass' }
		]);
	});

	it('lists new and resolved gate findings', () => {
		const after = takeSnapshot([], [finding('g1', 'a'), finding('g3', 'c', 'new one')]);
		const diff = diffSnapshots(before, after);
		expect(diff.newFindings).toEqual([{ gateId: 'g3', elementIri: 'c', message: 'new one' }]);
		expect(diff.resolvedFindings.map((f) => f.gateId)).toEqual(['g2']);
	});

	it('survives a round trip through JSON, which is how a baseline is stored', () => {
		expect(JSON.parse(JSON.stringify(before))).toEqual(before);
	});
});

describe('latestOutcomes / assessAgainst', () => {
	const run = (questionIri: string, ranAt: string, outcome: 'pass' | 'fail' | 'error') => ({ questionIri, ranAt, outcome, actual: '', durationMs: 1 });

	it('keeps the newest run of each question', () => {
		const latest = latestOutcomes([run('q1', '2026-01-01T00:00:00Z', 'pass'), run('q1', '2026-02-01T00:00:00Z', 'fail'), run('q2', '2026-01-05T00:00:00Z', 'pass')]);
		expect(latest).toEqual([{ questionIri: 'q1', outcome: 'fail' }, { questionIri: 'q2', outcome: 'pass' }]);
	});

	it('diffs fresh results against the stored baseline', () => {
		const baseline = takeSnapshot([{ questionIri: 'q1', outcome: 'pass' }], []);
		const diff = assessAgainst(baseline, [run('q1', '2026-03-01T00:00:00Z', 'fail')], [finding('g', 'a')]);
		expect(diff.questions).toEqual([{ questionIri: 'q1', before: 'pass', after: 'fail' }]);
		expect(diff.newFindings).toHaveLength(1);
	});

	it('treats a request without a baseline as one made against an empty model', () => {
		const diff = assessAgainst(null, [run('q1', '2026-03-01T00:00:00Z', 'pass')], []);
		expect(diff.questions).toEqual([{ questionIri: 'q1', before: null, after: 'pass' }]);
	});
});
