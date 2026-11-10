import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import type { CompetencyQuestionDraft } from './competency-question';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '#lib/config.js';
import {
	COMPETENCY_QUESTION_CLASS_IRI,
	CQ_EXPECTED_RESULT_PREDICATE_IRI,
	CQ_LINKED_ELEMENT_PREDICATE_IRI,
	CQ_QUERY_PREDICATE_IRI,
	CQ_SAVED_QUERY_PREDICATE_IRI,
	CQ_RUN_CLASS_IRI,
	CQ_RUN_OF_PREDICATE_IRI,
	competencyQuestionIri
} from '#lib/utils/iri.js';

const DEFAULT_GRAPHS = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

const draft: CompetencyQuestionDraft = {
	question: 'Which apps hold "PII"?',
	expected: { kind: 'minRows', count: 2 },
	query: { kind: 'sparql', text: 'SELECT ?a WHERE { ?a ?p "x\\y" }' },
	linkedElements: ['http://example.org/ns#Application', 'http://example.org/ns#holds'],
	owner: 'Ada',
	lastReviewed: '2026-11-01'
};

function mockFetch(fixture: { classExists?: boolean; questionExists?: boolean; bindings?: Record<string, { value: string }>[] } = {}) {
	const updates: string[] = [];
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		queries.push(q);
		if (q.includes('ASK')) {
			const boolean =
				q.includes(`<${COMPETENCY_QUESTION_CLASS_IRI}> a owl:Class`) || q.includes(`<${CQ_RUN_CLASS_IRI}> a owl:Class`)
					? (fixture.classExists ?? true)
					: (fixture.questionExists ?? false);
			return new Response(JSON.stringify({ head: {}, boolean }), { status: 200 });
		}
		return new Response(
			JSON.stringify({ head: { vars: [] }, results: { bindings: fixture.bindings ?? [] } }),
			{ status: 200 }
		);
	});
	return { fn, updates, queries };
}

describe('SparqlConnector — competency questions (STORY-317)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insert writes the node to the default schema graph with escaped literals and one triple per linked element', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const iri = await new SparqlConnector('/api/sparql').insertCompetencyQuestion(draft);

		expect(iri).toBe(competencyQuestionIri(draft.question));
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
		expect(u).toContain(`<${iri}> a <${COMPETENCY_QUESTION_CLASS_IRI}>`);
		expect(u).toContain('rdfs:label "Which apps hold \\"PII\\"?"');
		expect(u).toContain(`<${CQ_EXPECTED_RESULT_PREDICATE_IRI}> "rows>=2"`);
		expect(u).toContain(`<${CQ_QUERY_PREDICATE_IRI}> "SELECT ?a WHERE { ?a ?p \\"x\\\\y\\" }"`);
		expect(u).toContain(`<${CQ_LINKED_ELEMENT_PREDICATE_IRI}> <http://example.org/ns#Application>`);
		expect(u).toContain(`<${CQ_LINKED_ELEMENT_PREDICATE_IRI}> <http://example.org/ns#holds>`);
		expect(u).toContain('"2026-11-01"^^xsd:date');
	});

	it('insert declares the class when missing, refuses an existing question and an empty one', async () => {
		const missing = mockFetch({ classExists: false });
		vi.stubGlobal('fetch', missing.fn);
		await new SparqlConnector('/api/sparql').insertCompetencyQuestion(draft);
		expect(missing.updates).toHaveLength(2);
		expect(missing.updates[0]).toContain(`<${COMPETENCY_QUESTION_CLASS_IRI}> a owl:Class`);

		vi.stubGlobal('fetch', mockFetch({ questionExists: true }).fn);
		await expect(new SparqlConnector('/api/sparql').insertCompetencyQuestion(draft)).rejects.toThrow(/already exists/);
		await expect(
			new SparqlConnector('/api/sparql').insertCompetencyQuestion({ ...draft, question: ' ' })
		).rejects.toThrow(/must not be empty/);
	});

	it('refuses an unsafe linked element or saved query IRI before sending anything', async () => {
		const { fn } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const c = new SparqlConnector('/api/sparql');
		await expect(
			c.insertCompetencyQuestion({ ...draft, linkedElements: ['http://x/a> } ; DROP ALL ; <'] })
		).rejects.toThrow();
		await expect(
			c.insertCompetencyQuestion({ ...draft, query: { kind: 'saved', iri: 'http://x/a> <b' } })
		).rejects.toThrow();
		expect(fn).not.toHaveBeenCalled();
	});

	it('a saved-query reference is stored as an IRI, not as text', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').insertCompetencyQuestion({
			...draft,
			query: { kind: 'saved', iri: 'http://example.org/ns#Q' }
		});
		expect(updates[0]).toContain(`<${CQ_SAVED_QUERY_PREDICATE_IRI}> <http://example.org/ns#Q>`);
		expect(updates[0]).not.toContain(`<${CQ_QUERY_PREDICATE_IRI}>`);
	});

	it('update replaces the node in one request and keeps its IRI', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').updateCompetencyQuestion('http://example.org/ns#Q1', draft);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatch(/DELETE WHERE \{[^}]*<http:\/\/example.org\/ns#Q1> \?p \?o/);
		expect(updates[0]).toContain('INSERT DATA');
		expect(updates[0]).toContain('<http://example.org/ns#Q1> a <' + COMPETENCY_QUESTION_CLASS_IRI + '>');
	});

	it('delete removes every triple of the node', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').deleteCompetencyQuestion('http://example.org/ns#Q1');
		expect(updates[0]).toContain('DELETE WHERE');
		expect(updates[0]).toContain('<http://example.org/ns#Q1> ?p ?o');
	});

	it('fetch reads one graph with DISTINCT and folds the linked-element rows into one question', async () => {
		const row = (le: string) => ({
			q: { value: 'http://example.org/ns#Q1' },
			label: { value: 'Which?' },
			expected: { value: 'true' },
			text: { value: 'ASK { ?s ?p ?o }' },
			owner: { value: 'Ada' },
			reviewed: { value: '2026-11-01' },
			le: { value: le }
		});
		const { fn, queries } = mockFetch({ bindings: [row('http://e/A'), row('http://e/B')] });
		vi.stubGlobal('fetch', fn);
		const result = await new SparqlConnector('/api/sparql').fetchCompetencyQuestions();

		expect(queries[0]).toContain('SELECT DISTINCT');
		expect(queries[0]).toContain(`FROM <${DEFAULT_GRAPHS.schema}>`);
		expect(result).toEqual([
			{
				iri: 'http://example.org/ns#Q1',
				question: 'Which?',
				expected: { kind: 'ask', value: true },
				query: { kind: 'sparql', text: 'ASK { ?s ?p ?o }' },
				linkedElements: ['http://e/A', 'http://e/B'],
				owner: 'Ada',
				lastReviewed: '2026-11-01'
			}
		]);
	});

	it('delete also removes the question\'s runs', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').deleteCompetencyQuestion('http://example.org/ns#Q1');
		expect(updates[0]).toContain(`?run <${CQ_RUN_OF_PREDICATE_IRI}> <http://example.org/ns#Q1> . ?run ?rp ?ro`);
	});

	it('askQuery can leave inference off', async () => {
		const { fn } = mockFetch({ questionExists: true });
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').askQuery('ASK { ?s ?p ?o }', { infer: false });
		expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ query: 'ASK { ?s ?p ?o }', infer: false });
	});
});

