import { describe, it, expect } from 'vitest';
import {
	classIri,
	propertyIri,
	genericPropertyIri,
	individualIri,
	nodeShapeIri,
	workspaceIri,
	workspaceMembershipIri,
	savedQueryIri,
	catalogIri,
	datasetIri,
	publicationActivityIri,
	statementIri,
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
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '$lib/config';

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

describe('genericPropertyIri (STORY-051)', () => {
	it('mints an owner-class-independent IRI under the default schema namespace', () => {
		expect(genericPropertyIri('uses')).toBe(`${SCHEMA_NAMESPACE}uses`);
	});

	it('resolves to the same IRI regardless of which source class draws the relation', () => {
		// unlike propertyIri, genericPropertyIri takes no owner class at all
		expect(genericPropertyIri('uses')).toBe(genericPropertyIri('uses'));
	});

	it('mints under an explicitly passed namespace base IRI, with no cross-namespace bleed', () => {
		const govIri = genericPropertyIri('uses', 'http://example.org/gov/schema');
		const coreIri = genericPropertyIri('uses', 'http://example.org/core/schema');
		expect(govIri).toBe('http://example.org/gov/schema#uses');
		expect(govIri).not.toBe(coreIri);
	});

	it('camelCases a multi-word name the same way propertyIri does', () => {
		expect(genericPropertyIri('depends on')).toBe(`${SCHEMA_NAMESPACE}dependsOn`);
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

describe('workspaceIri (STORY-071)', () => {
	it('derives a PascalCase local name suffixed "Workspace" under the default schema namespace', () => {
		expect(workspaceIri('Project Overview')).toBe(`${SCHEMA_NAMESPACE}ProjectOverviewWorkspace`);
	});

	it('is deterministic — calling it twice with the same name returns the identical IRI', () => {
		expect(workspaceIri('Default')).toBe(workspaceIri('Default'));
	});

	it('mints under an explicitly passed namespace base IRI', () => {
		expect(workspaceIri('Default', 'http://example.org/gov')).toBe(
			'http://example.org/gov/schema#DefaultWorkspace'
		);
	});
});

describe('savedQueryIri (STORY-086)', () => {
	it('derives a PascalCase local name suffixed "SavedQuery" under the default schema namespace', () => {
		expect(savedQueryIri('Undocumented Classes')).toBe(
			`${SCHEMA_NAMESPACE}UndocumentedClassesSavedQuery`
		);
	});

	it('is deterministic — calling it twice with the same name returns the identical IRI', () => {
		expect(savedQueryIri('Undocumented Classes')).toBe(savedQueryIri('Undocumented Classes'));
	});

	it('normalizes names that pascal-case to the same value to the identical IRI', () => {
		expect(savedQueryIri('undocumented classes')).toBe(savedQueryIri('Undocumented Classes'));
	});

	it('mints under an explicitly passed namespace base IRI', () => {
		expect(savedQueryIri('Undocumented Classes', 'http://example.org/gov')).toBe(
			'http://example.org/gov/schema#UndocumentedClassesSavedQuery'
		);
	});
});

describe('workspaceMembershipIri (STORY-071)', () => {
	it('is deterministic — calling it twice with the same pair returns the identical IRI', () => {
		const ws = workspaceIri('Project Overview');
		const element = classIri('Application');
		expect(workspaceMembershipIri(ws, element)).toBe(workspaceMembershipIri(ws, element));
	});

	it('derives from both owning IRIs\' local names under the default schema namespace', () => {
		const ws = workspaceIri('Project Overview');
		const element = classIri('Application');
		expect(workspaceMembershipIri(ws, element)).toBe(
			`${SCHEMA_NAMESPACE}ProjectOverviewWorkspace-Application`
		);
	});

	it('produces distinct membership IRIs for different elements in the same workspace', () => {
		const ws = workspaceIri('Project Overview');
		const a = workspaceMembershipIri(ws, classIri('Application'));
		const b = workspaceMembershipIri(ws, classIri('Server'));
		expect(a).not.toBe(b);
	});

	it('produces distinct membership IRIs for the same element in different workspaces', () => {
		const element = classIri('Application');
		const a = workspaceMembershipIri(workspaceIri('Project Overview'), element);
		const b = workspaceMembershipIri(workspaceIri('Infrastructure'), element);
		expect(a).not.toBe(b);
	});
});

describe('individualIri (STORY-019)', () => {
	it('scopes the member local name by its owning class, avoiding cross-class collisions', () => {
		const relationType = classIri('RelationType');
		const externalSystem = classIri('ExternalSystem');
		expect(individualIri(relationType, 'nutzt')).toBe(`${DEFAULT_NAMESPACE_BASE_IRI}#relationTypeNutzt`);
		expect(individualIri(externalSystem, 'nutzt')).not.toBe(individualIri(relationType, 'nutzt'));
	});

	it('mints under the namespace plain base, not the schema base (STORY-062)', () => {
		const relationType = classIri('RelationType');
		expect(individualIri(relationType, 'nutzt')).not.toBe(`${SCHEMA_NAMESPACE}relationTypeNutzt`);
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

describe('catalogIri / datasetIri / publicationActivityIri (data-catalog Story 002)', () => {
	const govBase = 'http://example.org/gov';

	it('catalogIri mints one deterministic dcat:Catalog IRI per namespace, under its /catalog graph', () => {
		expect(catalogIri(govBase)).toBe(`${namespaceGraphs(govBase).catalog}#Catalog`);
		expect(catalogIri(govBase)).toBe(catalogIri(govBase));
	});

	it('catalogIri does not bleed across namespaces', () => {
		const coreBase = 'http://example.org/core';
		expect(catalogIri(govBase)).not.toBe(catalogIri(coreBase));
	});

	it('datasetIri mints a deterministic dcat:Dataset IRI per class, under the namespace /catalog graph', () => {
		expect(datasetIri(govBase, 'Person')).toBe(`${namespaceGraphs(govBase).catalog}#PersonDataset`);
		expect(datasetIri(govBase, 'Person')).toBe(datasetIri(govBase, 'Person'));
	});

	it('datasetIri does not collide across two different classes', () => {
		expect(datasetIri(govBase, 'Person')).not.toBe(datasetIri(govBase, 'Company'));
	});

	it('publicationActivityIri produces distinct IRIs across repeated calls with different timestamps', () => {
		const first = publicationActivityIri(govBase, 'Person', '2026-08-27T00:00:00Z');
		const second = publicationActivityIri(govBase, 'Person', '2026-08-27T00:00:01Z');
		expect(first).not.toBe(second);
		expect(first).toContain(namespaceGraphs(govBase).catalog);
	});
});

describe('statementIri (relation-assertions Story 008)', () => {
	const govBase = 'http://example.org/gov';

	it('produces distinct IRIs for two calls with different timestamps in the same namespace', () => {
		const first = statementIri(govBase, '20260827000000');
		const second = statementIri(govBase, '20260827000001');
		expect(first).not.toBe(second);
	});

	it('mints under the namespace base IRI directly (graphs.instances), not the /catalog graph', () => {
		expect(statementIri(govBase, '20260827000000')).toBe(`${govBase}#Statement20260827000000`);
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
