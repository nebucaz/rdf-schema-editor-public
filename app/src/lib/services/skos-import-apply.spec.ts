import { describe, expect, it } from 'vitest';
import { applyImport, importChangeEntry, importChangeSummary, selectImportWrites, type ImportWrites } from './skos-import-apply';
import { recordChange } from './change-log-actions';
import { suggestBump } from './release';
import type { ChangeLogItem } from './change-log';
import { buildImportPlan, parseSkosTurtle } from './skos-import';
import { FIXTURE_BASE, fixtureVocabulary } from './skos-fixture';
import type { SkosVocabulary } from './skos-export';
import type { Concept } from './skos-concept';

const c = (id: string) => `${FIXTURE_BASE}#${id}`;
const P = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <${FIXTURE_BASE}#> .
`;
const empty: SkosVocabulary = { schemes: [], concepts: [], collections: [] };
const planFor = (turtle: string, existing: SkosVocabulary) => buildImportPlan(parseSkosTurtle(P + turtle), existing);

/** A stand-in for storing the writes, to prove a second import has nothing left to do. */
function materialise(existing: SkosVocabulary, w: ImportWrites): SkosVocabulary {
	const concepts = new Map(existing.concepts.map((x) => [x.iri, x]));
	for (const write of w.concepts) {
		const prior = concepts.get(write.iri);
		const next = {
			created: '', modified: '', deprecatedOn: '', ...prior, ...write.draft, iri: write.iri,
			broader: [...new Set([...(prior?.broader ?? []), ...write.broader])],
			related: [...new Set([...(prior?.related ?? []), ...write.related])],
			mappings: [...(prior?.mappings ?? []), ...write.mappings.filter((m) => !(prior?.mappings ?? []).some((p) => p.kind === m.kind && p.target === m.target))]
		} as Concept;
		concepts.set(write.iri, next);
	}
	return { ...existing, concepts: [...concepts.values()] };
}

describe('selectImportWrites (STORY-417)', () => {
	const file = `ex:Alpha a skos:Concept ; skos:prefLabel "Alpha"@en ; skos:definition "First." ; skos:related ex:Beta ; skos:exactMatch <http://o.example/A> .
ex:Beta a skos:Concept ; skos:prefLabel "Beta"@en .`;

	it('accepts new entries as proposed concepts with the file name as source', () => {
		const w = selectImportWrites(planFor(file, empty), empty, {}, 'terms.ttl');
		expect(w.concepts.map((x) => [x.iri, x.mode, x.draft.status, x.draft.source])).toEqual([
			[c('Alpha'), 'insert', 'proposed', 'terms.ttl'],
			[c('Beta'), 'insert', 'proposed', 'terms.ttl']
		]);
		expect(w.concepts[0].related).toEqual([c('Beta')]);
		expect(w.summary).toEqual({ added: 2, changed: 0, merged: 0, skipped: 0 });
	});

	it('writes only what the user accepted: a skipped new entry is not written', () => {
		const w = selectImportWrites(planFor(file, empty), empty, { entries: { [c('Beta')]: 'skip' } }, 'terms.ttl');
		expect(w.concepts.map((x) => x.iri)).toEqual([c('Alpha')]);
		expect(w.summary.skipped).toBe(1);
	});

	it('leaves changed and conflicting entries alone unless the user took the imported version', () => {
		const existing = fixtureVocabulary();
		const turtle = `ex:Manager a skos:Concept ; skos:prefLabel "Manager"@en ; skos:definition "A leader." .
