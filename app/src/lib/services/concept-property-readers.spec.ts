import { describe, expect, it } from 'vitest';
import { buildCanvasModel, type EntityNodeSpec } from './canvas-model';
import { buildBuilderSchema } from './query-builder-schema';
import { nameableEntitiesFromSchema } from './addable-elements';
import { runGates } from './gates/index';
import { SparqlConnector, type FetchedConceptProperty, type FetchedSchema } from './sparql-connector';

/**
 * concept-valued-properties STORY-436: a concept property has a `sh:property` with no `sh:class` and no `rdfs:range`,
 * but carries `rse:valueScheme`. It reaches the readers as `FetchedSchema.conceptProperties`, never as an object
 * property, so no reader draws an edge to nothing or throws. Each audited reader and its expected output is listed here.
 */
const NS = 'http://example.org/ns';
const device = `${NS}#Device`;
const laptop = `${NS}#Laptop`;
const stage = `${NS}/schema#deviceLifecycleStage`;
const scheme = 'http://example.org/core/vocab#Lifecycle';

const concept: FetchedConceptProperty = {
	iri: stage, label: 'lifecycleStage', domain: device, valueSchemeIri: scheme,
	required: true, repeatable: false, minCount: 1, maxCount: 1, namespaceBaseIri: NS
};
const cls = (iri: string, label: string) => ({ iri, label, comment: null, namespaceBaseIri: NS });
const schema: FetchedSchema = {
	classes: [cls(device, 'Device'), cls(laptop, 'Laptop')],
	datatypeProperties: [],
	objectProperties: [],
	subClassOf: [{ sub: laptop, super: device, namespaceBaseIri: NS }],
	individuals: [],
	individualClassRelations: [],
	individualIndividualRelations: [],
	conceptProperties: [concept]
};
const entity = (iri: string) => buildCanvasModel(schema).nodes.find((n) => n.iri === iri) as EntityNodeSpec;

describe('readers of a concept property (STORY-436)', () => {
	it('buildCanvasModel: no edge and no external node, a concept field on the owner and (inherited) on the subclass', () => {
		const model = buildCanvasModel(schema);
		expect(model.edges.filter((e) => e.kind !== 'inheritance')).toEqual([]);
		expect(model.nodes.filter((n) => n.kind === 'external')).toEqual([]);
		expect(entity(device).conceptFields).toEqual([
			{ iri: stage, name: 'lifecycleStage', targetClassIri: '', targetClassName: '', valueSchemeIri: scheme, required: true, repeatable: false }
		]);
		expect(entity(laptop).conceptFields).toEqual([
			{
				iri: stage, name: 'lifecycleStage', targetClassIri: '', targetClassName: '', valueSchemeIri: scheme, required: true, repeatable: false,
				inheritedFrom: { classIri: device, className: 'Device' }
			}
		]);
		expect(entity(device).relationFields).toEqual([]);
	});

	it('buildCanvasModel: an entity without a concept property carries no conceptFields', () => {
		const plain = buildCanvasModel({ ...schema, conceptProperties: undefined });
		expect((plain.nodes[0] as EntityNodeSpec).conceptFields).toBeUndefined();
	});

	it('buildBuilderSchema: a column of the owner, never a relationship hop', () => {
		const builder = buildBuilderSchema(schema).classes.get(device)!;
		expect(builder.relationships).toEqual([]);
		expect(builder.inboundRelationships).toEqual([]);
		expect(builder.properties).toHaveLength(1);
		expect(builder.properties[0]).toMatchObject({ iri: stage, label: 'lifecycleStage', valueSchemeIri: scheme, required: true, repeatable: false });
		expect(builder.isEnumeration).toBe(false);
	});

	it('nameableEntitiesFromSchema: unchanged, the property is not an entity', () => {
		expect(nameableEntitiesFromSchema(schema).map((e) => e.iri).sort()).toEqual([device, laptop].sort());
	});

	it('fetchRelationPredicateOptions: does not offer it as a relation predicate', async () => {
		const options = await new SparqlConnector('/api/sparql').fetchRelationPredicateOptions(schema);
		expect(options).toEqual([]);
	});

	it('the gates run over it without throwing and report nothing about a half-built relation', () => {
		expect(() => runGates(schema)).not.toThrow();
		expect(runGates(schema).filter((f) => f.elementIri === stage)).toEqual([]);
	});
});
