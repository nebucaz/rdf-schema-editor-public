import { describe, expect, it } from 'vitest';
import type { CompetencyQuestion } from '../competency-question';
import type { FetchedSchema } from '../sparql-connector';
import { runGates } from './index';
import { QUESTION_REVIEW_GATES } from './question-review';

const schema = { classes: [], subClassOf: [] } as unknown as FetchedSchema;
const question = (id: string, lastReviewed: string): CompetencyQuestion => ({
	iri: `urn:q:${id}`, question: `Question ${id}?`, expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'x' }, linkedElements: [], owner: '', lastReviewed
});
const now = new Date('2026-11-10T00:00:00Z');
const run = (questions: CompetencyQuestion[] | undefined, reviewPeriodMonths = 3) =>
	runGates(schema, { questions, reviewPeriodMonths, now, stages: ['governance'] });

describe('question review gate (STORY-334)', () => {
	it('registers under the governance stage', () => {
		expect(QUESTION_REVIEW_GATES.every((g) => g.stage === 'governance')).toBe(true);
	});

	it('is silent without questions', () => {
		expect(run(undefined)).toEqual([]);
		expect(run([])).toEqual([]);
	});

	it('flags a question reviewed longer ago than the period, or never', () => {
		const found = run([question('old', '2026-06-01'), question('new', '2026-10-01'), question('never', '')]);
		expect(found.map((f) => [f.elementIri, f.severity]).sort()).toEqual([
			['urn:q:never', 'warning'],
			['urn:q:old', 'warning']
		]);
		expect(found.find((f) => f.elementIri === 'urn:q:never')!.message).toMatch(/never been reviewed/i);
		expect(found.find((f) => f.elementIri === 'urn:q:old')!.message).toMatch(/months ago/);
	});

	it('follows the review period', () => {
		expect(run([question('a', '2026-06-01')], 6)).toEqual([]);
		expect(run([question('a', '2026-06-01')], 3)).toHaveLength(1);
	});
});
