import { describe, expect, it } from 'vitest';
import { changeKindForConceptEdit, classCreatedEntry, classDeletedEntry, classEditEntries, conceptChangeSummary, relationEntry } from './change-log';
import type { Concept } from './skos-concept';

const concept = (over: Partial<Concept> = {}): Concept => ({
	iri: 'urn:c:Bank',
	prefLabels: [{ text: 'Bank', lang: 'en' }], altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '',
	disambiguation: '', schemeIri: 's', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', ...over
});

describe('changeKindForConceptEdit (STORY-331)', () => {
	it('is a label change when only labels changed', () => {
		const before = concept();
		expect(changeKindForConceptEdit(before, { ...before, altLabels: [{ text: 'Credit house', lang: 'en' }] })).toBe('label');
	});

	it('is a comment change when texts changed', () => {
		const before = concept();
		expect(changeKindForConceptEdit(before, { ...before, definition: 'new' })).toBe('comment');
		expect(changeKindForConceptEdit(before, { ...before, scopeNote: 'n' })).toBe('comment');
	});

	it('is other for structure, and the label wins over nothing', () => {
		const before = concept();
		expect(changeKindForConceptEdit(before, { ...before, schemeIri: 't' })).toBe('other');
		expect(changeKindForConceptEdit(before, before)).toBe('other');
	});
});

describe('conceptChangeSummary', () => {
	it('names the action and the concept', () => {
		expect(conceptChangeSummary('added', concept())).toBe('Added concept "Bank"');
		expect(conceptChangeSummary('edited', concept())).toBe('Edited concept "Bank"');
	});
});

describe('class change entries (STORY-331)', () => {
	const iri = 'http://e#Customer';

	it('records a creation as an addition with the rationale', () => {
		expect(classCreatedEntry(iri, 'Customer', 'CQ-2')).toEqual({
			kind: 'change', summary: 'Added class "Customer"', rationale: 'CQ-2', term: iri, changeKind: 'addition'
		});
	});

	it('records a deletion as a removal', () => {
		expect(classDeletedEntry(iri, 'Customer', '')).toMatchObject({ summary: 'Deleted class "Customer"', changeKind: 'removal', term: iri });
	});

	it('records a rename and a description change separately', () => {
		const entries = classEditEntries(iri, { name: 'Client', description: 'a' }, { name: 'Customer', description: 'b' }, 'why');
		expect(entries.map((e) => e.changeKind)).toEqual(['rename', 'comment']);
		expect(entries[0].summary).toBe('Renamed class "Client" to "Customer"');
		expect(entries.every((e) => e.rationale === 'why' && e.term === iri)).toBe(true);
	});

	it('records nothing when nothing changed', () => {
		expect(classEditEntries(iri, { name: 'A', description: 'd' }, { name: 'A', description: 'd' }, '')).toEqual([]);
	});
});

describe('relationEntry', () => {
	it('records an added or removed relation of a concept', () => {
		const c = concept();
		expect(relationEntry('added', c, 'exactMatch', 'http://x/Bank', 'r')).toEqual({
			kind: 'change', summary: 'Added exactMatch from concept "Bank" to http://x/Bank', rationale: 'r', term: c.iri, changeKind: 'addition'
		});
		expect(relationEntry('removed', c, 'related', 'urn:c:Lender', '').changeKind).toBe('removal');
	});
});
