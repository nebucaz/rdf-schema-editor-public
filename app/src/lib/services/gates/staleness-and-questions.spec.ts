import { describe, expect, it } from 'vitest';
import type { CompetencyQuestion, CompetencyQuestionRun } from '../competency-question';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { GATES, runGates } from './index';
import { gateFindingLink } from './links';
import { QUESTION_COVERAGE_GATES } from './question-coverage';
import { staleConceptGate } from './stale-concept';

const NS = 'http://e';
const now = new Date('2026-11-10T00:00:00Z');
const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id.toUpperCase(), lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: true, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});
const question = (id: string, linkedElements: string[] = []): CompetencyQuestion => ({
	iri: `urn:q:${id}`, question: `Question ${id}?`, expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'x' }, linkedElements, owner: '', lastReviewed: '2026-11-01'
});
const runOf = (id: string, outcome: CompetencyQuestionRun['outcome'], ranAt: string): CompetencyQuestionRun => ({
	questionIri: `urn:q:${id}`, ranAt, outcome, actual: '', durationMs: 1
});
const cls = (id: string) => ({ iri: `${NS}#${id}`, label: id, comment: null, namespaceBaseIri: NS });
const schema = { classes: [cls('A'), cls('B')], subClassOf: [], individuals: [], objectProperties: [] } as unknown as FetchedSchema;

describe('GateOptions for staleness and runs (ontology-dashboard STORY-460)', () => {
	it('registers the three gates', () => {
		for (const id of ['stale-concept', 'class-without-question', 'failing-question']) expect(GATES.some((g) => g.id === id)).toBe(true);
	});
});

describe('stale-concept gate', () => {
	const run = (concepts: Concept[] | undefined, staleAfterMonths?: number) =>
		runGates(schema, { concepts, staleAfterMonths, now }, [staleConceptGate]);

	it('is silent without concepts or without a threshold', () => {
		expect(run(undefined, 12)).toEqual([]);
		expect(run([concept('old', { modified: '2020-01-01' })])).toEqual([]);
	});

	it('flags a live concept untouched for at least the threshold, measured from modified, else created', () => {
		const found = run(
			[
				concept('old', { modified: '2025-10-01' }),
				concept('edge', { modified: '2025-11-10' }),
				concept('fresh', { modified: '2026-06-01' }),
				concept('created', { created: '2024-01-01' }),
				concept('undated')
			],
			12
		);
		expect(found.map((f) => f.elementIri).sort()).toEqual(['urn:c:created', 'urn:c:edge', 'urn:c:old']);
		expect(found[0]).toMatchObject({ gateId: 'stale-concept', stage: 'vocabulary', severity: 'warning' });
		expect(found.find((f) => f.elementIri === 'urn:c:old')!.message).toContain('13 months (threshold 12)');
	});

	it('leaves out deprecated and retired concepts', () => {
		expect(run([concept('gone', { status: 'retired', modified: '2020-01-01' })], 12)).toEqual([]);
	});

	it('opens on the concept', () => {
		const [f] = run([concept('old', { modified: '2020-01-01' })], 12);
		expect(gateFindingLink(f, schema)).toBe('/vocabulary?concept=urn%3Ac%3Aold');
	});
});

describe('question coverage gates', () => {
	const run = (questions: CompetencyQuestion[] | undefined, runs?: CompetencyQuestionRun[], gateId?: string) =>
		runGates(schema, { questions, runs }, QUESTION_COVERAGE_GATES).filter((f) => !gateId || f.gateId === gateId);

	it('are silent without questions', () => {
		expect(run(undefined, [runOf('x', 'fail', '2026-01-01')])).toEqual([]);
	});

	it('class-without-question flags each model class no question links', () => {
		const found = run([question('q', [`${NS}#A`])], undefined, 'class-without-question');
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ elementIri: `${NS}#B`, severity: 'info' });
		expect(found[0].message).toContain('Class "B" is not needed by any competency question');
		expect(gateFindingLink(found[0], schema)).toBe(`/?focus=${encodeURIComponent(`${NS}#B`)}`);
	});

	it('failing-question uses the latest run of each question and is silent without runs', () => {
		const questions = [question('f'), question('e'), question('ok'), question('healed'), question('norun')];
		expect(run(questions, undefined, 'failing-question')).toEqual([]);
		const found = run(
			questions,
			[
				runOf('f', 'fail', '2026-05-01'), runOf('e', 'error', '2026-05-01'), runOf('ok', 'pass', '2026-05-01'),
				runOf('healed', 'fail', '2026-01-01'), runOf('healed', 'pass', '2026-02-01')
			],
			'failing-question'
		);
		expect(found.map((f) => f.elementIri).sort()).toEqual(['urn:q:e', 'urn:q:f']);
		expect(found.find((f) => f.elementIri === 'urn:q:f')!.message).toContain('fails in its latest run');
		expect(found.find((f) => f.elementIri === 'urn:q:e')!.message).toContain('errors in its latest run');
		expect(gateFindingLink(found[0], schema)).toBe('/questions');
	});
});

describe('unowned concepts', () => {
	it('no gate reports an unowned concept besides concept-without-provenance', () => {
		expect(GATES.some((g) => g.id === 'unowned-concept')).toBe(false);
	});
});
