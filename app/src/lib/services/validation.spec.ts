import { describe, it, expect } from 'vitest';
import { checkShaclWellFormedness, checkStructural, checkCatalogStructural } from './validation';
import { parseTurtle } from './turtle';

const PREFIXES = `
	@prefix owl: <http://www.w3.org/2002/07/owl#> .
	@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
	@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
	@prefix sh: <http://www.w3.org/ns/shacl#> .
`;

const CATALOG_PREFIXES = `
	@prefix dcat: <http://www.w3.org/ns/dcat#> .
	@prefix dct: <http://purl.org/dc/terms/> .
`;

describe('checkShaclWellFormedness (STORY-013)', () => {
	it('passes a known-good shape (modeled on semantic-crm gcrms:PersonShape)', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:Person> a owl:Class .
			<urn:PersonShape> a sh:NodeShape ;
				sh:targetClass <urn:Person> ;
				sh:property [ sh:path rdfs:label ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
				sh:property [ sh:path <urn:nickname> ; sh:datatype xsd:string ; sh:maxCount 1 ] .
		`);
		const declaredClasses = new Set(['urn:Person']);
		expect(checkShaclWellFormedness(quads, declaredClasses)).toEqual([]);
	});

	it('rejects a sh:property blank node missing sh:path', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:PersonShape> a sh:NodeShape ;
				sh:property [ sh:datatype xsd:string ] .
		`);
		const issues = checkShaclWellFormedness(quads, new Set());
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ layer: 'shacl' });
		expect(issues[0].message).toMatch(/missing sh:path/);
	});

	it('rejects a sh:NodeShape whose sh:targetClass is not declared as owl:Class', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:PersonShape> a sh:NodeShape ; sh:targetClass <urn:NotAClass> .
		`);
		const issues = checkShaclWellFormedness(quads, new Set());
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toMatch(/not declared as owl:Class/);
	});
});

describe('checkStructural (STORY-013)', () => {
	it('passes a well-formed schema', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:Person> a owl:Class .
			<urn:Car> a owl:Class .
			<urn:owns> a owl:ObjectProperty ; rdfs:domain <urn:Person> ; rdfs:range <urn:Car> .
			<urn:name> a owl:DatatypeProperty ; rdfs:domain <urn:Person> ; rdfs:range xsd:string .
		`);
		expect(checkStructural(quads)).toEqual([]);
	});

	it('detects an rdfs:subClassOf cycle spanning classes outside any single edited scope', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:A> a owl:Class ; rdfs:subClassOf <urn:B> .
			<urn:B> a owl:Class ; rdfs:subClassOf <urn:C> .
			<urn:C> a owl:Class ; rdfs:subClassOf <urn:A> .
		`);
		const issues = checkStructural(quads);
		expect(issues.some((i) => i.layer === 'structural' && /cycle/.test(i.message))).toBe(true);
	});

	it('rejects rdfs:domain pointing at an undeclared class', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:owns> a owl:ObjectProperty ; rdfs:domain <urn:Ghost> ; rdfs:range <urn:Car> .
			<urn:Car> a owl:Class .
		`);
		const issues = checkStructural(quads);
		expect(issues.some((i) => /rdfs:domain/.test(i.message) && /urn:Ghost/.test(i.message))).toBe(
			true
		);
	});

	it('accepts an XSD datatype as rdfs:range without requiring an owl:Class declaration', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:Person> a owl:Class .
			<urn:name> a owl:DatatypeProperty ; rdfs:domain <urn:Person> ; rdfs:range xsd:string .
		`);
		expect(checkStructural(quads)).toEqual([]);
	});

	it('rejects two different rdfs:range declarations for the same property', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:Car> a owl:Class .
			<urn:Truck> a owl:Class .
			<urn:owns> a owl:ObjectProperty ; rdfs:domain <urn:Person> ; rdfs:range <urn:Car> .
			<urn:owns> rdfs:range <urn:Truck> .
		`);
		const issues = checkStructural(quads);
		expect(issues.some((i) => /conflicting rdfs:range/.test(i.message))).toBe(true);
	});

	it('accepts an individual whose rdf:type target is a declared local owl:Class (STORY-019)', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:RelationType> a owl:Class .
			<urn:nutzt> a <urn:RelationType> ; rdfs:label "nutzt" .
			<urn:verbucht> a <urn:RelationType> ; rdfs:label "verbucht" .
		`);
		expect(checkStructural(quads)).toEqual([]);
	});

	it('rejects an individual whose rdf:type target is not a declared local owl:Class (STORY-019)', () => {
		const quads = parseTurtle(`
			${PREFIXES}
			<urn:nutzt> a <urn:Ghost> ; rdfs:label "nutzt" .
		`);
		const issues = checkStructural(quads);
		expect(
			issues.some(
				(i) => i.layer === 'structural' && /urn:nutzt/.test(i.message) && /urn:Ghost/.test(i.message) && /not declared as owl:Class/.test(i.message)
			)
		).toBe(true);
	});
});

describe('checkCatalogStructural (data-catalog Story 010)', () => {
	const COMPLETE_DATASET = `
		${CATALOG_PREFIXES}
		<urn:ApplicationDataset> a dcat:Dataset ;
			dct:identifier "core-application" ;
			dct:title "Application Inventory" ;
			dct:conformsTo <urn:Application> ;
			dct:publisher "Application Architecture Authority" ;
			dct:license <https://example.com/license/v1> ;
			dcat:distribution <urn:ApplicationTurtleDistribution> .
		<urn:ApplicationTurtleDistribution> a dcat:Distribution ;
			dct:format <https://www.iana.org/assignments/media-types/text/turtle> ;
			dcat:mediaType <https://www.iana.org/assignments/media-types/text/turtle> ;
			dcat:accessURL <https://example.com/distribution/application.ttl> .
	`;

	it('passes a fully-populated catalog draft (matching catalog-v2.ttl\'s shape)', () => {
		const quads = parseTurtle(COMPLETE_DATASET);
		expect(checkCatalogStructural(quads)).toEqual([]);
	});

	it('a draft with dcat:theme/dcat:keyword omitted produces no issue for those fields', () => {
		const quads = parseTurtle(COMPLETE_DATASET);
		const issues = checkCatalogStructural(quads);
		expect(issues.some((i) => /theme/.test(i.message) || /keyword/.test(i.message))).toBe(false);
	});

	it('flags a missing dct:publisher', () => {
		const quads = parseTurtle(`
			${CATALOG_PREFIXES}
			<urn:ApplicationDataset> a dcat:Dataset ;
				dct:identifier "core-application" ;
				dct:title "Application Inventory" ;
				dct:conformsTo <urn:Application> ;
				dct:license <https://example.com/license/v1> ;
				dcat:distribution <urn:ApplicationTurtleDistribution> .
			<urn:ApplicationTurtleDistribution> a dcat:Distribution ;
				dct:format <https://www.iana.org/assignments/media-types/text/turtle> ;
				dcat:mediaType <https://www.iana.org/assignments/media-types/text/turtle> ;
				dcat:accessURL <https://example.com/distribution/application.ttl> .
		`);
		const issues = checkCatalogStructural(quads);
		expect(issues.some((i) => i.layer === 'structural' && /dct:publisher/.test(i.message))).toBe(true);
	});

	it('flags an empty-placeholder dct:license', () => {
		const quads = parseTurtle(`
			${CATALOG_PREFIXES}
			<urn:ApplicationDataset> a dcat:Dataset ;
				dct:identifier "core-application" ;
				dct:title "Application Inventory" ;
				dct:conformsTo <urn:Application> ;
				dct:publisher "Application Architecture Authority" ;
				dct:license "" ;
				dcat:distribution <urn:ApplicationTurtleDistribution> .
			<urn:ApplicationTurtleDistribution> a dcat:Distribution ;
				dct:format <https://www.iana.org/assignments/media-types/text/turtle> ;
				dcat:mediaType <https://www.iana.org/assignments/media-types/text/turtle> ;
				dcat:accessURL <https://example.com/distribution/application.ttl> .
		`);
		const issues = checkCatalogStructural(quads);
		expect(issues.some((i) => i.layer === 'structural' && /dct:license/.test(i.message))).toBe(true);
	});

	it('flags a missing dcat:Distribution entirely', () => {
		const quads = parseTurtle(`
			${CATALOG_PREFIXES}
			<urn:ApplicationDataset> a dcat:Dataset ;
				dct:identifier "core-application" ;
				dct:title "Application Inventory" ;
				dct:conformsTo <urn:Application> ;
				dct:publisher "Application Architecture Authority" ;
				dct:license <https://example.com/license/v1> .
		`);
		const issues = checkCatalogStructural(quads);
		expect(issues.some((i) => /dcat:Distribution/.test(i.message))).toBe(true);
	});

	it('flags an incomplete dcat:Distribution block (missing dct:format)', () => {
		const quads = parseTurtle(`
			${CATALOG_PREFIXES}
			<urn:ApplicationDataset> a dcat:Dataset ;
				dct:identifier "core-application" ;
				dct:title "Application Inventory" ;
				dct:conformsTo <urn:Application> ;
				dct:publisher "Application Architecture Authority" ;
				dct:license <https://example.com/license/v1> ;
				dcat:distribution <urn:ApplicationTurtleDistribution> .
			<urn:ApplicationTurtleDistribution> a dcat:Distribution ;
				dcat:mediaType <https://www.iana.org/assignments/media-types/text/turtle> ;
				dcat:accessURL <https://example.com/distribution/application.ttl> .
		`);
		const issues = checkCatalogStructural(quads);
		expect(issues.some((i) => /dct:format/.test(i.message))).toBe(true);
	});

	it('flags a hand-deleted dct:title even though it is normally inferable', () => {
		const quads = parseTurtle(`
			${CATALOG_PREFIXES}
			<urn:ApplicationDataset> a dcat:Dataset ;
				dct:identifier "core-application" ;
				dct:conformsTo <urn:Application> ;
				dct:publisher "Application Architecture Authority" ;
				dct:license <https://example.com/license/v1> ;
				dcat:distribution <urn:ApplicationTurtleDistribution> .
			<urn:ApplicationTurtleDistribution> a dcat:Distribution ;
				dct:format <https://www.iana.org/assignments/media-types/text/turtle> ;
				dcat:mediaType <https://www.iana.org/assignments/media-types/text/turtle> ;
				dcat:accessURL <https://example.com/distribution/application.ttl> .
		`);
		const issues = checkCatalogStructural(quads);
		expect(issues.some((i) => /dct:title/.test(i.message))).toBe(true);
	});
});
