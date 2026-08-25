import { describe, it, expect } from 'vitest';
import {
	classIri,
	propertyIri,
	individualIri,
	nodeShapeIri,
	extractLocalName,
	pascalCase,
	camelCase,
	xsdIri,
	xsdDatatypeFromIri,
	resolvePrefixedName,
	iriToPrefixedName,
	SCHEMA_NAMESPACE,
	SHAPES_NAMESPACE
} from './iri';

describe('pascalCase / camelCase', () => {
	it('converts a multi-word name to PascalCase', () => {
		expect(pascalCase('employment assignment')).toBe('EmploymentAssignment');
	});

	it('converts a multi-word name to camelCase', () => {
		expect(camelCase('birth date')).toBe('birthDate');
	});

	it('strips non-alphanumeric separators', () => {
		expect(pascalCase("person's-full_name")).toBe('PersonSFullName');
	});

	it('preserves word boundaries in an already-camelCase or PascalCase input', () => {
		expect(pascalCase('VerifyPerson')).toBe('VerifyPerson');
		expect(camelCase('birthDate')).toBe('birthDate');
	});
});

describe('classIri', () => {
	it('derives a PascalCase local name under the default schema namespace when no namespace is passed', () => {
		expect(classIri('Person')).toBe(`${SCHEMA_NAMESPACE}Person`);
		expect(classIri('employment assignment')).toBe(`${SCHEMA_NAMESPACE}EmploymentAssignment`);
	});

	it('mints under an explicitly passed namespace base IRI (STORY-025)', () => {
		expect(classIri('Person', 'http://example.org/gov/schema')).toBe(
			'http://example.org/gov/schema#Person'
		);
	});

	it('reproduces the exact default-namespace IRI when its base IRI is passed explicitly', () => {
		const defaultSchemaBase = SCHEMA_NAMESPACE.slice(0, -1); // strip trailing '#'
		expect(classIri('Person', defaultSchemaBase)).toBe(classIri('Person'));
	});

	it('does not bleed a resource minted under one namespace into another', () => {
		const gov = classIri('Person', 'http://example.org/gov/schema');
		const core = classIri('Person', 'http://example.org/core/schema');
		expect(gov).not.toBe(core);
	});
});

describe('propertyIri', () => {
	it('scopes the property local name by its owning class, avoiding cross-class collisions', () => {
		const person = classIri('Person');
		const company = classIri('Company');
		expect(propertyIri(person, 'name')).toBe(`${SCHEMA_NAMESPACE}personName`);
		expect(propertyIri(company, 'name')).toBe(`${SCHEMA_NAMESPACE}companyName`);
		expect(propertyIri(person, 'name')).not.toBe(propertyIri(company, 'name'));
	});

	it('mints under an explicitly passed namespace base IRI, with no cross-namespace bleed', () => {
		const person = classIri('Person');
		const govIri = propertyIri(person, 'name', 'http://example.org/gov/schema');
		const coreIri = propertyIri(person, 'name', 'http://example.org/core/schema');
		expect(govIri).toBe('http://example.org/gov/schema#personName');
		expect(govIri).not.toBe(coreIri);
	});
});

describe('nodeShapeIri', () => {
	it('derives a deterministic shape IRI under the default shapes namespace when no namespace is passed', () => {
		expect(nodeShapeIri(classIri('Person'))).toBe(`${SHAPES_NAMESPACE}PersonShape`);
	});

	it('mints under an explicitly passed namespace base IRI', () => {
		expect(nodeShapeIri(classIri('Person'), 'http://example.org/gov/shapes')).toBe(
			'http://example.org/gov/shapes#PersonShape'
		);
	});
});

describe('individualIri (STORY-019)', () => {
	it('scopes the member local name by its owning class, avoiding cross-class collisions', () => {
		const relationType = classIri('RelationType');
		const externalSystem = classIri('ExternalSystem');
		expect(individualIri(relationType, 'nutzt')).toBe(`${SCHEMA_NAMESPACE}relationTypeNutzt`);
		expect(individualIri(externalSystem, 'nutzt')).not.toBe(individualIri(relationType, 'nutzt'));
	});

	it('is stable for the same class + label', () => {
		const relationType = classIri('RelationType');
		expect(individualIri(relationType, 'verbucht')).toBe(individualIri(relationType, 'verbucht'));
	});

	it('mints under an explicitly passed namespace base IRI, with no cross-namespace bleed', () => {
		const relationType = classIri('RelationType');
		const govIri = individualIri(relationType, 'nutzt', 'http://example.org/gov/schema');
		const coreIri = individualIri(relationType, 'nutzt', 'http://example.org/core/schema');
		expect(govIri).toBe('http://example.org/gov/schema#relationTypeNutzt');
		expect(govIri).not.toBe(coreIri);
	});
});