describe('SparqlConnector — competency question runs (STORY-318)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const run = {
		questionIri: 'http://example.org/ns#Q1',
		ranAt: '2026-11-10T08:00:00.000Z',
		outcome: 'error' as const,
		actual: '',
		durationMs: 12.6,
		message: 'Parse "error"'
	};

	it('stores a run in the default schema graph with typed literals and an escaped message', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').insertCompetencyQuestionRun(run);

		const u = updates[0];
		expect(u).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
		expect(u).toContain(`a <${CQ_RUN_CLASS_IRI}>`);
		expect(u).toContain(`<${CQ_RUN_OF_PREDICATE_IRI}> <http://example.org/ns#Q1>`);
		expect(u).toContain('"2026-11-10T08:00:00.000Z"^^xsd:dateTime');
		expect(u).toContain('"error"');
		expect(u).toContain('"13"^^xsd:integer');
		expect(u).toContain('"Parse \\"error\\""');
		expect(u).not.toContain('rowCount');
	});

	it('refuses an unsafe question IRI', async () => {
		const { fn } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await expect(
			new SparqlConnector('/api/sparql').insertCompetencyQuestionRun({ ...run, questionIri: 'http://x/a> <b' })
		).rejects.toThrow();
		expect(fn).not.toHaveBeenCalled();
	});

	it('keeps only the newest runs of the question after inserting', async () => {
		const bindings = Array.from({ length: 4 }, (_, i) => ({
			run: { value: `http://example.org/ns#Run${i}` },
			at: { value: `2026-11-0${i + 1}T00:00:00Z` }
		}));
		const { fn, updates } = mockFetch({ bindings });
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').insertCompetencyQuestionRun(run, 2);

		expect(updates).toHaveLength(2);
		expect(updates[1]).toContain('<http://example.org/ns#Run0> ?p ?o');
		expect(updates[1]).toContain('<http://example.org/ns#Run1> ?p ?o');
		expect(updates[1]).not.toContain('Run2');
		expect(updates[1]).not.toContain('Run3');
	});

	it('fetches every run in one DISTINCT query on one graph', async () => {
		const { fn, queries } = mockFetch({
			bindings: [
				{
					q: { value: 'http://example.org/ns#Q1' },
					at: { value: '2026-11-10T08:00:00Z' },
					outcome: { value: 'pass' },
					actual: { value: '3 rows' },
					rows: { value: '3' },
					ms: { value: '40' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);
		const runs = await new SparqlConnector('/api/sparql').fetchCompetencyQuestionRuns();

		expect(queries[0]).toContain('SELECT DISTINCT');
		expect(queries[0]).toContain(`FROM <${DEFAULT_GRAPHS.schema}>`);
		expect(runs).toEqual([
			{
				questionIri: 'http://example.org/ns#Q1',
				ranAt: '2026-11-10T08:00:00Z',
				outcome: 'pass',
				actual: '3 rows',
				rowCount: 3,
				durationMs: 40
			}
		]);
	});
});
