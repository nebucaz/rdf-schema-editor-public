import { describe, expect, it } from 'vitest';
import { buildExportFiles, DEFAULT_EXPORT_SETTINGS } from './skos-export-actions';
import { SCHEME, fixtureVocabulary } from './skos-fixture';
import { SKOS_SHAPES_TURTLE } from './skos-shapes';

const now = new Date('2026-11-17T10:00:00Z');

describe('buildExportFiles (STORY-414)', () => {
	it('exports one scheme as Turtle with a name carrying the scheme and the date', () => {
		const [file, ...rest] = buildExportFiles(fixtureVocabulary(), { ...DEFAULT_EXPORT_SETTINGS, schemeIri: SCHEME }, now);
		expect(file.name).toBe('workforce-2026-11-17.ttl');
		expect(file.mime).toBe('text/turtle');
		expect(file.content).toContain('Workforce thesaurus');
		expect(file.content).not.toContain('Cafeteria');
		expect(rest).toEqual([]);
	});

	it('exports every scheme under a vocabulary name', () => {
		const [file] = buildExportFiles(fixtureVocabulary(), DEFAULT_EXPORT_SETTINGS, now);
		expect(file.name).toBe('vocabulary-2026-11-17.ttl');
		expect(file.content).toContain('Cafeteria');
	});

	it('adds the shapes as a companion file only with Turtle', () => {
		const files = buildExportFiles(fixtureVocabulary(), { ...DEFAULT_EXPORT_SETTINGS, schemeIri: SCHEME, includeShapes: true }, now);
		expect(files.map((f) => f.name)).toEqual(['workforce-2026-11-17.ttl', 'workforce-2026-11-17.shapes.ttl']);
		expect(files[1].content).toBe(SKOS_SHAPES_TURTLE);
		const csv = buildExportFiles(fixtureVocabulary(), { ...DEFAULT_EXPORT_SETTINGS, format: 'csv', schemeIri: SCHEME, includeShapes: true }, now);
		expect(csv.map((f) => f.name)).toEqual(['workforce-2026-11-17.csv']);
		expect(csv[0].mime).toBe('text/csv;charset=utf-8');
		expect(csv[0].content.startsWith('﻿scheme,iri')).toBe(true);
	});

	it('passes the Turtle options through, and ignores them for CSV', () => {
		const withNotes = buildExportFiles(fixtureVocabulary(), { ...DEFAULT_EXPORT_SETTINGS, schemeIri: SCHEME, includeEditorialNotes: true }, now)[0];
		expect(withNotes.content).toContain('Check the HR wording');
		const csv = buildExportFiles(fixtureVocabulary(), { ...DEFAULT_EXPORT_SETTINGS, format: 'csv', includeEditorialNotes: true }, now)[0];
		expect(csv.content).not.toContain('Check the HR wording');
	});
});
