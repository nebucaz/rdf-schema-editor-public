import { describe, expect, it } from 'vitest';
import type { Concept } from './skos-concept';
import { alphabeticalList, glossaryLabel, glossaryTree, searchGlossary } from './glossary-search';

const c = (iri: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: iri, lang: 'en' }],
	altLabels: [],
	hiddenLabels: [],
	definition: 'd',
	scopeNote: '',
	disambiguation: '',
	schemeIri: 's',
	topConcept: false,
	status: 'active',
	source: '',
	authority: '',
	replacedBy: '',
	deprecationReason: '',
	created: '',
	modified: '',
	deprecatedOn: '',
	...over
});

const staff = c('Staff', { topConcept: true, altLabels: [{ text: 'Personnel', lang: 'en' }] });
const nurse = c('Nurse', { broader: ['Staff'], hiddenLabels: [{ text: 'Sister', lang: 'en' }], notation: ['N-01'] });
const all = [staff, nurse, c('Doctor', { broader: ['Staff'] })];

describe('searchGlossary', () => {
	it('matches preferred, alternative and hidden labels and notation, ignoring case and accents', () => {
		expect(searchGlossary(all, 'nurse').map((x) => x.iri)).toEqual(['Nurse']);
		expect(searchGlossary(all, 'PERSONNEL').map((x) => x.iri)).toEqual(['Staff']);
		expect(searchGlossary(all, 'sister').map((x) => x.iri)).toEqual(['Nurse']);
		expect(searchGlossary(all, 'n-01').map((x) => x.iri)).toEqual(['Nurse']);
	});
	it('returns everything for an empty query', () => {
		expect(searchGlossary(all, '  ')).toHaveLength(3);
	});
	it('does not search the definition or editorial notes', () => {
		const x = c('X', { definition: 'secretword', editorialNote: ['internalonly'] });
		expect(searchGlossary([x], 'secretword')).toEqual([]);
		expect(searchGlossary([x], 'internalonly')).toEqual([]);
	});
});

describe('glossaryLabel', () => {
	const x = c('X', { prefLabels: [{ text: 'Pflege', lang: 'de' }, { text: 'Care', lang: 'en' }] });
	it('prefers the wanted language, then English, then any', () => {
		expect(glossaryLabel(x, 'de')).toBe('Pflege');
		expect(glossaryLabel(x, 'fr')).toBe('Care');
		expect(glossaryLabel(c('Y', { prefLabels: [{ text: 'Soin', lang: 'fr' }] }), 'de')).toBe('Soin');
	});
});

describe('alphabeticalList and glossaryTree', () => {
	it('lists sorted by label', () => {
		expect(alphabeticalList(all).map((x) => x.iri)).toEqual(['Doctor', 'Nurse', 'Staff']);
	});
	it('the tree keeps ancestors of matches and holds the same concepts as the list', () => {
		const tree = glossaryTree(all, searchGlossary(all, 'sister'));
		expect(tree.map((n) => n.iri)).toEqual(['Staff']);
		expect(tree[0].children.map((n) => n.iri)).toEqual(['Nurse']);
		const full = glossaryTree(all, all);
		const flat = (ns: typeof full): string[] => ns.flatMap((n) => [n.iri, ...flat(n.children)]);
		expect(flat(full).sort()).toEqual(alphabeticalList(all).map((x) => x.iri).sort());
	});
});
