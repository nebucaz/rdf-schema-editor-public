import { describe, expect, it } from 'vitest';
import { isUnclassifiedQueryTooShort, keysetAfter } from './unclassified-search';

describe('isUnclassifiedQueryTooShort', () => {
	it('is true only for a single character of text', () => {
		expect(isUnclassifiedQueryTooShort('a')).toBe(true);
		expect(isUnclassifiedQueryTooShort(' a ')).toBe(true);
	});

	it('is false for no text (browse everything) and for two or more characters', () => {
		expect(isUnclassifiedQueryTooShort('')).toBe(false);
		expect(isUnclassifiedQueryTooShort('   ')).toBe(false);
		expect(isUnclassifiedQueryTooShort('ab')).toBe(false);
	});
});

describe('keysetAfter', () => {
	it('is the label and IRI of the last row', () => {
		expect(
			keysetAfter([
				{ iri: 'urn:a', label: 'A' },
				{ iri: 'urn:b', label: 'B' }
			])
		).toEqual({ label: 'B', iri: 'urn:b' });
	});

	it('is undefined for an empty list', () => {
		expect(keysetAfter([])).toBeUndefined();
	});
});
