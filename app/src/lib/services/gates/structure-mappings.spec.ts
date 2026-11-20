import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { GATES, runGates } from './index';
import { gateFindingLink } from './links';
import { STRUCTURE_MAPPING_GATES } from './structure-mappings';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [], disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [],
	...over
});
const schema = { classes: [], subClassOf: [], individuals: [] } as unknown as FetchedSchema;
const ids = STRUCTURE_MAPPING_GATES.map((g) => g.id);
const only = (gateId: string, concepts?: Concept[]) =>
	runGates(schema, { concepts }, STRUCTURE_MAPPING_GATES).filter((f) => f.gateId === gateId);
const top = concept('Top', { topConcept: true });

describe('structure and mapping gates (STORY-420)', () => {
	it('registers every gate with an id, stage and an Open link', () => {
		expect(ids.sort()).toEqual([
			'hierarchical-redundancy', 'mapping-clash', 'mapping-without-scheme', 'omitted-top-concept', 'reflexive-relation', 'related-between-siblings'
		]);
		for (const g of STRUCTURE_MAPPING_GATES) {
			expect(GATES).toContain(g);
			expect(['taxonomy', 'thesaurus']).toContain(g.stage);
		}
		const found = only('related-between-siblings', [
			top, concept('A', { broader: ['urn:c:Top'], related: ['urn:c:B'] }), concept('B', { broader: ['urn:c:Top'] })
		]);
		expect(gateFindingLink(found[0], schema)).toContain('/vocabulary?concept=');
	});

	it('is silent without a vocabulary', () => {
		for (const g of STRUCTURE_MAPPING_GATES) expect(runGates(schema, {}, [g])).toEqual([]);
	});

	it('mapping-clash: exactMatch with a broad/related/narrow match to the same target, either direction', () => {
		const positive = only('mapping-clash', [
			concept('A', { mappings: [{ kind: 'exactMatch', target: 'urn:x:T' }, { kind: 'broadMatch', target: 'urn:x:T' }] })
		]);
		expect(positive).toHaveLength(1);
		expect(positive[0].message).toContain('S46');
		const reverse = only('mapping-clash', [
			concept('A', { mappings: [{ kind: 'exactMatch', target: 'urn:c:B' }] }),
			concept('B', { mappings: [{ kind: 'narrowMatch', target: 'urn:c:A' }] })
		]);
		expect(reverse).toHaveLength(1);
		expect(only('mapping-clash', [
			concept('A', { mappings: [{ kind: 'exactMatch', target: 'urn:x:T' }, { kind: 'broadMatch', target: 'urn:x:U' }, { kind: 'closeMatch', target: 'urn:x:T' }] })
		])).toEqual([]);
	});

	it('related-between-siblings: shared parent flags, different parents do not', () => {
		const p = concept('P'), q = concept('Q');
		const hit = only('related-between-siblings', [p, q, concept('A', { broader: [p.iri], related: ['urn:c:B'] }), concept('B', { broader: [p.iri] })]);
		expect(hit).toHaveLength(1);
		expect(hit[0].message).toContain('valueless associative relation');
		expect(only('related-between-siblings', [p, q, concept('A', { broader: [p.iri], related: ['urn:c:B'] }), concept('B', { broader: [q.iri] })])).toEqual([]);
	});

	it('hierarchical-redundancy: shortcut flags, a plain chain does not', () => {
		const chain = [concept('A'), concept('B', { broader: ['urn:c:A'] })];
		expect(only('hierarchical-redundancy', [...chain, concept('C', { broader: ['urn:c:B', 'urn:c:A'] })])).toHaveLength(1);
		expect(only('hierarchical-redundancy', [...chain, concept('C', { broader: ['urn:c:B'] })])).toEqual([]);
	});

	it('reflexive-relation: broader, related or a mapping to itself', () => {
		expect(only('reflexive-relation', [
			concept('A', { broader: ['urn:c:A'] }), concept('B', { related: ['urn:c:B'] }),
			concept('C', { mappings: [{ kind: 'closeMatch', target: 'urn:c:C' }] }), concept('D')
		])).toHaveLength(3);
	});

	it('omitted-top-concept: a scheme with concepts but no top concept', () => {
		const hit = only('omitted-top-concept', [concept('A'), concept('B', { schemeIri: 'urn:scheme:b', topConcept: true })]);
		expect(hit).toHaveLength(1);
		expect(hit[0].elementIri).toBe('urn:scheme:a');
		expect(only('omitted-top-concept', [concept('A', { topConcept: true })])).toEqual([]);
		expect(only('omitted-top-concept', [concept('A', { schemeIri: '' })])).toEqual([]);
	});

	it('mapping-without-scheme: a mapping on a concept in no scheme', () => {
		const m = [{ kind: 'exactMatch' as const, target: 'urn:x:T' }];
		expect(only('mapping-without-scheme', [concept('A', { schemeIri: '', mappings: m }), concept('B', { mappings: m })])).toHaveLength(1);
	});

	it('never reports a collection', () => {
		const collections = [{ iri: 'urn:coll:X', prefLabels: [], ordered: false, members: ['urn:c:A'] }];
		const cs = [concept('A', { broader: ['urn:c:A'] })];
		const a = runGates(schema, { concepts: cs, collections }, STRUCTURE_MAPPING_GATES);
		expect(a.some((f) => f.elementIri.startsWith('urn:coll:'))).toBe(false);
	});
});
