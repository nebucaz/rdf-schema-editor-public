import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { FetchedClass, FetchedSchema } from '../sparql-connector';
import { LINK_GATES, runLinkGates } from './link';
import { runGates } from './index';

const NS = 'http://e/gov';
const VOCAB = 'http://e/core/vocab';
const cls = (name: string, over: Partial<FetchedClass> = {}): FetchedClass => ({
	iri: `${NS}/schema#${name}`,
	label: name,
	comment: null,
	namespaceBaseIri: NS,
	...over
});
const concept = (name: string, over: Partial<Concept> = {}): Concept => ({
	iri: `${VOCAB}#${name}`,
	prefLabels: [{ text: name, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: `${name} definition`, scopeNote: '', disambiguation: '',
	schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});
const schema = (classes: FetchedClass[]): FetchedSchema =>
	({ classes, datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [], individualClassRelations: [], individualIndividualRelations: [] }) as unknown as FetchedSchema;

const run = (classes: FetchedClass[], concepts: Concept[]) =>
	runLinkGates(schema(classes), concepts).map((f) => [f.gateId, f.elementIri, f.severity]);

describe('link gates (STORY-327)', () => {
	it('registers four gates for the ontology stage', () => {
		expect(LINK_GATES.map((g) => g.id)).toEqual([
			'class-without-concept-or-comment',
			'class-without-concept',
			'definition-drift',
			'link-to-retired-concept'
		]);
		expect(new Set(LINK_GATES.map((g) => g.stage))).toEqual(new Set(['ontology']));
	});

	it('warns about a class with neither a concept nor a comment', () => {
		expect(run([cls('Order')], [])).toEqual([['class-without-concept-or-comment', `${NS}/schema#Order`, 'warning']]);
	});

	it('only informs about a described class that has no concept, so the two cases never overlap', () => {
		expect(run([cls('Order', { comment: 'A purchase request.' })], [])).toEqual([
			['class-without-concept', `${NS}/schema#Order`, 'info']
		]);
	});

	it('is quiet for a linked class whose comment is absent or says the same as the concept', () => {
		const c = concept('Customer', { definition: 'A party that buys.' });
		expect(run([cls('Customer', { definedByConcept: c.iri })], [c])).toEqual([]);
		expect(run([cls('Customer', { definedByConcept: c.iri, comment: '  a PARTY   that buys. ' })], [c])).toEqual([]);
	});

	it('flags drift when class comment and concept definition differ', () => {
		const c = concept('Customer', { definition: 'A party that buys.' });
		expect(run([cls('Customer', { definedByConcept: c.iri, comment: 'Someone who orders.' })], [c])).toEqual([
			['definition-drift', `${NS}/schema#Customer`, 'warning']
		]);
	});

	it('does not flag drift when the concept has no definition', () => {
		const c = concept('Customer', { definition: '' });
		expect(run([cls('Customer', { definedByConcept: c.iri, comment: 'Someone who orders.' })], [c])).toEqual([]);
	});

	it('warns about a link to a deprecated or retired concept and offers the replacement', () => {
		const replacement = concept('Customer');
		const old = concept('Client', { status: 'deprecated', replacedBy: replacement.iri });
		const findings = runLinkGates(schema([cls('Client', { definedByConcept: old.iri })]), [old, replacement]);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ gateId: 'link-to-retired-concept', severity: 'warning' });
		expect(findings[0].message).toContain('Customer');
		expect(findings[0].fix).toEqual({
			kind: 'retarget-concept',
			classIri: `${NS}/schema#Client`,
			namespaceBaseIri: NS,
			conceptIri: replacement.iri,
			conceptLabel: 'Customer'
		});
	});

	it('warns without a fix when the deprecated concept has no replacement, and for a retired one', () => {
		const old = concept('Client', { status: 'retired' });
		const [f] = runLinkGates(schema([cls('Client', { definedByConcept: old.iri })]), [old]);
		expect(f.gateId).toBe('link-to-retired-concept');
		expect(f.fix).toBeUndefined();
	});

	it('offers no fix when the replacement is itself not live', () => {
		const dead = concept('Buyer', { status: 'retired' });
		const old = concept('Client', { status: 'deprecated', replacedBy: dead.iri });
		const [f] = runLinkGates(schema([cls('Client', { definedByConcept: old.iri })]), [old, dead]);
		expect(f.fix).toBeUndefined();
	});

	it('ignores a link to a concept that is not loaded', () => {
		expect(run([cls('Client', { definedByConcept: `${VOCAB}#Gone`, comment: 'x' })], [])).toEqual([]);
	});

	it('is part of runGates, but only when a vocabulary was loaded', () => {
		const s = schema([cls('Order')]);
		expect(runGates(s, { stages: ['ontology'] }).map((f) => f.gateId)).not.toContain('class-without-concept-or-comment');
		expect(runGates(s, { stages: ['ontology'], concepts: [] }).map((f) => f.gateId)).toContain('class-without-concept-or-comment');
	});

	it('leaves out the application own classes', () => {
		const own = cls('Workspace', { iri: 'http://ld.pageagent.com/rdf-schema-editor/schema#Workspace' });
		expect(run([own], [])).toEqual([]);
	});
});
