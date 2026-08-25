import { describe, it, expect } from 'vitest';
import { buildCanvasModel } from './canvas-model';
import type { FetchedSchema, FetchedClass, FetchedProperty, FetchedSubClassOf, FetchedIndividual } from './sparql-connector';
import { classIri, propertyIri, xsdIri, ATTRIBUTED_RELATIONSHIP_IRI, type XsdDatatype } from '$lib/utils/iri';

const NS = 'http://ld.pageagent.com/rdf-schema-editor/schema#';
const NS_A = 'http://example.com/ns-a#';
const NS_B = 'http://example.com/ns-b#';

function fetchedClass(iri: string, label: string, comment: string | null = null, namespaceBaseIri = NS): FetchedClass {
	return { iri, label, comment, namespaceBaseIri };
}

function objectProp(domain: string, range: string, name: string, overrides: Partial<FetchedProperty> = {}): FetchedProperty {
	return {
		iri: propertyIri(domain, name),
		label: name,
		domain,
		range,
		required: false,
		repeatable: true,
		namespaceBaseIri: NS,
		...overrides
	};
}

function datatypeProp(domain: string, name: string, datatype: XsdDatatype, overrides: Partial<FetchedProperty> = {}): FetchedProperty {
	return {
		iri: propertyIri(domain, name),
		label: name,
		domain,
		range: xsdIri(datatype),
		required: false,
		repeatable: false,
		namespaceBaseIri: NS,
		...overrides
	};
}

function subClassOf(sub: string, superIri: string, namespaceBaseIri = NS): FetchedSubClassOf {
	return { sub, super: superIri, namespaceBaseIri };
}

function individual(iri: string, label: string, classIriValue: string, namespaceBaseIri = NS): FetchedIndividual {
	return { iri, label, classIri: classIriValue, namespaceBaseIri };
}

function emptySchema(overrides: Partial<FetchedSchema> = {}): FetchedSchema {
	return {
		classes: [],
		datatypeProperties: [],
		objectProperties: [],
		subClassOf: [],
		individuals: [],
		...overrides
	};
}

