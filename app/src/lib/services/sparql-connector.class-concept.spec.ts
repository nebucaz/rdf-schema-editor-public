import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '#lib/config.js';
import { CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI } from '#lib/utils/iri.js';

const DEFAULT_GRAPHS = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);
const GOV = 'http://example.org/gov';
const GOV_GRAPHS = namespaceGraphs(GOV);
const CLS = `${GOV}/schema#Person`;
const CONCEPT = 'http://example.org/core/vocab#Customer';

function mockFetch(fixture: { propertyDeclared?: boolean } = {}) {
	const updates: string[] = [];
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		queries.push(body.query);
		return new Response(JSON.stringify({ head: {}, boolean: fixture.propertyDeclared ?? false }), { status: 200 });
	});
	return { fn, updates, queries };
}

describe('SparqlConnector — class to concept link (STORY-325)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('declares the predicate once, as a sub-property of rdfs:isDefinedBy, with a maxCount 1 shape', async () => {
		const { fn, updates } = mockFetch({ propertyDeclared: false });
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await connector.setClassConcept(CLS, CONCEPT, GOV);
		await connector.setClassConcept(CLS, CONCEPT, GOV);

		const declarations = updates.filter((u) => u.includes('owl:ObjectProperty'));
		expect(declarations).toHaveLength(1);
		expect(declarations[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.schema}>`);
		expect(declarations[0]).toContain(`<${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> a owl:ObjectProperty`);
		expect(declarations[0]).toContain('rdfs:subPropertyOf rdfs:isDefinedBy');
		expect(declarations[0]).toContain(`GRAPH <${DEFAULT_GRAPHS.shapes}>`);
		expect(declarations[0]).toContain('sh:maxCount 1');
		expect(declarations[0]).toContain(`sh:path <${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}>`);
	});

	it('does not redeclare a predicate that already exists', async () => {
		const { fn, updates } = mockFetch({ propertyDeclared: true });
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').setClassConcept(CLS, CONCEPT, GOV);
		expect(updates.filter((u) => u.includes('owl:ObjectProperty'))).toHaveLength(0);
	});

	it('sets the link in the class own schema graph, replacing any earlier one in the same request', async () => {
		const { fn, updates } = mockFetch({ propertyDeclared: true });
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').setClassConcept(CLS, CONCEPT, GOV);

		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`WITH <${GOV_GRAPHS.schema}>`);
		expect(u).toContain(`DELETE { <${CLS}> <${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> ?old }`);
		expect(u).toContain(`INSERT { <${CLS}> <${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> <${CONCEPT}> }`);
	});

	it('clears the link with null', async () => {
		const { fn, updates } = mockFetch({ propertyDeclared: true });
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').setClassConcept(CLS, null, GOV);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`DELETE WHERE`);
		expect(updates[0]).toContain(`GRAPH <${GOV_GRAPHS.schema}>`);
		expect(updates[0]).toContain(`<${CLS}> <${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> ?old`);
	});

	it('refuses an unsafe class or concept IRI before any request', async () => {
		const { fn } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.setClassConcept('http://x/> } DROP', CONCEPT, GOV)).rejects.toThrow();
		await expect(connector.setClassConcept(CLS, 'http://x/> } DROP', GOV)).rejects.toThrow();
		expect(fn).not.toHaveBeenCalled();
	});
});
