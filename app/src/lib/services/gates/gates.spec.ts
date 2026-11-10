import { describe, expect, it } from 'vitest';
import type { FetchedSchema } from '../sparql-connector';
import { CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI } from '#lib/utils/iri.js';
import { runGates, type Gate } from './index';
import {
	classWithoutCommentGate,
	classWithoutParentGate,
	classWithoutShapeGate,
	individualOutsideDomainGate,
	shapePathUndeclaredGate
} from './ontology-gates';

const NS = 'http://e';
const cls = (name: string, comment: string | null = 'c') => ({
	iri: `${NS}#${name}`,
	label: name,
	comment,
	namespaceBaseIri: NS
});
const prop = (name: string, domain: string) => ({
	iri: `${NS}#${name}`,
	label: name,
	domain: `${NS}#${domain}`,
	range: 'http://www.w3.org/2001/XMLSchema#string',
	namespaceBaseIri: NS,
	required: false,
	repeatable: false
});
const schema = (over: Partial<FetchedSchema> = {}): FetchedSchema => ({
	classes: [],
	datatypeProperties: [],
	objectProperties: [],
	subClassOf: [],
	individuals: [],
	individualClassRelations: [],
	individualIndividualRelations: [],
	...over
});
const ids = (findings: { elementIri: string }[]) => findings.map((f) => f.elementIri);

describe('classWithoutCommentGate', () => {
	it('warns about a class with no or blank comment and accepts one with a comment', () => {
		const findings = classWithoutCommentGate.run(schema({ classes: [cls('A', null), cls('B', '  '), cls('C', 'text')] }), {});
		expect(ids(findings)).toEqual([`${NS}#A`, `${NS}#B`]);
		expect(findings[0]).toMatchObject({ gateId: 'class-without-comment', stage: 'ontology', severity: 'warning' });
		expect(findings[0].message).toContain('A');
	});
});

describe('classWithoutParentGate', () => {
	it('gives an info for a class that is nobody\'s subclass', () => {
		const findings = classWithoutParentGate.run(
			schema({ classes: [cls('A'), cls('B')], subClassOf: [{ sub: `${NS}#B`, super: `${NS}#A`, namespaceBaseIri: NS }] }),
			{}
		);
		expect(ids(findings)).toEqual([`${NS}#A`]);
		expect(findings[0].severity).toBe('info');
	});
});

describe('classWithoutShapeGate', () => {
	it('warns about a class that no shape targets', () => {
		const shapes = [{ iri: `${NS}#AShape`, targetClassIri: `${NS}#A`, paths: [], namespaceBaseIri: NS }];
		const findings = classWithoutShapeGate.run(schema({ classes: [cls('A'), cls('B')], shapes }), {});
		expect(ids(findings)).toEqual([`${NS}#B`]);
		expect(findings[0].severity).toBe('warning');
	});

	it('says nothing when the shapes were not loaded', () => {
		expect(classWithoutShapeGate.run(schema({ classes: [cls('A')] }), {})).toEqual([]);
	});
});

describe('shapePathUndeclaredGate and the app own link predicate (STORY-325)', () => {
	it('does not warn about the definedByConcept path of the app maxCount shape', () => {
		const shapes = [
			{ iri: `${NS}#LinkShape`, targetClassIri: 'http://www.w3.org/2002/07/owl#Class', paths: [CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI], namespaceBaseIri: NS }
		];
		expect(shapePathUndeclaredGate.run(schema({ shapes }), {})).toEqual([]);
	});
});

describe('shapePathUndeclaredGate', () => {
	it('warns about a shape path that is no declared property, but not about vocabulary paths', () => {
		const shapes = [
			{
				iri: `${NS}#AShape`,
				targetClassIri: `${NS}#A`,
				paths: [`${NS}#name`, `${NS}#ghost`, 'http://www.w3.org/2000/01/rdf-schema#label'],
				namespaceBaseIri: NS
			}
		];
		const findings = shapePathUndeclaredGate.run(
			schema({ classes: [cls('A')], datatypeProperties: [prop('name', 'A')], shapes }),
			{}
		);
		expect(ids(findings)).toEqual([`${NS}#AShape`]);
		expect(findings[0].message).toContain('ghost');
	});

	it('counts a declared relation as declared and says nothing without shapes', () => {
		const shapes = [{ iri: `${NS}#S`, paths: [`${NS}#rel`], namespaceBaseIri: NS }];
		expect(
			shapePathUndeclaredGate.run(schema({ objectProperties: [{ ...prop('rel', 'A'), relationKind: 'specific' }] as never, shapes }), {})
		).toEqual([]);
		expect(shapePathUndeclaredGate.run(schema(), {})).toEqual([]);
	});
});

