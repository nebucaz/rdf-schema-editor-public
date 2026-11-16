import { describe, expect, it } from 'vitest';
import {
	buildIdentitySearchUrl,
	createSearchSequence,
	parseIdentitySearchParams,
	PushedSearches
} from './identity-search-url';

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

describe('createSearchSequence', () => {
	it('only the newest ticket is current', () => {
		const seq = createSearchSequence();
		const a = seq.next();
		expect(seq.isCurrent(a)).toBe(true);
		const b = seq.next();
		expect(seq.isCurrent(a)).toBe(false);
		expect(seq.isCurrent(b)).toBe(true);
	});
});

describe('PushedSearches', () => {
	it('skips the URL the page pushed itself, once', () => {
		const pushed = new PushedSearches();
		pushed.add(buildIdentitySearchUrl({ query: 'ab' }));
		expect(pushed.consume('?q=ab')).toBe(true);
		expect(pushed.consume('?q=ab')).toBe(false);
	});

	it('late URL of an older term is still recognised as ours after a newer push', () => {
		const pushed = new PushedSearches();
		pushed.add(buildIdentitySearchUrl({ query: 'ab' }));
		pushed.add(buildIdentitySearchUrl({ query: 'abc' }));
		expect(pushed.consume('?q=ab')).toBe(true);
		expect(pushed.consume('?q=abc')).toBe(true);
	});

	it('does not skip an external URL (deep link, Back/Forward)', () => {
		const pushed = new PushedSearches();
		pushed.add(buildIdentitySearchUrl({ query: 'ab' }));
		expect(pushed.consume('?q=zzz')).toBe(false);
	});

	it('ignores a push of the URL that is already current', () => {
		const pushed = new PushedSearches();
		pushed.add(buildIdentitySearchUrl({ query: 'ab' }), '?q=ab');
		expect(pushed.consume('?q=ab')).toBe(false);
	});

	it('forgets old pushes beyond its cap', () => {
		const pushed = new PushedSearches(2);
		for (const q of ['a', 'b', 'c']) pushed.add(buildIdentitySearchUrl({ query: q }));
		expect(pushed.consume('?q=a')).toBe(false);
		expect(pushed.consume('?q=c')).toBe(true);
	});
});
