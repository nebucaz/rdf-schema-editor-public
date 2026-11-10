import { describe, expect, it } from 'vitest';
import { pipelineSummary, type StageSummary, unlinkedQuestionCount, pipelineNamespaces } from './pipeline-summary.js';
import type { FetchedSchema } from './sparql-connector.js';
import type { GateFinding } from './gates/index.js';
import type { CompetencyQuestion, CompetencyQuestionRun } from './competency-question.js';

const A = 'http://example.org/a';
const B = 'http://example.org/b';
const namespaces = [
	{ baseIri: A, prefix: 'a' },
	{ baseIri: B, prefix: 'b' }
];
const cls = (ns: string, name: string) => ({ iri: `${ns}#${name}`, label: name, comment: null, namespaceBaseIri: ns });
const dp = (ns: string, name: string) => ({
	iri: `${ns}#${name}`, label: name, domain: `${ns}#X`, range: 'x', namespaceBaseIri: ns, required: false, repeatable: false
});
const schema = {
	classes: [cls(A, 'Person'), cls(A, 'Team'), cls(B, 'Thing')],
	datatypeProperties: [dp(A, 'name')],
	objectProperties: [],
	subClassOf: [],
	individuals: [
		{ iri: `${A}#ann`, label: 'ann', classIri: `${A}#Person`, namespaceBaseIri: A, syncSource: null, syncStatus: null }
	],
	individualClassRelations: [],
	individualIndividualRelations: []
} as unknown as FetchedSchema;

const finding = (elementIri: string, severity: GateFinding['severity'], stage: GateFinding['stage'] = 'ontology'): GateFinding => ({
	gateId: 'g', stage, severity, elementIri, message: 'm'
});
const question = (iri: string, linked: string[]): CompetencyQuestion => ({
	iri, question: iri, expected: { kind: 'minRows', count: 1 }, query: { kind: 'sparql', text: 'SELECT * {}' },
	linkedElements: linked, owner: '', lastReviewed: ''
});
const run = (questionIri: string, day: number, outcome: CompetencyQuestionRun['outcome']): CompetencyQuestionRun => ({
	questionIri, ranAt: `2026-11-0${day}T00:00:00Z`, outcome, actual: '', durationMs: 1
});

const stage = (s: ReturnType<typeof pipelineSummary>, ns: string, id: StageSummary['stage']) =>
	s.find((n) => n.namespaceBaseIri === ns)!.stages.find((x) => x.stage === id)!;
const stat = (st: StageSummary, label: string) => st.stats.find((x) => x.label === label);

describe('pipelineSummary', () => {
	const summary = pipelineSummary({ schema, namespaces, findings: [], questions: [], runs: [] });

	it('gives every namespace the six stages in order', () => {
		expect(summary.map((n) => n.stages.map((s) => s.stage))).toEqual([
			['vocabulary', 'taxonomy', 'thesaurus', 'ontology', 'validation', 'application'],
			['vocabulary', 'taxonomy', 'thesaurus', 'ontology', 'validation', 'application']
		]);
	});

	it('counts classes, properties and individuals per namespace, each linking to its screen', () => {
		const ontology = stage(summary, A, 'ontology');
		expect(ontology.status).toBe('in-progress');
		expect(stat(ontology, 'Classes')).toMatchObject({ value: 2, href: '/' });
		expect(stat(ontology, 'Properties')?.value).toBe(1);
		const app = stage(summary, A, 'application');
		expect(stat(app, 'Individuals')).toMatchObject({ value: 1, href: `/identities?ns=${encodeURIComponent(A)}` });
		expect(stat(stage(summary, B, 'ontology'), 'Classes')?.value).toBe(1);
	});

	it('labels stages without data "not started" instead of hiding them', () => {
		for (const id of ['vocabulary', 'taxonomy', 'thesaurus'] as const) {
			expect(stage(summary, A, id)).toMatchObject({ status: 'not-started', stats: [] });
		}
		expect(stage(summary, B, 'application').status).toBe('not-started');
		expect(stage(summary, A, 'validation').status).toBe('not-started');
	});

	it('attributes gate findings to the stage and the namespace of their element', () => {
		const s = pipelineSummary({
			schema,
			namespaces,
			findings: [
				finding(`${A}#Person`, 'warning'),
				finding(`${A}#Team`, 'info'),
				finding(`${B}#Thing`, 'warning'),
				finding('http://elsewhere#x', 'warning'),
				finding(`${A}#ann`, 'warning', 'knowledgeGraph')
			],
			questions: [],
			runs: []
		});
		const a = stage(s, A, 'ontology');
		expect([a.warnings, a.infos]).toEqual([1, 1]);
		expect(stat(a, 'Findings')).toMatchObject({ value: 2, href: '/validation?tab=gates' });
		expect(stage(s, B, 'ontology').warnings).toBe(1);
		expect(stage(s, A, 'application').warnings).toBe(1);
	});

	it('summarises the latest run of the questions linked to a namespace', () => {
		const s = pipelineSummary({
			schema,
			namespaces,
			findings: [],
			questions: [
				question('q1', [`${A}#Person`]),
				question('q2', [`${A}#name`]),
				question('q3', [`${A}#Team`]),
				question('q4', [`${B}#Thing`])
			],
			runs: [run('q1', 1, 'pass'), run('q1', 2, 'fail'), run('q2', 1, 'pass'), run('q4', 1, 'pass')]
		});
		const o = stage(s, A, 'ontology');
		expect(o.status).toBe('in-progress');
		expect(stat(o, 'Questions')).toMatchObject({ value: 3, href: '/questions' });
		expect(stat(o, 'Passing')).toMatchObject({ value: '1 of 2 run', href: '/questions#results' });
		expect(stat(o, 'Regressions')?.value).toBe(1);
		expect(stat(stage(s, B, 'ontology'), 'Passing')?.value).toBe('1 of 1 run');
		expect(stat(stage(s, A, 'validation'), 'Questions')).toBeUndefined();
	});

	it('shows no pass rate for questions that never ran', () => {
		const s = pipelineSummary({ schema, namespaces, findings: [], questions: [question('q', [`${A}#Person`])], runs: [] });
		const o = stage(s, A, 'ontology');
		expect(stat(o, 'Passing')).toBeUndefined();
		expect(stat(o, 'Questions')?.value).toBe(1);
	});

	it('counts the shapes of a namespace under validation', () => {
		const withShapes = { ...schema, shapes: [{ iri: `${A}#PersonShape`, namespaceBaseIri: A }] } as never;
		const s = pipelineSummary({ schema: withShapes, namespaces, findings: [], questions: [], runs: [] });
		expect(stage(s, A, 'validation').status).toBe('in-progress');
		expect(stat(stage(s, A, 'validation'), 'Shapes')).toMatchObject({ value: 1, href: '/validation' });
		expect(stage(s, B, 'validation').status).toBe('not-started');
	});

	it('counts the questions linked to nothing', () => {
		expect(unlinkedQuestionCount([question('a', []), question('b', [`${A}#Person`]), question('c', [])])).toBe(2);
	});

	it('lists only the namespaces flagged as part of the pipeline', () => {
		const all = [
			{ baseIri: A, prefix: 'a', pipeline: true },
			{ baseIri: B, prefix: 'b', pipeline: false }
		];
		expect(pipelineNamespaces(all).map((n) => n.baseIri)).toEqual([A]);
	});
});
