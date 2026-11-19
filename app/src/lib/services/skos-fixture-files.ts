/**
 * The workforce thesaurus as hand-written Turtle and CSV, plus a stand-in for storing an import (skos-support STORY-419).
 * The files are written by hand, not produced by the serializers, so the round-trip spec is not circular. Test support only.
 */
import type { Concept, ConceptScheme } from './skos-concept';
import type { SkosVocabulary } from './skos-export';
import type { ImportWrites } from './skos-import-apply';
import { FIXTURE_BASE } from './skos-fixture';

export const WORKFORCE_TURTLE = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix ex: <${FIXTURE_BASE}#> .

ex:WorkforceScheme a skos:ConceptScheme ;
    rdfs:label "Workforce" ;
    rdfs:comment "People who work here." ;
    dct:title "Workforce thesaurus" ;
    dct:creator "Data Office" ;
    dct:publisher <https://example.org/org/hr> ;
    dct:rights "CC-BY-4.0" ;
    skos:hasTopConcept ex:Person .

ex:Person a skos:Concept ;
    skos:prefLabel "Person"@en, "Person"@de ;
    skos:altLabel "Individual"@en ;
    skos:definition "A human being." ;
    skos:notation "P-1" ;
    skos:inScheme ex:WorkforceScheme ;
    skos:topConceptOf ex:WorkforceScheme ;
    skos:narrower ex:Employee, ex:Consultant .

ex:Employee a skos:Concept ;
    skos:prefLabel "Employee"@en, "Mitarbeiter"@de ;
    skos:altLabel "Staff member"@en ;
    skos:hiddenLabel "Employe"@en ;
    skos:definition "A person employed by the organisation." ;
    skos:example "A salaried developer" ;
    skos:notation "E-1" ;
    skos:inScheme ex:WorkforceScheme ;
    skos:broader ex:Person ;
    skos:narrower ex:Manager .

ex:Manager a skos:Concept ;
    skos:prefLabel "Manager"@en ;
    skos:altLabel "Boss"@en, "Line manager"@en ;
    skos:definition "An employee who leads others." ;
    skos:scopeNote "Line management only." ;
    skos:notation "M-1" ;
    skos:inScheme ex:WorkforceScheme ;
    skos:broader ex:Employee ;
    skos:related ex:Consultant ;
    skos:exactMatch <http://example.org/other#Manager> ;
    skos:closeMatch <http://example.org/other#Lead> .

ex:Consultant a skos:Concept ;
    skos:prefLabel "Consultant"@en, "Berater"@de ;
    skos:definition "An external adviser." ;
    skos:notation "C-1" ;
    skos:inScheme ex:WorkforceScheme ;
    skos:broader ex:Person ;
    skos:related ex:Manager .

ex:RolesCollection a skos:Collection ;
    skos:prefLabel "Roles"@en ;
    skos:member ex:Manager, ex:Consultant .

ex:OnboardingCollection a skos:OrderedCollection ;
    skos:prefLabel "Onboarding"@en ;
    skos:memberList ( ex:Employee ex:Manager ) .
`;

export const WORKFORCE_CSV = [
	'scheme,notation,prefLabel@en,prefLabel@de,definition,altLabel@en,hiddenLabel@en,broader,related',
	'Workforce,P-1,Person,Person,A human being.,Individual,,,',
	'Workforce,E-1,Employee,Mitarbeiter,A person employed by the organisation.,Staff member,Employe,Person,',
	'Workforce,M-1,Manager,,An employee who leads others.,Boss;Line manager,,Employee,Consultant',
	'Workforce,C-1,Consultant,Berater,An external adviser.,,,Person,Manager',
	''
].join('\r\n');

/** A stand-in for storing the writes of an import, so a specs can export or re-import the result. */
export function materialiseWrites(existing: SkosVocabulary, writes: ImportWrites): SkosVocabulary {
	const concepts = new Map(existing.concepts.map((x) => [x.iri, x]));
	for (const w of writes.concepts) {
		const prior = concepts.get(w.iri);
		const mappings = [...(prior?.mappings ?? [])];
		for (const m of w.mappings) if (!mappings.some((p) => p.kind === m.kind && p.target === m.target)) mappings.push(m);
		concepts.set(w.iri, {
			created: '', modified: '', deprecatedOn: '', ...prior, ...w.draft, iri: w.iri,
			broader: [...new Set([...(prior?.broader ?? []), ...w.broader])],
			related: [...new Set([...(prior?.related ?? []), ...w.related])],
			mappings
		} as Concept);
	}
	const schemes = new Map(existing.schemes.map((s) => [s.iri, s]));
	for (const w of writes.schemes) {
		const s = w.scheme;
		schemes.set(w.iri, {
			iri: w.iri, name: s.name, description: s.description,
			scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' },
			metadata: { title: s.title, creator: s.creator, publisher: s.publisher, rights: s.rights, modified: '' }
		} as ConceptScheme);
	}
	const collections = new Map(existing.collections.map((x) => [x.iri, x]));
	for (const w of writes.collections) collections.set(w.iri, w.collection);
	return { ...existing, schemes: [...schemes.values()], concepts: [...concepts.values()], collections: [...collections.values()] };
}
