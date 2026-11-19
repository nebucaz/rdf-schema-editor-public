import { describe, expect, it } from 'vitest';
import type { SkosCollection } from '../skos-collection';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { GATES, runGates } from './index';
import { LABELS_NOTATION_TYPES_GATES } from './labels-notation-types';
import { gateFindingLink } from './links';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [],
	...over
});
const coll = (id: string, members: string[]): SkosCollection => ({ iri: `urn:coll:${id}`, prefLabels: [{ text: id, lang: 'en' }], ordered: false, members });
const schema = { classes: [], subClassOf: [], individuals: [] } as unknown as FetchedSchema;
const only = (gateId: string, concepts?: Concept[], extra: { collections?: SkosCollection[]; schemes?: { iri: string }[] } = {}) =>
	runGates(schema, { concepts, ...extra } as never, LABELS_NOTATION_TYPES_GATES).filter((f) => f.gateId === gateId);

describe('label, notation and type gates (STORY-421)', () => {
	it('registers six gates with a stage and an Open link', () => {
		expect(LABELS_NOTATION_TYPES_GATES.map((g) => g.id).sort()).toEqual([
			'collection-member-invalid', 'duplicate-notation', 'empty-or-unprintable-label', 'incomplete-language-coverage', 'invalid-language-tag', 'type-disjointness'
		]);
		for (const g of LABELS_NOTATION_TYPES_GATES) expect(GATES).toContain(g);
		const f = only('empty-or-unprintable-label', [concept('A', { altLabels: [{ text: '  ', lang: '' }] })]);
		expect(gateFindingLink(f[0], schema)).toContain('/vocabulary?concept=');
	});

	it('is quiet without a vocabulary', () => {
		for (const g of LABELS_NOTATION_TYPES_GATES) expect(runGates(schema, {}, [g])).toEqual([]);
	});

	it('invalid-language-tag', () => {
		const bad = only('invalid-language-tag', [concept('A', { altLabels: [{ text: 'x', lang: 'english_US' }] })]);
		expect(bad).toHaveLength(1);
		expect(bad[0].message).toContain('english_US');
		const good = ['en', 'de-CH', 'zh-Hant-TW', 'sl-rozaj-biske', 'x-private', ''].map((lang) => concept('G' + lang, { hiddenLabels: [{ text: 'y', lang }] }));
		expect(only('invalid-language-tag', good)).toEqual([]);
	});

	it('incomplete-language-coverage reports languages and counts per scheme', () => {
		const de = { text: 'Hund', lang: 'de' };
		const found = only('incomplete-language-coverage', [concept('A', { prefLabels: [{ text: 'A', lang: 'en' }, de] }), concept('B'), concept('C')]);
		expect(found).toHaveLength(1);
		expect(found[0].elementIri).toBe('urn:scheme:a');
		expect(found[0].message).toContain('de');
		expect(found[0].message).toContain('2');
		const full = [concept('A', { prefLabels: [{ text: 'A', lang: 'en' }, de] }), concept('B', { prefLabels: [{ text: 'B', lang: 'en' }, de] })];
		expect(only('incomplete-language-coverage', full)).toEqual([]);
		expect(only('incomplete-language-coverage', [concept('A'), concept('B', { schemeIri: 'urn:scheme:b', prefLabels: [{ text: 'B', lang: 'de' }] })])).toEqual([]);
	});

	it('empty-or-unprintable-label', () => {
		const found = only('empty-or-unprintable-label', [
			concept('A', { prefLabels: [{ text: '', lang: 'en' }] }),
			concept('B', { altLabels: [{ text: 'bad\u0007bell', lang: 'en' }] }),
			concept('C', { hiddenLabels: [{ text: '   ', lang: '' }] }),
			concept('D')
		]);
		expect(found.map((f) => f.elementIri).sort()).toEqual(['urn:c:A', 'urn:c:B', 'urn:c:C']);
	});

	it('duplicate-notation within a scheme only, and says it is an app convention', () => {
		const found = only('duplicate-notation', [
			concept('A', { notation: ['N1'] }), concept('B', { notation: ['N1', 'N2'] }),
			concept('C', { schemeIri: 'urn:scheme:b', notation: ['N1'] }), concept('D', { notation: ['N3'] })
		]);
		expect(found).toHaveLength(1);
		expect(found[0].message).toMatch(/convention of this app/i);
		expect(found[0].message).toContain('N1');
	});

	it('type-disjointness cites S9/S37', () => {
		const a = concept('A');
		const both = only('type-disjointness', [a, concept('S')], { schemes: [{ iri: 'urn:c:S' }] });
		expect(both).toHaveLength(1);
		expect(both[0].message).toContain('S9');
		const collConcept = only('type-disjointness', [a], { collections: [{ ...coll('X', []), iri: 'urn:c:A' }] });
		expect(collConcept).toHaveLength(1);
		expect(collConcept[0].message).toContain('S37');
		const collScheme = only('type-disjointness', [a], { collections: [coll('X', [])], schemes: [{ iri: 'urn:coll:X' }] });
		expect(collScheme).toHaveLength(1);
		expect(only('type-disjointness', [a], { collections: [coll('X', [])], schemes: [{ iri: 'urn:scheme:a' }] })).toEqual([]);
	});

	it('collection-member-invalid is labelled a convention', () => {
		const cs = [concept('A')];
		const found = only('collection-member-invalid', cs, { collections: [coll('X', ['urn:c:A', 'urn:coll:Y', 'urn:c:Missing']), coll('Y', [])] });
		expect(found).toHaveLength(1);
		expect(found[0].elementIri).toBe('urn:coll:X');
		expect(found[0].message).toMatch(/convention of this app/i);
		expect(found[0].message).toContain('urn:c:Missing');
	});
});
