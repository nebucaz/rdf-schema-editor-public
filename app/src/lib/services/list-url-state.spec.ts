import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST_STATE, listStateHref, parseListUrlState, patchListState, withListState } from './list-url-state';

const params = (q: string) => new URLSearchParams(q);

describe('parseListUrlState', () => {
	it('returns the defaults for an empty query', () => {
		expect(parseListUrlState(params(''))).toEqual({ tab: 'concepts', q: '', page: 1, scheme: '', status: '' });
	});
	it('reads tab, q, page and scheme', () => {
		expect(parseListUrlState(params('tab=schemes&q=bank&page=3&scheme=urn%3As1&status=active'))).toEqual({
			tab: 'schemes', q: 'bank', page: 3, scheme: 'urn:s1', status: 'active'
		});
	});
	it('falls back to the first tab for an unknown tab', () => {
		expect(parseListUrlState(params('tab=nope')).tab).toBe('concepts');
	});
	it('ignores an unknown status', () => {
		expect(parseListUrlState(params('status=bogus')).status).toBe('');
	});
	it('ignores a malformed page', () => {
		for (const bad of ['abc', '0', '-2', '1.5', '', '1e3', ' ']) {
			expect(parseListUrlState(params(`page=${encodeURIComponent(bad)}`)).page).toBe(1);
		}
	});
});

describe('withListState', () => {
	it('drops defaults so the default view has a clean URL', () => {
		expect(withListState(params('tab=schemes&q=x&page=2&scheme=s'), DEFAULT_LIST_STATE).toString()).toBe('');
	});
	it('writes non-default values and keeps unrelated parameters', () => {
		const next = withListState(params('concept=urn%3Ac1'), { tab: 'collections', q: 'a b', page: 2, scheme: 'urn:s1', status: 'proposed' });
		expect(next.get('concept')).toBe('urn:c1');
		expect(next.get('tab')).toBe('collections');
		expect(next.get('q')).toBe('a b');
		expect(next.get('page')).toBe('2');
		expect(next.get('scheme')).toBe('urn:s1');
		expect(next.get('status')).toBe('proposed');
	});
	it('round-trips through parse', () => {
		const state = { tab: 'schemes' as const, q: 'ünï & co', page: 7, scheme: 'http://x/y#z', status: 'deprecated' as const };
		expect(parseListUrlState(new URLSearchParams(withListState(params(''), state).toString()))).toEqual(state);
	});
	it('does not mutate its input', () => {
		const input = params('page=4');
		withListState(input, DEFAULT_LIST_STATE);
		expect(input.get('page')).toBe('4');
	});
});

describe('patchListState', () => {
	const base = { tab: 'concepts' as const, q: 'bank', page: 4, scheme: '', status: '' as const };
	it('resets the page when the search, the scheme or the tab changes', () => {
		expect(patchListState(base, { q: 'cash' }).page).toBe(1);
		expect(patchListState(base, { scheme: 'urn:s1' }).page).toBe(1);
		expect(patchListState(base, { tab: 'schemes' }).page).toBe(1);
		expect(patchListState(base, { status: 'active' }).page).toBe(1);
	});
	it('keeps an explicit page and a patch that changes nothing', () => {
		expect(patchListState(base, { page: 2 }).page).toBe(2);
		expect(patchListState(base, { q: 'bank' }).page).toBe(4);
	});
});

describe('listStateHref', () => {
	it('builds an app-relative href from a path, the current query and the state', () => {
		expect(listStateHref('/vocabulary', params('concept=urn%3Ac1'), { ...DEFAULT_LIST_STATE, tab: 'schemes' })).toBe(
			'/vocabulary?concept=urn%3Ac1&tab=schemes'
		);
		expect(listStateHref('/vocabulary', params('tab=schemes'), DEFAULT_LIST_STATE)).toBe('/vocabulary');
	});
});
