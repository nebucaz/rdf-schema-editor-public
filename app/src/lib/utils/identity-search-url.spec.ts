import { describe, expect, it } from 'vitest';
import { buildIdentitySearchUrl, parseIdentitySearchParams } from './identity-search-url';

describe('parseIdentitySearchParams', () => {
	it('defaults every field to empty/null on a bare/empty search string', () => {
		expect(parseIdentitySearchParams('')).toEqual({
			query: '',
			classIri: null,
			namespaceBaseIri: null,
			syncSource: null,
			syncStatus: null,
			node: null
		});
	});

	it('reads every param, with or without a leading "?"', () => {
		const search =
			'?q=alice&class=http%3A%2F%2Fex.org%23Person&ns=http%3A%2F%2Fex.org&source=backstage&status=stale&node=http%3A%2F%2Fex.org%23alice';
		expect(parseIdentitySearchParams(search)).toEqual({
			query: 'alice',
			classIri: 'http://ex.org#Person',
			namespaceBaseIri: 'http://ex.org',
			syncSource: 'backstage',
			syncStatus: 'stale',
			node: 'http://ex.org#alice'
		});
		expect(parseIdentitySearchParams(search.slice(1))).toEqual(parseIdentitySearchParams(search));
	});

	it('leaves an omitted param as null, not undefined', () => {
		const parsed = parseIdentitySearchParams('?q=alice');
		expect(parsed.classIri).toBeNull();
		expect(parsed.node).toBeNull();
	});
});

describe('buildIdentitySearchUrl', () => {
	it('returns the bare route path when every field is empty', () => {
		expect(buildIdentitySearchUrl({})).toBe('/identities');
	});

	it('omits empty-string/null fields, keeping only set ones', () => {
		expect(buildIdentitySearchUrl({ query: 'alice', classIri: null, node: null })).toBe(
			'/identities?q=alice'
		);
	});

	it('round-trips through parseIdentitySearchParams', () => {
		const params = {
			query: 'alice',
			classIri: 'http://ex.org#Person',
			namespaceBaseIri: 'http://ex.org',
			syncSource: 'backstage',
			syncStatus: 'stale',
			node: 'http://ex.org#alice'
		};
		const url = buildIdentitySearchUrl(params);
		const [, search] = url.split('?');
		expect(parseIdentitySearchParams(search)).toEqual(params);
	});
});
