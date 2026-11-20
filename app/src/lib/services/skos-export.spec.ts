import { describe, expect, it } from 'vitest';
import { Parser } from 'n3';
import { serializeSkosTurtle } from './skos-export';
import { FIXTURE_BASE, SCHEME, fixtureVocabulary } from './skos-fixture';
import { SKOS } from '#lib/utils/iri.js';
import { SCHEMA_NAMESPACE } from '#lib/config.js';

const c = (id: string) => `${FIXTURE_BASE}#${id}`;
const RSE = SCHEMA_NAMESPACE;
const OWL_DEPRECATED = 'http://www.w3.org/2002/07/owl#deprecated';
const DCT = 'http://purl.org/dc/terms/';

const parse = (turtle: string) => new Parser().parse(turtle);
const has = (turtle: string, s: string, p: string, o?: string) =>
	parse(turtle).some((q) => q.subject.value === s && q.predicate.value === p && (o === undefined || q.object.value === o));

describe('serializeSkosTurtle (STORY-411)', () => {
	const out = serializeSkosTurtle(fixtureVocabulary(), { schemeIri: SCHEME });

	it('parses back and carries labels, definition, notation, example, scope note and scheme membership', () => {
		expect(has(out, c('Employee'), SKOS.prefLabel, 'Employee')).toBe(true);
		const label = parse(out).find((q) => q.subject.value === c('Employee') && q.predicate.value === SKOS.prefLabel)!;
		expect((label.object as { language: string }).language).toBe('en');
		expect(has(out, c('Employee'), SKOS.definition, 'A person employed by the organisation.')).toBe(true);
		expect(has(out, c('Employee'), SKOS.notation, 'E-1')).toBe(true);
		expect(has(out, c('Employee'), SKOS.example, 'A salaried developer')).toBe(true);
		expect(has(out, c('Employee'), SKOS.hiddenLabel, 'Employe')).toBe(true);
		expect(has(out, c('Manager'), SKOS.scopeNote)).toBe(true);
		expect(has(out, c('Manager'), SKOS.inScheme, SCHEME)).toBe(true);
	});

	it('writes one language-tagged skos:definition and skos:scopeNote per language (STORY-481)', () => {
		const vocab = { ...fixtureVocabulary(), concepts: [...fixtureVocabulary().concepts] };
		vocab.concepts[0] = {
			...vocab.concepts[0],
			definitions: [{ text: 'A person employed.', lang: 'en' }, { text: 'Eine angestellte Person.', lang: 'de' }],
			scopeNotes: [{ text: 'Staff only.', lang: 'en' }]
		};
		const ttl = serializeSkosTurtle(vocab, { schemeIri: SCHEME });
		const defs = parse(ttl).filter((q) => q.subject.value === vocab.concepts[0].iri && q.predicate.value === SKOS.definition);
		expect(defs.map((q) => [q.object.value, (q.object as { language: string }).language]).sort()).toEqual([
			['A person employed.', 'en'],
			['Eine angestellte Person.', 'de']
		]);
		expect(ttl).toContain('"Staff only."@en');
		expect(serializeSkosTurtle(vocab, { schemeIri: SCHEME })).toBe(ttl);
	});

	it('writes top concepts both ways and scheme metadata as dct terms', () => {
		expect(has(out, c('Employee'), SKOS.topConceptOf, SCHEME)).toBe(true);
		expect(has(out, SCHEME, SKOS.hasTopConcept, c('Employee'))).toBe(true);
		expect(has(out, SCHEME, `${DCT}title`, 'Workforce thesaurus')).toBe(true);
		expect(has(out, SCHEME, `${DCT}publisher`, 'https://example.org/org/hr')).toBe(true);
		expect(has(out, SCHEME, `${DCT}creator`, 'Data Office')).toBe(true);
		expect(has(out, SCHEME, `${DCT}modified`, '2026-11-17T06:30:15Z')).toBe(true);
	});

	it('states every related link in both directions and every broader with its narrower', () => {
		expect(has(out, c('Manager'), SKOS.related, c('Consultant'))).toBe(true);
		expect(has(out, c('Consultant'), SKOS.related, c('Manager'))).toBe(true);
		expect(has(out, c('Manager'), SKOS.broader, c('Employee'))).toBe(true);
		expect(has(out, c('Employee'), SKOS.narrower, c('Manager'))).toBe(true);
	});

	it('exports mappings with the target as a bare IRI', () => {
		expect(has(out, c('Manager'), SKOS.exactMatch, 'http://example.org/other#Manager')).toBe(true);
		expect(parse(out).some((q) => q.subject.value === 'http://example.org/other#Manager')).toBe(false);
	});

	it('contains only that scheme, with its collections and members', () => {
		expect(has(out, c('Cafeteria'), SKOS.prefLabel)).toBe(false);
		expect(has(out, `${FIXTURE_BASE}#FoodCollection`, SKOS.prefLabel)).toBe(false);
		expect(has(out, `${FIXTURE_BASE}#RolesCollection`, SKOS.member, c('Manager'))).toBe(true);
		const ordered = parse(out).filter((q) => q.subject.value === `${FIXTURE_BASE}#OnboardingCollection` && q.predicate.value === SKOS.memberList);
		expect(ordered).toHaveLength(1);
	});

	it('leaves out editorial notes, rse: predicates and deprecation markers by default', () => {
		expect(out).not.toContain('Check the HR wording');
		expect(parse(out).some((q) => q.predicate.value.startsWith(RSE))).toBe(false);
		expect(has(out, c('TempWorker'), OWL_DEPRECATED)).toBe(false);
		expect(out).not.toContain('historyNote');
	});

	it('is byte-identical on a second run', () => {
		expect(serializeSkosTurtle(fixtureVocabulary(), { schemeIri: SCHEME })).toBe(out);
		const full = serializeSkosTurtle(fixtureVocabulary(), {});
		expect(serializeSkosTurtle(fixtureVocabulary(), {})).toBe(full);
	});

	it('the whole-vocabulary export has every scheme and collection', () => {
		const full = serializeSkosTurtle(fixtureVocabulary(), {});
		expect(has(full, c('Cafeteria'), SKOS.prefLabel)).toBe(true);
		expect(has(full, `${FIXTURE_BASE}#FoodCollection`, SKOS.prefLabel)).toBe(true);
	});
});

