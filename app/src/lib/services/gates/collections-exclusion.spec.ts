import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { SkosCollection } from '../skos-collection';
import type { FetchedSchema } from '../sparql-connector';
import { GATES, runGates } from './index';
import { buildTaxonomy } from '../taxonomy-tree';

/** skos-support STORY-410: a collection groups concepts for navigation and implies no hierarchy, so no gate may
 *  report it as an orphan, a concept without scheme or anything else (the book warns concept validators do). */
const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '',
	disambiguation: '', schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: 'src', authority: 'auth', replacedBy: '',
	deprecationReason: '', created: '2026-11-01', modified: '2026-11-01', deprecatedOn: '', broader: [], related: [], mappings: [], ...over
});
const schema = {
	classes: [], datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [], individualClassRelations: [],
	individualIndividualRelations: []
} as unknown as FetchedSchema;
const concepts = [concept('Animal', { topConcept: true }), concept('Dog', { broader: ['urn:c:Animal'] })];
const collections: SkosCollection[] = [
	{ iri: 'urn:coll:Empty', prefLabels: [{ text: 'Empty', lang: 'en' }], ordered: false, members: [] },
	{ iri: 'urn:coll:Pets', prefLabels: [{ text: 'Pets', lang: 'en' }], ordered: true, members: ['urn:c:Dog'] },
	{ iri: 'urn:coll:All', prefLabels: [{ text: 'All', lang: 'en' }], ordered: false, members: ['urn:coll:Pets', 'urn:c:Animal'] }
];

describe('collections and the gates (STORY-410)', () => {
	it('runs every registered gate and finds nothing new once collections exist', () => {
		const without = runGates(schema, { concepts }, GATES);
		const withCollections = runGates(schema, { concepts, collections }, GATES);
		expect(withCollections).toEqual(without);
		expect(withCollections.filter((f) => f.elementIri.startsWith('urn:coll:'))).toEqual([]);
		expect(GATES.length).toBeGreaterThan(20);
	});

	it('keeps collections out of the taxonomy outline', () => {
		const tree = JSON.stringify(buildTaxonomy(concepts, 'urn:scheme:a'));
		expect(tree).not.toContain('urn:coll:');
	});
});
