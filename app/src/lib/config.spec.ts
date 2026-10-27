import { describe, it, expect } from 'vitest';
import { namespaceGraphs, DEFAULT_NAMESPACE_BASE_IRI, SCHEMA_NAMESPACE, SHAPES_NAMESPACE } from './config';

describe('namespaceGraphs (STORY-025)', () => {
	it('derives instances/schema/shapes/catalog graphs from a base IRI with no trailing slash', () => {
		expect(namespaceGraphs('http://example.org/ns')).toEqual({
			instances: 'http://example.org/ns',
			schema: 'http://example.org/ns/schema',
			shapes: 'http://example.org/ns/shapes',
			catalog: 'http://example.org/ns/catalog'
		});
	});

	it('normalizes a trailing slash so no double-slash appears in the derived graphs', () => {
		expect(namespaceGraphs('http://example.org/ns/')).toEqual({
			instances: 'http://example.org/ns',
			schema: 'http://example.org/ns/schema',
			shapes: 'http://example.org/ns/shapes',
			catalog: 'http://example.org/ns/catalog'
		});
	});

	it('works for an https base IRI too', () => {
		expect(namespaceGraphs('https://example.org/gov')).toEqual({
			instances: 'https://example.org/gov',
			schema: 'https://example.org/gov/schema',
			shapes: 'https://example.org/gov/shapes',
			catalog: 'https://example.org/gov/catalog'
		});
	});

	it('reproduces the default namespace\'s existing schema/shapes namespace IRIs unchanged', () => {
		const graphs = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
		expect(`${graphs.schema}#`).toBe(SCHEMA_NAMESPACE);
		expect(`${graphs.shapes}#`).toBe(SHAPES_NAMESPACE);
	});
});

describe('loadRuntimeConfig (static-frontend STORY-011)', () => {
	const respond = (body: unknown, ok = true) =>
		(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as typeof fetch;

	it('takes the default namespace base IRI and devLoginEnabled from /api/config', async () => {
		const { loadRuntimeConfig } = await import('./config');
		const result = await loadRuntimeConfig(
			respond({ defaultNamespaceBaseIri: 'http://example.org/ns/schema#', devLoginEnabled: true })
		);
		expect(result).toEqual({ ok: true, defaultNamespaceBaseIri: 'http://example.org/ns', devLoginEnabled: true });
	});

	it('reports a failed request as an error', async () => {
		const { loadRuntimeConfig } = await import('./config');
		const result = await loadRuntimeConfig(respond({}, false));
		expect(result.ok).toBe(false);
	});

	it('reports a network failure or a malformed body as an error', async () => {
		const { loadRuntimeConfig } = await import('./config');
		const down = (async () => {
			throw new TypeError('offline');
		}) as unknown as typeof fetch;
		expect((await loadRuntimeConfig(down)).ok).toBe(false);
		expect((await loadRuntimeConfig(respond({ nope: 1 }))).ok).toBe(false);
	});
});
