import { describe, expect, it } from 'vitest';
import type {
	CanvasAttributeSpec,
	CanvasModel,
	EdgeSpec,
	EntityNodeSpec,
	ExternalNodeSpec,
	IndividualNodeSpec,
	NodeSpec
} from './canvas-model';
import { buildErdModel, cardinalityFromCounts, cardinalityOf, exactMultiplicity } from './erd-model';

const NS_A = 'http://example.org/a';
const NS_B = 'http://example.org/b';

function entity(
	name: string,
	namespace = NS_A,
	attributes: CanvasAttributeSpec[] = []
): EntityNodeSpec {
	return {
		kind: 'entity',
		iri: `${namespace}#${name}`,
		name,
		description: '',
		attributes,
		relationFields: [],
		members: [{ iri: `${namespace}#${name}Member`, label: 'm' }],
		namespace,
		labelRequired: false
	};
}

function attr(name: string, extra: Partial<CanvasAttributeSpec> = {}): CanvasAttributeSpec {
	return {
		iri: `http://example.org/a#${name}`,
		name,
		datatype: 'string',
		required: false,
		repeatable: false,
		...extra
	};
}

function model(
	nodes: NodeSpec[],
	edges: EdgeSpec[] = [],
	associationClassIris: string[] = []
): CanvasModel {
	return {
		nodes,
		edges,
		associationClassIris: new Set(associationClassIris),
		authoritativeEntityIris: new Set(),
		labelRequiredClassIris: new Set()
	};
}

function relation(
	name: string,
	source: string,
	target: string,
	extra: Partial<Extract<EdgeSpec, { kind: 'relation' }>> = {}
): EdgeSpec {
	return {
		kind: 'relation',
		iri: `http://example.org/a#${name}`,
		source,
		target,
		name,
		required: false,
		repeatable: false,
		relationKind: 'specific',
		namespace: NS_A,
		...extra
	};
}

const iri = (name: string, ns = NS_A) => `${ns}#${name}`;
const members = (...names: string[]) => new Set(names.map((n) => iri(n)));

describe('cardinalityOf', () => {
	it('maps all four required×repeatable combinations', () => {
		expect(cardinalityOf(false, false)).toBe('0..1');
		expect(cardinalityOf(true, false)).toBe('1');
		expect(cardinalityOf(false, true)).toBe('0..*');
		expect(cardinalityOf(true, true)).toBe('1..*');
	});
});

describe('cardinalityFromCounts', () => {
	it('prefers the shape counts over the flags', () => {
		expect(cardinalityFromCounts(false, false, 0, 1)).toBe('0..1');
		expect(cardinalityFromCounts(true, false, 1, 1)).toBe('1');
		expect(cardinalityFromCounts(false, false, 2, 5)).toBe('1..*');
		expect(cardinalityFromCounts(true, true, 0, 1)).toBe('0..1');
	});

	it('falls back to the flags when no counts are known', () => {
		expect(cardinalityFromCounts(true, true)).toBe('1..*');
		expect(cardinalityFromCounts(false, false)).toBe('0..1');
	});

	it('reports exact multiplicity text only when the symbol is not exact', () => {
		expect(exactMultiplicity('1..*', 2, 5)).toBe('2..5');
		expect(exactMultiplicity('1', 1, 1)).toBeUndefined();
		expect(exactMultiplicity('0..1', 0, 1)).toBeUndefined();
		expect(exactMultiplicity('0..1')).toBeUndefined();
	});
});

describe('buildErdModel — scope', () => {
	it('includes only workspace-member classes, ignoring everything else in the canvas model', () => {
		const m = model([entity('Person'), entity('Company', NS_B), entity('Hidden')]);
		const erd = buildErdModel(m, { memberIris: new Set([iri('Person'), iri('Company', NS_B)]) });
		expect(erd.entities.map((e) => e.name).sort()).toEqual(['Company', 'Person']);
	});

	it('derives relation cardinality from sh:minCount/sh:maxCount when present', () => {
		const m = model([entity('A'), entity('B')], [
			relation('r', iri('A'), iri('B'), { minCount: 2, maxCount: 5 })
		]);
		const [r] = buildErdModel(m, { memberIris: members('A', 'B') }).relations;
		expect([r.cardinality, r.multiplicity]).toEqual(['1..*', '2..5']);
	});

	it('leaves out entities in namespaces hidden on the workbench', () => {
		const m = model([entity('Person'), entity('ZBeta', NS_B)]);
		const erd = buildErdModel(m, {
			memberIris: new Set([iri('Person'), iri('ZBeta', NS_B)]),
			hiddenNamespaces: new Set([NS_B])
		});
		expect(erd.entities.map((e) => e.name)).toEqual(['Person']);
	});

	it('omits generated reverse relations when the workbench hides them', () => {
		const m = model([entity('A'), entity('B')], [
			relation('rev', iri('B'), iri('A'), { generatedReverseOf: 'http://example.org/a#gone' })
		]);
		const erd = buildErdModel(m, { memberIris: members('A', 'B'), showReverseRelations: false });
		expect(erd.relations).toEqual([]);
	});

	it('omits individuals, instance edges and enumeration members', () => {
		const individual: IndividualNodeSpec = {
			kind: 'individual',
			iri: iri('bob'),
			label: 'bob',
			classIri: iri('Person'),
			className: 'Person',
			namespace: NS_A,
			syncSource: null,
			isStale: false
		};
		const m = model(
			[entity('Person'), individual],
			[
				{ kind: 'instanceOf', source: iri('bob'), target: iri('Person'), namespace: NS_A },
				{
					kind: 'individualRelation',
					source: iri('bob'),
					target: iri('Person'),
					predicateIri: 'p',
					name: 'knows',
					namespace: NS_A
				}
			]
		);
		const erd = buildErdModel(m, { memberIris: new Set([iri('Person'), iri('bob')]) });
		expect(erd.entities).toHaveLength(1);
		expect(erd.relations).toEqual([]);
		expect(JSON.stringify(erd)).not.toContain('Member');
		expect(erd.entities[0]).not.toHaveProperty('members');
	});

	it('resolves the namespace colour onto each entity', () => {
		const m = model([entity('Person'), entity('Company', NS_B)]);
		const erd = buildErdModel(m, {
			memberIris: members('Person', 'Company').add(iri('Company', NS_B)) as Set<string>,
			namespaceColors: new Map([[NS_A, '#ff0000']])
		});
		expect(erd.entities.find((e) => e.name === 'Person')?.color).toBe('#ff0000');
		expect(erd.entities.find((e) => e.name === 'Company')?.color).toBeUndefined();
	});
});

