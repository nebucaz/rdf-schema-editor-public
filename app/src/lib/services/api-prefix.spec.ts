import { describe, expect, it, vi } from 'vitest';

// Run every backend client with API_PREFIX=/p (STORY-007): the URLs they fetch must carry the prefix.
vi.mock('#lib/utils/urls.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/utils/urls.js')>();
	return { ...original, ...original.createUrls({ appBasePath: '/path', apiPrefix: '/p' }) };
});

import { loadRuntimeConfig } from '#lib/config.js';
import { deleteAnnotationRequest, postAnnotation } from './annotation-client';
import { devLogin, devLogout } from './auth-client';
import { fetchShortLinkModel } from './share-links';
import { SparqlConnector } from './sparql-connector';

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });
const urlOf = (fn: ReturnType<typeof vi.fn>) => String(fn.mock.calls[0][0]);

describe('backend clients honour API_PREFIX', () => {
	it('config', async () => {
		const f = vi.fn(async () => ok({ defaultNamespaceBaseIri: 'http://x/y' }));
		await loadRuntimeConfig(f as unknown as typeof fetch);
		expect(urlOf(f)).toBe('/p/api/config');
	});

	it('auth client', async () => {
		const f = vi.fn(async () => ok());
		await devLogin(f as unknown as typeof fetch);
		expect(urlOf(f)).toBe('/p/api/auth/dev-login');
		f.mockClear();
		await devLogout(f as unknown as typeof fetch);
		expect(urlOf(f)).toBe('/p/api/auth/logout');
	});

	it('annotation client', async () => {
		const f = vi.fn(async () => ok({ iri: 'urn:a', annotatedBy: 'u', annotatedAt: 't' }));
		await postAnnotation(f as unknown as typeof fetch, {} as never, {} as never).catch(() => undefined);
		expect(urlOf(f)).toBe('/p/api/annotations');
		f.mockClear();
		await deleteAnnotationRequest(f as unknown as typeof fetch, 'urn:a').catch(() => undefined);
		expect(urlOf(f)).toBe('/p/api/annotations');
	});

	it('short links', async () => {
		const f = vi.fn(async () => ok({}));
		await fetchShortLinkModel('aZ09aZ09aZ', f as unknown as typeof fetch);
		expect(urlOf(f)).toBe('/p/api/shared-queries/aZ09aZ09aZ');
	});

	it('SPARQL connector (default endpoint, query and update)', async () => {
		const f = vi.fn(async () => ok({ head: { vars: [] }, results: { bindings: [] } }));
		vi.stubGlobal('fetch', f);
		try {
			const connector = new SparqlConnector();
			await (connector as unknown as { executeQuery(q: string): Promise<unknown> })
				.executeQuery('SELECT * WHERE {}')
				.catch(() => undefined);
			expect(urlOf(f)).toBe('/p/api/sparql');
			f.mockClear();
			await (connector as unknown as { executeUpdate(q: string): Promise<void> })
				.executeUpdate('INSERT DATA {}')
				.catch(() => undefined);
			expect(urlOf(f)).toBe('/p/api/sparql/update');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
