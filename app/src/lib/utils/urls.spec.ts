import { describe, expect, it } from 'vitest';
import { apiUrl, appUrl, createUrls } from './urls';

describe('createUrls with a base path and an API prefix', () => {
	const urls = createUrls({ appBasePath: '/path', apiPrefix: '/p' });

	it('apiUrl prefixes <prefix>/api', () => {
		expect(urls.apiUrl('/me')).toBe('/p/api/me');
		expect(urls.apiUrl('/sparql/update')).toBe('/p/api/sparql/update');
	});

	it('appUrl prefixes the base path and keeps query strings', () => {
		expect(urls.appUrl('/workbench?m=x')).toBe('/path/workbench?m=x');
		expect(urls.appUrl('/')).toBe('/path/');
		expect(urls.appUrl('/identities')).toBe('/path/identities');
	});

	it('absoluteAppUrl puts the origin in front of the app URL', () => {
		expect(urls.absoluteAppUrl('https://h.example', '/reports/Abc')).toBe('https://h.example/path/reports/Abc');
	});

	it('stripBase turns a browser pathname into an app route path', () => {
		expect(urls.stripBase('/path/workbench')).toBe('/workbench');
		expect(urls.stripBase('/path')).toBe('/');
		expect(urls.stripBase('/path/')).toBe('/');
		expect(urls.stripBase('/pathology')).toBe('/pathology');
		expect(urls.stripBase('/other')).toBe('/other');
	});

	it('rejects a path without a leading slash', () => {
		expect(() => urls.apiUrl('me')).toThrow(/leading/);
		expect(() => urls.appUrl('workbench')).toThrow(/leading/);
	});
});

describe('createUrls with empty settings (today\'s behaviour)', () => {
	const urls = createUrls({ appBasePath: '', apiPrefix: '' });

	it('is the identity for app paths and /api for the backend', () => {
		expect(urls.apiUrl('/me')).toBe('/api/me');
		expect(urls.appUrl('/workbench?x=1')).toBe('/workbench?x=1');
		expect(urls.absoluteAppUrl('https://h.example', '/workbench')).toBe('https://h.example/workbench');
		expect(urls.stripBase('/workbench')).toBe('/workbench');
	});
});

describe('default instance (build-time constants, empty under test)', () => {
	it('resolves with the injected settings', () => {
		expect(apiUrl('/me')).toBe(`${__API_PREFIX__}/api/me`);
		expect(appUrl('/workbench')).toBe(`${__APP_BASE_PATH__}/workbench`);
	});
});
