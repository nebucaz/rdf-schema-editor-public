import { describe, expect, it } from 'vitest';
import type { FetchedSchema } from './sparql-connector.js';
import {
	competencyElementOptions,
	evaluateCompetencyQuestion,
	isRegression,
	stripRunHistory,
	queryForm,
	formatExpectedResult,
	parseExpectedResult,
	validateCompetencyQuestion,
	type CompetencyQuestionDraft,
	type ExpectedResult
} from './competency-question.js';

const base: CompetencyQuestionDraft = {
	question: 'Which applications process personal data?',
	expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'SELECT ?a WHERE { ?a a ?t }' },
	linkedElements: [],
	owner: '',
	lastReviewed: ''
};

describe('expected result serialisation', () => {
	it('round-trips ask, row count and value expectations', () => {
		const cases: ExpectedResult[] = [
			{ kind: 'ask', value: true },
			{ kind: 'ask', value: false },
			{ kind: 'minRows', count: 3 },
			{ kind: 'values', values: ['a', 'b c'] }
		];
		for (const e of cases) expect(parseExpectedResult(formatExpectedResult(e))).toEqual(e);
	});

	it('returns null for text that is not an expectation', () => {
		expect(parseExpectedResult('maybe')).toBeNull();
		expect(parseExpectedResult('rows>=-1')).toBeNull();
		expect(parseExpectedResult('values:not json')).toBeNull();
	});
});

describe('validateCompetencyQuestion', () => {
	it('accepts a complete draft', () => {
		expect(validateCompetencyQuestion(base)).toEqual([]);
	});

	it('requires a question', () => {
		expect(validateCompetencyQuestion({ ...base, question: '  ' })).toContain('The question must not be empty.');
	});

	it('requires query text or a saved query', () => {
		expect(validateCompetencyQuestion({ ...base, query: { kind: 'sparql', text: ' ' } })).toContain(
			'Enter the SPARQL query or choose a saved query.'
		);
		expect(validateCompetencyQuestion({ ...base, query: { kind: 'saved', iri: '' } })).toContain(
			'Enter the SPARQL query or choose a saved query.'
		);
	});

	it('requires an ASK query for a true/false expectation and a SELECT for the others', () => {
		const ask = { ...base, expected: { kind: 'ask', value: true } as const };
		expect(validateCompetencyQuestion(ask)).toContain('A true/false expectation needs an ASK query.');
		expect(
			validateCompetencyQuestion({ ...ask, query: { kind: 'sparql', text: 'PREFIX x: <http://x/>\n# c\nASK { ?s ?p ?o }' } })
		).toEqual([]);
		expect(validateCompetencyQuestion({ ...base, query: { kind: 'sparql', text: 'ASK { ?s ?p ?o }' } })).toContain(
			'A row expectation needs a SELECT query.'
		);
	});

	it('does not check the form of a saved query', () => {
		const draft = { ...base, expected: { kind: 'ask', value: false } as const, query: { kind: 'saved', iri: 'http://x/q' } as const };
		expect(validateCompetencyQuestion(draft)).toEqual([]);
	});

	it('rejects a non-positive row count, empty value list and a bad review date', () => {
		expect(validateCompetencyQuestion({ ...base, expected: { kind: 'minRows', count: 0 } })).toContain(
			'The minimum row count must be a whole number of at least 1.'
		);
		expect(validateCompetencyQuestion({ ...base, expected: { kind: 'values', values: [] } })).toContain(
			'Enter at least one expected value.'
		);
		expect(validateCompetencyQuestion({ ...base, lastReviewed: '10.11.2026' })).toContain(
			'The review date must be YYYY-MM-DD.'
		);
	});
});

describe('competencyElementOptions', () => {
	it('lists classes and both property kinds once each, sorted by label with a kind suffix', () => {
		const schema = {
			classes: [{ iri: 'http://e/B', label: 'Beta' }, { iri: 'http://e/A', label: 'Alpha' }],
			datatypeProperties: [{ iri: 'http://e/p', label: 'name' }],
			objectProperties: [{ iri: 'http://e/p', label: 'name' }, { iri: 'http://e/o', label: 'holds' }]
		} as unknown as FetchedSchema;
		expect(competencyElementOptions(schema)).toEqual([
			{ iri: 'http://e/A', label: 'Alpha (class)' },
			{ iri: 'http://e/B', label: 'Beta (class)' },
			{ iri: 'http://e/o', label: 'holds (relation)' },
			{ iri: 'http://e/p', label: 'name (attribute)' }
		]);
	});
});

describe('evaluateCompetencyQuestion', () => {
	const rows = (...values: string[]) => ({ kind: 'select' as const, rows: values.map((v) => ({ x: v })) });

	it('checks an ASK answer against a true/false expectation', () => {
		expect(evaluateCompetencyQuestion({ kind: 'ask', value: true }, { kind: 'ask', value: true })).toEqual({
			outcome: 'pass',
			actual: 'true'
		});
		expect(evaluateCompetencyQuestion({ kind: 'ask', value: true }, { kind: 'ask', value: false })).toEqual({
			outcome: 'fail',
			actual: 'true'
		});
	});

	it('checks the row count against a minimum', () => {
		expect(evaluateCompetencyQuestion(rows('a', 'b'), { kind: 'minRows', count: 2 })).toEqual({
			outcome: 'pass',
			actual: '2 rows'
		});
		expect(evaluateCompetencyQuestion(rows('a'), { kind: 'minRows', count: 2 })).toEqual({
			outcome: 'fail',
			actual: '1 row'
		});
	});

	it('requires every expected value to appear in some cell', () => {
		expect(evaluateCompetencyQuestion(rows('a', 'b', 'c'), { kind: 'values', values: ['a', 'c'] }).outcome).toBe('pass');
		const missing = evaluateCompetencyQuestion(rows('a'), { kind: 'values', values: ['a', 'z'] });
		expect(missing.outcome).toBe('fail');
		expect(missing.actual).toBe('missing: z');
	});

	it('fails when the result kind does not match the expectation', () => {
		expect(evaluateCompetencyQuestion({ kind: 'ask', value: true }, { kind: 'minRows', count: 1 }).outcome).toBe('fail');
		expect(evaluateCompetencyQuestion(rows('a'), { kind: 'ask', value: true }).outcome).toBe('fail');
	});
});

describe('isRegression', () => {
	it('is a pass followed by a fail, nothing else', () => {
		expect(isRegression('pass', 'fail')).toBe(true);
		expect(isRegression('fail', 'fail')).toBe(false);
		expect(isRegression('pass', 'pass')).toBe(false);
		expect(isRegression('pass', 'error')).toBe(false);
		expect(isRegression(undefined, 'fail')).toBe(false);
	});
});

describe('stripRunHistory', () => {
	it('keeps the newest N runs in oldest-to-newest order', () => {
		const run = (n: number) => ({ ranAt: `2026-11-0${n}T00:00:00Z`, outcome: 'pass' as const });
		const out = stripRunHistory([run(3), run(1), run(2), run(4)], 3);
		expect(out.map((r) => r.ranAt.slice(8, 10))).toEqual(['02', '03', '04']);
	});
});

describe('queryForm', () => {
	it('reads the form after prologue and comments', () => {
		expect(queryForm('# c\nPREFIX a: <http://a/>\nSELECT * {}')).toBe('SELECT');
		expect(queryForm('ASK {}')).toBe('ASK');
		expect(queryForm('CONSTRUCT {} WHERE {}')).toBe('other');
	});
});
