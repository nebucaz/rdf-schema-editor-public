import { describe, it, expect } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import type { FetchedSchema } from './sparql-connector';
import { buildSocFetchedSchema, loadSocQuads, SOC_SCHEMA_NS } from './soc-test-support';

const NS = 'http://example.org/ns';
const iri = (n: string) => `${NS}#${n}`;

function schema(over: Partial<FetchedSchema> = {}): FetchedSchema {
	return {
		classes: [
			{ iri: iri('Application'), label: 'Application', comment: null, namespaceBaseIri: NS },
			{ iri: iri('WebApp'), label: 'Web App', comment: null, namespaceBaseIri: NS },
			{ iri: iri('Server'), label: 'Server', comment: null, namespaceBaseIri: NS },
			{ iri: iri('Lifecycle'), label: 'Lifecycle', comment: null, namespaceBaseIri: NS }
		],
		datatypeProperties: [
			{
				iri: iri('appName'), label: 'Name', domain: iri('Application'),
				range: 'http://www.w3.org/2001/XMLSchema#string', namespaceBaseIri: NS,
				required: true, repeatable: false, minCount: 1, maxCount: 1
			},
			{
				iri: iri('code'), label: '', domain: iri('Application'),
				range: 'http://www.w3.org/2001/XMLSchema#string', namespaceBaseIri: NS,
				required: false, repeatable: true
			}
		],
		objectProperties: [
			{
				iri: iri('hostedOn'), label: 'hosted on', domain: iri('Application'), range: iri('Server'),
				namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific'
			}
		],
		subClassOf: [{ sub: iri('WebApp'), super: iri('Application'), namespaceBaseIri: NS }],
		individuals: [
			{ iri: iri('prod'), label: 'Production', classIri: iri('Lifecycle'), namespaceBaseIri: NS, syncSource: null, syncStatus: null },
			{ iri: iri('dev'), label: 'Development', classIri: iri('Lifecycle'), namespaceBaseIri: NS, syncSource: null, syncStatus: null },
			{ iri: iri('app1'), label: 'App 1', classIri: iri('Application'), namespaceBaseIri: NS, syncSource: null, syncStatus: null }
		],
		individualClassRelations: [],
		individualIndividualRelations: [],
		...over
	};
}

describe('buildBuilderSchema', () => {
	it('splits datatype properties and relationships per class', () => {
		const app = buildBuilderSchema(schema()).classes.get(iri('Application'))!;
		expect(app.properties.map((p) => p.iri)).toEqual([iri('appName'), iri('code')]);
		expect(app.properties[0]).toMatchObject({
			label: 'Name', datatype: 'http://www.w3.org/2001/XMLSchema#string', required: true, repeatable: false
		});
		expect(app.relationships.map((r) => r.iri)).toEqual([iri('hostedOn')]);
		expect(app.relationships[0]).toMatchObject({ targetClassIri: iri('Server'), targetLabel: 'Server' });
		expect(buildBuilderSchema(schema()).classes.get(iri('Server'))!.relationships).toEqual([]);
	});

	it('falls back to the IRI local name when there is no label', () => {
		const app = buildBuilderSchema(schema()).classes.get(iri('Application'))!;
		expect(app.properties[1].label).toBe('code');
		const bare = buildBuilderSchema(
			schema({ classes: [{ iri: iri('Bare'), label: '', comment: null, namespaceBaseIri: NS }] })
		);
		expect(bare.classes.get(iri('Bare'))!.label).toBe('Bare');
	});

	it('computes transitive, cycle-safe subclasses', () => {
		const s = buildBuilderSchema(schema({
			subClassOf: [
				{ sub: iri('WebApp'), super: iri('Application'), namespaceBaseIri: NS },
				{ sub: iri('Server'), super: iri('WebApp'), namespaceBaseIri: NS },
				{ sub: iri('Application'), super: iri('Server'), namespaceBaseIri: NS } // cycle
			]
		}));
		expect(s.classes.get(iri('Application'))!.subclasses.sort()).toEqual(
			[iri('Server'), iri('WebApp')].sort()
		);
		expect(s.classes.get(iri('Application'))!.subclasses).not.toContain(iri('Application'));
	});

	it('detects enumerated-member classes with member IRIs and labels', () => {
		const s = buildBuilderSchema(schema());
		const life = s.classes.get(iri('Lifecycle'))!;
		expect(life.isEnumeration).toBe(true);
		expect(life.members).toEqual([
			{ value: iri('prod'), label: 'Production', isIri: true },
			{ value: iri('dev'), label: 'Development', isIri: true }
		]);
		expect(s.classes.get(iri('Application'))!.isEnumeration).toBe(false);
	});

	it('exposes sh:in values as allowed values on the property', () => {
		const s = buildBuilderSchema(schema({
			shapeInConstraints: [
				{ classIri: iri('Application'), propertyIri: iri('code'), values: [
					{ value: 'A', isIri: false }, { value: iri('prod'), isIri: true }
				] }
			]
		}));
		const code = s.classes.get(iri('Application'))!.properties.find((p) => p.iri === iri('code'))!;
		expect(code.allowedValues).toEqual([
			{ value: 'A', label: 'A', isIri: false },
			{ value: iri('prod'), label: 'Production', isIri: true }
		]);
	});

	it('picks up a class added to the fixture with no code change', () => {
		const base = schema();
		const added = schema({
			classes: [...base.classes, { iri: iri('Database'), label: 'Database', comment: null, namespaceBaseIri: NS }],
			datatypeProperties: [...base.datatypeProperties, {
				iri: iri('engine'), label: 'Engine', domain: iri('Database'),
				range: 'http://www.w3.org/2001/XMLSchema#string', namespaceBaseIri: NS, required: false, repeatable: true
			}]
		});
		const db = buildBuilderSchema(added).classes.get(iri('Database'))!;
		expect(db.properties.map((p) => p.label)).toEqual(['Engine']);
	});

	it('is pure: does not mutate its input', () => {
		const s = schema();
		const copy = structuredClone(s);
		buildBuilderSchema(s);
		expect(s).toEqual(copy);
	});
});

