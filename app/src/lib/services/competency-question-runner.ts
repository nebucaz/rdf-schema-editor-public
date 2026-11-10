/**
 * Runs competency questions (ontology-pipeline STORY-318). Queries run one at a time and on asserted data
 * only (`infer: false`); GraphDB stalls under heavy parallel queries (`loop-issues`). The I/O sits behind
 * `RunnerDeps` so the rules are testable without a connector.
 */
import {
	evaluateCompetencyQuestion,
	queryForm,
	type CompetencyQuestion,
	type CompetencyQuestionRun
} from './competency-question';
import type { SparqlConnector } from './sparql-connector';

export interface RunnerDeps {
	/** SPARQL text of a saved query, or `undefined` when it no longer exists. */
	resolveSavedText(iri: string): string | undefined;
	select(query: string): Promise<Record<string, string>[]>;
	ask(query: string): Promise<boolean>;
	saveRun(run: CompetencyQuestionRun): Promise<void>;
	/** Monotonic milliseconds, for durations. */
	now(): number;
	clock(): Date;
}

/** Runs one question and returns its result; a failing query is an `error` run, not a thrown exception. */
export async function runCompetencyQuestion(
	question: CompetencyQuestion,
	deps: RunnerDeps
): Promise<CompetencyQuestionRun> {
	const started = deps.now();
	const ranAt = deps.clock().toISOString();
	const finish = (rest: Omit<CompetencyQuestionRun, 'questionIri' | 'ranAt' | 'durationMs'>): CompetencyQuestionRun => ({
		questionIri: question.iri,
		ranAt,
		durationMs: deps.now() - started,
		...rest
	});
	const error = (message: string) => finish({ outcome: 'error', actual: '', message });

	const text =
		question.query.kind === 'saved' ? deps.resolveSavedText(question.query.iri) : question.query.text;
	if (text === undefined) return error('The saved query no longer exists.');

	const form = queryForm(text);
	if (form === 'other') return error('Only SELECT and ASK queries can be run.');
	try {
		if (form === 'ASK') {
			const value = await deps.ask(text);
			return finish(evaluateCompetencyQuestion({ kind: 'ask', value }, question.expected));
		}
		const rows = await deps.select(text);
		return finish({
			...evaluateCompetencyQuestion({ kind: 'select', rows }, question.expected),
			rowCount: rows.length
		});
	} catch (e) {
		return error(e instanceof Error ? e.message : 'The query failed.');
	}
}

/** Runs the questions in order, one request at a time; each run is saved before the next starts. */
export async function runAllCompetencyQuestions(
	questions: CompetencyQuestion[],
	deps: RunnerDeps,
	onRun?: (run: CompetencyQuestionRun) => void
): Promise<CompetencyQuestionRun[]> {
	const runs: CompetencyQuestionRun[] = [];
	for (const question of questions) {
		const run = await runCompetencyQuestion(question, deps);
		await deps.saveRun(run);
		runs.push(run);
		onRun?.(run);
	}
	return runs;
}

/** The real dependencies: asserted-data queries through the connector, runs stored by it. */
export function connectorRunnerDeps(
	connector: Pick<SparqlConnector, 'selectQuery' | 'askQuery' | 'insertCompetencyQuestionRun'>,
	savedQueries: { iri: string; sparqlText: string }[]
): RunnerDeps {
	const texts = new Map(savedQueries.map((q) => [q.iri, q.sparqlText]));
	return {
		resolveSavedText: (iri) => texts.get(iri),
		select: async (query) => {
			const result = await connector.selectQuery(query, { infer: false });
			return result.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
		},
		ask: (query) => connector.askQuery(query, { infer: false }),
		saveRun: (run) => connector.insertCompetencyQuestionRun(run),
		now: () => performance.now(),
		clock: () => new Date()
	};
}
