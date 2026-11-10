import { describe, expect, it } from 'vitest';
import type { FetchedSchema } from '../sparql-connector';
import { gateFindingLink } from './links';
import type { GateFinding } from './types';

const finding = (elementIri: string): GateFinding => ({
	gateId: 'g',
	stage: 'ontology',
	severity: 'warning',
	elementIri,
	message: 'm'
});
const schema = {
	classes: [{ iri: 'http://e#A', label: 'A', comment: null, namespaceBaseIri: 'http://e' }],
	datatypeProperties: [],
	objectProperties: [],
	subClassOf: [],
	individuals: [{ iri: 'http://e#ann', label: 'ann', classIri: 'http://e#A', namespaceBaseIri: 'http://e', syncSource: null, syncStatus: null }],
	untypedIndividuals: [{ iri: 'http://e#loose', label: 'loose', namespaceBaseIri: 'http://e' }],
	individualClassRelations: [],
	individualIndividualRelations: [],
	shapes: [{ iri: 'http://e#AShape', targetClassIri: 'http://e#A', paths: [], namespaceBaseIri: 'http://e' }]
} as unknown as FetchedSchema;

describe('gateFindingLink', () => {
	it('opens an individual in the identity browser', () => {
		expect(gateFindingLink(finding('http://e#ann'), schema)).toBe('/identities?node=http%3A%2F%2Fe%23ann');
		expect(gateFindingLink(finding('http://e#loose'), schema)).toBe('/identities?node=http%3A%2F%2Fe%23loose');
	});

	it('focuses a class on the canvas, and a shape through the class it targets', () => {
		expect(gateFindingLink(finding('http://e#A'), schema)).toBe('/?focus=http%3A%2F%2Fe%23A');
		expect(gateFindingLink(finding('http://e#AShape'), schema)).toBe('/?focus=http%3A%2F%2Fe%23A');
	});

	it('has no link for an element it cannot place', () => {
		expect(gateFindingLink(finding('http://e#unknown'), schema)).toBeNull();
	});

	it('opens a vocabulary finding on the concept in the Vocabulary area (STORY-324)', () => {
		const f = { ...finding('http://e/core/vocab#Customer'), stage: 'vocabulary' as const };
		expect(gateFindingLink(f, schema)).toBe('/vocabulary?concept=http%3A%2F%2Fe%2Fcore%2Fvocab%23Customer');
	});
});

describe('gateFindingLink for concepts (STORY-329)', () => {
	it('opens a thesaurus finding about a concept in the vocabulary', () => {
		const f: GateFinding = { ...finding('urn:c:Bank'), stage: 'thesaurus' };
		expect(gateFindingLink(f, schema)).toBe('/vocabulary?concept=urn%3Ac%3ABank');
	});

	it('still opens a thesaurus-stage or taxonomy-stage finding about a class on the canvas', () => {
		const f: GateFinding = { ...finding('http://e#A'), stage: 'taxonomy' };
		expect(gateFindingLink(f, schema)).toBe('/?focus=http%3A%2F%2Fe%23A');
	});
});

describe('gateFindingLink for governance (STORY-331)', () => {
	it('opens the governance page', () => {
		const f: GateFinding = { ...finding('http://e'), stage: 'governance' };
		expect(gateFindingLink(f, schema)).toBe('/governance');
	});
});

describe('gateFindingLink for question reviews (STORY-334)', () => {
	it('opens the question registry', () => {
		const f: GateFinding = { ...finding('urn:q:1'), stage: 'governance', gateId: 'question-review-overdue' };
		expect(gateFindingLink(f, schema)).toBe('/questions');
	});
});
