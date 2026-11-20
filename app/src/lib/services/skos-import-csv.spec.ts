import { describe, expect, it } from 'vitest';
import { parseCsv, parseSkosCsv, readCsvHeaders } from './skos-import-csv';
import { buildImportPlan, parseSkosTurtle, type PlanEntry } from './skos-import';
import { serializeSkosCsv } from './skos-export-csv';
import { fixtureVocabulary } from './skos-fixture';
import { conceptIri, conceptSchemeIri } from '#lib/utils/iri.js';
import type { SkosVocabulary } from './skos-export';

const CORE = 'http://example.org/core';
const empty: SkosVocabulary = { schemes: [], concepts: [], collections: [] };
const opts = { coreBaseIri: CORE };
const ci = (label: string) => conceptIri(label, '', CORE);
const planOf = (csv: string, existing = empty) => buildImportPlan(parseSkosCsv(csv, opts), existing);
const entry = (p: ReturnType<typeof planOf>, iri: string): PlanEntry => p.entries.find((e) => e.iri === iri)!;

describe('parseCsv (STORY-416)', () => {
	it('reads quotes, doubled quotes, embedded newlines, CRLF and a BOM', () => {
		const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z\r\n';
		expect(parseCsv(text)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['line1\nline2', 'z']]);
	});
});

describe('per-language definitions (STORY-481)', () => {
	it('round-trips definition@de and definition@en through the CSV export and import', () => {
		const vocab = { ...fixtureVocabulary(), concepts: [...fixtureVocabulary().concepts] };
		vocab.concepts[0] = { ...vocab.concepts[0], definitions: [{ text: 'A person; employed.', lang: 'en' }, { text: 'Eine Person.', lang: 'de' }] };
		const csv = serializeSkosCsv(vocab, {});
		const back = parseSkosCsv(csv, opts).concepts.find((c) => c.iri === vocab.concepts[0].iri)!;
		expect([...back.definitions].sort((a, b) => a.lang.localeCompare(b.lang))).toEqual([
			{ text: 'Eine Person.', lang: 'de' },
			{ text: 'A person; employed.', lang: 'en' }
		]);
	});

	it('still reads an old CSV with a plain definition column as untagged text', () => {
		const parsed = parseSkosCsv('prefLabel@en,definition\r\nDog,A pet\r\n', opts);
		expect(parsed.concepts[0].definitions).toEqual([{ text: 'A pet', lang: '' }]);
	});
});

