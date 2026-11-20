import { describe, expect, it, vi } from 'vitest';
import type { Concept } from './skos-concept';
import {
	buildConceptOptions,
	conceptOptionEntries,
	conceptOptionsMoreKey,
	mergeKeptValues
} from './concept-value-options';

const concept = (id: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri: `http://example.org/core/vocab#${id}`,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [{ text: `alt ${label}`, lang: 'en' }],
	hiddenLabels: [{ text: `hidden ${label}`, lang: 'en' }],
	definitions: [{ text: 'd', lang: '' }], scopeNotes: [], notation: [], example: [], editorialNote: ['secret note'], disambiguation: '',
	schemeIri: 'http://example.org/core/vocab#Lifecycle', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', broader: [], related: [], mappings: [],
	...over
});

describe('buildConceptOptions (STORY-438)', () => {
	it('lists the concepts by preferred label and never a hidden label or editorial note', () => {
		const options = buildConceptOptions([concept('Planned', 'Planned'), concept('Active', 'Active')]);
		expect(options.map((o) => o.label)).toEqual(['Planned', 'Active']);
		const text = JSON.stringify(options);
		expect(text).not.toContain('hidden');
		expect(text).not.toContain('secret');
	});

	it('does not offer deprecated or retired concepts', () => {
		const options = buildConceptOptions([
			concept('A', 'A'),
			concept('B', 'B', { status: 'deprecated' }),
			concept('C', 'C', { status: 'retired' }),
			concept('D', 'D', { status: 'proposed' })
		]);
		expect(options.map((o) => o.label)).toEqual(['A', 'D']);
	});

	it('tells same-labelled concepts apart by notation, else by local name', () => {
		const options = buildConceptOptions([
			concept('Open1', 'Open', { notation: ['O-1'] }),
			concept('Open2', 'Open'),
			concept('Other', 'Other')
		]);
		expect(options.map((o) => o.label)).toEqual(['Open [O-1]', 'Open [Open2]', 'Other']);
		expect(new Set(options.map((o) => o.label)).size).toBe(3);
	});
});

describe('mergeKeptValues (STORY-438)', () => {
	const options = { f: [{ iri: 'urn:a', label: 'A' }] };

	it('keeps a value that is no longer offered, selectable under its own label', () => {
		const merged = mergeKeptValues(options, { f: [{ iri: 'urn:old', label: 'Old stage' }] });
		expect(merged.f).toEqual([{ iri: 'urn:a', label: 'A' }, { iri: 'urn:old', label: 'Old stage' }]);
	});

	it('adds nothing for a value already offered under the same label, and leaves other fields alone', () => {
		const merged = mergeKeptValues({ ...options, g: [] }, { f: [{ iri: 'urn:a', label: 'A' }] });
		expect(merged.f).toHaveLength(1);
		expect(merged.g).toEqual([]);
	});

	it('also lists an offered concept under the label the form shows for it', () => {
		const merged = mergeKeptValues(options, { f: [{ iri: 'urn:a', label: 'a' }] });
		expect(merged.f.map((o) => o.label)).toEqual(['A', 'a']);
	});

	it('does not touch fields without kept values', () => {
		expect(mergeKeptValues(options, {})).toBe(options);
	});
});

describe('conceptOptionEntries (STORY-438)', () => {
	const field = { iri: 'urn:field', valueSchemeIri: 'http://example.org/core/vocab#Lifecycle' };

	it('fetches the scheme from the vocabulary namespace and yields the options of the field', async () => {
		const connector = {
			fetchVocabularyNamespace: vi.fn(async () => 'http://example.org/core'),
			fetchConcepts: vi.fn(async () => ({ concepts: [concept('Planned', 'Planned')], hasMore: false }))
		};
		const entries = await conceptOptionEntries(connector, field);
		expect(connector.fetchConcepts).toHaveBeenCalledWith('http://example.org/core', { schemeIri: field.valueSchemeIri, limit: 1000 });
		expect(entries).toEqual([['urn:field', [{ iri: 'http://example.org/core/vocab#Planned', label: 'Planned' }]]]);
	});

	it('adds the limit marker when more concepts exist', async () => {
		const connector = {
			fetchVocabularyNamespace: async () => 'http://example.org/core',
			fetchConcepts: async () => ({ concepts: [concept('Planned', 'Planned')], hasMore: true })
		};
		const entries = await conceptOptionEntries(connector, field);
		expect(entries.map(([k]) => k)).toEqual(['urn:field', conceptOptionsMoreKey('urn:field')]);
	});

	it('yields no options without a vocabulary namespace', async () => {
		const connector = { fetchVocabularyNamespace: async () => null, fetchConcepts: vi.fn() };
		expect(await conceptOptionEntries(connector, field)).toEqual([['urn:field', []]]);
		expect(connector.fetchConcepts).not.toHaveBeenCalled();
	});
});
