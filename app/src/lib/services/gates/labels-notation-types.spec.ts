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
	altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [], disambiguation: '',
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

	it('invalid-language-tag also covers definitions and scope notes (STORY-485)', () => {
		const bad = only('invalid-language-tag', [
			concept('A', { definitions: [{ text: 'd', lang: 'english_US' }] }),
			concept('B', { scopeNotes: [{ text: 's', lang: 'de_DE' }] })
		]);
		expect(bad.map((f) => f.elementIri).sort()).toEqual(['urn:c:A', 'urn:c:B']);
	});

	describe('incomplete-language-coverage (STORY-485)', () => {
		const full = (id: string) =>
			concept(id, {
				prefLabels: [{ text: id, lang: 'en' }, { text: id + 'de', lang: 'de' }],
				definitions: [{ text: 'd', lang: 'en' }, { text: 'd', lang: 'de' }]
			});

		it('reports a concept once, naming each language and what is missing', () => {
			const lacking = concept('B', { prefLabels: [{ text: 'B', lang: 'en' }], definitions: [{ text: 'd', lang: 'en' }] });
			const noDef = concept('C', {
				prefLabels: [{ text: 'C', lang: 'en' }, { text: 'Cde', lang: 'de' }],
				definitions: [{ text: 'd', lang: 'en' }]
			});
			const found = only('incomplete-language-coverage', [full('A'), lacking, noDef]);
			expect(found.map((f) => f.elementIri).sort()).toEqual(['urn:c:B', 'urn:c:C']);
			expect(found.every((f) => f.severity === 'info')).toBe(true);
			expect(found.find((f) => f.elementIri === 'urn:c:B')!.message).toMatch(/de.*preferred label.*definition/);
			expect(found.find((f) => f.elementIri === 'urn:c:C')!.message).toMatch(/de.*definition/);
			expect(found.find((f) => f.elementIri === 'urn:c:C')!.message).not.toMatch(/preferred label/);
		});

		it('is quiet for a complete scheme, a one-language scheme and a schemeless concept', () => {
			expect(only('incomplete-language-coverage', [full('A'), full('B')])).toEqual([]);
			expect(only('incomplete-language-coverage', [concept('A'), concept('B', { definitions: [] })])).toEqual([]);
			const loose = concept('L', { schemeIri: '', prefLabels: [{ text: 'L', lang: 'en' }] });
			expect(only('incomplete-language-coverage', [full('A'), loose])).toEqual([]);
		});

		it('keeps schemes apart and opens the concept', () => {
			const other = concept('Z', { schemeIri: 'urn:scheme:b' });
			const found = only('incomplete-language-coverage', [full('A'), other, concept('Y', { schemeIri: 'urn:scheme:b' })]);
			expect(found).toEqual([]);
			const lacking = concept('B', { definitions: [{ text: 'd', lang: 'en' }] });
			const f = only('incomplete-language-coverage', [full('A'), lacking]);
			expect(gateFindingLink(f[0], schema)).toContain('/vocabulary?concept=');
		});
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