describe('buildErdModel — attributes', () => {
	it('keeps own and inherited attributes, inherited ones carrying their origin', () => {
		const inheritedFrom = { classIri: iri('Base'), className: 'Base' };
		const m = model([
			entity('Child', NS_A, [
				attr('own', { required: true, repeatable: true }),
				attr('fromBase', { inheritedFrom })
			])
		]);
		const [child] = buildErdModel(m, { memberIris: members('Child') }).entities;
		expect(child.attributes).toEqual([
			{ name: 'own', datatype: 'string', required: true, repeatable: true },
			{ name: 'fromBase', datatype: 'string', required: false, repeatable: false, inheritedFrom }
		]);
	});
});

describe('buildErdModel — relations', () => {
	const nodes = [entity('A'), entity('B')];

	it.each([
		[false, false, '0..1'],
		[true, false, '1'],
		[false, true, '0..*'],
		[true, true, '1..*']
	] as const)('relation required=%s repeatable=%s → %s', (required, repeatable, expected) => {
		const m = model(nodes, [relation('r', iri('A'), iri('B'), { required, repeatable })]);
		const erd = buildErdModel(m, { memberIris: members('A', 'B') });
		expect(erd.relations).toEqual([
			{
				iri: 'http://example.org/a#r',
				name: 'r',
				sourceIri: iri('A'),
				targetIri: iri('B'),
				cardinality: expected,
				relationKind: 'specific'
			}
		]);
	});

	it('draws generic relations like specific ones', () => {
		const m = model(nodes, [relation('r', iri('A'), iri('B'), { relationKind: 'generic' })]);
		const erd = buildErdModel(m, { memberIris: members('A', 'B') });
		expect(erd.relations).toHaveLength(1);
		expect(erd.relations[0].relationKind).toBe('generic');
	});

	it('omits a generated reverse relation when its forward relation is present', () => {
		const m = model(nodes, [
			relation('fwd', iri('A'), iri('B')),
			relation('rev', iri('B'), iri('A'), { generatedReverseOf: 'http://example.org/a#fwd' })
		]);
		const erd = buildErdModel(m, { memberIris: members('A', 'B') });
		expect(erd.relations.map((r) => r.name)).toEqual(['fwd']);
	});

	it('keeps a generated reverse relation whose forward relation is absent', () => {
		const m = model(nodes, [
			relation('rev', iri('B'), iri('A'), { generatedReverseOf: 'http://example.org/a#gone' })
		]);
		const erd = buildErdModel(m, { memberIris: members('A', 'B') });
		expect(erd.relations.map((r) => r.name)).toEqual(['rev']);
	});

	it('drops relations whose endpoint is not a kept entity', () => {
		const m = model(nodes, [relation('r', iri('A'), iri('B'))]);
		const erd = buildErdModel(m, { memberIris: members('A') });
		expect(erd.relations).toEqual([]);
	});

	it('keeps self-relations', () => {
		const m = model(nodes, [relation('r', iri('A'), iri('A'))]);
		const erd = buildErdModel(m, { memberIris: members('A') });
		expect(erd.relations).toHaveLength(1);
	});
});

