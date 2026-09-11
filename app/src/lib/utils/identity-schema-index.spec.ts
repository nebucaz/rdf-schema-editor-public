import { describe, it, expect } from 'vitest';
import { buildEntityNodeIndex, resolveEditFormSpec, resolveGoverningClass } from './identity-schema-index';
import type { FetchedClass, FetchedProperty, FetchedSchema } from '$lib/services/sparql-connector';
import { classIri, propertyIri, xsdIri } from '$lib/utils/iri';

const NS = 'http://ld.pageagent.com/rdf-schema-editor/schema#';

function fetchedClass(iri: string, label: string): FetchedClass {
	return { iri, label, comment: null, namespaceBaseIri: NS };
}

function datatypeProp(domain: string, name: string): FetchedProperty {
	return {
		iri: propertyIri(domain, name),
		label: name,
		domain,
		range: xsdIri('string'),
		required: false,
		repeatable: false,
		namespaceBaseIri: NS
	};
}

function emptySchema(overrides: Partial<FetchedSchema> = {}): FetchedSchema {
	return {
		classes: [],
		datatypeProperties: [],
		objectProperties: [],
		subClassOf: [],
		individuals: [],
		individualClassRelations: [],
		individualIndividualRelations: [],
		...overrides
	};
}

describe('buildEntityNodeIndex', () => {
	it('indexes buildCanvasModel entity nodes by class IRI, exposing their attributes', () => {
		const person = classIri('Person');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			datatypeProperties: [datatypeProp(person, 'name')]
		});

		const index = buildEntityNodeIndex(schema);

		expect(index.get(person)?.attributes.map((a) => a.name)).toEqual(['name']);
	});

	it('returns undefined for a class IRI not present in the schema, without throwing', () => {
		const index = buildEntityNodeIndex(emptySchema());
		expect(index.get(classIri('Ghost'))).toBeUndefined();
	});
});

describe('resolveGoverningClass', () => {
	const person = classIri('Person');
	const employee = classIri('Employee');
	const contractor = classIri('Contractor');

	it('returns the active facet when it matches one of the identity types', () => {
		expect(resolveGoverningClass([person, employee], employee)).toBe(employee);
	});

	it('falls back to the first type when there is no active facet', () => {
		expect(resolveGoverningClass([person, employee], null)).toBe(person);
	});

	it('falls back to the first type when the facet is set but not among the identity types', () => {
		expect(resolveGoverningClass([person, employee], contractor)).toBe(person);
	});

	it('returns null when the identity carries no types at all', () => {
		expect(resolveGoverningClass([], person)).toBeNull();
	});
});

describe('resolveEditFormSpec', () => {
	it('returns the class node attributes/relationFields/labelRequired for a known governing class', () => {
		const person = classIri('Person');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			datatypeProperties: [datatypeProp(person, 'name')]
		});
		const index = buildEntityNodeIndex(schema);

		const spec = resolveEditFormSpec(index, person);

		expect(spec.attributes.map((a) => a.name)).toEqual(['name']);
		expect(spec.relationFields).toEqual([]);
		expect(spec.labelRequired).toBe(false);
	});

	it('returns an empty spec (generic Assertions-only editing) when governingClassIri is null', () => {
		const index = buildEntityNodeIndex(emptySchema());

		const spec = resolveEditFormSpec(index, null);

		expect(spec).toEqual({ attributes: [], relationFields: [], labelRequired: false });
	});

	it('returns an empty spec when governingClassIri is not present in the schema index', () => {
		const index = buildEntityNodeIndex(emptySchema());

		const spec = resolveEditFormSpec(index, classIri('Ghost'));

		expect(spec).toEqual({ attributes: [], relationFields: [], labelRequired: false });
	});
});
