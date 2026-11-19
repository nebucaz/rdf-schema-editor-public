/**
 * The book's workforce thesaurus as data, shared by the SKOS export, import, round-trip and API specs
 * (skos-support STORY-411, 412, 416, 419, 428). Test support only: nothing in the app imports it.
 */
import type { Concept, ConceptScheme } from './skos-concept';
import type { SkosCollection } from './skos-collection';
import type { SkosVocabulary } from './skos-export';

export const FIXTURE_BASE = 'http://example.org/core/vocab';
export const SCHEME = `${FIXTURE_BASE}#WorkforceScheme`;
export const OTHER_SCHEME = `${FIXTURE_BASE}#FacilitiesScheme`;
const c = (id: string) => `${FIXTURE_BASE}#${id}`;

const concept = (id: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri: c(id),
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [],
	hiddenLabels: [],
	definition: '',
	scopeNote: '',
	notation: [],
	example: [],
	editorialNote: [],
	disambiguation: '',
	schemeIri: SCHEME,
	topConcept: false,
	status: 'active',
	source: 'HR handbook',
	authority: 'HR',
	replacedBy: '',
	deprecationReason: '',
	created: '2026-11-01',
	modified: '2026-11-02',
	deprecatedOn: '',
	broader: [],
	related: [],
	mappings: [],
	...over
});

export const fixtureConcepts: Concept[] = [
	concept('Employee', 'Employee', {
		topConcept: true,
		definition: 'A person employed by the organisation.',
		altLabels: [{ text: 'Staff member', lang: 'en' }],
		hiddenLabels: [{ text: 'Employe', lang: 'en' }],
		notation: ['E-1'],
		example: ['A salaried developer'],
		editorialNote: ['Check the HR wording'],
		source: 'HR handbook',
		authority: 'HR'
	}),
	concept('Manager', 'Manager', {
		definition: 'An employee who leads others.',
		scopeNote: 'Line management only.',
		broader: [c('Employee')],
		related: [c('Consultant')],
		mappings: [{ kind: 'exactMatch', target: 'http://example.org/other#Manager' }]
	}),
	concept('Contractor', 'Contractor', { definition: 'A person hired for a fixed term.', broader: [c('Employee')] }),
	concept('Consultant', 'Consultant', { definition: 'An external adviser.', schemeIri: SCHEME }),
	concept('TempWorker', 'Temp worker', {
		status: 'deprecated',
		definition: 'Replaced by Contractor.',
		replacedBy: c('Contractor'),
		deprecationReason: 'Merged',
		deprecatedOn: '2026-11-10',
		broader: [c('Employee')]
	}),
	concept('Cafeteria', 'Cafeteria', { schemeIri: OTHER_SCHEME, topConcept: true, definition: 'Staff restaurant.' })
];

export const fixtureCollections: SkosCollection[] = [
	{ iri: `${FIXTURE_BASE}#RolesCollection`, prefLabels: [{ text: 'Roles', lang: 'en' }], ordered: false, members: [c('Manager'), c('Contractor')] },
	{ iri: `${FIXTURE_BASE}#OnboardingCollection`, prefLabels: [{ text: 'Onboarding', lang: 'en' }], ordered: true, members: [c('Contractor'), c('Employee')] },
	{ iri: `${FIXTURE_BASE}#FoodCollection`, prefLabels: [{ text: 'Food', lang: 'en' }], ordered: false, members: [c('Cafeteria')] }
];

export const fixtureSchemes: ConceptScheme[] = [
	{
		iri: SCHEME,
		name: 'Workforce',
		description: 'People who work here.',
		scope: { purpose: 'Shared HR terms', decisionsSupported: '', outOfScope: '', stakeholders: 'HR' },
		metadata: { title: 'Workforce thesaurus', creator: 'Data Office', publisher: 'https://example.org/org/hr', rights: 'CC-BY-4.0', modified: '2026-11-17T06:30:15Z' }
	},
	{ iri: OTHER_SCHEME, name: 'Facilities', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }
];

export const fixtureVocabulary = (): SkosVocabulary => ({
	schemes: fixtureSchemes,
	concepts: fixtureConcepts,
	collections: fixtureCollections
});