describe('parseSkosCsv (STORY-416)', () => {
	const indented = 'scheme,L1,L2,L3,definition@en,altLabel\r\nGlossary,Animal,,,A living thing,Creature;Beast\r\nGlossary,,Dog,,A pet,Hound\r\nGlossary,,,Puppy,A young dog,\r\nGlossary,,Cat,,,\r\n';
	const flat = 'scheme,prefLabel@en,definition,altLabel@en,broader\r\nGlossary,Animal,A living thing,Creature;Beast,\r\nGlossary,Dog,A pet,Hound,Animal\r\nGlossary,Puppy,A young dog,,Dog\r\nGlossary,Cat,,,Animal\r\n';

	it('builds concepts with top concept, broader and ;-separated alt labels from the indented layout', () => {
		const parsed = parseSkosCsv(indented, opts);
		expect(parsed.errors).toEqual([]);
		const byIri = new Map(parsed.concepts.map((c) => [c.iri, c]));
		expect(byIri.get(ci('Animal'))).toMatchObject({ topConcept: true, schemeIri: conceptSchemeIri('Glossary', CORE), altLabels: [{ text: 'Creature', lang: '' }, { text: 'Beast', lang: '' }], definitions: [{ text: 'A living thing', lang: 'en' }] });
		expect(byIri.get(ci('Dog'))!.broader).toEqual([ci('Animal')]);
		expect(byIri.get(ci('Puppy'))!.broader).toEqual([ci('Dog')]);
		expect(byIri.get(ci('Cat'))!.broader).toEqual([ci('Animal')]);
		expect(parsed.schemes.map((s) => s.name)).toEqual(['Glossary']);
	});

	it('both layouts give the same plan as the equivalent Turtle file', () => {
		const s = conceptSchemeIri('Glossary', CORE);
		const turtle = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<${s}> a skos:ConceptScheme ; rdfs:label "Glossary" .
<${ci('Animal')}> a skos:Concept ; skos:prefLabel "Animal"@en ; skos:definition "A living thing" ; skos:inScheme <${s}> ; skos:topConceptOf <${s}> ; skos:altLabel "Creature"@en, "Beast"@en .
<${ci('Dog')}> a skos:Concept ; skos:prefLabel "Dog"@en ; skos:definition "A pet" ; skos:inScheme <${s}> ; skos:broader <${ci('Animal')}> ; skos:altLabel "Hound"@en .
<${ci('Puppy')}> a skos:Concept ; skos:prefLabel "Puppy"@en ; skos:definition "A young dog" ; skos:inScheme <${s}> ; skos:broader <${ci('Dog')}> .
<${ci('Cat')}> a skos:Concept ; skos:prefLabel "Cat"@en ; skos:inScheme <${s}> ; skos:broader <${ci('Animal')}> .`;
		const strip = (e: PlanEntry) => JSON.stringify(e.imported);
		const fromTurtle = buildImportPlan(parseSkosTurtle(turtle), empty).entries.map(strip);
		const fromFlat = planOf(flat).entries.map(strip);
		expect(fromFlat).toEqual(fromTurtle);
		// The indented layout has no language column, so its labels carry no tag; the structure is the same.
		const fromIndented = planOf(indented).entries;
		expect(fromIndented.map((e) => e.iri)).toEqual(buildImportPlan(parseSkosTurtle(turtle), empty).entries.map((e) => e.iri));
		expect(fromIndented.every((e) => e.status === 'new')).toBe(true);
	});

	it('keeps a literal ; inside one value when it is escaped', () => {
		const csv = 'prefLabel,altLabel\r\nTerm,"a\\;b;c"\r\n';
		const concept = parseSkosCsv(csv, opts).concepts[0];
		expect(concept.altLabels.map((l) => l.text)).toEqual(['a;b', 'c']);
	});

	it('reports rows with a missing label, an unknown parent and an unreadable line, with row numbers', () => {
		const csv = 'prefLabel,broader\r\nOk,\r\n,Ok\r\nChild,Ghost\r\nToo,many,cells\r\nFine,Ok\r\n';
		const parsed = parseSkosCsv(csv, opts);
		const byRow = Object.fromEntries(parsed.errors.map((e) => [e.row, e.code]));
		expect(byRow).toEqual({ 3: 'missing-label', 4: 'unknown-parent', 5: 'unreadable-row' });
		expect(parsed.concepts.map((c) => c.iri)).toEqual([ci('Ok'), ci('Child'), ci('Fine')]);
		expect(parsed.errors.find((e) => e.row === 4)!.message).toMatch(/^Row 4:/);
	});

	it('resolves a flat broader by label, notation or label <iri>, and by existing concepts', () => {
		const existing = fixtureVocabulary();
		const csv = `prefLabel,notation,broader\r\nBoss,B-1,Manager\r\nDeputy,,"Boss <${ci('Boss')}>"\r\nSub,,B-1\r\n`;
		const parsed = parseSkosCsv(csv, { ...opts, existing: existing.concepts });
		expect(parsed.errors).toEqual([]);
		const by = new Map(parsed.concepts.map((c) => [c.iri, c]));
		expect(by.get(ci('Boss'))!.broader).toEqual([existing.concepts.find((c) => c.prefLabels[0].text === 'Manager')!.iri]);
		expect(by.get(ci('Deputy'))!.broader).toEqual([ci('Boss')]);
		expect(by.get(ci('Sub'))!.broader).toEqual([ci('Boss')]);
	});

	it('flags a duplicate minted IRI instead of suffixing it, and a label that mints an existing IRI with another label', () => {
		const dup = parseSkosCsv('prefLabel\r\nCustomer\r\ncustomer!\r\n', opts);
		expect(dup.errors.map((e) => e.code)).toEqual(['duplicate-iri']);
		expect(dup.concepts).toHaveLength(1);
		const existing: SkosVocabulary = { ...empty, concepts: [{ ...fixtureVocabulary().concepts[0], iri: ci('Customer'), prefLabels: [{ text: 'Client', lang: '' }] }] };
		const plan = planOf('prefLabel\r\nCustomer\r\n', existing);
		expect(entry(plan, ci('Customer')).status).toBe('conflicting');
	});

	it('trims cells and strips unprintable characters, saying so', () => {
		const parsed = parseSkosCsv('prefLabel,definition\r\n  Spaced  ,"bad\u0007char"\r\n', opts);
		expect(parsed.concepts[0].prefLabels[0].text).toBe('Spaced');
		expect(parsed.concepts[0].definitions).toEqual([{ text: 'badchar', lang: '' }]);
		expect(parsed.info.some((i) => i.code === 'stripped-characters' && i.row === 2)).toBe(true);
	});

	it('does not neutralise formula-looking text on import', () => {
		expect(parseSkosCsv("prefLabel\r\n=cmd\r\n", opts).concepts[0].prefLabels[0].text).toBe('=cmd');
	});

	it('lists unknown columns and honours a column mapping', () => {
		const csv = 'Begriff,Erklaerung\r\nTerm,Meaning\r\n';
		expect(readCsvHeaders(csv).unknown).toEqual(['Begriff', 'Erklaerung']);
		const mapped = parseSkosCsv(csv, { ...opts, columnMap: { Begriff: 'prefLabel@de', Erklaerung: 'definition' } });
		expect(mapped.concepts[0]).toMatchObject({ prefLabels: [{ text: 'Term', lang: 'de' }], definitions: [{ text: 'Meaning', lang: '' }] });
		expect(parseSkosCsv(csv, opts).errors[0].code).toBe('missing-label');
	});

	it('the CSV written by the export imports back with no errors and nothing new or changed', () => {
		const vocab = fixtureVocabulary();
		const csv = serializeSkosCsv(vocab, {});
		const parsed = parseSkosCsv(csv, { ...opts, existing: vocab.concepts });
		expect(parsed.errors).toEqual([]);
		const plan = buildImportPlan(parsed, vocab);
		expect(plan.counts.new).toBe(0);
		expect(plan.counts.conflicting).toBe(0);
		expect(parsed.concepts).toHaveLength(vocab.concepts.length);
	});
});