describe('extractLocalName', () => {
	it('extracts the fragment after #', () => {
		expect(extractLocalName('http://example.org/schema#Person')).toBe('Person');
	});

	it('extracts the last path segment when there is no fragment', () => {
		expect(extractLocalName('http://example.org/schema/Person')).toBe('Person');
	});
});

describe('xsdIri', () => {
	it('builds the full XSD datatype IRI', () => {
		expect(xsdIri('dateTime')).toBe('http://www.w3.org/2001/XMLSchema#dateTime');
	});
});

describe('resolvePrefixedName', () => {
	it('resolves a known prefix to its full IRI', () => {
		expect(resolvePrefixedName('schema:Organization')).toEqual({
			iri: 'https://schema.org/Organization',
			prefix: 'schema',
			localName: 'Organization'
		});
		expect(resolvePrefixedName('foaf:Person')).toEqual({
			iri: 'http://xmlns.com/foaf/0.1/Person',
			prefix: 'foaf',
			localName: 'Person'
		});
		expect(resolvePrefixedName('skos:Concept')).toEqual({
			iri: 'http://www.w3.org/2004/02/skos/core#Concept',
			prefix: 'skos',
			localName: 'Concept'
		});
	});

	it('returns null for an unknown prefix', () => {
		expect(resolvePrefixedName('dbpedia:Thing')).toBeNull();
	});

	it('returns null for input with no prefix separator', () => {
		expect(resolvePrefixedName('Organization')).toBeNull();
	});

	it('returns null for a bare IRI (not prefix:LocalName shaped)', () => {
		expect(resolvePrefixedName('http://example.org/Thing')).toBeNull();
	});

	it('resolves a non-built-in prefix when an explicit prefixes map is passed (STORY-046)', () => {
		const prefixes = { gist: 'https://ontologies.semanticarts.com/gist/' };
		expect(resolvePrefixedName('gist:System', prefixes)).toEqual({
			iri: 'https://ontologies.semanticarts.com/gist/System',
			prefix: 'gist',
			localName: 'System'
		});
	});

	it('still resolves the built-in prefixes when no map is passed (default-parameter regression)', () => {
		expect(resolvePrefixedName('schema:Organization')).not.toBeNull();
	});
});

describe('iriToPrefixedName', () => {
	it('reverses a known external vocabulary IRI back to prefix:LocalName', () => {
		expect(iriToPrefixedName('https://schema.org/Organization')).toBe('schema:Organization');
		expect(iriToPrefixedName('http://xmlns.com/foaf/0.1/Person')).toBe('foaf:Person');
		expect(iriToPrefixedName('http://www.w3.org/2004/02/skos/core#Concept')).toBe('skos:Concept');
	});

	it('round-trips with resolvePrefixedName', () => {
		const resolved = resolvePrefixedName('schema:Organization')!;
		expect(iriToPrefixedName(resolved.iri)).toBe('schema:Organization');
	});

	it('falls back to the raw IRI for an unknown vocabulary', () => {
		expect(iriToPrefixedName('http://example.org/Thing')).toBe('http://example.org/Thing');
	});

	it('reverses a non-built-in IRI when an explicit prefixes map is passed (STORY-046)', () => {
		const prefixes = { gist: 'https://ontologies.semanticarts.com/gist/' };
		expect(iriToPrefixedName('https://ontologies.semanticarts.com/gist/System', prefixes)).toBe('gist:System');
	});

	it('still reverses the built-in prefixes when no map is passed (default-parameter regression)', () => {
		expect(iriToPrefixedName('https://schema.org/Organization')).toBe('schema:Organization');
	});
});

describe('xsdDatatypeFromIri', () => {
	it('reverses xsdIri for every known datatype', () => {
		expect(xsdDatatypeFromIri('http://www.w3.org/2001/XMLSchema#dateTime')).toBe('dateTime');
		expect(xsdDatatypeFromIri('http://www.w3.org/2001/XMLSchema#anyURI')).toBe('anyURI');
	});

	it('falls back to "string" for an unrecognized range rather than throwing', () => {
		expect(xsdDatatypeFromIri('http://www.w3.org/2001/XMLSchema#base64Binary')).toBe('string');
	});
});
