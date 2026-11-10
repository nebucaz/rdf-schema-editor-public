import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '#lib/config.js';
import { CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI, SKOS, classIri } from '#lib/utils/iri.js';
import type { BackfillWrite } from './concept-backfill';
import type { ConceptDraft } from './skos-concept';

const CORE = 'http://example.org/core';
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;
const GOV = 'http://example.org/gov';
const HR = 'http://example.org/hr';

type Row = Record<string, { value: string } | undefined>;

function mockFetch(fixture: { classExists?: boolean; select?: Row[]; propertyDeclared?: boolean } = {}) {
	const updates: string[] = [];
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		queries.push(q);
		if (q.includes('ASK')) {
			const boolean = q.includes('owl:ObjectProperty') ? (fixture.propertyDeclared ?? true) : (fixture.classExists ?? false);
			return new Response(JSON.stringify({ head: {}, boolean }), { status: 200 });
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: fixture.select ?? [] } }), { status: 200 });
	});
	return { fn, updates, queries };
}

const draft = (label: string, definition = ''): ConceptDraft => ({
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition, scopeNote: '', disambiguation: '', schemeIri: '', topConcept: false,
	status: 'proposed', source: '', authority: '', replacedBy: '', deprecationReason: ''
});

describe('SparqlConnector.promoteConceptToClass (STORY-326)', () => {
	afterEach(() => vi.unstubAllGlobals());
	const concept = `${VOCAB}#Customer`;

	it('creates the class and its concept link in one write, copying no text but the label', async () => {
		const { fn, updates } = mockFetch({ select: [{ status: { value: 'approved' }, label: { value: 'Customer' } }] });
		vi.stubGlobal('fetch', fn);
		const result = await new SparqlConnector('/api/sparql').promoteConceptToClass(CORE, concept, GOV);

		const expected = classIri('Customer', namespaceGraphs(GOV).schema);
		expect(result).toEqual({ iri: expected });
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${namespaceGraphs(GOV).schema}>`);
		expect(u).toContain(`<${expected}> a owl:Class`);
		expect(u).toContain('rdfs:label "Customer"');
		expect(u).toContain(`<${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> <${concept}>`);
		expect(u).not.toContain('rdfs:comment');
		expect(u).not.toContain('skos:definition');
	});

	it('refuses when the class IRI already exists', async () => {
		const { fn, updates } = mockFetch({ classExists: true, select: [{ status: { value: 'active' }, label: { value: 'Customer' } }] });
		vi.stubGlobal('fetch', fn);
		await expect(new SparqlConnector('/api/sparql').promoteConceptToClass(CORE, concept, GOV)).rejects.toThrow(/already exists/);
		expect(updates).toHaveLength(0);
	});

	it('refuses a concept that is not approved or active, and one that does not exist', async () => {
		vi.stubGlobal('fetch', mockFetch({ select: [{ status: { value: 'proposed' }, label: { value: 'Customer' } }] }).fn);
		await expect(new SparqlConnector('/api/sparql').promoteConceptToClass(CORE, concept, GOV)).rejects.toThrow(/approved or active/);
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(new SparqlConnector('/api/sparql').promoteConceptToClass(CORE, concept, GOV)).rejects.toThrow(/not found/i);
	});

	it('refuses an unsafe IRI before any request', async () => {
		const { fn } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await expect(new SparqlConnector('/api/sparql').promoteConceptToClass(CORE, 'http://x/> } DROP', GOV)).rejects.toThrow();
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('SparqlConnector.createConceptsForClasses (STORY-326)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const writes: BackfillWrite[] = [
		{ classIri: `${GOV}/schema#Order`, namespaceBaseIri: GOV, conceptIri: `${VOCAB}#Order`, create: draft('Order', 'A purchase "request".') },
		{ classIri: `${HR}/schema#Order`, namespaceBaseIri: HR, conceptIri: `${VOCAB}#Order` },
		{ classIri: `${GOV}/schema#Person`, namespaceBaseIri: GOV, conceptIri: `${VOCAB}#Person`, create: draft('Person') }
	];

	it('writes every concept and link in one update, each link in its class namespace graph', async () => {
		const { fn, updates } = mockFetch({ propertyDeclared: true });
		vi.stubGlobal('fetch', fn);
		const result = await new SparqlConnector('/api/sparql').createConceptsForClasses(CORE, writes);

		expect(result).toEqual({ created: 2, linked: 3 });
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${VOCAB}>`);
		expect(u).toContain(`<${VOCAB}#Order> a <${SKOS.Concept}>`);
		expect(u).toContain(`<${SKOS.definition}> "A purchase \\"request\\"."`);
		expect(u).toContain('"proposed"');
		expect(u).toContain(`GRAPH <${namespaceGraphs(GOV).schema}>`);
		expect(u).toContain(`GRAPH <${namespaceGraphs(HR).schema}>`);
		expect(u).toContain(`<${GOV}/schema#Order> <${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> <${VOCAB}#Order>`);
		expect(u).toContain(`<${HR}/schema#Order> <${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> <${VOCAB}#Order>`);
		expect((u.match(/a <http:\/\/www\.w3\.org\/2004\/02\/skos\/core#Concept>/g) ?? []).length).toBe(2);
	});

	it('sends nothing for an empty batch', async () => {
		const { fn } = mockFetch();
		vi.stubGlobal('fetch', fn);
		expect(await new SparqlConnector('/api/sparql').createConceptsForClasses(CORE, [])).toEqual({ created: 0, linked: 0 });
		expect(fn).not.toHaveBeenCalled();
	});

	it('refuses an unsafe IRI or an unacceptable draft before writing anything', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(
			connector.createConceptsForClasses(CORE, [{ ...writes[1], classIri: 'http://x/> } DROP' }])
		).rejects.toThrow();
		await expect(
			connector.createConceptsForClasses(CORE, [{ ...writes[0], create: draft('Bad (x)') }])
		).rejects.toThrow(/parentheses/);
		expect(updates).toHaveLength(0);
	});

	it('does not mix a class graph into the default namespace by accident', async () => {
		const { fn, updates } = mockFetch({ propertyDeclared: true });
		vi.stubGlobal('fetch', fn);
		await new SparqlConnector('/api/sparql').createConceptsForClasses(CORE, [writes[1]]);
		expect(updates[0]).not.toContain(`GRAPH <${namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI).schema}>`);
	});
});
