import { describe, expect, it } from 'vitest';
import { Parser, type Quad } from 'n3';
import { buildImportPlan, parseSkosTurtle } from './skos-import';
import { parseSkosCsv } from './skos-import-csv';
import { selectImportWrites } from './skos-import-apply';
import { serializeSkosTurtle, type SkosVocabulary } from './skos-export';
import { serializeSkosCsv } from './skos-export-csv';
import { collectionsFromQuads } from './skos-collection';
import { WORKFORCE_CSV, WORKFORCE_TURTLE, materialiseWrites } from './skos-fixture-files';
import { FIXTURE_BASE, fixtureConcepts } from './skos-fixture';
import { runGates } from './gates/index';
import type { FetchedSchema } from './sparql-connector';
import { SKOS } from '#lib/utils/iri.js';

const CORE = 'http://example.org/core';
const empty: SkosVocabulary = { schemes: [], concepts: [], collections: [] };
const importTurtle = (turtle: string, into = empty) => materialiseWrites(into, selectImportWrites(buildImportPlan(parseSkosTurtle(turtle), into), into, {}, 'workforce.ttl'));
const importCsv = (csv: string, into = empty) =>
	materialiseWrites(into, selectImportWrites(buildImportPlan(parseSkosCsv(csv, { coreBaseIri: CORE, existing: into.concepts }), into), into, {}, 'workforce.csv'));

const triples = (quads: Quad[]) =>
	new Set(quads.filter((q) => q.subject.termType !== 'BlankNode' && q.object.termType !== 'BlankNode').map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}${'language' in q.object && q.object.language ? `@${q.object.language}` : ''}`));

describe('round trip with the workforce thesaurus (STORY-419)', () => {
	it('the hand-written Turtle imports without errors or skipped content', () => {
		const plan = buildImportPlan(parseSkosTurtle(WORKFORCE_TURTLE), empty);
		expect(plan.errors).toEqual([]);
		expect(plan.skipped).toEqual([]);
		expect(plan.counts).toMatchObject({ new: 4 + 1 + 2, changed: 0, conflicting: 0 });
	});

	it('Turtle -> import -> export yields the same triples, plus the documented inverses', () => {
		const exported = serializeSkosTurtle(importTurtle(WORKFORCE_TURTLE), {});
		const original = new Parser().parse(WORKFORCE_TURTLE);
		const expected = triples(original);
		// Documented additions of the export: the inverse of every broader, both halves of related.
		for (const q of original) {
			if (q.predicate.value === SKOS.broader) expected.add(`${q.object.value} ${SKOS.narrower} ${q.subject.value}`);
			if (q.predicate.value === SKOS.related) expected.add(`${q.object.value} ${SKOS.related} ${q.subject.value}`);
			if (q.predicate.value === SKOS.narrower) expected.add(`${q.object.value} ${SKOS.broader} ${q.subject.value}`);
		}
		const got = triples(new Parser().parse(exported));
		expect([...got].filter((t) => !expected.has(t))).toEqual([]);
		expect([...expected].filter((t) => !got.has(t))).toEqual([]);
		const collections = collectionsFromQuads(new Parser().parse(exported));
		expect(collections.find((x) => x.iri.endsWith('OnboardingCollection'))).toMatchObject({ ordered: true, members: [`${FIXTURE_BASE}#Employee`, `${FIXTURE_BASE}#Manager`] });
	});

	it('CSV -> import -> export -> import is an all-unchanged plan', () => {
		const first = importCsv(WORKFORCE_CSV);
		expect(first.concepts).toHaveLength(4);
		const csv = serializeSkosCsv(first, {});
		const parsed = parseSkosCsv(csv, { coreBaseIri: CORE, existing: first.concepts });
		expect(parsed.errors).toEqual([]);
		const plan = buildImportPlan(parsed, first);
		expect(plan.counts).toMatchObject({ new: 0, changed: 0, conflicting: 0 });
		expect(plan.counts.unchanged).toBe(first.concepts.length + first.schemes.length);
	});

	it('Turtle -> CSV -> Turtle keeps concepts, labels, hierarchy and related', () => {
		const fromTurtle = importTurtle(WORKFORCE_TURTLE);
		const viaCsv = importCsv(serializeSkosCsv(fromTurtle, {}));
		const shape = (v: SkosVocabulary) =>
			v.concepts
				.map((x) => ({
					iri: x.iri,
					pref: x.prefLabels.map((l) => `${l.text}@${l.lang}`).sort(),
					alt: x.altLabels.map((l) => `${l.text}@${l.lang}`).sort(),
					broader: [...(x.broader ?? [])].sort(),
					related: [...(x.related ?? [])].sort(),
					definition: x.definition,
					notation: x.notation ?? []
				}))
				.sort((a, b) => (a.iri < b.iri ? -1 : 1));
		expect(shape(viaCsv)).toEqual(shape(fromTurtle));
	});

	it('the fixture passes every registered gate without a finding', () => {
		const schema = { classes: [], datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [], individualClassRelations: [], individualIndividualRelations: [] } as unknown as FetchedSchema;
		const findings = runGates(schema, { concepts: fixtureConcepts }).map((f) => `${f.gateId} ${f.elementIri.split('#')[1]}`).sort();
		// The fixture is meant to be clean: a finding here means a gate or the fixture drifted.
		expect(findings).toEqual([]);
	});
});
