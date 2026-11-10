/**
 * Competency questions (ontology-pipeline STORY-317): plain-language questions the model must be able to
 * answer, each with a query and an expected result. Pure types and validation; storage is in
 * `SparqlConnector`, execution in STORY-318.
 */

import type { FetchedSchema } from './sparql-connector.js';

export type ExpectedResult =
	| { kind: 'ask'; value: boolean }
	| { kind: 'minRows'; count: number }
	| { kind: 'values'; values: string[] };

export type QuerySource = { kind: 'sparql'; text: string } | { kind: 'saved'; iri: string };

export interface CompetencyQuestionDraft {
	question: string;
	expected: ExpectedResult;
	query: QuerySource;
	/** IRIs of the classes and properties the question needs. */
	linkedElements: string[];
	owner: string;
	/** `YYYY-MM-DD` or empty. */
	lastReviewed: string;
}

export interface CompetencyQuestion extends CompetencyQuestionDraft {
	iri: string;
}

/** The stored form of an expectation: `true`, `false`, `rows>=N` or `values:<JSON array>`. */
export function formatExpectedResult(e: ExpectedResult): string {
	if (e.kind === 'ask') return e.value ? 'true' : 'false';
	if (e.kind === 'minRows') return `rows>=${e.count}`;
	return `values:${JSON.stringify(e.values)}`;
}

export function parseExpectedResult(text: string): ExpectedResult | null {
	if (text === 'true' || text === 'false') return { kind: 'ask', value: text === 'true' };
	const rows = /^rows>=(\d+)$/.exec(text);
	if (rows) return { kind: 'minRows', count: Number(rows[1]) };
	if (text.startsWith('values:')) {
		try {
			const values: unknown = JSON.parse(text.slice('values:'.length));
			if (Array.isArray(values) && values.every((v) => typeof v === 'string')) return { kind: 'values', values };
		} catch {
			return null;
		}
	}
	return null;
}

/** `SELECT`, `ASK` or `other` for the first keyword after prologue lines and comments. */
export function queryForm(text: string): 'SELECT' | 'ASK' | 'other' {
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || /^(PREFIX|BASE)\b/i.test(line)) continue;
		const word = /^[A-Za-z]+/.exec(line)?.[0].toUpperCase();
		return word === 'SELECT' || word === 'ASK' ? word : 'other';
	}
	return 'other';
}

/** Messages for everything wrong with `draft`; empty when it can be saved. */
export function validateCompetencyQuestion(draft: CompetencyQuestionDraft): string[] {
	const errors: string[] = [];
	if (!draft.question.trim()) errors.push('The question must not be empty.');

	const { query, expected } = draft;
	const hasQuery = query.kind === 'sparql' ? query.text.trim() !== '' : query.iri !== '';
	if (!hasQuery) errors.push('Enter the SPARQL query or choose a saved query.');
	else if (query.kind === 'sparql') {
		const form = queryForm(query.text);
		if (expected.kind === 'ask' && form !== 'ASK') errors.push('A true/false expectation needs an ASK query.');
		if (expected.kind !== 'ask' && form !== 'SELECT') errors.push('A row expectation needs a SELECT query.');
	}

	if (expected.kind === 'minRows' && !(Number.isInteger(expected.count) && expected.count >= 1)) {
		errors.push('The minimum row count must be a whole number of at least 1.');
	}
	if (expected.kind === 'values' && expected.values.filter((v) => v.trim()).length === 0) {
		errors.push('Enter at least one expected value.');
	}
	if (draft.lastReviewed && !/^\d{4}-\d{2}-\d{2}$/.test(draft.lastReviewed)) {
		errors.push('The review date must be YYYY-MM-DD.');
	}
	return errors;
}

/** Classes and properties of the loaded schema as `{iri, label}` choices for linking, once per IRI. */
export function competencyElementOptions(schema: FetchedSchema): { iri: string; label: string }[] {
	const seen = new Set<string>();
	const out: { iri: string; label: string }[] = [];
	const add = (items: { iri: string; label: string }[], kind: string) => {
		for (const { iri, label } of items) {
			if (seen.has(iri)) continue;
			seen.add(iri);
			out.push({ iri, label: `${label} (${kind})` });
		}
	};
	add(schema.classes, 'class');
	add(schema.datatypeProperties, 'attribute');
	add(schema.objectProperties, 'relation');
	return out.sort((a, b) => a.label.localeCompare(b.label));
}

export type RunOutcome = 'pass' | 'fail' | 'error';

/** What a run of the question's query produced: an ASK answer or the SELECT rows (variable to value). */
export type QueryResult = { kind: 'ask'; value: boolean } | { kind: 'select'; rows: Record<string, string>[] };

const plural = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

/** Compares a query result with the expectation. A result of the wrong kind never passes. */
export function evaluateCompetencyQuestion(
	result: QueryResult,
	expected: ExpectedResult
): { outcome: 'pass' | 'fail'; actual: string } {
	if (result.kind === 'ask') {
		return { outcome: expected.kind === 'ask' && expected.value === result.value ? 'pass' : 'fail', actual: String(result.value) };
	}
	const actual = plural(result.rows.length);
	if (expected.kind === 'minRows') {
		return { outcome: result.rows.length >= expected.count ? 'pass' : 'fail', actual };
	}
	if (expected.kind === 'values') {
		const present = new Set(result.rows.flatMap((row) => Object.values(row)));
		const missing = expected.values.filter((v) => !present.has(v));
		return missing.length === 0
			? { outcome: 'pass', actual }
			: { outcome: 'fail', actual: `missing: ${missing.join(', ')}` };
	}
	return { outcome: 'fail', actual };
}

/** A regression is a question that passed in its previous run and fails now. An error is not a fail. */
export function isRegression(previous: RunOutcome | undefined, current: RunOutcome): boolean {
	return previous === 'pass' && current === 'fail';
}

/** The newest `limit` runs, oldest first, for the pass/fail strip. */
export function stripRunHistory<T extends { ranAt: string }>(runs: T[], limit: number): T[] {
	return [...runs].sort((a, b) => a.ranAt.localeCompare(b.ranAt)).slice(-limit);
}

/** One execution of a question, as stored (`rse:CompetencyQuestionRun`). */
export interface CompetencyQuestionRun {
	questionIri: string;
	/** ISO date-time. */
	ranAt: string;
	outcome: RunOutcome;
	/** What the query produced, e.g. `3 rows` or `true`; empty for an error. */
	actual: string;
	/** Rows returned by a SELECT. */
	rowCount?: number;
	durationMs: number;
	/** The error text when `outcome` is `error`. */
	message?: string;
}

/** How many runs per question are kept and shown in the strip. */
export const COMPETENCY_RUN_HISTORY_LIMIT = 10;
