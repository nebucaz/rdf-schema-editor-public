import { describe, expect, it } from 'vitest';
import { DEBT_KINDS, collectDebt, countDebt, filterDebt, type DebtInput } from './semantic-debt';
import { DEFAULT_DEBT_SETTINGS } from './debt-settings';
import type { CompetencyQuestion, CompetencyQuestionRun } from './competency-question';
import type { Concept } from './skos-concept';
import type { FetchedSchema } from './sparql-connector';

const NS = 'http://e';
const now = new Date('2026-11-10T00:00:00Z');

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definition: 'A defined thing.',
	scopeNote: '', disambiguation: '', schemeIri: 's', topConcept: true, status: 'active', source: 'ISO', authority: 'Data Office',
	replacedBy: '', deprecationReason: '', created: '2026-09-01', modified: '2026-09-01', deprecatedOn: '', ...over
});
const question = (id: string, over: Partial<CompetencyQuestion> = {}): CompetencyQuestion => ({
	iri: `urn:q:${id}`, question: `Question ${id}?`, expected: { kind: 'minRows', count: 1 }, query: { kind: 'sparql', text: 'x' },
	linkedElements: [], owner: '', lastReviewed: '2026-10-01', ...over
});
const run = (id: string, outcome: 'pass' | 'fail' | 'error', ranAt = '2026-11-01T00:00:00Z'): CompetencyQuestionRun => ({
	questionIri: `urn:q:${id}`, ranAt, outcome, actual: '', durationMs: 1
});
const cls = (id: string, comment: string | null = 'described', concept?: string) => ({
	iri: `${NS}#${id}`, label: id, comment, namespaceBaseIri: NS, definedByConcept: concept
});
const schemaOf = (classes: ReturnType<typeof cls>[], shapes: unknown[] = []) =>
	({ classes, datatypeProperties: [], objectProperties: [], subClassOf: [{ sub: `${NS}#Z`, super: `${NS}#Y`, namespaceBaseIri: NS }], individuals: [], individualClassRelations: [], individualIndividualRelations: [], shapes }) as unknown as FetchedSchema;

const input = (over: Partial<DebtInput> = {}): DebtInput => ({
	schema: schemaOf([]), concepts: [], questions: [], runs: [], settings: DEFAULT_DEBT_SETTINGS, now, ...over
});
const kinds = (i: DebtInput) => collectDebt(i).map((d) => `${d.kind}:${d.elementIri}`).sort();

describe('collectDebt (STORY-334)', () => {
	it('is empty for a model with no debt', () => {
		const shapes = [{ iri: `${NS}#AShape`, targetClassIri: `${NS}#A`, paths: [], namespaceBaseIri: NS }];
		expect(
			kinds(input({
				schema: schemaOf([cls('A', 'A defined thing.', 'urn:c:a')], shapes),
				concepts: [concept('a')],
				questions: [question('1', { linkedElements: [`${NS}#A`] })],
				runs: [run('1', 'pass')]
			}))
		).toEqual([]);
	});

	it('lists undefined terms and unowned concepts', () => {
		const found = kinds(input({ concepts: [concept('nodef', { definition: '' }), concept('noauth', { authority: '' })] }));
		expect(found).toContain('undefined-term:urn:c:nodef');
		expect(found).toContain('unowned-concept:urn:c:noauth');
	});

	it('lists concepts not touched for the stale threshold, but not retired ones', () => {
		const found = kinds(input({
			concepts: [concept('old', { modified: '2025-06-01', created: '2025-06-01' }), concept('fresh'), concept('gone', { modified: '2020-01-01', status: 'retired' })]
		}));
		expect(found).toContain('stale-concept:urn:c:old');
		expect(found.some((f) => f.includes('urn:c:fresh') || f.includes('urn:c:gone'))).toBe(false);
	});

	it('follows the stale threshold setting', () => {
		const concepts = [concept('c', { modified: '2026-05-01' })];
		expect(kinds(input({ concepts, settings: { ...DEFAULT_DEBT_SETTINGS, staleAfterMonths: 12 } }))).not.toContain('stale-concept:urn:c:c');
		expect(kinds(input({ concepts, settings: { ...DEFAULT_DEBT_SETTINGS, staleAfterMonths: 3 } }))).toContain('stale-concept:urn:c:c');
	});

	it('lists drifted definitions and classes without a shape or a question', () => {
		const found = kinds(input({
			schema: schemaOf([cls('A', 'a different text', 'urn:c:a')]),
			concepts: [concept('a')]
		}));
		expect(found).toContain(`drifted-definition:${NS}#A`);
		expect(found).toContain(`class-without-shape:${NS}#A`);
		expect(found).toContain(`class-without-question:${NS}#A`);
	});

	it('lists failing questions from their latest run only, and overdue reviews', () => {
		const found = kinds(input({
			questions: [question('f'), question('recovered'), question('late', { lastReviewed: '2025-01-01' }), question('never', { lastReviewed: '' })],
			runs: [run('f', 'fail'), run('recovered', 'fail', '2026-10-01T00:00:00Z'), run('recovered', 'pass', '2026-11-01T00:00:00Z')]
		}));
		expect(found).toContain('failing-question:urn:q:f');
		expect(found).not.toContain('failing-question:urn:q:recovered');
		expect(found).toContain('overdue-question-review:urn:q:late');
		expect(found).toContain('overdue-question-review:urn:q:never');
	});

	it('follows the review period setting', () => {
		const questions = [question('q', { lastReviewed: '2026-05-01' })];
		expect(kinds(input({ questions, settings: { ...DEFAULT_DEBT_SETTINGS, reviewPeriodMonths: 3 } }))).toContain('overdue-question-review:urn:q:q');
		expect(kinds(input({ questions, settings: { ...DEFAULT_DEBT_SETTINGS, reviewPeriodMonths: 12 } }))).not.toContain('overdue-question-review:urn:q:q');
	});

	it('gives each item a label, a detail and a link to the element', () => {
		const [item] = collectDebt(input({ concepts: [concept('nodef', { definition: '' })] })).filter((d) => d.kind === 'undefined-term');
		expect(item.label).toBe('nodef');
		expect(item.detail.length).toBeGreaterThan(0);
		expect(item.href).toBe('/vocabulary?concept=urn%3Ac%3Anodef');
	});
});

describe('filterDebt / countDebt', () => {
	const items = collectDebt(input({ concepts: [concept('a', { definition: '' }), concept('b', { authority: '' })], questions: [question('q', { lastReviewed: '' })] }));

	it('counts every item', () => {
		expect(countDebt(items)).toBe(items.length);
		expect(items.length).toBe(3);
	});

	it('filters by kind and by search over label and detail', () => {
		expect(filterDebt(items, { kind: 'unowned-concept' })).toHaveLength(1);
		expect(filterDebt(items, { search: 'question q' })).toHaveLength(1);
		expect(filterDebt(items, {})).toHaveLength(3);
	});

	it('names every kind', () => {
		for (const k of DEBT_KINDS) expect(k.label.length).toBeGreaterThan(0);
	});
});