describe('buildBuilderSchema — inbound relationships (STORY-226)', () => {
	const soc = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
	const socIri = (n: string) => `${SOC_SCHEMA_NS}${n}`;
	const inbound = (name: string) => soc.classes.get(socIri(name))!.inboundRelationships;

	it('lists hostedOn from LogFile on Server', () => {
		expect(inbound('Server')).toContainEqual(
			expect.objectContaining({ iri: socIri('hostedOn'), sourceClassIri: socIri('LogFile') })
		);
	});

	it('lists recordedIn from AuthenticationEvent on LogFile', () => {
		expect(inbound('LogFile')).toContainEqual(
			expect.objectContaining({ iri: socIri('recordedIn'), sourceClassIri: socIri('AuthenticationEvent') })
		);
	});

	it('lists triggeredBy from Alert on AuthenticationEvent', () => {
		expect(inbound('AuthenticationEvent')).toContainEqual(
			expect.objectContaining({ iri: socIri('triggeredBy'), sourceClassIri: socIri('Alert') })
		);
	});

	it('gives a class nothing points at an empty list', () => {
		expect(inbound('Alert')).toEqual([]);
	});

	it('carries source label, cardinality and a display label', () => {
		const inb = buildBuilderSchema(schema()).classes.get(iri('Server'))!.inboundRelationships;
		expect(inb).toEqual([
			expect.objectContaining({
				iri: iri('hostedOn'), label: 'hosted on', sourceClassIri: iri('Application'),
				sourceLabel: 'Application', required: false, repeatable: true, displayLabel: 'hosted on'
			})
		]);
	});

	it('inherits entries targeting a superclass for its subclasses', () => {
		const s = schema({
			objectProperties: [
				{
					iri: iri('ownedBy'), label: 'owned by', domain: iri('Lifecycle'), range: iri('Application'),
					namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific'
				}
			]
		});
		const b = buildBuilderSchema(s);
		expect(b.classes.get(iri('Application'))!.inboundRelationships.map((r) => r.iri)).toEqual([iri('ownedBy')]);
		expect(b.classes.get(iri('WebApp'))!.inboundRelationships.map((r) => r.iri)).toEqual([iri('ownedBy')]);
		expect(b.classes.get(iri('Server'))!.inboundRelationships).toEqual([]);
	});

	it('disambiguates identical labels with the source class', () => {
		const rel = (name: string, domain: string) => ({
			iri: iri(name), label: 'uses', domain: iri(domain), range: iri('Server'),
			namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific' as const
		});
		const s = schema({ objectProperties: [rel('appUses', 'Application'), rel('lifeUses', 'Lifecycle')] });
		const inb = buildBuilderSchema(s).classes.get(iri('Server'))!.inboundRelationships;
		expect(inb.map((r) => r.displayLabel).sort()).toEqual(['uses (Application)', 'uses (Lifecycle)']);
	});

	it('keeps one entry per property and source even for repeated range rows', () => {
		const row = {
			iri: iri('hostedOn'), label: 'hosted on', domain: iri('Application'), range: iri('Server'),
			namespaceBaseIri: NS, required: false, repeatable: true, relationKind: 'specific' as const
		};
		const inb = buildBuilderSchema(schema({ objectProperties: [row, { ...row }] })).classes.get(iri('Server'))!
			.inboundRelationships;
		expect(inb).toHaveLength(1);
	});
});
