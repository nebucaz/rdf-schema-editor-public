import { describe, expect, it } from 'vitest';
import { apiProxyKey, apiProxyRewrite, normalizeBasePath } from './base-paths';

describe('normalizeBasePath', () => {
	it('treats unset and empty as no prefix', () => {
		expect(normalizeBasePath(undefined, 'APP_BASE_PATH')).toBe('');
		expect(normalizeBasePath('', 'APP_BASE_PATH')).toBe('');
		expect(normalizeBasePath('   ', 'APP_BASE_PATH')).toBe('');
		expect(normalizeBasePath('/', 'APP_BASE_PATH')).toBe('');
	});

	it('keeps a leading slash and drops a trailing one', () => {
		expect(normalizeBasePath('/path', 'APP_BASE_PATH')).toBe('/path');
		expect(normalizeBasePath('/path/', 'APP_BASE_PATH')).toBe('/path');
		expect(normalizeBasePath('path', 'APP_BASE_PATH')).toBe('/path');
		expect(normalizeBasePath(' /a/b-c_d.e/ ', 'APP_BASE_PATH')).toBe('/a/b-c_d.e');
	});

	it.each(['//x', '/a//b', 'http://host/x', '/a b', '/a/../b', '/./a', '/a?x=1', '/a#f', '/a\\b', '/%2e%2e'])(
		'rejects %j and names the variable',
		(raw) => {
			expect(() => normalizeBasePath(raw, 'API_PREFIX')).toThrow(/API_PREFIX/);
		}
	);
});

describe('dev proxy helpers', () => {
	it('keys the proxy on <prefix>/api', () => {
		expect(apiProxyKey('')).toBe('/api');
		expect(apiProxyKey('/p')).toBe('/p/api');
	});

	it('strips <prefix>/api before forwarding to the backend', () => {
		expect(apiProxyRewrite('')('/api/me')).toBe('/me');
		expect(apiProxyRewrite('/p')('/p/api/sparql/update')).toBe('/sparql/update');
		expect(apiProxyRewrite('/p')('/p/api/me?x=1')).toBe('/me?x=1');
		expect(apiProxyRewrite('/p')('/other/api/me')).toBe('/other/api/me');
	});
});
