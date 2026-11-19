import { describe, expect, it } from 'vitest';
import { ImportRefused, buildImportPlan, parseSkosTurtle, type ImportPlan } from './skos-import';
import { serializeSkosTurtle } from './skos-export';
import { FIXTURE_BASE, SCHEME, fixtureVocabulary } from './skos-fixture';

const c = (id: string) => `${FIXTURE_BASE}#${id}`;
const P = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix ex: <${FIXTURE_BASE}#> .
`;
import type { SkosVocabulary } from './skos-export';
const empty: SkosVocabulary = { schemes: [], concepts: [], collections: [] };
const plan = (turtle: string, existing = empty) => buildImportPlan(parseSkosTurtle(P + turtle), existing);
const entry = (p: ImportPlan, iri: string) => p.entries.find((e) => e.iri === iri)!;

describe('scheme names from skos:prefLabel', () => {
	const parse = (t: string) => parseSkosTurtle(P + t);

	it('uses skos:prefLabel as the scheme name when there is no rdfs:label, without reporting it as skipped', () => {
		const p = parse('ex:S a skos:ConceptScheme ; skos:prefLabel "Lifecycle"@en .');
		expect(p.schemes[0].name).toBe('Lifecycle');
		expect(p.skipped).toEqual([]);
	});

	it('prefers rdfs:label over skos:prefLabel, whatever the order', () => {
		const p = parse('ex:S a skos:ConceptScheme ; skos:prefLabel "Pref"@en ; rdfs:label "Label" .');
		expect(p.schemes[0].name).toBe('Label');
	});
});

describe('parseSkosTurtle and buildImportPlan (STORY-415)', () => {
	const file = `
ex:S a skos:ConceptScheme ; rdfs:label "Glossary" ; dct:title "Business glossary" .
ex:A a skos:Concept ; skos:prefLabel "Alpha"@en ; skos:definition "First." ; skos:inScheme ex:S ; skos:topConceptOf ex:S ; skos:notation "A1" ;
   skos:altLabel "Alef"@en ; skos:exactMatch <http://other.example/Alpha> .
ex:B a skos:Concept ; skos:prefLabel "Beta"@en ; skos:inScheme ex:S ; skos:broader ex:A .
`;

	it('turns a file into new entries with counts, keeping IRIs as given', () => {
		const p = plan(file);
		expect(p.counts).toMatchObject({ new: 3, changed: 0, unchanged: 0, conflicting: 0 });
		expect(p.entries.map((e) => e.iri)).toEqual([c('S'), c('A'), c('B')]);
		const a = entry(p, c('A'));
		expect(a).toMatchObject({ kind: 'concept', status: 'new' });
		expect(a.kind === 'concept' && a.imported).toMatchObject({
			prefLabels: [{ text: 'Alpha', lang: 'en' }], altLabels: [{ text: 'Alef', lang: 'en' }], definition: 'First.',
			notation: ['A1'], schemeIri: c('S'), topConcept: true, mappings: [{ kind: 'exactMatch', target: 'http://other.example/Alpha' }]
		});
	});

	it('folds narrower into broader, and accepts one half of related, reporting it as info', () => {
		const p = plan(`
ex:A a skos:Concept ; skos:prefLabel "A"@en ; skos:narrower ex:B ; skos:related ex:C .
ex:B a skos:Concept ; skos:prefLabel "B"@en .
ex:C a skos:Concept ; skos:prefLabel "C"@en .`);
		const b = entry(p, c('B'));
		expect(b.kind === 'concept' && b.imported.broader).toEqual([c('A')]);
		const a = entry(p, c('A'));
		expect(a.kind === 'concept' && a.imported.related).toEqual([c('C')]);
		const cc = entry(p, c('C'));
		expect(cc.kind === 'concept' && cc.imported.related).toEqual([c('A')]);
		expect(p.info.map((i) => i.code)).toEqual(expect.arrayContaining(['one-sided-related', 'one-sided-hierarchy']));
		expect(p.errors).toEqual([]);
	});

	it('compares with the loaded vocabulary: unchanged, changed per property, conflicting', () => {
		const existing = fixtureVocabulary();
		const p = plan(`
ex:Employee a skos:Concept ; skos:prefLabel "Employee"@en ; skos:definition "A person employed by the organisation." .
ex:Manager a skos:Concept ; skos:prefLabel "Manager"@en ; skos:definition "A leader." ; skos:altLabel "Boss"@en .
ex:Contractor a skos:Concept ; skos:prefLabel "Freelancer"@en .
ex:Brand a skos:Concept ; skos:prefLabel "Brand"@en .`, existing);
		expect(entry(p, c('Employee')).status).toBe('unchanged');
		const manager = entry(p, c('Manager'));
		expect(manager.status).toBe('changed');
		expect(manager.changes.map((x) => x.property).sort()).toEqual(['altLabel', 'definition']);
		expect(manager.changes.find((x) => x.property === 'definition')).toMatchObject({ before: 'An employee who leads others.', after: 'A leader.' });
		const contractor = entry(p, c('Contractor'));
		expect(contractor.status).toBe('conflicting');
		expect(contractor.reason).toMatch(/preferred label.*en/i);
		expect(entry(p, c('Brand')).status).toBe('new');
		expect(p.counts).toMatchObject({ unchanged: 1, changed: 1, conflicting: 1, new: 1 });
	});

	it('a field the file leaves out never counts as a change', () => {
		const p = plan(`ex:Manager a skos:Concept ; skos:prefLabel "Manager"@en .`, fixtureVocabulary());
		expect(entry(p, c('Manager')).status).toBe('unchanged');
	});

	it('flags a notation already used in the same scheme as conflicting', () => {
		const p = plan(`
