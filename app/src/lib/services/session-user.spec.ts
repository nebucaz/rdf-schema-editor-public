import { describe, expect, it } from 'vitest';
import { toSessionUser } from './session-user';

describe('toSessionUser', () => {
	it('keeps every profile field from a full payload', () => {
		expect(
			toSessionUser({ sub: 'u1', displayName: 'Ada', email: 'ada@x.org', department: 'R&D', groups: ['a', 'b'] })
		).toEqual({ sub: 'u1', displayName: 'Ada', email: 'ada@x.org', department: 'R&D', groups: ['a', 'b'] });
	});

	it('defaults missing optional fields to empty values', () => {
		expect(toSessionUser({ sub: 'u1', displayName: 'Ada' })).toEqual({
			sub: 'u1',
			displayName: 'Ada',
			email: '',
			department: '',
			groups: []
		});
	});

	it('treats wrong types as missing', () => {
		const user = toSessionUser({ sub: 'u1', displayName: 'Ada', email: 5, department: null, groups: 'a,b' });
		expect(user).toMatchObject({ email: '', department: '', groups: [] });
	});

	it('drops non-string group entries', () => {
		expect(toSessionUser({ sub: 'u', displayName: 'n', groups: ['a', 3, null] })?.groups).toEqual(['a']);
	});

	it('returns null for a null or absent user', () => {
		expect(toSessionUser(null)).toBeNull();
		expect(toSessionUser(undefined)).toBeNull();
	});
});