describe('buildCanvasModel', () => {
	it('renders one entity node per class, with datatype attributes attached', () => {
		const person = classIri('Person');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person', 'A person')],
			datatypeProperties: [datatypeProp(person, 'nickname', 'string', { required: false, repeatable: false })]
		});
		const model = buildCanvasModel(schema);
		expect(model.nodes).toHaveLength(1);
		const node = model.nodes[0];
		expect(node.kind).toBe('entity');
		if (node.kind === 'entity') {
			expect(node.name).toBe('Person');
			expect(node.description).toBe('A person');
			expect(node.namespace).toBe(NS);
			expect(node.attributes).toEqual([
				{ iri: propertyIri(person, 'nickname'), name: 'nickname', datatype: 'string', required: false, repeatable: false }
			]);
		}
	});

	it('renders a plain relation edge for an object property on a non-association class', () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person'), fetchedClass(car, 'Car')],
			objectProperties: [objectProp(person, car, 'owns', { required: false, repeatable: true })]
		});
		const model = buildCanvasModel(schema);
		expect(model.edges).toEqual([
			{
				kind: 'relation',
				iri: propertyIri(person, 'owns'),
				source: person,
				target: car,
				name: 'owns',
				required: false,
				repeatable: true,
				namespace: NS
			}
		]);
	});

	it('renders attributedLink edges (not relation edges) for a class carrying the AttributedRelationship marker (STORY-020)', () => {
		const assoc = classIri('EmploymentAssignment');
		const person = classIri('Person');
		const company = classIri('Company');
		const schema = emptySchema({
			classes: [fetchedClass(assoc, 'EmploymentAssignment'), fetchedClass(person, 'Person'), fetchedClass(company, 'Company')],
			objectProperties: [
				objectProp(assoc, person, 'employee', { required: true, repeatable: false }),
				objectProp(assoc, company, 'employer', { required: true, repeatable: false })
			],
			subClassOf: [subClassOf(assoc, ATTRIBUTED_RELATIONSHIP_IRI)]
		});
		const model = buildCanvasModel(schema);
		expect(model.associationClassIris).toEqual(new Set([assoc]));
		expect(model.edges).toHaveLength(2);
		expect(model.edges.every((e) => e.kind === 'attributedLink')).toBe(true);
		// The association class still gets a full entity node (with its own future attributes).
		expect(model.nodes.some((n) => n.kind === 'entity' && n.iri === assoc)).toBe(true);
	});

	it('does NOT treat a class with 2+ links as an association class unless it carries the marker (heuristic fully removed)', () => {
		const assoc = classIri('EmploymentAssignment');
		const person = classIri('Person');
		const company = classIri('Company');
		const schema = emptySchema({
			objectProperties: [objectProp(assoc, person, 'employee'), objectProp(assoc, company, 'employer')]
		});
		const model = buildCanvasModel(schema);
		expect(model.associationClassIris.has(assoc)).toBe(false);
		expect(model.edges.every((e) => e.kind === 'relation')).toBe(true);
	});

	it('treats a class with the marker as an association class even with a single link or none', () => {
		const almostAssoc = classIri('AlmostAssignment');
		const person = classIri('Person');
		const schema = emptySchema({
			objectProperties: [objectProp(almostAssoc, person, 'assignee')],
			subClassOf: [subClassOf(almostAssoc, ATTRIBUTED_RELATIONSHIP_IRI)]
		});
		const model = buildCanvasModel(schema);
		expect(model.associationClassIris.has(almostAssoc)).toBe(true);
		expect(model.edges[0].kind).toBe('attributedLink');
	});

	it('excludes the AttributedRelationship marker class itself from the rendered nodes/edges', () => {
		const assoc = classIri('EmploymentAssignment');
		const person = classIri('Person');
		const schema = emptySchema({
			classes: [
				fetchedClass(ATTRIBUTED_RELATIONSHIP_IRI, 'AttributedRelationship'),
				fetchedClass(assoc, 'EmploymentAssignment'),
				fetchedClass(person, 'Person')
			],
			objectProperties: [objectProp(assoc, person, 'employee')],
			subClassOf: [subClassOf(assoc, ATTRIBUTED_RELATIONSHIP_IRI)]
		});
		const model = buildCanvasModel(schema);
		expect(model.nodes.some((n) => n.iri === ATTRIBUTED_RELATIONSHIP_IRI)).toBe(false);
		expect(model.edges.some((e) => e.kind === 'inheritance')).toBe(false);
	});

	it('renders an external stub node + inheritance edge for a subClassOf target not on the canvas', () => {
		const company = classIri('Company');
		const schema = emptySchema({
			classes: [fetchedClass(company, 'Company')],
			subClassOf: [subClassOf(company, 'https://schema.org/Organization')]
		});
		const model = buildCanvasModel(schema);
		const external = model.nodes.find((n) => n.kind === 'external');
		expect(external).toEqual({ kind: 'external', iri: 'https://schema.org/Organization', prefixedName: 'schema:Organization' });
		expect(model.edges).toContainEqual({
			kind: 'inheritance',
			source: company,
			target: 'https://schema.org/Organization',
			namespace: NS
		});
	});

	it('supports multiple inheritance (two subClassOf targets for the same class)', () => {
		const person = classIri('Person');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			subClassOf: [
				subClassOf(person, 'http://xmlns.com/foaf/0.1/Person'),
				subClassOf(person, 'https://schema.org/Person')
			]
		});
		const model = buildCanvasModel(schema);
		const inheritanceEdges = model.edges.filter((e) => e.kind === 'inheritance');
		expect(inheritanceEdges).toHaveLength(2);
		expect(model.nodes.filter((n) => n.kind === 'external')).toHaveLength(2);
	});

	it('renders a class\'s enumerated individuals as its members list (STORY-019)', () => {
		const relationType = classIri('RelationType');
		const nutztIri = `${NS}relationTypeNutzt`;
		const verbuchtIri = `${NS}relationTypeVerbucht`;
		const schema = emptySchema({
			classes: [fetchedClass(relationType, 'RelationType')],
			individuals: [
				individual(nutztIri, 'nutzt', relationType),
				individual(verbuchtIri, 'verbucht', relationType)
			]
		});
		const model = buildCanvasModel(schema);
		const node = model.nodes[0];
		expect(node.kind).toBe('entity');
		if (node.kind === 'entity') {
			expect(node.members).toEqual([
				{ iri: nutztIri, label: 'nutzt' },
				{ iri: verbuchtIri, label: 'verbucht' }
			]);
		}
	});

	it('gives every class an empty members list by default (no enumeration toggle)', () => {
		const person = classIri('Person');
		const schema = emptySchema({ classes: [fetchedClass(person, 'Person')] });
		const model = buildCanvasModel(schema);
		const node = model.nodes[0];
		expect(node.kind === 'entity' && node.members).toEqual([]);
	});

	it('renders an empty canvas without error for a schema with zero classes', () => {
		const model = buildCanvasModel(emptySchema());
		expect(model.nodes).toEqual([]);
		expect(model.edges).toEqual([]);
	});

	it('carries each node/edge\'s own namespace through from the fetched schema (STORY-033)', () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person', null, NS_A), fetchedClass(car, 'Car', null, NS_B)],
			objectProperties: [objectProp(person, car, 'owns', { namespaceBaseIri: NS_A })],
			subClassOf: [subClassOf(car, 'https://schema.org/Product', NS_B)]
		});
		const model = buildCanvasModel(schema);

		const personNode = model.nodes.find((n) => n.iri === person);
		const carNode = model.nodes.find((n) => n.iri === car);
		expect(personNode?.kind === 'entity' && personNode.namespace).toBe(NS_A);
		expect(carNode?.kind === 'entity' && carNode.namespace).toBe(NS_B);

		const relationEdge = model.edges.find((e) => e.kind === 'relation');
		expect(relationEdge?.namespace).toBe(NS_A);

		const inheritanceEdge = model.edges.find((e) => e.kind === 'inheritance');
		expect(inheritanceEdge?.namespace).toBe(NS_B);
	});

	it('is idempotent: building twice from the same schema produces an identical model', () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person'), fetchedClass(car, 'Car')],
			objectProperties: [objectProp(person, car, 'owns')]
		});
		const first = buildCanvasModel(schema);
		const second = buildCanvasModel(schema);
		expect(second.nodes).toEqual(first.nodes);
		expect(second.edges).toEqual(first.edges);
	});
});