ex:Boss a skos:Concept ; skos:prefLabel "Boss"@en ; skos:inScheme <${SCHEME}> ; skos:notation "E-1" .
ex:Other a skos:Concept ; skos:prefLabel "Other"@en ; skos:inScheme ex:Else ; skos:notation "E-1" .`, fixtureVocabulary());
		expect(entry(p, c('Boss')).status).toBe('conflicting');
		expect(entry(p, c('Boss')).reason).toMatch(/notation E-1/);
		expect(entry(p, c('Other')).status).toBe('new');
	});

	it('lists similar existing concepts for a new one, as a homonym or duplicate candidate', () => {
		const p = plan(`ex:Employees a skos:Concept ; skos:prefLabel "Employees"@en .`, fixtureVocabulary());
		expect(p.similar).toEqual([expect.objectContaining({ importedIri: c('Employees'), existingIri: c('Employee') })]);
	});

	it('lists unsupported constructs under skipped with a reason, grouped, never silently dropped', () => {
		const p = plan(`
@prefix skosxl: <http://www.w3.org/2008/05/skos-xl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
ex:A a skos:Concept ; skos:prefLabel "A"@en ; skosxl:prefLabel ex:L1 ; skos:madeUp "x" ; foaf:name "Anna" ; dct:created "2026-01-01" .
ex:Thing a foaf:Person ; foaf:name "Bo" .`);
		const reasons = Object.fromEntries(p.skipped.map((s) => [s.predicate, s.reason]));
		expect(reasons['http://www.w3.org/2008/05/skos-xl#prefLabel']).toMatch(/SKOS-XL/);
		expect(reasons['http://www.w3.org/2004/02/skos/core#madeUp']).toMatch(/unknown/i);
		expect(reasons['http://xmlns.com/foaf/0.1/name']).toMatch(/not SKOS/i);
		expect(p.skipped.find((s) => s.predicate === 'http://xmlns.com/foaf/0.1/name')!.count).toBe(2);
		expect(p.skipped.some((s) => s.predicate === 'http://purl.org/dc/terms/created')).toBe(true);
	});

	it('reports a node that is a concept and a scheme, or a concept and a collection, as an error and leaves it out', () => {
		const p = plan(`
ex:X a skos:Concept, skos:ConceptScheme ; skos:prefLabel "X"@en .
ex:Y a skos:Concept, skos:Collection ; skos:prefLabel "Y"@en .
ex:Z a skos:Concept ; skos:prefLabel "Z"@en .`);
		expect(p.errors.map((e) => e.code)).toEqual(['disjoint-types', 'disjoint-types']);
		expect(p.entries.map((e) => e.iri)).toEqual([c('Z')]);
	});

	it('reports a reflexive relation as an error and drops that link', () => {
		const p = plan(`ex:A a skos:Concept ; skos:prefLabel "A"@en ; skos:broader ex:A ; skos:related ex:A .`);
		expect(p.errors.map((e) => e.code)).toEqual(['reflexive-relation', 'reflexive-relation']);
		const a = entry(p, c('A'));
		expect(a.kind === 'concept' && [a.imported.broader, a.imported.related]).toEqual([[], []]);
	});

	it('notes a relation to a concept that neither the file nor the vocabulary defines', () => {
		const p = plan(`ex:A a skos:Concept ; skos:prefLabel "A"@en ; skos:broader ex:Missing .`);
		expect(p.info.some((i) => i.code === 'undefined-concept' && i.message.includes('Missing'))).toBe(true);
	});

	it('reads an ordered and an unordered collection with its members', () => {
		const p = plan(`
ex:Col a skos:Collection ; skos:prefLabel "Col"@en ; skos:member ex:A .
ex:Ord a skos:OrderedCollection ; skos:prefLabel "Ord"@en ; skos:memberList ( ex:B ex:A ) .
ex:A a skos:Concept ; skos:prefLabel "A"@en .
ex:B a skos:Concept ; skos:prefLabel "B"@en .`);
		const ord = entry(p, c('Ord'));
		expect(ord.kind === 'collection' && ord.imported).toMatchObject({ ordered: true, members: [c('B'), c('A')] });
		expect(entry(p, c('Col')).kind).toBe('collection');
	});

	it('refuses an unsafe IRI, an oversized literal and files over the caps with a message', () => {
		const escaped = 'ex:A a skos:Concept ; skos:exactMatch <http://x/a' + String.fromCharCode(92) + 'u007Bb> .';
		expect(() => parseSkosTurtle(P + escaped)).toThrow(ImportRefused);
		expect(() => parseSkosTurtle(P + `ex:A a skos:Concept ; skos:prefLabel "${'x'.repeat(5000)}"@en .`)).toThrow(ImportRefused);
		expect(() => parseSkosTurtle('ex:A a skos:Concept .')).toThrow(/Turtle/);
		expect(() => parseSkosTurtle(P + 'ex:A a skos:Concept .', { maxBytes: 10 })).toThrow(/too large/i);
		expect(() => parseSkosTurtle(P + 'ex:A a skos:Concept . ex:B a skos:Concept .', { maxConcepts: 1 })).toThrow(/more than 1 concepts/);
	});

	it('is pure and deterministic: the same text gives the same plan', () => {
		expect(plan(file)).toEqual(plan(file));
	});

	it('takes the STORY-411 export as input: nothing in the vocabulary is new or changed', () => {
		const existing = fixtureVocabulary();
		const exported = serializeSkosTurtle(existing, {});
		const p = buildImportPlan(parseSkosTurtle(exported), existing);
		expect(p.errors).toEqual([]);
		expect(p.counts).toMatchObject({ new: 0, changed: 0, conflicting: 0 });
		expect(p.counts.unchanged).toBe(existing.concepts.length + existing.collections.length + existing.schemes.length);
	});
});