describe('serializeSkosTurtle options (STORY-411)', () => {
	it('includeEditorialNotes adds skos:editorialNote', () => {
		const out = serializeSkosTurtle(fixtureVocabulary(), { schemeIri: SCHEME, includeEditorialNotes: true });
		expect(has(out, c('Employee'), SKOS.editorialNote, 'Check the HR wording')).toBe(true);
	});

	it('includeProjectPredicates adds rse: fields, the deprecated marker and replacedBy together', () => {
		const out = serializeSkosTurtle(fixtureVocabulary(), { schemeIri: SCHEME, includeProjectPredicates: true });
		expect(has(out, c('Employee'), `${RSE}source`, 'HR handbook')).toBe(true);
		expect(has(out, c('TempWorker'), OWL_DEPRECATED, 'true')).toBe(true);
		expect(has(out, c('TempWorker'), `${RSE}replacedBy`, c('Contractor'))).toBe(true);
		expect(has(out, c('TempWorker'), `${RSE}status`, 'deprecated')).toBe(true);
	});

	it('classExactMatch adds only the class-to-concept lines', () => {
		const base = serializeSkosTurtle(fixtureVocabulary(), { schemeIri: SCHEME });
		const withLinks = serializeSkosTurtle(
			{ ...fixtureVocabulary(), classLinks: [{ classIri: 'http://example.org/a#Employee', conceptIri: c('Employee') }, { classIri: 'http://example.org/a#Food', conceptIri: c('Cafeteria') }] },
			{ schemeIri: SCHEME, classExactMatch: true }
		);
		const plain = (turtle: string) => parse(turtle).filter((q) => q.subject.termType !== 'BlankNode' && q.object.termType !== 'BlankNode');
		const before = new Set(plain(base).map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`));
		const diff = plain(withLinks).filter((q) => !before.has(`${q.subject.value} ${q.predicate.value} ${q.object.value}`));
		expect(diff.map((q) => [q.subject.value, q.predicate.value, q.object.value])).toEqual([
			['http://example.org/a#Employee', SKOS.exactMatch, c('Employee')]
		]);
		const off = serializeSkosTurtle({ ...fixtureVocabulary(), classLinks: [{ classIri: 'http://example.org/a#Employee', conceptIri: c('Employee') }] }, { schemeIri: SCHEME });
		expect(off).toBe(base);
	});

	it('generates changeNote lines from supplied history', () => {
		const out = serializeSkosTurtle(
			{ ...fixtureVocabulary(), history: { [c('Employee')]: [{ summary: 'Edited concept "Employee"', changedBy: 'bo', changedAt: '2026-11-05T09:00:00Z', version: '1.1.0' }] } },
			{ schemeIri: SCHEME }
		);
		expect(parse(out).some((q) => q.subject.value === c('Employee') && q.predicate.value === SKOS.changeNote && q.object.value.includes('bo'))).toBe(true);
	});
});
