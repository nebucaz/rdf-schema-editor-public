import { describe, expect, it } from 'vitest';
import { conceptInVocabularyHref, parseTaxonomyUrlState, taxonomyHref } from './taxonomy-url-state';

const params = (s: string) => new URLSearchParams(s);

describe('parseTaxonomyUrlState', () => {
	it('defaults to the outline and no scheme', () => {
		expect(parseTaxonomyUrlState(params(''))).toEqual({ view: 'outline', scheme: '' });
	});
	it('reads view and scheme, and ignores an unknown view', () => {
		expect(parseTaxonomyUrlState(params('view=graph&scheme=urn%3As1'))).toEqual({ view: 'graph', scheme: 'urn:s1' });
		expect(parseTaxonomyUrlState(params('view=cube')).view).toBe('outline');
	});
});

describe('taxonomyHref', () => {
	it('keeps other parameters and leaves the default view with a clean URL', () => {
		expect(taxonomyHref('/taxonomy', params('x=1'), { view: 'graph', scheme: 'urn:s1' })).toBe('/taxonomy?x=1&view=graph&scheme=urn%3As1');
		expect(taxonomyHref('/taxonomy', params('view=graph'), { view: 'outline', scheme: '' })).toBe('/taxonomy');
	});
});

describe('conceptInVocabularyHref', () => {
	it('opens the concept on the Concepts tab', () => {
		expect(conceptInVocabularyHref('urn:c:a b')).toBe('/vocabulary?concept=urn%3Ac%3Aa%20b');
	});
});
