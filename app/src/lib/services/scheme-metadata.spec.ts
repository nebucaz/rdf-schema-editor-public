import { describe, expect, it } from 'vitest';
import { classifyAgent, emptySchemeMetadata, utcTimestamp, validateSchemeMetadata } from './scheme-metadata';

describe('scheme metadata (STORY-408)', () => {
	it('stamps dct:modified as a UTC ISO timestamp from an injected clock', () => {
		expect(utcTimestamp(new Date('2026-11-17T08:30:15.123+02:00'))).toBe('2026-11-17T06:30:15Z');
	});

	it('treats an absolute IRI as an IRI and anything else as a literal', () => {
		expect(classifyAgent(' https://example.org/org/data-office ')).toEqual({ kind: 'iri', value: 'https://example.org/org/data-office' });
		expect(classifyAgent('urn:org:data-office')).toEqual({ kind: 'iri', value: 'urn:org:data-office' });
		expect(classifyAgent('Data Office')).toEqual({ kind: 'literal', value: 'Data Office' });
		expect(classifyAgent('  ')).toBeNull();
	});

	it('refuses an IRI-looking creator or publisher that is not well formed', () => {
		const meta = { ...emptySchemeMetadata(), creator: 'http://x/> } DROP', publisher: 'https://ok.example/p' };
		expect(validateSchemeMetadata(meta)).toEqual(['Creator must be a well-formed IRI or plain text']);
		expect(validateSchemeMetadata({ ...emptySchemeMetadata(), creator: 'Ann', publisher: 'https://ok.example/p' })).toEqual([]);
	});

	it('an empty record is valid', () => {
		expect(validateSchemeMetadata(emptySchemeMetadata())).toEqual([]);
	});
});
