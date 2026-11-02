import { describe, expect, it, vi } from 'vitest';
import { addableElementsFromSchema } from './addable-elements';
import { SparqlConnector, type FetchedSchema } from './sparql-connector';

const NS = 'https://example.com/core';

/** Shared fixture: classes, an attribute, a relation, individuals (one repeated IRI as class + individual). */
const schema = {
	classes: [
		{ iri: 'urn:Person', label: 'Person', comment: null, namespaceBaseIri: NS },
		{ iri: 'urn:Org', label: 'Org', comment: null, namespaceBaseIri: NS },
		{ iri: 'urn:Dup', label: 'Dup as class', comment: null, namespaceBaseIri: NS }
	],
	datatypeProperties: [
		{ iri: 'urn:name', label: 'name', domain: 'urn:Person', range: 'xsd:string', namespaceBaseIri: NS, required: false, repeatable: false }
	],
	objectProperties: [
		{ iri: 'urn:worksFor', label: 'worksFor', domain: 'urn:Person', range: 'urn:Org', namespaceBaseIri: NS, required: false, repeatable: false, relationKind: 'specific' }
	],
	subClassOf: [],
	individuals: [
		{ iri: 'urn:ada', label: 'Ada', classIri: 'urn:Person', namespaceBaseIri: NS, syncSource: null, syncStatus: null },
		{ iri: 'urn:Dup', label: 'Dup as individual', classIri: 'urn:Org', namespaceBaseIri: NS, syncSource: null, syncStatus: null }
	],
	individualClassRelations: [],
	individualIndividualRelations: []
} as unknown as FetchedSchema;

describe('addableElementsFromSchema', () => {
	it('keeps only classes and individuals, with the same labels', () => {
		const result = addableElementsFromSchema(schema);
		expect(result.map((e) => e.kind).every((k) => k === 'class' || k === 'individual')).toBe(true);
		expect(result.find((e) => e.iri === 'urn:Person')).toEqual({ iri: 'urn:Person', label: 'Person', kind: 'class' });
		expect(result.find((e) => e.iri === 'urn:ada')).toEqual({ iri: 'urn:ada', label: 'Ada', kind: 'individual' });
		expect(result.some((e) => e.iri === 'urn:name' || e.iri === 'urn:worksFor')).toBe(false);
	});

	it('equals what fetchAddableWorkspaceElements returns for the same data, including deduplication', async () => {
		const connector = new SparqlConnector('/api/sparql');
		vi.spyOn(connector, 'fetchAllReifiedStatements').mockResolvedValue([]);
		vi.spyOn(connector, 'fetchFullSchemaForAllNamespaces').mockResolvedValue(schema);
		expect(addableElementsFromSchema(schema)).toEqual(await connector.fetchAddableWorkspaceElements());
	});

	it('is empty for an empty schema', () => {
		expect(addableElementsFromSchema({ ...schema, classes: [], individuals: [], datatypeProperties: [], objectProperties: [] })).toEqual([]);
	});
});
