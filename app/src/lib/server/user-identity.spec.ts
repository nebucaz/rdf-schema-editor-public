import { describe, it, expect } from 'vitest';
import { readUserIdentity } from './user-identity';

const b64url = (v: unknown) =>
	Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const token = (payload: unknown, header: unknown = { alg: 'HS256', typ: 'JWT' }) =>
	`${b64url(header)}.${b64url(payload)}.sig`;

const NOW = 1_800_000_000_000; // ms

describe('readUserIdentity', () => {
	it('returns sub and uses name as displayName when present', () => {
		expect(readUserIdentity(token({ sub: 'alice', name: 'Alice Example' }), NOW)).toEqual({
			sub: 'alice',
			displayName: 'Alice Example'
		});
	});

	it('falls back to sub when there is no name', () => {
		expect(readUserIdentity(token({ sub: 'alice' }), NOW)).toEqual({ sub: 'alice', displayName: 'alice' });
		expect(readUserIdentity(token({ sub: 'alice', name: '  ' }), NOW)?.displayName).toBe('alice');
	});

	it('decodes UTF-8 names', () => {
		expect(readUserIdentity(token({ sub: 'u', name: 'Zoë Müller' }), NOW)?.displayName).toBe('Zoë Müller');
	});

	it('accepts an unexpired token and ignores one without exp', () => {
		expect(readUserIdentity(token({ sub: 'a', exp: NOW / 1000 + 60 }), NOW)).not.toBeNull();
		expect(readUserIdentity(token({ sub: 'a' }), NOW)).not.toBeNull();
	});

	it('returns null for an expired token', () => {
		expect(readUserIdentity(token({ sub: 'a', exp: NOW / 1000 - 1 }), NOW)).toBeNull();
	});

	it.each([
		['undefined', undefined],
		['empty', ''],
		['whitespace', '   '],
		['two segments', 'aaa.bbb'],
		['four segments', 'a.b.c.d'],
		['non-base64 payload', 'aaa.%%%.ccc'],
		['non-JSON payload', `aaa.${b64url('not json')}.ccc`],
		['JSON array payload', token([1, 2])],
		['missing sub', token({ name: 'x' })],
		['empty sub', token({ sub: '' })],
		['non-string sub', token({ sub: 5 })],
		['non-numeric exp', token({ sub: 'a', exp: 'soon' })],
		['oversized payload', token({ sub: 'a', pad: 'x'.repeat(20_000) })]
	])('returns null for %s', (_n, t) => {
		expect(readUserIdentity(t as string | undefined, NOW)).toBeNull();
	});
});
