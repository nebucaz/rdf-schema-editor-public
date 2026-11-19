import { describe, expect, it } from 'vitest';
import { joinValues, splitValues, formatRef, parseRef } from './skos-csv-format';
import { serializeSkosCsv } from './skos-export-csv';
import { FIXTURE_BASE, SCHEME, fixtureVocabulary } from './skos-fixture';
import type { Concept } from './skos-concept';

const c = (id: string) => `${FIXTURE_BASE}#${id}`;
const rows = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('value lists (STORY-412)', () => {
	it('joins with ; and escapes a literal ; and backslash so the list survives a round trip', () => {
		const values = ['a;b', 'c\\d', 'plain', 'e;'];
		expect(joinValues(values)).toBe('a\\;b;c\\\\d;plain;e\\;');
		expect(splitValues(joinValues(values))).toEqual(values);
		expect(splitValues('')).toEqual([]);
		expect(splitValues(' x ; y ')).toEqual(['x', 'y']);
	});

	it('writes a reference as label <iri> and reads it back', () => {
		expect(formatRef('Employee', 'urn:x#E')).toBe('Employee <urn:x#E>');
		expect(parseRef('Employee <urn:x#E>')).toEqual({ label: 'Employee', iri: 'urn:x#E' });
		expect(parseRef('Employee')).toEqual({ label: 'Employee', iri: '' });
		expect(parseRef('<urn:x#E>')).toEqual({ label: '', iri: 'urn:x#E' });
	});
});

describe('serializeSkosCsv (STORY-412)', () => {
	const csv = serializeSkosCsv(fixtureVocabulary(), { schemeIri: SCHEME });

	it('starts with a BOM, uses CRLF and puts the columns in the documented order', () => {
		expect(csv.startsWith('﻿')).toBe(true);
		expect(rows(csv)[0]).toBe('scheme,iri,notation,prefLabel@en,definition,altLabel@en,hiddenLabel@en,broader,related');
	});

	it('exports one row per concept of the scheme only', () => {
		const lines = rows(csv);
		expect(lines).toHaveLength(1 + 5);
		expect(csv).not.toContain('Cafeteria');
	});

	it('separates multiple values with ; and lists the broader reference with its IRI', () => {
		const manager = rows(csv).find((l) => l.includes('Manager'))!;
		expect(manager).toContain(`Employee <${c('Employee')}>`);
		const employee = rows(csv).find((l) => l.includes('E-1'))!;
		expect(employee).toContain('Staff member');
	});

	it('lists each concept\'s related concepts, so both halves of a pair appear', () => {
		const lines = rows(csv);
		expect(lines.find((l) => l.startsWith('Workforce,' + c('Manager')))).toContain(`Consultant <${c('Consultant')}>`);
		expect(lines.find((l) => l.startsWith('Workforce,' + c('Consultant')))).toContain(`Manager <${c('Manager')}>`);
	});

	it('quotes commas, quotes and newlines and neutralises formula cells', () => {
		const vocab = fixtureVocabulary();
		const tricky: Concept = { ...vocab.concepts[0], iri: c('Tricky'), prefLabels: [{ text: '=SUM(A1)', lang: 'en' }], definition: 'Says "hi", then\nbreaks', altLabels: [{ text: 'a;b', lang: 'en' }, { text: 'c', lang: 'en' }], notation: [], broader: [], related: [] };
		const out = serializeSkosCsv({ ...vocab, concepts: [tricky] }, {});
		expect(out).toContain("'=SUM(A1)");
		expect(out).toContain('"Says ""hi"", then\nbreaks"');
		expect(out).toContain('a\\;b;c');
	});

	it('adds one column per language for labels, in sorted order', () => {
		const vocab = fixtureVocabulary();
		vocab.concepts[0] = { ...vocab.concepts[0], prefLabels: [...vocab.concepts[0].prefLabels, { text: 'Mitarbeiter', lang: 'de' }] };
		const header = rows(serializeSkosCsv(vocab, { schemeIri: SCHEME }))[0];
		expect(header).toBe('scheme,iri,notation,prefLabel@de,prefLabel@en,definition,altLabel@en,hiddenLabel@en,broader,related');
	});

	it('the full export has one row per concept with its scheme', () => {
		const full = rows(serializeSkosCsv(fixtureVocabulary(), {}));
		expect(full).toHaveLength(1 + 6);
		expect(full.some((l) => l.startsWith('Facilities,'))).toBe(true);
	});
});
