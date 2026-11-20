import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { SKOS } from '#lib/utils/iri.js';
import { runGates } from './index';
import { CONCEPT_PROPERTY_GATES } from './concept-properties';
import { gateFindingLink } from './links';

const NS = 'http://e';
const SCHEME = 'urn:scheme:lifecycle';
const OTHER_SCHEME = 'urn:scheme:other';
const stage = `${NS}#deviceStage`;
const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [],
	notation: [], example: [], editorialNote: [], disambiguation: '', schemeIri: SCHEME, topConcept: true, status: 'active',
	source: '', authority: '', replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [], ...over
});
const conceptProperty = (scheme = SCHEME) => ({
	iri: stage, label: 'stage', domain: `${NS}#Device`, valueSchemeIri: scheme, required: false, repeatable: false, namespaceBaseIri: NS
});
const value = (individual: string, target: string) => ({
	individualIri: individual, predicateIri: stage, name: 'stage', targetIndividualIri: target, namespaceBaseIri: NS
});
const schemaOf = (over: Partial<FetchedSchema> = {}) =>
	({
		classes: [{ iri: `${NS}#Device`, label: 'Device', comment: 'd', namespaceBaseIri: NS }],
		datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [{ iri: `${NS}#laptop`, label: 'laptop', classIri: `${NS}#Device`, namespaceBaseIri: NS, syncSource: null, syncStatus: null }],
		individualClassRelations: [], individualIndividualRelations: [], conceptProperties: [conceptProperty()], ...over
	}) as unknown as FetchedSchema;
const run = (schema: FetchedSchema, concepts?: Concept[], schemes?: { iri: string }[]) =>
	runGates(schema, { concepts, schemes, stages: ['ontology'] }, CONCEPT_PROPERTY_GATES);
const ids = (found: ReturnType<typeof run>) => found.map((f) => f.gateId).sort();

describe('concept property gates (STORY-440)', () => {
	it('report nothing without the vocabulary concepts', () => {
		expect(run(schemaOf({ individualIndividualRelations: [value(`${NS}#laptop`, 'urn:c:x')] }), undefined)).toEqual([]);
	});

	it('are silent for a clean model', () => {
		const schema = schemaOf({ individualIndividualRelations: [value(`${NS}#laptop`, 'urn:c:live')] });
		expect(run(schema, [concept('live')], [{ iri: SCHEME }])).toEqual([]);
	});

	it('(1) report a concept property whose scheme has no concepts, naming a missing scheme', () => {
		const empty = run(schemaOf(), [concept('elsewhere', { schemeIri: OTHER_SCHEME })], [{ iri: SCHEME }, { iri: OTHER_SCHEME }]);
		expect(ids(empty)).toEqual(['concept-property-empty-scheme']);
		expect(empty[0]).toMatchObject({ elementIri: stage, stage: 'ontology', severity: 'warning' });
		expect(empty[0].message).toMatch(/has no concepts/);
		const gone = run(schemaOf(), [concept('elsewhere', { schemeIri: OTHER_SCHEME })], [{ iri: OTHER_SCHEME }]);
		expect(gone[0].message).toMatch(/no longer exists/);
	});

	it('(2) report an individual holding a retired concept, naming the replacement', () => {
		const concepts = [concept('old', { status: 'retired', replacedBy: 'urn:c:new' }), concept('new')];
		const found = run(schemaOf({ individualIndividualRelations: [value(`${NS}#laptop`, 'urn:c:old')] }), concepts, [{ iri: SCHEME }]);
		expect(ids(found)).toEqual(['concept-property-retired-value']);
		expect(found[0].elementIri).toBe(`${NS}#laptop`);
		expect(found[0].message).toContain('new');
	});

	it('(2) also catch a deprecated concept, without a replacement hint when there is none', () => {
		const found = run(schemaOf({ individualIndividualRelations: [value(`${NS}#laptop`, 'urn:c:old')] }), [concept('old', { status: 'deprecated' })]);
		expect(ids(found)).toEqual(['concept-property-retired-value']);
		expect(found[0].message).not.toMatch(/replaced by/i);
	});

	it('(3) report a value that is not a concept of the scheme, as also reported by /validation', () => {
		const schema = schemaOf({ individualIndividualRelations: [value(`${NS}#laptop`, 'urn:c:wrong'), value(`${NS}#laptop`, 'urn:unknown')] });
		const found = run(schema, [concept('live'), concept('wrong', { schemeIri: OTHER_SCHEME })], [{ iri: SCHEME }]);
		expect(ids(found)).toEqual(['concept-property-foreign-value', 'concept-property-foreign-value']);
		expect(found[0].severity).toBe('info');
		expect(found[0].message).toMatch(/also reported by Validation/);
	});

	it('(2) and (3) need individuals: without them only the scheme check can fire', () => {
		const schema = schemaOf({ individuals: [], individualIndividualRelations: [] });
		expect(run(schema, [concept('live')], [{ iri: SCHEME }])).toEqual([]);
	});

	it('ignores values of other predicates', () => {
		const other = { ...value(`${NS}#laptop`, 'urn:c:x'), predicateIri: `${NS}#other` };
		expect(run(schemaOf({ individualIndividualRelations: [other] }), [concept('live')], [{ iri: SCHEME }])).toEqual([]);
	});

	it('(4) report a relation whose target is the external class skos:Concept', () => {
		const relation = { iri: `${NS}#hasStatus`, label: 'hasStatus', domain: `${NS}#Device`, range: SKOS.Concept, namespaceBaseIri: NS, required: false, repeatable: false };
		const schema = schemaOf({ conceptProperties: [], objectProperties: [relation] as never });
		const found = run(schema, [concept('live')], [{ iri: SCHEME }]);
		expect(ids(found)).toEqual(['relation-to-skos-concept']);
		expect(found[0]).toMatchObject({ elementIri: relation.iri, severity: 'warning' });
		expect(found[0].message).toContain('concept property');
	});

	it('every finding opens somewhere', () => {
		const relation = { iri: `${NS}#hasStatus`, label: 'hasStatus', domain: `${NS}#Device`, range: SKOS.Concept, namespaceBaseIri: NS, required: false, repeatable: false };
		const schema = schemaOf({ objectProperties: [relation] as never, individualIndividualRelations: [value(`${NS}#laptop`, 'urn:c:old'), value(`${NS}#laptop`, 'urn:c:elsewhere')] });
		const found = run(schema, [concept('old', { status: 'retired' }), concept('elsewhere', { schemeIri: OTHER_SCHEME })], [{ iri: SCHEME }]);
		expect(found.length).toBeGreaterThanOrEqual(3);
		for (const f of found) expect(gateFindingLink(f, schema), f.gateId).not.toBeNull();
	});
});
