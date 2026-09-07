import { describe, it, expect } from 'vitest';
import {
	buildCanvasModel,
	isAuthoritativeEntity,
	mergeAncestorAttributes,
	mergeAncestorRelations,
	isLabelRequiredForClass,
	directSuperclassRequiredAttributes
} from './canvas-model';
import type {
	FetchedSchema,
	FetchedClass,
	FetchedProperty,
	FetchedObjectProperty,
	FetchedSubClassOf,
	FetchedIndividual,
	FetchedIndividualClassRelation,
	FetchedIndividualIndividualRelation
} from './sparql-connector';
import {
	classIri,
	propertyIri,
	xsdIri,
	ATTRIBUTED_RELATIONSHIP_IRI,
	type XsdDatatype
} from '$lib/utils/iri';

const NS = 'http://ld.pageagent.com/rdf-schema-editor/schema#';
const NS_A = 'http://example.com/ns-a#';
const NS_B = 'http://example.com/ns-b#';

function fetchedClass(iri: string, label: string, comment: string | null = null, namespaceBaseIri = NS): FetchedClass {
	return { iri, label, comment, namespaceBaseIri };
}

function objectProp(
	domain: string,
	range: string,
	name: string,
	overrides: Partial<FetchedObjectProperty> = {}
): FetchedObjectProperty {
	return {
		iri: propertyIri(domain, name),
		label: name,
		domain,
		range,
		required: false,
		repeatable: true,
		namespaceBaseIri: NS,
		relationKind: 'specific',
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

function individual(
	iri: string,
	label: string,
	classIriValue: string,
	namespaceBaseIri = NS,
	syncSource: string | null = null,
	syncStatus: string | null = null
): FetchedIndividual {
	return { iri, label, classIri: classIriValue, namespaceBaseIri, syncSource, syncStatus };
}

function individualClassRelation(
	individualIri: string,
	predicateIri: string,
	name: string,
	classIriValue: string,
	namespaceBaseIri = NS
): FetchedIndividualClassRelation {
	return { individualIri, predicateIri, name, classIri: classIriValue, namespaceBaseIri };
}

function individualIndividualRelation(
	individualIri: string,
	predicateIri: string,
	name: string,
	targetIndividualIri: string,
	namespaceBaseIri = NS
): FetchedIndividualIndividualRelation {
	return { individualIri, predicateIri, name, targetIndividualIri, namespaceBaseIri };
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
				relationKind: 'specific',
				namespace: NS
			}
		]);
	});

	it('attaches a relationFields entry for an object property, resolving the target class name (STORY-114)', () => {
		const application = classIri('Application');
		const businessProcess = classIri('BusinessProcess');
		const schema = emptySchema({
			classes: [fetchedClass(application, 'Application'), fetchedClass(businessProcess, 'BusinessProcess')],
			objectProperties: [objectProp(application, businessProcess, 'supports', { required: false, repeatable: true })]
		});
		const model = buildCanvasModel(schema);
		const node = model.nodes.find((n) => n.iri === application);
		expect(node?.kind).toBe('entity');
		if (node?.kind === 'entity') {
			expect(node.relationFields).toEqual([
				{
					iri: propertyIri(application, 'supports'),
					name: 'supports',
					targetClassIri: businessProcess,
					targetClassName: 'BusinessProcess',
					required: false,
					repeatable: true
				}
			]);
		}
	});

	it('excludes an object property whose domain is an association class from relationFields (STORY-114)', () => {
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
		const node = model.nodes.find((n) => n.iri === assoc);
		expect(node?.kind).toBe('entity');
		if (node?.kind === 'entity') expect(node.relationFields).toEqual([]);
	});

	it('dedupes a generic relation reused from the same domain against two range classes into one relationField (STORY-114 regression)', () => {
		const application = classIri('Application');
		const businessProcess = classIri('BusinessProcess');
		const otherTarget = classIri('OtherTarget');
		const supportsIri = `${NS}supports`;
		const schema = emptySchema({
			classes: [
				fetchedClass(application, 'Application'),
				fetchedClass(businessProcess, 'BusinessProcess'),
				fetchedClass(otherTarget, 'OtherTarget')
			],
			objectProperties: [
				{
					iri: supportsIri,
					label: 'supports',
					domain: application,
					range: businessProcess,
					required: false,
					repeatable: true,
					namespaceBaseIri: NS,
					relationKind: 'generic'
				},
				{
					iri: supportsIri,
					label: 'supports',
					domain: application,
					range: otherTarget,
					required: false,
					repeatable: true,
					namespaceBaseIri: NS,
					relationKind: 'generic'
				}
			]
		});
		const model = buildCanvasModel(schema);
		const node = model.nodes.find((n) => n.iri === application);
		expect(node?.kind).toBe('entity');
		if (node?.kind === 'entity') {
			expect(node.relationFields).toHaveLength(1);
			expect(node.relationFields[0].iri).toBe(supportsIri);
		}
	});

	it('renders a relation edge for a generic relation reconstructed from the shapes graph (STORY-054), tagged relationKind: generic', () => {
		const project = classIri('Project');
		const tool = classIri('Tool');
		const usesIri = `${NS}uses`;
		const schema = emptySchema({
			classes: [fetchedClass(project, 'Project'), fetchedClass(tool, 'Tool')],
			objectProperties: [
				{
					iri: usesIri,
					label: 'uses',
					domain: project,
					range: tool,
					required: false,
					repeatable: true,
					namespaceBaseIri: NS,
					relationKind: 'generic'
				}
			]
		});
		const model = buildCanvasModel(schema);
		expect(model.edges).toEqual([
			{
				kind: 'relation',
				iri: usesIri,
				source: project,
				target: tool,
				name: 'uses',
				required: false,
				repeatable: true,
				relationKind: 'generic',
				namespace: NS
			}
		]);
	});

	it('renders two edges for the same generic relation reused from two different source classes, without merging or confusing them', () => {
		const project = classIri('Project');
		const recipe = classIri('Recipe');
		const tool = classIri('Tool');
		const ingredient = classIri('Ingredient');
		const usesIri = `${NS}uses`;
		const schema = emptySchema({
			classes: [
				fetchedClass(project, 'Project'),
				fetchedClass(recipe, 'Recipe'),
				fetchedClass(tool, 'Tool'),
				fetchedClass(ingredient, 'Ingredient')
			],
			objectProperties: [
				{
					iri: usesIri,
					label: 'uses',
					domain: project,
					range: tool,
					required: false,
					repeatable: true,
					namespaceBaseIri: NS,
					relationKind: 'generic'
				},
				{
					iri: usesIri,
					label: 'uses',
					domain: recipe,
					range: ingredient,
					required: false,
					repeatable: true,
					namespaceBaseIri: NS,
					relationKind: 'generic'
				}
			]
		});
		const model = buildCanvasModel(schema);
		const relationEdges = model.edges.filter((e) => e.kind === 'relation');
		expect(relationEdges).toHaveLength(2);
		expect(relationEdges).toContainEqual(expect.objectContaining({ source: project, target: tool }));
		expect(relationEdges).toContainEqual(expect.objectContaining({ source: recipe, target: ingredient }));
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

	describe('inherited attributes (STORY-108)', () => {
		it('merges an ancestor\'s own attributes into a subclass, tagged with inheritedFrom', () => {
			const person = classIri('Person');
			const employee = classIri('Employee');
			const schema = emptySchema({
				classes: [fetchedClass(person, 'Person'), fetchedClass(employee, 'Employee')],
				subClassOf: [subClassOf(employee, person)],
				datatypeProperties: [
					datatypeProp(person, 'birthDate', 'date'),
					datatypeProp(employee, 'salary', 'decimal')
				]
			});
			const model = buildCanvasModel(schema);
			const employeeNode = model.nodes.find((n) => n.iri === employee);
			expect(employeeNode?.kind).toBe('entity');
			if (employeeNode?.kind !== 'entity') return;
			expect(employeeNode.attributes).toEqual([
				{ iri: propertyIri(employee, 'salary'), name: 'salary', datatype: 'decimal', required: false, repeatable: false },
				{
					iri: propertyIri(person, 'birthDate'),
					name: 'birthDate',
					datatype: 'date',
					required: false,
					repeatable: false,
					inheritedFrom: { classIri: person, className: 'Person' }
				}
			]);

			const personNode = model.nodes.find((n) => n.iri === person);
			expect(personNode?.kind).toBe('entity');
			if (personNode?.kind !== 'entity') return;
			expect(personNode.attributes).toEqual([
				{ iri: propertyIri(person, 'birthDate'), name: 'birthDate', datatype: 'date', required: false, repeatable: false }
			]);
		});

		it('orders a three-level hierarchy\'s inherited attributes nearest-ancestor-first', () => {
			const livingThing = classIri('LivingThing');
			const person = classIri('Person');
			const employee = classIri('Employee');
			const schema = emptySchema({
				classes: [
					fetchedClass(livingThing, 'LivingThing'),
					fetchedClass(person, 'Person'),
					fetchedClass(employee, 'Employee')
				],
				subClassOf: [subClassOf(employee, person), subClassOf(person, livingThing)],
				datatypeProperties: [
					datatypeProp(livingThing, 'weight', 'decimal'),
					datatypeProp(person, 'birthDate', 'date')
				]
			});
			const model = buildCanvasModel(schema);
			const employeeNode = model.nodes.find((n) => n.iri === employee);
			expect(employeeNode?.kind).toBe('entity');
			if (employeeNode?.kind !== 'entity') return;
			expect(employeeNode.attributes.map((a) => a.inheritedFrom?.className)).toEqual(['Person', 'LivingThing']);
		});

		it('shadows an inherited attribute by name, not by sh:path IRI (propertyIri scopes IRIs per owning class, so they never actually match)', () => {
			const person = classIri('Person');
			const employee = classIri('Employee');
			const schema = emptySchema({
				classes: [fetchedClass(person, 'Person'), fetchedClass(employee, 'Employee')],
				subClassOf: [subClassOf(employee, person)],
				datatypeProperties: [
					datatypeProp(person, 'birthDate', 'date', { required: false }),
					// Employee redeclares "birthDate" with its own, differently-scoped IRI and different
					// constraints — this must shadow Person's copy, not sit alongside it.
					datatypeProp(employee, 'birthDate', 'dateTime', { required: true })
				]
			});
			const model = buildCanvasModel(schema);
			const employeeNode = model.nodes.find((n) => n.iri === employee);
			expect(employeeNode?.kind).toBe('entity');
			if (employeeNode?.kind !== 'entity') return;
			expect(employeeNode.attributes).toEqual([
				{
					iri: propertyIri(employee, 'birthDate'),
					name: 'birthDate',
					datatype: 'dateTime',
					required: true,
					repeatable: false
				}
			]);
		});

		it('when two ancestors both declare the same attribute name, only the nearest one\'s copy is inherited', () => {
			const livingThing = classIri('LivingThing');
			const person = classIri('Person');
			const employee = classIri('Employee');
			const schema = emptySchema({
				classes: [
					fetchedClass(livingThing, 'LivingThing'),
					fetchedClass(person, 'Person'),
					fetchedClass(employee, 'Employee')
				],
				subClassOf: [subClassOf(employee, person), subClassOf(person, livingThing)],
				datatypeProperties: [
					datatypeProp(livingThing, 'name', 'string'),
					datatypeProp(person, 'name', 'string')
				]
			});
			const model = buildCanvasModel(schema);
			const employeeNode = model.nodes.find((n) => n.iri === employee);
			expect(employeeNode?.kind).toBe('entity');
			if (employeeNode?.kind !== 'entity') return;
			expect(employeeNode.attributes).toEqual([
				{
					iri: propertyIri(person, 'name'),
					name: 'name',
					datatype: 'string',
					required: false,
					repeatable: false,
					inheritedFrom: { classIri: person, className: 'Person' }
				}
			]);
		});
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

	it('produces authoritativeEntityIris: true for a class subclassed under the configured marker class (Sprint 5 Story 014)', () => {
		const person = classIri('Person');
		const marker = classIri('GovCatalogMarker');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			subClassOf: [subClassOf(person, marker)]
		});
		const model = buildCanvasModel(schema, undefined, { authoritativeEntityClassIri: marker });
		expect(model.authoritativeEntityIris.has(person)).toBe(true);
	});

	it('produces authoritativeEntityIris: false for a class not subclassed under the configured marker class', () => {
		const person = classIri('Person');
		const marker = classIri('GovCatalogMarker');
		const schema = emptySchema({ classes: [fetchedClass(person, 'Person')] });
		const model = buildCanvasModel(schema, undefined, { authoritativeEntityClassIri: marker });
		expect(model.authoritativeEntityIris.has(person)).toBe(false);
	});

	it('produces an empty authoritativeEntityIris when no marker class is configured (null, no fallback)', () => {
		const person = classIri('Person');
		const marker = classIri('GovCatalogMarker');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			subClassOf: [subClassOf(person, marker)]
		});
		const model = buildCanvasModel(schema, undefined, { authoritativeEntityClassIri: null });
		expect(model.authoritativeEntityIris.size).toBe(0);
		const modelWithNoOption = buildCanvasModel(schema);
		expect(modelWithNoOption.authoritativeEntityIris.size).toBe(0);
	});

	it('renders the configured marker class itself as a normal, visible node (Sprint 5 Story 014 — no longer hidden)', () => {
		const person = classIri('Person');
		const marker = classIri('GovCatalogMarker');
		const schema = emptySchema({
			classes: [fetchedClass(marker, 'GovCatalogMarker'), fetchedClass(person, 'Person')],
			subClassOf: [subClassOf(person, marker)]
		});
		const model = buildCanvasModel(schema, undefined, { authoritativeEntityClassIri: marker });
		expect(model.nodes.some((n) => n.kind === 'entity' && n.iri === marker)).toBe(true);
		expect(model.edges.some((e) => e.kind === 'inheritance' && e.source === person && e.target === marker)).toBe(
			true
		);
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

describe('mergeAncestorAttributes (STORY-109 — extracted from buildCanvasModel, exercised directly)', () => {
	it('returns only own attributes for a class with no ancestors', () => {
		const person = classIri('Person');
		const attributesByClass = new Map([
			[
				person,
				[{ iri: propertyIri(person, 'birthDate'), name: 'birthDate', datatype: 'date' as XsdDatatype, required: false, repeatable: false }]
			]
		]);
		const result = mergeAncestorAttributes(person, attributesByClass, [], new Map([[person, 'Person']]));
		expect(result).toEqual([
			{ iri: propertyIri(person, 'birthDate'), name: 'birthDate', datatype: 'date', required: false, repeatable: false }
		]);
	});

	it('merges an ancestor\'s own attributes in, tagged with inheritedFrom', () => {
		const person = classIri('Person');
		const employee = classIri('Employee');
		const attributesByClass = new Map([
			[person, [{ iri: propertyIri(person, 'birthDate'), name: 'birthDate', datatype: 'date' as XsdDatatype, required: false, repeatable: false }]],
			[employee, [{ iri: propertyIri(employee, 'salary'), name: 'salary', datatype: 'decimal' as XsdDatatype, required: false, repeatable: false }]]
		]);
		const classLabelByIri = new Map([[person, 'Person'], [employee, 'Employee']]);
		const result = mergeAncestorAttributes(employee, attributesByClass, [subClassOf(employee, person)], classLabelByIri);
		expect(result).toEqual([
			{ iri: propertyIri(employee, 'salary'), name: 'salary', datatype: 'decimal', required: false, repeatable: false },
			{
				iri: propertyIri(person, 'birthDate'),
				name: 'birthDate',
				datatype: 'date',
				required: false,
				repeatable: false,
				inheritedFrom: { classIri: person, className: 'Person' }
			}
		]);
	});

	it('orders a three-level hierarchy nearest-ancestor-first', () => {
		const livingThing = classIri('LivingThing');
		const person = classIri('Person');
		const employee = classIri('Employee');
		const attributesByClass = new Map([
			[livingThing, [{ iri: propertyIri(livingThing, 'weight'), name: 'weight', datatype: 'decimal' as XsdDatatype, required: false, repeatable: false }]],
			[person, [{ iri: propertyIri(person, 'birthDate'), name: 'birthDate', datatype: 'date' as XsdDatatype, required: false, repeatable: false }]]
		]);
		const classLabelByIri = new Map([[livingThing, 'LivingThing'], [person, 'Person'], [employee, 'Employee']]);
		const result = mergeAncestorAttributes(
			employee,
			attributesByClass,
			[subClassOf(employee, person), subClassOf(person, livingThing)],
			classLabelByIri
		);
		expect(result.map((a) => a.inheritedFrom?.className)).toEqual(['Person', 'LivingThing']);
	});

	it('shadows by attribute name: a nearer declaration wins over a farther one', () => {
		const livingThing = classIri('LivingThing');
		const person = classIri('Person');
		const employee = classIri('Employee');
		const attributesByClass = new Map([
			[livingThing, [{ iri: propertyIri(livingThing, 'name'), name: 'name', datatype: 'string' as XsdDatatype, required: false, repeatable: false }]],
			[person, [{ iri: propertyIri(person, 'name'), name: 'name', datatype: 'string' as XsdDatatype, required: false, repeatable: false }]]
		]);
		const classLabelByIri = new Map([[livingThing, 'LivingThing'], [person, 'Person'], [employee, 'Employee']]);
		const result = mergeAncestorAttributes(
			employee,
			attributesByClass,
			[subClassOf(employee, person), subClassOf(person, livingThing)],
			classLabelByIri
		);
		expect(result).toEqual([
			{
				iri: propertyIri(person, 'name'),
				name: 'name',
				datatype: 'string',
				required: false,
				repeatable: false,
				inheritedFrom: { classIri: person, className: 'Person' }
			}
		]);
	});

	it('an own attribute shadows a same-named ancestor attribute', () => {
		const person = classIri('Person');
		const employee = classIri('Employee');
		const attributesByClass = new Map([
			[person, [{ iri: propertyIri(person, 'birthDate'), name: 'birthDate', datatype: 'date' as XsdDatatype, required: false, repeatable: false }]],
			[employee, [{ iri: propertyIri(employee, 'birthDate'), name: 'birthDate', datatype: 'dateTime' as XsdDatatype, required: true, repeatable: false }]]
		]);
		const classLabelByIri = new Map([[person, 'Person'], [employee, 'Employee']]);
		const result = mergeAncestorAttributes(employee, attributesByClass, [subClassOf(employee, person)], classLabelByIri);
		expect(result).toEqual([
			{ iri: propertyIri(employee, 'birthDate'), name: 'birthDate', datatype: 'dateTime', required: true, repeatable: false }
		]);
	});
});

describe('mergeAncestorRelations (STORY-114 — sibling of mergeAncestorAttributes)', () => {
	it('returns only own relation fields for a class with no ancestors', () => {
		const application = classIri('Application');
		const businessProcess = classIri('BusinessProcess');
		const relationsByClass = new Map([
			[
				application,
				[
					{
						iri: propertyIri(application, 'supports'),
						name: 'supports',
						targetClassIri: businessProcess,
						targetClassName: 'BusinessProcess',
						required: false,
						repeatable: true
					}
				]
			]
		]);
		const result = mergeAncestorRelations(application, relationsByClass, [], new Map([[application, 'Application']]));
		expect(result).toEqual([
			{
				iri: propertyIri(application, 'supports'),
				name: 'supports',
				targetClassIri: businessProcess,
				targetClassName: 'BusinessProcess',
				required: false,
				repeatable: true
			}
		]);
	});

	it("merges an ancestor's own relation fields in, tagged with inheritedFrom", () => {
		const coreEntity = classIri('CoreEntity');
		const application = classIri('Application');
		const businessProcess = classIri('BusinessProcess');
		const relationsByClass = new Map([
			[
				coreEntity,
				[
					{
						iri: propertyIri(coreEntity, 'ownedBy'),
						name: 'ownedBy',
						targetClassIri: classIri('Team'),
						targetClassName: 'Team',
						required: false,
						repeatable: false
					}
				]
			],
			[
				application,
				[
					{
						iri: propertyIri(application, 'supports'),
						name: 'supports',
						targetClassIri: businessProcess,
						targetClassName: 'BusinessProcess',
						required: false,
						repeatable: true
					}
				]
			]
		]);
		const classLabelByIri = new Map([[coreEntity, 'CoreEntity'], [application, 'Application']]);
		const result = mergeAncestorRelations(application, relationsByClass, [subClassOf(application, coreEntity)], classLabelByIri);
		expect(result).toEqual([
			{
				iri: propertyIri(application, 'supports'),
				name: 'supports',
				targetClassIri: businessProcess,
				targetClassName: 'BusinessProcess',
				required: false,
				repeatable: true
			},
			{
				iri: propertyIri(coreEntity, 'ownedBy'),
				name: 'ownedBy',
				targetClassIri: classIri('Team'),
				targetClassName: 'Team',
				required: false,
				repeatable: false,
				inheritedFrom: { classIri: coreEntity, className: 'CoreEntity' }
			}
		]);
	});

	it('shadows by relation name: an own relation shadows a same-named ancestor relation', () => {
		const coreEntity = classIri('CoreEntity');
		const application = classIri('Application');
		const relationsByClass = new Map([
			[
				coreEntity,
				[
					{
						iri: propertyIri(coreEntity, 'ownedBy'),
						name: 'ownedBy',
						targetClassIri: classIri('Team'),
						targetClassName: 'Team',
						required: false,
						repeatable: false
					}
				]
			],
			[
				application,
				[
					{
						iri: propertyIri(application, 'ownedBy'),
						name: 'ownedBy',
						targetClassIri: classIri('Person'),
						targetClassName: 'Person',
						required: true,
						repeatable: false
					}
				]
			]
		]);
		const classLabelByIri = new Map([[coreEntity, 'CoreEntity'], [application, 'Application']]);
		const result = mergeAncestorRelations(application, relationsByClass, [subClassOf(application, coreEntity)], classLabelByIri);
		expect(result).toEqual([
			{
				iri: propertyIri(application, 'ownedBy'),
				name: 'ownedBy',
				targetClassIri: classIri('Person'),
				targetClassName: 'Person',
				required: true,
				repeatable: false
			}
		]);
	});
});

describe('isLabelRequiredForClass (STORY-112)', () => {
	it('returns true when the class itself is in labelRequiredClassIris', () => {
		const person = classIri('Person');
		expect(isLabelRequiredForClass(person, new Set([person]), [])).toBe(true);
	});

	it('returns true when an ancestor is in labelRequiredClassIris', () => {
		const coreEntity = classIri('CoreEntity');
		const application = classIri('Application');
		expect(isLabelRequiredForClass(application, new Set([coreEntity]), [subClassOf(application, coreEntity)])).toBe(true);
	});

	it('returns true through a multi-level ancestor chain', () => {
		const coreEntity = classIri('CoreEntity');
		const app = classIri('Application');
		const webApp = classIri('WebApplication');
		const subClassOfEdges = [subClassOf(webApp, app), subClassOf(app, coreEntity)];
		expect(isLabelRequiredForClass(webApp, new Set([coreEntity]), subClassOfEdges)).toBe(true);
	});

	it('returns false when neither the class nor any ancestor is shape-required', () => {
		const person = classIri('Person');
		const employee = classIri('Employee');
		expect(isLabelRequiredForClass(employee, new Set(), [subClassOf(employee, person)])).toBe(false);
	});
});

describe('buildCanvasModel — labelRequired (STORY-112)', () => {
	it('marks an entity node labelRequired when its own class is in schema.labelRequiredClassIris', () => {
		const coreEntity = classIri('CoreEntity');
		const schema = emptySchema({
			classes: [fetchedClass(coreEntity, 'CoreEntity')],
			labelRequiredClassIris: [coreEntity]
		});
		const model = buildCanvasModel(schema);
		const node = model.nodes.find((n) => n.kind === 'entity' && n.iri === coreEntity);
		expect(node).toMatchObject({ labelRequired: true });
		expect(model.labelRequiredClassIris.has(coreEntity)).toBe(true);
	});

	it('marks a subclass labelRequired when only its ancestor is in schema.labelRequiredClassIris', () => {
		const coreEntity = classIri('CoreEntity');
		const application = classIri('Application');
		const schema = emptySchema({
			classes: [fetchedClass(coreEntity, 'CoreEntity'), fetchedClass(application, 'Application')],
			subClassOf: [subClassOf(application, coreEntity)],
			labelRequiredClassIris: [coreEntity]
		});
		const model = buildCanvasModel(schema);
		const node = model.nodes.find((n) => n.kind === 'entity' && n.iri === application);
		expect(node).toMatchObject({ labelRequired: true });
	});

	it('leaves labelRequired false for a class with no shape constraint on rdfs:label', () => {
		const person = classIri('Person');
		const schema = emptySchema({ classes: [fetchedClass(person, 'Person')] });
		const model = buildCanvasModel(schema);
		const node = model.nodes.find((n) => n.kind === 'entity' && n.iri === person);
		expect(node).toMatchObject({ labelRequired: false });
		expect(model.labelRequiredClassIris.size).toBe(0);
	});
});

describe('isAuthoritativeEntity (data-catalog Story 003, Sprint 5 Story 014)', () => {
	it('returns true when classIri is directly subClassOf the configured marker class', () => {
		const person = classIri('Person');
		const marker = classIri('GovCatalogMarker');
		expect(isAuthoritativeEntity(person, [subClassOf(person, marker)], marker)).toBe(true);
	});

	it('returns false when classIri has no subClassOf triple to the configured marker class', () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const marker = classIri('GovCatalogMarker');
		expect(isAuthoritativeEntity(person, [subClassOf(car, marker)], marker)).toBe(false);
		expect(isAuthoritativeEntity(person, [], marker)).toBe(false);
	});

	it('returns false unconditionally when no marker class is configured (null, no fallback)', () => {
		const person = classIri('Person');
		const marker = classIri('GovCatalogMarker');
		expect(isAuthoritativeEntity(person, [subClassOf(person, marker)], null)).toBe(false);
	});
});

describe('directSuperclassRequiredAttributes (generalized "required for subclasses" mechanism)', () => {
	it('returns an attribute a direct superclass marks requiredForSubclasses', () => {
		const coreConcept = classIri('CoreConcept');
		const application = classIri('Application');
		const bAttr = datatypeProp(coreConcept, 'bAttr', 'string', { requiredForSubclasses: true });
		const classLabelByIri = new Map([[coreConcept, 'CoreConcept']]);

		expect(
			directSuperclassRequiredAttributes(application, [subClassOf(application, coreConcept)], [bAttr], classLabelByIri)
		).toEqual([
			{
				iri: bAttr.iri,
				name: 'bAttr',
				datatype: 'string',
				ownerClassIri: coreConcept,
				ownerClassName: 'CoreConcept'
			}
		]);
	});

	it('excludes an attribute that is not marked requiredForSubclasses', () => {
		const coreConcept = classIri('CoreConcept');
		const application = classIri('Application');
		const plain = datatypeProp(coreConcept, 'plainAttr', 'string');

		expect(
			directSuperclassRequiredAttributes(application, [subClassOf(application, coreConcept)], [plain], new Map())
		).toEqual([]);
	});

	it('excludes an attribute declared on a non-direct (transitive) ancestor', () => {
		const coreConcept = classIri('CoreConcept');
		const api = classIri('Api');
		const restApi = classIri('RestApi');
		const bAttr = datatypeProp(coreConcept, 'bAttr', 'string', { requiredForSubclasses: true });
		const subClassOfEdges = [subClassOf(restApi, api), subClassOf(api, coreConcept)];

		expect(directSuperclassRequiredAttributes(restApi, subClassOfEdges, [bAttr], new Map())).toEqual([]);
	});

	it('falls back to the owner class IRI as the display name when no label is known', () => {
		const coreConcept = classIri('CoreConcept');
		const application = classIri('Application');
		const bAttr = datatypeProp(coreConcept, 'bAttr', 'string', { requiredForSubclasses: true });

		const result = directSuperclassRequiredAttributes(
			application,
			[subClassOf(application, coreConcept)],
			[bAttr],
			new Map()
		);
		expect(result[0].ownerClassName).toBe(coreConcept);
	});
});

describe('buildCanvasModel — instances view mode (data-catalog Story 005/006)', () => {
	it('defaults to "schema" mode (omitted parameter) and produces identical output to today\'s buildCanvasModel', () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person'), fetchedClass(car, 'Car')],
			objectProperties: [objectProp(person, car, 'owns')],
			individuals: [individual(`${NS}#alice`, 'Alice', person)]
		});
		const withoutOption = buildCanvasModel(schema);
		const withExplicitSchema = buildCanvasModel(schema, undefined, { viewMode: 'schema' });
		expect(withoutOption).toEqual(withExplicitSchema);
		expect(withoutOption.nodes.every((n) => n.kind !== 'individual')).toBe(true);
	});

	it('"instances" mode emits one IndividualNodeSpec per individual, resolving its owning class\'s label', () => {
		const person = classIri('Person');
		const aliceIri = `${NS}#alice`;
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			individuals: [individual(aliceIri, 'Alice', person)]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		const individualNodes = model.nodes.filter((n) => n.kind === 'individual');
		expect(individualNodes).toHaveLength(1);
		expect(individualNodes[0]).toMatchObject({
			iri: aliceIri,
			label: 'Alice',
			classIri: person,
			className: 'Person',
			namespace: NS
		});
	});

	it('computes a syncSource flag from the rse:syncSource marker triple (Story 010)', () => {
		const person = classIri('Person');
		const aliceIri = `${NS}#alice`;
		const bobIri = `${NS}#bob`;
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			individuals: [
				individual(aliceIri, 'Alice', person, NS, 'backstage'),
				individual(bobIri, 'Bob', person, NS, null)
			]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		const individualNodes = model.nodes.filter((n) => n.kind === 'individual');
		const alice = individualNodes.find((n) => n.iri === aliceIri);
		const bob = individualNodes.find((n) => n.iri === bobIri);
		expect(alice).toMatchObject({ syncSource: 'backstage', isStale: false });
		expect(bob).toMatchObject({ syncSource: null, isStale: false });
	});

	it('computes an isStale flag from the rse:syncStatus "stale" marker (Story 009/010)', () => {
		const person = classIri('Person');
		const aliceIri = `${NS}#alice`;
		const bobIri = `${NS}#bob`;
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			individuals: [
				individual(aliceIri, 'Alice', person, NS, 'backstage', 'stale'),
				individual(bobIri, 'Bob', person, NS, 'backstage', null)
			]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		const individualNodes = model.nodes.filter((n) => n.kind === 'individual');
		const alice = individualNodes.find((n) => n.iri === aliceIri);
		const bob = individualNodes.find((n) => n.iri === bobIri);
		expect(alice).toMatchObject({ syncSource: 'backstage', isStale: true });
		expect(bob).toMatchObject({ syncSource: 'backstage', isStale: false });
	});

	it('"instances" mode includes every namespace-visible entity, not just classes individuals/relations reference (data-catalog Story 016)', () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const application = classIri('Application');
		const adoitIri = `${NS}#adoit`;
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person'), fetchedClass(car, 'Car'), fetchedClass(application, 'Application')],
			individuals: [individual(`${NS}#alice`, 'Alice', person)],
			individualClassRelations: [individualClassRelation(adoitIri, `${NS}#isMasterFor`, 'isMasterFor', application)]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		const entityNodeIris = model.nodes.filter((n) => n.kind === 'entity').map((n) => n.iri);
		expect(entityNodeIris.sort()).toEqual([application, car, person].sort());
	});

	it('"instances" mode returns the same entity-node set as "schema" mode for an identical fixture', () => {
		const person = classIri('Person');
		const car = classIri('Car');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person'), fetchedClass(car, 'Car')],
			individuals: [individual(`${NS}#alice`, 'Alice', person)]
		});
		const schemaMode = buildCanvasModel(schema, undefined, { viewMode: 'schema' });
		const instancesMode = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		const entityNodes = (n: (typeof schemaMode.nodes)[number]) => n.kind === 'entity';
		expect(instancesMode.nodes.filter(entityNodes)).toEqual(schemaMode.nodes.filter(entityNodes));
	});

	it('"instances" mode emits a derived InstanceOfEdgeSpec connecting every individual to its own rdf:type class', () => {
		const person = classIri('Person');
		const aliceIri = `${NS}#alice`;
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			individuals: [individual(aliceIri, 'Alice', person)]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		expect(model.edges).toContainEqual({
			kind: 'instanceOf',
			source: aliceIri,
			target: person,
			namespace: NS
		});
	});

	it('"schema" mode never emits InstanceOfEdgeSpecs, even when the schema has individuals', () => {
		const person = classIri('Person');
		const schema = emptySchema({
			classes: [fetchedClass(person, 'Person')],
			individuals: [individual(`${NS}#alice`, 'Alice', person)]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'schema' });
		expect(model.edges.some((e) => e.kind === 'instanceOf')).toBe(false);
	});

	it('"instances" mode still includes a class with no individuals and no relations (data-catalog Story 016)', () => {
		const application = classIri('Application');
		const schema = emptySchema({
			classes: [fetchedClass(application, 'Application')]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		expect(model.nodes.some((n) => n.kind === 'entity' && n.iri === application)).toBe(true);
	});

	it('"instances" mode reconstructs an IndividualClassRelationEdgeSpec per individual→class relation, including one labeled "isMasterFor"', () => {
		const application = classIri('Application');
		const adoitIri = `${NS}#adoit`;
		const schema = emptySchema({
			classes: [fetchedClass(application, 'Application')],
			individualClassRelations: [
				individualClassRelation(adoitIri, `${NS_A}#isMasterFor`, 'isMasterFor', application, NS_A)
			]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		expect(model.edges).toEqual([
			{
				kind: 'individualRelation',
				source: adoitIri,
				target: application,
				predicateIri: `${NS_A}#isMasterFor`,
				name: 'isMasterFor',
				namespace: NS_A
			}
		]);
	});

	it('"instances" mode reconstructs an IndividualClassRelationEdgeSpec per individual→individual relation, alongside individual→class relations (relation-assertions Sprint 3 Story 007)', () => {
		const application = classIri('Application');
		const person = classIri('Person');
		const adoitIri = `${NS}#adoit`;
		const aliceIri = `${NS}#alice`;
		const bobIri = `${NS}#bob`;
		const schema = emptySchema({
			classes: [fetchedClass(application, 'Application'), fetchedClass(person, 'Person')],
			individuals: [individual(aliceIri, 'Alice', person), individual(bobIri, 'Bob', person)],
			individualClassRelations: [
				individualClassRelation(adoitIri, `${NS}#isMasterFor`, 'isMasterFor', application)
			],
			individualIndividualRelations: [
				individualIndividualRelation(aliceIri, `${NS}#isOperatedBy`, 'isOperatedBy', bobIri)
			]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		const individualRelationEdges = model.edges.filter((e) => e.kind === 'individualRelation');
		expect(individualRelationEdges).toEqual([
			{
				kind: 'individualRelation',
				source: adoitIri,
				target: application,
				predicateIri: `${NS}#isMasterFor`,
				name: 'isMasterFor',
				namespace: NS
			},
			{
				kind: 'individualRelation',
				source: aliceIri,
				target: bobIri,
				predicateIri: `${NS}#isOperatedBy`,
				name: 'isOperatedBy',
				namespace: NS
			}
		]);
	});

	it('"schema" mode never emits individual nodes or individual-relation edges, even when the schema has both', () => {
		const application = classIri('Application');
		const adoitIri = `${NS}#adoit`;
		const schema = emptySchema({
			classes: [fetchedClass(application, 'Application')],
			individuals: [individual(`${NS}#alice`, 'Alice', application)],
			individualClassRelations: [individualClassRelation(adoitIri, `${NS}#isMasterFor`, 'isMasterFor', application)]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'schema' });
		expect(model.nodes.some((n) => n.kind === 'individual')).toBe(false);
		expect(model.edges.some((e) => e.kind === 'individualRelation')).toBe(false);
	});

	it('"instances" mode reconstructs an IndividualClassRelationEdgeSpec per generalized relation, alongside one labeled "isMasterFor" (data-catalog Story 017)', () => {
		const application = classIri('Application', NS_A);
		const architectureIri = `${NS_B}#applicationArchitecture`;
		const adoitIri = `${NS_A}#adoit`;
		const schema = emptySchema({
			classes: [fetchedClass(application, 'Application', null, NS_A)],
			individualClassRelations: [
				individualClassRelation(adoitIri, `${NS_A}#isMasterFor`, 'isMasterFor', application, NS_A),
				individualClassRelation(architectureIri, `${NS_B}#isAuthorityFor`, 'isAuthorityFor', application, NS_B)
			]
		});
		const model = buildCanvasModel(schema, undefined, { viewMode: 'instances' });
		expect(model.edges).toEqual([
			{
				kind: 'individualRelation',
				source: adoitIri,
				target: application,
				predicateIri: `${NS_A}#isMasterFor`,
				name: 'isMasterFor',
				namespace: NS_A
			},
			{
				kind: 'individualRelation',
				source: architectureIri,
				target: application,
				predicateIri: `${NS_B}#isAuthorityFor`,
				name: 'isAuthorityFor',
				namespace: NS_B
			}
		]);
	});
});
