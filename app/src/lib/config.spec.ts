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
