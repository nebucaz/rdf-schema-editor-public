import { describe, expect, it } from 'vitest';
import { planBackfillWrites, proposeBackfill, type BackfillRow } from './concept-backfill';
import type { Concept } from './skos-concept';
import type { FetchedClass } from './sparql-connector';
import { SCHEMA_NAMESPACE } from '#lib/config.js';

const CORE = 'http://e/core';
const VOCAB = 'http://e/core/vocab';
const GOV = 'http://e/gov';

const cls = (name: string, over: Partial<FetchedClass> = {}): FetchedClass => ({
	iri: `${GOV}/schema#${name}`,
	label: name,
	comment: null,
	namespaceBaseIri: GOV,
	...over
});
const concept = (name: string, over: Partial<Concept> = {}): Concept => ({
	iri: `${VOCAB}#${name}`,
	prefLabels: [{ text: name, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});

describe('proposeBackfill (STORY-326)', () => {
	it('proposes one new concept per unlinked class, with the label and the comment as definition', () => {
		const proposals = proposeBackfill([cls('Person', { comment: 'A human being.' }), cls('Order')], [], CORE);
		expect(proposals).toEqual([
			{ classIri: `${GOV}/schema#Order`, namespaceBaseIri: GOV, label: 'Order', definition: '', action: 'create', conceptIri: `${VOCAB}#Order` },
			{ classIri: `${GOV}/schema#Person`, namespaceBaseIri: GOV, label: 'Person', definition: 'A human being.', action: 'create', conceptIri: `${VOCAB}#Person` }
		]);
	});

	it('proposes nothing for classes already linked, so a rerun is empty', () => {
		const classes = [cls('Person', { definedByConcept: `${VOCAB}#Person` }), cls('Order', { definedByConcept: `${VOCAB}#Order` })];
		expect(proposeBackfill(classes, [], CORE)).toEqual([]);
	});

	it('proposes linking to an existing concept whose preferred label equals the class label', () => {
		const [p] = proposeBackfill([cls('customer')], [concept('Customer')], CORE);
		expect(p).toMatchObject({ action: 'link', conceptIri: `${VOCAB}#Customer` });
	});

	it('does not link to a deprecated or retired concept', () => {
		const [p] = proposeBackfill([cls('Customer')], [concept('Customer', { status: 'deprecated' })], CORE);
		expect(p.action).toBe('link');
		// The minted IRI is taken, so it can only be reused, never silently recreated.
		expect(p.conceptIri).toBe(`${VOCAB}#Customer`);
	});

	it('lets same-named classes of different namespaces share the one concept created for the first', () => {
		const classes = [cls('Person'), cls('Person', { iri: 'http://e/hr/schema#Person', namespaceBaseIri: 'http://e/hr' })];
		const proposals = proposeBackfill(classes, [], CORE);
		expect(proposals.map((p) => p.action)).toEqual(['create', 'link']);
		expect(proposals[1].conceptIri).toBe(proposals[0].conceptIri);
	});

	it('leaves out the application own classes', () => {
		const own = cls('Workspace', { iri: `${SCHEMA_NAMESPACE}Workspace` });
		expect(proposeBackfill([own], [], CORE)).toEqual([]);
	});
});

describe('planBackfillWrites (STORY-326)', () => {
	const row = (name: string, over: Partial<BackfillRow> = {}): BackfillRow => ({
		classIri: `${GOV}/schema#${name}`,
		namespaceBaseIri: GOV,
		label: name,
		definition: '',
		...over
	});

	it('creates a proposed concept and links the class', () => {
		const { writes, errors } = planBackfillWrites([row('Order', { definition: 'A purchase request.' })], [], CORE);
		expect(errors).toEqual([]);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({ classIri: `${GOV}/schema#Order`, namespaceBaseIri: GOV, conceptIri: `${VOCAB}#Order` });
		expect(writes[0].create).toMatchObject({
			prefLabels: [{ text: 'Order', lang: 'en' }],
			definition: 'A purchase request.',
			status: 'proposed'
		});
	});

	it('links instead of creating when the edited label matches an existing concept or one planned earlier', () => {
		const { writes } = planBackfillWrites(
			[row('Client', { label: 'Customer' }), row('Buyer', { label: 'Order' }), row('Purchase', { label: 'order' })],
			[concept('Customer')],
			CORE
		);
		expect(writes.map((w) => [w.conceptIri, Boolean(w.create)])).toEqual([
			[`${VOCAB}#Customer`, false],
			[`${VOCAB}#Order`, true],
			[`${VOCAB}#Order`, false]
		]);
	});

	it('reports rows whose edited label or definition is not acceptable, and writes the rest', () => {
		const { writes, errors } = planBackfillWrites([row('Order'), row('Bad', { label: 'Bad (thing)' }), row('Empty', { label: '  ' })], [], CORE);
		expect(writes.map((w) => w.classIri)).toEqual([`${GOV}/schema#Order`]);
		expect(errors.map((e) => e.classIri)).toEqual([`${GOV}/schema#Bad`, `${GOV}/schema#Empty`]);
		expect(errors[0].message).toMatch(/parentheses/);
		expect(errors[1].message).toMatch(/label/i);
	});

	it('is empty for no rows', () => {
		expect(planBackfillWrites([], [], CORE)).toEqual({ writes: [], errors: [] });
	});
});