describe('buildErdModel — association classes, inheritance, externals', () => {
	const external: ExternalNodeSpec = { kind: 'external', iri: 'http://x.org/Agent', prefixedName: 'foaf:Agent' };

	it('flags association classes and emits their links', () => {
		const m = model(
			[entity('Employment'), entity('Person'), entity('Company')],
			[
				{
					kind: 'attributedLink',
					iri: 'http://example.org/a#employee',
					source: iri('Employment'),
					target: iri('Person'),
					propName: 'employee',
					required: true,
					repeatable: false,
					namespace: NS_A
				},
				{
					kind: 'attributedLink',
					iri: 'http://example.org/a#employer',
					source: iri('Employment'),
					target: iri('Company'),
					propName: 'employer',
					required: false,
					repeatable: true,
					namespace: NS_A
				}
			],
			[iri('Employment')]
		);
		const erd = buildErdModel(m, { memberIris: members('Employment', 'Person', 'Company') });
		expect(erd.entities.find((e) => e.name === 'Employment')?.isAssociationClass).toBe(true);
		expect(erd.entities.find((e) => e.name === 'Person')?.isAssociationClass).toBe(false);
		expect(erd.associationLinks).toEqual([
			{
				iri: 'http://example.org/a#employee',
				name: 'employee',
				associationIri: iri('Employment'),
				targetIri: iri('Person'),
				cardinality: '1'
			},
			{
				iri: 'http://example.org/a#employer',
				name: 'employer',
				associationIri: iri('Employment'),
				targetIri: iri('Company'),
				cardinality: '0..*'
			}
		]);
		expect(erd.relations).toEqual([]);
	});

	it('emits inheritance links between kept entities and to referenced externals', () => {
		const m = model(
			[entity('Child'), entity('Parent'), external],
			[
				{ kind: 'inheritance', source: iri('Child'), target: iri('Parent'), namespace: NS_A },
				{ kind: 'inheritance', source: iri('Parent'), target: external.iri, namespace: NS_A }
			]
		);
		const erd = buildErdModel(m, { memberIris: members('Child', 'Parent') });
		expect(erd.inheritances).toEqual([
			{ subIri: iri('Child'), superIri: iri('Parent') },
			{ subIri: iri('Parent'), superIri: external.iri }
		]);
		expect(erd.externals).toEqual([{ iri: external.iri, prefixedName: 'foaf:Agent' }]);
	});

	it('omits externals no kept inheritance references', () => {
		const m = model([entity('Child'), external], [
			{ kind: 'inheritance', source: iri('Hidden'), target: external.iri, namespace: NS_A }
		]);
		const erd = buildErdModel(m, { memberIris: members('Child') });
		expect(erd.externals).toEqual([]);
		expect(erd.inheritances).toEqual([]);
	});
});

describe('buildErdModel — selection filter', () => {
	const nodes = [entity('A'), entity('B'), entity('C')];
	const edges = [relation('ab', iri('A'), iri('B')), relation('bc', iri('B'), iri('C'))];

	it('ignores an empty selection', () => {
		const erd = buildErdModel(model(nodes, edges), {
			memberIris: members('A', 'B', 'C'),
			selection: new Set()
		});
		expect(erd.entities).toHaveLength(3);
		expect(erd.relations).toHaveLength(2);
	});

	it('restricts to selected members and the edges between them', () => {
		const erd = buildErdModel(model(nodes, edges), {
			memberIris: members('A', 'B', 'C'),
			selection: members('A', 'B')
		});
		expect(erd.entities.map((e) => e.name)).toEqual(['A', 'B']);
		expect(erd.relations.map((r) => r.name)).toEqual(['ab']);
	});

	it('never admits a selected non-member', () => {
		const erd = buildErdModel(model(nodes, edges), {
			memberIris: members('A'),
			selection: members('A', 'B')
		});
		expect(erd.entities.map((e) => e.name)).toEqual(['A']);
	});

	describe('association classes and inheritance', () => {
		const link = (name: string, target: string) => ({
			kind: 'attributedLink' as const,
			iri: iri(name),
			source: iri('Employment'),
			target: iri(target),
			propName: name,
			required: true,
			repeatable: false,
			namespace: NS_A
		});
		const m = model(
			[entity('Employment'), entity('Person'), entity('Company')],
			[
				link('employee', 'Person'),
				link('employer', 'Company'),
				{ kind: 'inheritance', source: iri('Person'), target: iri('Company'), namespace: NS_A }
			],
			[iri('Employment')]
		);
		const all = members('Employment', 'Person', 'Company');

		it('keeps association links only when the class and the linked entity are both selected', () => {
			const erd = buildErdModel(m, { memberIris: all, selection: members('Employment', 'Person') });
			expect(erd.associationLinks.map((l) => l.name)).toEqual(['employee']);
		});

		it('keeps every link when all endpoints are selected, and none when the class itself is not', () => {
			expect(buildErdModel(m, { memberIris: all, selection: all }).associationLinks).toHaveLength(2);
			expect(buildErdModel(m, { memberIris: all, selection: members('Person', 'Company') }).associationLinks).toEqual([]);
		});

		it('omits an inheritance link with an unselected endpoint', () => {
			expect(buildErdModel(m, { memberIris: all, selection: members('Person') }).inheritances).toEqual([]);
			expect(buildErdModel(m, { memberIris: all, selection: members('Person', 'Company') }).inheritances).toHaveLength(1);
		});
	});
});