describe('individualOutsideDomainGate', () => {
	const base = {
		classes: [cls('Person'), cls('Employee'), cls('Team')],
		subClassOf: [{ sub: `${NS}#Employee`, super: `${NS}#Person`, namespaceBaseIri: NS }],
		objectProperties: [{ ...prop('memberOf', 'Person'), range: `${NS}#Team`, relationKind: 'specific' }] as never
	};
	const ind = (name: string, type: string) => ({
		iri: `${NS}#${name}`,
		label: name,
		classIri: `${NS}#${type}`,
		namespaceBaseIri: NS,
		syncSource: null,
		syncStatus: null
	});
	const rel = (individualIri: string) => ({
		individualIri,
		predicateIri: `${NS}#memberOf`,
		name: 'memberOf',
		classIri: `${NS}#Team`,
		namespaceBaseIri: NS
	});

	it('accepts an instance of the domain or of a subclass of it', () => {
		const findings = individualOutsideDomainGate.run(
			schema({
				...base,
				individuals: [ind('ann', 'Person'), ind('bob', 'Employee')],
				individualClassRelations: [rel(`${NS}#ann`), rel(`${NS}#bob`)]
			}),
			{}
		);
		expect(findings).toEqual([]);
	});

	it('warns about a subject that is typed with something else, once per property', () => {
		const findings = individualOutsideDomainGate.run(
			schema({
				...base,
				individuals: [ind('acme', 'Team')],
				individualClassRelations: [rel(`${NS}#acme`), rel(`${NS}#acme`)]
			}),
			{}
		);
		expect(ids(findings)).toEqual([`${NS}#acme`]);
		expect(findings[0]).toMatchObject({ stage: 'ontology', severity: 'warning' });
	});

	it('also checks individual-to-individual relations and untyped subjects', () => {
		const findings = individualOutsideDomainGate.run(
			schema({
				...base,
				untypedIndividuals: [{ iri: `${NS}#x`, label: 'x', namespaceBaseIri: NS }],
				individualIndividualRelations: [
					{ individualIri: `${NS}#x`, predicateIri: `${NS}#memberOf`, name: 'memberOf', targetIndividualIri: `${NS}#t`, namespaceBaseIri: NS }
				]
			}),
			{}
		);
		expect(ids(findings)).toEqual([`${NS}#x`]);
	});

	it('skips subjects it does not know and properties without a declared domain', () => {
		const findings = individualOutsideDomainGate.run(
			schema({
				...base,
				individuals: [ind('acme', 'Team')],
				individualClassRelations: [
					rel(`${NS}#stranger`),
					{ ...rel(`${NS}#acme`), predicateIri: `${NS}#undeclared` }
				]
			}),
			{}
		);
		expect(findings).toEqual([]);
	});
});

describe('runGates', () => {
	const fixture = schema({ classes: [cls('A', null)] });

	it('collects the findings of every gate', () => {
		const findings = runGates(fixture);
		expect(findings.map((f) => f.gateId)).toContain('class-without-comment');
		expect(findings.every((f) => f.stage && f.severity && f.elementIri)).toBe(true);
	});

	it('restricts to the requested stages and ignores a stage name it does not know', () => {
		expect(runGates(fixture, { stages: ['vocabulary'] })).toEqual([]);
		expect(runGates(fixture, { stages: ['nonsense', 'ontology'] }).length).toBeGreaterThan(0);
		expect(() => runGates(fixture, { stages: ['nonsense'] })).not.toThrow();
	});

	it('runs a custom registry and survives a gate that throws', () => {
		const boom: Gate = { id: 'boom', stage: 'ontology', run: () => { throw new Error('x'); } };
		const ok: Gate = {
			id: 'ok',
			stage: 'vocabulary',
			run: () => [{ gateId: 'ok', stage: 'vocabulary', severity: 'info', elementIri: 'http://e#1', message: 'm' }]
		};
		expect(runGates(fixture, {}, [boom, ok]).map((f) => f.gateId)).toEqual(['ok']);
	});
});
