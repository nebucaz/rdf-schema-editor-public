import { describe, expect, it } from 'vitest';
import type { Concept } from './skos-concept';
import { MAX_EXPANSION_TERMS, expandQuery, searchTerms } from './query-expansion';

const c = (iri: string, pref: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: pref, lang: 'en' }],
	altLabels: [],
	hiddenLabels: [],
	definition: '',
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

const staff = c('staff', 'Staff', { altLabels: [{ text: 'Personnel', lang: 'en' }], hiddenLabels: [{ text: 'Headcount', lang: 'en' }] });
const nurse = c('nurse', 'Nurse', { broader: ['staff'], altLabels: [{ text: 'Carer', lang: 'en' }] });
const icu = c('icu', 'ICU nurse', { broader: ['nurse'] });
const all = [staff, nurse, icu];
const terms = (r: ReturnType<typeof expandQuery>) => r.chips.map((x) => x.term);

describe('expandQuery', () => {
	it('resolves a synonym to the other labels of its concept', () => {
		const r = expandQuery(all, 'personnel', { narrower: false, broader: false });
		expect(terms(r)).toEqual(['Staff']);
	});
	it('adds narrower concepts one level by default, deeper on request', () => {
		expect(terms(expandQuery(all, 'staff', { narrower: true, broader: false })).sort()).toEqual(['Carer', 'Nurse', 'Personnel']);
		expect(terms(expandQuery(all, 'staff', { narrower: true, broader: false, depth: 2 }))).toContain('ICU nurse');
	});
	it('adds broader concepts only when asked', () => {
		expect(terms(expandQuery(all, 'nurse', { narrower: false, broader: false }))).toEqual(['Carer']);
		expect(terms(expandQuery(all, 'nurse', { narrower: false, broader: true }))).toContain('Staff');
	});
	it('uses hidden labels to resolve and to expand, but never lists them as chips', () => {
		const r = expandQuery(all, 'headcount', { narrower: false, broader: false });
		expect(terms(r).sort()).toEqual(['Personnel', 'Staff']);
		const viaSynonym = expandQuery(all, 'staff', { narrower: false, broader: false });
		expect(terms(viaSynonym)).not.toContain('Headcount');
		expect(searchTerms(viaSynonym, new Set())).toContain('Headcount');
	});
	it('returns nothing for an unknown term or without a vocabulary', () => {
		expect(expandQuery(all, 'zebra', { narrower: true, broader: true }).chips).toEqual([]);
		expect(expandQuery([], 'staff', { narrower: true, broader: true }).chips).toEqual([]);
	});
	it('caps the number of terms', () => {
		const kids = Array.from({ length: 40 }, (_, i) => c(`k${i}`, `Kid ${i}`, { broader: ['staff'] }));
		const r = expandQuery([staff, ...kids], 'staff', { narrower: true, broader: false });
		expect(searchTerms(r, new Set()).length).toBeLessThanOrEqual(MAX_EXPANSION_TERMS);
		expect(r.truncated).toBe(true);
	});
});

describe('searchTerms', () => {
	it('leaves out switched-off chips and the query itself', () => {
		const r = expandQuery(all, 'staff', { narrower: true, broader: false });
		const out = searchTerms(r, new Set(['nurse']));
		expect(out).not.toContain('Nurse');
		expect(out).not.toContain('Staff');
		expect(out).toContain('Personnel');
	});
});
