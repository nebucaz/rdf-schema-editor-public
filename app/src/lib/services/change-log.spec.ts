import { describe, expect, it } from 'vitest';
import type { ChangeLogItem } from './change-log';
import { conceptHistory, changeKindForConceptEdit, classCreatedEntry, classDeletedEntry, classEditEntries, conceptChangeSummary, relationEntry } from './change-log';
import type { Concept } from './skos-concept';

const concept = (over: Partial<Concept> = {}): Concept => ({
	iri: 'urn:c:Bank',
	prefLabels: [{ text: 'Bank', lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [],
	disambiguation: '', schemeIri: 's', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', ...over
});

describe('changeKindForConceptEdit (STORY-331)', () => {
	it('is a label change when only labels changed', () => {
		const before = concept();
		expect(changeKindForConceptEdit(before, { ...before, altLabels: [{ text: 'Credit house', lang: 'en' }] })).toBe('label');
	});

	it('is a comment change when only the linked business unit changed', () => {
		const before = { ...concept(), authority: 'Data Office', authorityIri: 'urn:bu:a' };
		expect(changeKindForConceptEdit(before, { ...before, authorityIri: 'urn:bu:b' })).toBe('comment');
	});

	it('is a comment change when texts changed', () => {
		const before = concept();
		expect(changeKindForConceptEdit(before, { ...before, definitions: [{ text: 'new', lang: '' }] })).toBe('comment');
		expect(changeKindForConceptEdit(before, { ...before, scopeNotes: [{ text: 'n', lang: '' }] })).toBe('comment');
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

describe('conceptHistory (STORY-407)', () => {
	const item = (over: Partial<ChangeLogItem>): ChangeLogItem => ({
		iri: 'urn:e', kind: 'change', summary: 's', rationale: '', term: 'urn:c:Bank', question: '', changeKind: '',
		version: '1.0.0', changedBy: 'ann', changedAt: '2026-11-01T10:00:00Z', ...over
	});

	it('keeps the entries about the concept, newest first, as who, when, version and summary', () => {
		const history = conceptHistory(
			[
				item({ iri: 'a', summary: 'Added concept "Bank"', changedAt: '2026-11-01T10:00:00Z' }),
				item({ iri: 'b', summary: 'Edited concept "Bank"', changedBy: 'bo', changedAt: '2026-11-05T09:00:00Z', version: '1.1.0' }),
				item({ iri: 'c', term: 'urn:c:Other', summary: 'other' }),
				item({ iri: 'd', term: '', kind: 'release', summary: 'Release 1.1.0' })
			],
			'urn:c:Bank'
		);
		expect(history).toEqual([
			{ summary: 'Edited concept "Bank"', changedBy: 'bo', changedAt: '2026-11-05T09:00:00Z', version: '1.1.0' },
			{ summary: 'Added concept "Bank"', changedBy: 'ann', changedAt: '2026-11-01T10:00:00Z', version: '1.0.0' }
		]);
	});

	it('is empty when nothing was logged', () => {
		expect(conceptHistory([], 'urn:c:Bank')).toEqual([]);
	});
});
