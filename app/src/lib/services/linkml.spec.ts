import { describe, it, expect } from 'vitest';
import { canvasModelToLinkML } from './linkml';
import type {
	CanvasModel,
	EntityNodeSpec,
	RelationEdgeSpec,
	InheritanceEdgeSpec,
	AttributedLinkEdgeSpec
} from './canvas-model';

function entity(overrides: Partial<EntityNodeSpec> & Pick<EntityNodeSpec, 'iri' | 'name'>): EntityNodeSpec {
	return {
		kind: 'entity',
		description: '',
		attributes: [],
		members: [],
		namespace: 'http://ns.example/ns',
		...overrides
	};
}

function emptyModel(): CanvasModel {
	return { nodes: [], edges: [], associationClassIris: new Set() };
}

describe('canvasModelToLinkML — core structural mapping (STORY-068)', () => {
	it('produces exact YAML for classes, a datatype attribute, a specific relation, and prefixes', () => {
		const model: CanvasModel = {
			nodes: [
				entity({
					iri: 'urn:Person',
					name: 'Person',
					description: 'A human being.',
					attributes: [{ iri: 'urn:name', name: 'name', datatype: 'string', required: true, repeatable: false }]
				}),
				entity({ iri: 'urn:Organization', name: 'Organization' })
			],
			edges: [
				{
					kind: 'relation',
					iri: 'urn:worksAt',
					source: 'urn:Person',
					target: 'urn:Organization',
					name: 'worksAt',
					required: true,
					repeatable: false,
					relationKind: 'specific',
					namespace: 'http://ns.example/ns'
				} satisfies RelationEdgeSpec
			],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(
			model,
			[{ prefix: 'core', baseIri: 'http://ld.pageagent.com/rdf-schema-editor/core' }],
			'TestSchema'
		);

		expect(yaml).toBe(
			[
				'id: http://ld.pageagent.com/rdf-schema-editor/core/schema',
				'name: TestSchema',
				'default_range: string',
				'imports:',
				'  - linkml:types',
				'prefixes:',
				'  linkml: https://w3id.org/linkml/',
				'  core: http://ld.pageagent.com/rdf-schema-editor/core/schema#',
				'classes:',
				'  Organization:',
				'  Person:',
				'    description: A human being.',
				'    attributes:',
				'      name:',
				'        range: string',
				'        required: true',
				'        multivalued: false',
				'      worksAt:',
				'        range: Organization',
				'        required: true',
				'        multivalued: false',
				''
			].join('\n')
		);
	});

	it('maps every XsdDatatype through the rename table (dateTime -> datetime, anyURI -> uri, rest 1:1)', () => {
		const model: CanvasModel = {
			nodes: [
				entity({
					iri: 'urn:Thing',
					name: 'Thing',
					attributes: [
						{ iri: 'urn:a', name: 'a', datatype: 'string', required: false, repeatable: false },
						{ iri: 'urn:b', name: 'b', datatype: 'integer', required: false, repeatable: false },
						{ iri: 'urn:c', name: 'c', datatype: 'decimal', required: false, repeatable: false },
						{ iri: 'urn:d', name: 'd', datatype: 'date', required: false, repeatable: false },
						{ iri: 'urn:e', name: 'e', datatype: 'dateTime', required: false, repeatable: false },
						{ iri: 'urn:f', name: 'f', datatype: 'boolean', required: false, repeatable: false },
						{ iri: 'urn:g', name: 'g', datatype: 'anyURI', required: false, repeatable: false }
					]
				})
			],
			edges: [],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(model);

		expect(yaml).toContain('range: string');
		expect(yaml).toContain('range: integer');
		expect(yaml).toContain('range: decimal');
		expect(yaml).toContain('range: date');
		expect(yaml).toContain('range: datetime');
		expect(yaml).toContain('range: boolean');
		expect(yaml).toContain('range: uri');
		expect(yaml).not.toContain('range: dateTime');
		expect(yaml).not.toContain('range: anyURI');
	});

	it('maps required/repeatable to required/multivalued', () => {
		const model: CanvasModel = {
			nodes: [
				entity({
					iri: 'urn:Thing',
					name: 'Thing',
					attributes: [
						{ iri: 'urn:tags', name: 'tags', datatype: 'string', required: true, repeatable: true }
					]
				})
			],
			edges: [],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(model);

		expect(yaml).toContain('required: true');
		expect(yaml).toContain('multivalued: true');
	});

	it('maps an InheritanceEdgeSpec to is_a: on the subclass', () => {
		const model: CanvasModel = {
			nodes: [entity({ iri: 'urn:Employee', name: 'Employee' }), entity({ iri: 'urn:Person', name: 'Person' })],
			edges: [
				{ kind: 'inheritance', source: 'urn:Employee', target: 'urn:Person', namespace: 'http://ns.example/ns' } satisfies InheritanceEdgeSpec
			],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(model);

		expect(yaml).toMatch(/Employee:\n\s+is_a: Person/);
	});

	it('excludes generic relations, enum members, and association-class links from a model with none of the impedance-mismatch content, without crashing', () => {
		const yaml = canvasModelToLinkML(emptyModel());
		expect(yaml).not.toContain('enums:');
		expect(yaml).not.toContain('slots:');
		expect(yaml).toContain('id:');
	});
});

describe('canvasModelToLinkML — enums, generic relations, association classes (STORY-069)', () => {
	it('emits an enum-backing class as enums:/permissible_values: instead of classes:', () => {
		const model: CanvasModel = {
			nodes: [
				entity({
					iri: 'urn:RelationType',
					name: 'RelationType',
					members: [
						{ iri: 'urn:nutzt', label: 'nutzt' },
						{ iri: 'urn:verbucht', label: 'verbucht' }
					]
				})
			],
			edges: [],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(model);

		expect(yaml).toContain('enums:');
		expect(yaml).toContain('  RelationType:');
		expect(yaml).toContain('    permissible_values:');
		expect(yaml).toContain('      nutzt:');
		expect(yaml).toContain('      verbucht:');
		expect(yaml).not.toMatch(/^classes:/m);
	});

	it('keeps a class with enumerated members as classes: (not enums:) when it is also referenced structurally', () => {
		const model: CanvasModel = {
			nodes: [
				entity({
					iri: 'urn:Status',
					name: 'Status',
					members: [{ iri: 'urn:open', label: 'open' }]
				}),
				entity({ iri: 'urn:Ticket', name: 'Ticket' })
			],
			edges: [
				{
					kind: 'relation',
					iri: 'urn:hasStatus',
					source: 'urn:Ticket',
					target: 'urn:Status',
					name: 'hasStatus',
					required: true,
					repeatable: false,
					relationKind: 'specific',
					namespace: 'http://ns.example/ns'
				} satisfies RelationEdgeSpec
			],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(model);

		expect(yaml).toContain('  Status:');
		expect(yaml).not.toContain('enums:');
	});

	it('emits a generic relation used by two source classes as one top-level slots: entry, referenced from both', () => {
		const model: CanvasModel = {
			nodes: [
				entity({ iri: 'urn:Person', name: 'Person' }),
				entity({ iri: 'urn:Organization', name: 'Organization' }),
				entity({ iri: 'urn:Topic', name: 'Topic' })
			],
			edges: [
				{
					kind: 'relation',
					iri: 'urn:relatedTo',
					source: 'urn:Person',
					target: 'urn:Topic',
					name: 'relatedTo',
					required: false,
					repeatable: true,
					relationKind: 'generic',
					namespace: 'http://ns.example/ns'
				} satisfies RelationEdgeSpec,
				{
					kind: 'relation',
					iri: 'urn:relatedTo',
					source: 'urn:Organization',
					target: 'urn:Topic',
					name: 'relatedTo',
					required: false,
					repeatable: true,
					relationKind: 'generic',
					namespace: 'http://ns.example/ns'
				} satisfies RelationEdgeSpec
			],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(model);

		expect(yaml.match(/^  relatedTo:/m) ?? []).toHaveLength(1);
		expect(yaml).toMatch(/Person:\n(?:.*\n)*?\s+slots:\n\s+- relatedTo/);
		expect(yaml).toMatch(/Organization:\n(?:.*\n)*?\s+slots:\n\s+- relatedTo/);
	});

	it('emits an association class as a classes: entry with two class-valued attributes plus an annotations: marker', () => {
		const model: CanvasModel = {
			nodes: [
				entity({ iri: 'urn:EmploymentAssignment', name: 'EmploymentAssignment' }),
				entity({ iri: 'urn:Person', name: 'Person' }),
				entity({ iri: 'urn:Organization', name: 'Organization' })
			],
			edges: [
				{
					kind: 'attributedLink',
					iri: 'urn:employee',
					source: 'urn:EmploymentAssignment',
					target: 'urn:Person',
					propName: 'employee',
					required: true,
					repeatable: false,
					namespace: 'http://ns.example/ns'
				} satisfies AttributedLinkEdgeSpec,
				{
					kind: 'attributedLink',
					iri: 'urn:employer',
					source: 'urn:EmploymentAssignment',
					target: 'urn:Organization',
					propName: 'employer',
					required: true,
					repeatable: false,
					namespace: 'http://ns.example/ns'
				} satisfies AttributedLinkEdgeSpec
			],
			associationClassIris: new Set(['urn:EmploymentAssignment'])
		};

		const yaml = canvasModelToLinkML(model);

		expect(yaml).toMatch(
			/EmploymentAssignment:\n(?:.*\n)*?\s+attributes:\n(?:.*\n)*?\s+employee:\n\s+range: Person/
		);
		expect(yaml).toMatch(
			/EmploymentAssignment:\n(?:.*\n)*?\s+attributes:\n(?:.*\n)*?\s+employer:\n\s+range: Organization/
		);
		expect(yaml).toMatch(/EmploymentAssignment:\n(?:.*\n)*?\s+annotations:\n\s+attributed_relationship: true/);
	});

	it("STORY-068's core-mapping fixture is unaffected by STORY-069's enum/generic/association handling", () => {
		const model: CanvasModel = {
			nodes: [
				entity({
					iri: 'urn:Person',
					name: 'Person',
					description: 'A human being.',
					attributes: [{ iri: 'urn:name', name: 'name', datatype: 'string', required: true, repeatable: false }]
				}),
				entity({ iri: 'urn:Organization', name: 'Organization' })
			],
			edges: [
				{
					kind: 'relation',
					iri: 'urn:worksAt',
					source: 'urn:Person',
					target: 'urn:Organization',
					name: 'worksAt',
					required: true,
					repeatable: false,
					relationKind: 'specific',
					namespace: 'http://ns.example/ns'
				} satisfies RelationEdgeSpec
			],
			associationClassIris: new Set()
		};

		const yaml = canvasModelToLinkML(
			model,
			[{ prefix: 'core', baseIri: 'http://ld.pageagent.com/rdf-schema-editor/core' }],
			'TestSchema'
		);

		expect(yaml).toBe(
			[
				'id: http://ld.pageagent.com/rdf-schema-editor/core/schema',
				'name: TestSchema',
				'default_range: string',
				'imports:',
				'  - linkml:types',
				'prefixes:',
				'  linkml: https://w3id.org/linkml/',
				'  core: http://ld.pageagent.com/rdf-schema-editor/core/schema#',
				'classes:',
				'  Organization:',
				'  Person:',
				'    description: A human being.',
				'    attributes:',
				'      name:',
				'        range: string',
				'        required: true',
				'        multivalued: false',
				'      worksAt:',
				'        range: Organization',
				'        required: true',
				'        multivalued: false',
				''
			].join('\n')
		);
	});
});