ex:Contractor a skos:Concept ; skos:prefLabel "Freelancer"@en .`;
		const plan = planFor(turtle, existing);
		expect(selectImportWrites(plan, existing, {}, 'f.ttl').concepts).toEqual([]);
		const taken = selectImportWrites(plan, existing, { entries: { [c('Manager')]: 'take', [c('Contractor')]: 'take' } }, 'f.ttl');
		const manager = taken.concepts.find((x) => x.iri === c('Manager'))!;
		expect(manager).toMatchObject({ mode: 'update', draft: { definitions: [{ text: 'A leader.', lang: '' }], status: 'active' } });
		expect(taken.concepts.find((x) => x.iri === c('Contractor'))!.draft.prefLabels).toEqual([{ text: 'Freelancer', lang: 'en' }]);
		expect(taken.summary.changed).toBe(2);
	});

	it('merges a concept marked "same as" an existing one: only its labels and relations are added', () => {
		const existing = fixtureVocabulary();
		const plan = planFor(`ex:Staff a skos:Concept ; skos:prefLabel "Staff"@en ; skos:definition "Ignored." ; skos:broader ex:Employee .`, existing);
		const w = selectImportWrites(plan, existing, { sameAs: { [c('Staff')]: c('Employee') } }, 'f.ttl');
		expect(w.concepts).toHaveLength(1);
		const write = w.concepts[0];
		expect(write).toMatchObject({ iri: c('Employee'), mode: 'update', broader: [c('Employee')] });
		expect(write.draft.altLabels.map((l) => l.text)).toEqual(['Staff member', 'Staff']);
		expect(write.draft.definitions).toEqual([{ text: 'A person employed by the organisation.', lang: '' }]);
		expect(w.summary.merged).toBe(1);
	});

	it('rejects an entry the model would refuse, without failing the others', () => {
		const w = selectImportWrites(planFor(`ex:Bad a skos:Concept ; skos:prefLabel "Bank (finance)"@en .\nex:Good a skos:Concept ; skos:prefLabel "Good"@en .`, empty), empty, {}, 'f.ttl');
		expect(w.rejected).toEqual([{ iri: c('Bad'), reason: expect.stringMatching(/parentheses/) }]);
		expect(w.concepts.map((x) => x.iri)).toEqual([c('Good')]);
	});

	it('is idempotent: applying the same file twice leaves nothing to do the second time', () => {
		const plan = planFor(file, empty);
		const after = materialise(empty, selectImportWrites(plan, empty, {}, 'terms.ttl'));
		const again = planFor(file, after);
		expect(again.counts).toMatchObject({ new: 0, changed: 0, conflicting: 0, unchanged: 2 });
		expect(selectImportWrites(again, after, {}, 'terms.ttl').concepts).toEqual([]);
	});

	it('summarises the import for the change log', () => {
		const w = selectImportWrites(planFor(file, empty), empty, {}, 'terms.ttl');
		expect(importChangeSummary(w)).toBe('Imported "terms.ttl": 2 added, 0 changed, 0 merged into existing concepts, 0 skipped');
	});
});

describe('applyImport (STORY-417)', () => {
	const writesFor = (turtle: string, existing: SkosVocabulary = empty) => selectImportWrites(planFor(turtle, existing), existing, {}, 'terms.ttl');
	const turtle = `ex:Alpha a skos:Concept ; skos:prefLabel "Alpha"@en .`;

	it('records one import entry after the write, and returns gate findings for the imported concepts', async () => {
		const order: string[] = [];
		const entries: unknown[] = [];
		const writes = writesFor(turtle);
		const result = await applyImport(
			{
				applyImportPlan: async () => { order.push('write'); },
				recordChange: async (e) => { order.push('log'); entries.push(e); return null; },
				loadConcepts: async () => [{ ...fixtureVocabulary().concepts[0], iri: c('Alpha'), prefLabels: [{ text: 'Alpha', lang: 'en' }], definitions: [], status: 'active' as const }]
			},
			'http://example.org/core',
			writes
		);
		expect(order).toEqual(['write', 'log']);
		expect(entries).toEqual([importChangeEntry(writes)]);
		expect(importChangeEntry(writes)).toMatchObject({ kind: 'change', changeKind: 'import', summary: importChangeSummary(writes) });
		expect(result.logProblem).toBeNull();
		expect(result.findings.length).toBeGreaterThan(0);
		expect(result.findings.every((f) => f.elementIri === c('Alpha'))).toBe(true);
	});

	it('a failing log write is a message, never a failed import', async () => {
		const result = await applyImport(
			{ applyImportPlan: async () => {}, recordChange: (e) => recordChange(e, (async () => { throw new Error('down'); }) as unknown as typeof fetch), loadConcepts: async () => [] },
			'http://example.org/core',
			writesFor(turtle)
		);
		expect(result.logProblem).toMatch(/change log entry failed/);
	});

	it('a failing write throws before anything is logged', async () => {
		const logged: unknown[] = [];
		await expect(
			applyImport(
				{ applyImportPlan: async () => { throw new Error('refused'); }, recordChange: async (e) => { logged.push(e); return null; }, loadConcepts: async () => [] },
				'http://example.org/core',
				writesFor(turtle)
			)
		).rejects.toThrow('refused');
		expect(logged).toEqual([]);
	});

	it('an import counts as a minor change when the release bump is suggested', () => {
		const item = { iri: 'x', kind: 'change', summary: 's', rationale: '', term: '', question: '', changeKind: 'import', version: '1.0.0', changedBy: 'a', changedAt: '2026-11-17T00:00:00Z' } as ChangeLogItem;
		expect(suggestBump([item]).bump).toBe('minor');
	});
});
