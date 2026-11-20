import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { namespaceGraphs } from '#lib/config.js';
import { NAMESPACE_VOCABULARY_PREDICATE_IRI, SKOS } from '#lib/utils/iri.js';
import type { ImportWrites } from './skos-import-apply';
import type { ConceptDraft } from './skos-concept';

const CORE = 'http://example.org/core';
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;
const SCHEME = `${VOCAB}#GlossaryScheme`;

const draft = (over: Partial<ConceptDraft> = {}): ConceptDraft => ({
	prefLabels: [{ text: 'Alpha "A"', lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [{ text: 'First.', lang: '' }], scopeNotes: [], notation: ['A-1'], example: [],
	editorialNote: [], disambiguation: '', schemeIri: SCHEME, topConcept: false, status: 'proposed', source: 'terms.ttl', authority: '', replacedBy: '',
	deprecationReason: '', ...over
});
const writes = (over: Partial<ImportWrites> = {}): ImportWrites => ({
	source: 'terms.ttl', schemes: [], concepts: [], collections: [], rejected: [], summary: { added: 1, changed: 0, merged: 0, skipped: 0 }, ...over
});

function mockFetch(core: string | null = CORE) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const bindings = body.query.includes(NAMESPACE_VOCABULARY_PREDICATE_IRI) && core ? [{ ns: { value: core } }] : [];
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });
	});
	return { fn, updates };
}
const connector = () => new SparqlConnector('/api/sparql');

describe('SparqlConnector.applyImportPlan (STORY-417)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('writes every accepted entry in one request, into the vocab graph, with provenance and relations', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		await connector().applyImportPlan(
			CORE,
			writes({
				schemes: [{ iri: SCHEME, mode: 'insert', scheme: { iri: SCHEME, name: 'Glossary', description: '', title: 'The "glossary"', creator: '', publisher: 'https://ex.org/p', rights: '' } }],
				concepts: [
					{ iri: `${VOCAB}#Alpha`, mode: 'insert', draft: draft(), broader: [`${VOCAB}#Root`], related: [`${VOCAB}#Beta`], mappings: [{ kind: 'exactMatch', target: 'http://o.example/A' }] }
				],
				collections: [{ iri: `${VOCAB}#SetCollection`, mode: 'insert', collection: { iri: `${VOCAB}#SetCollection`, prefLabels: [{ text: 'Set', lang: 'en' }], ordered: true, members: [`${VOCAB}#Alpha`] } }]
			})
		);
		expect(m.updates).toHaveLength(1);
		const u = m.updates[0];
		expect(u).toContain(`GRAPH <${VOCAB}>`);
		expect(u).toContain(`<${SKOS.prefLabel}> "Alpha \\"A\\""@en`);
		expect(u).toContain('"proposed"');
		expect(u).toContain('"terms.ttl"');
		expect(u).toContain(`<${VOCAB}#Alpha> <${SKOS.broader}> <${VOCAB}#Root>`);
		expect(u).toContain(`<${VOCAB}#Alpha> <${SKOS.related}> <${VOCAB}#Beta>`);
		expect(u).toContain(`<${SKOS.exactMatch}> <http://o.example/A>`);
		expect(u).toContain('"The \\"glossary\\""');
		expect(u).toContain(`<${SKOS.memberList}> ( <${VOCAB}#Alpha> )`);
		expect(u).toMatch(new RegExp(`<${SCHEME}> <http://purl.org/dc/terms/modified> "\\d{4}-\\d\\d-\\d\\dT[\\d:]+Z"`));
	});

	it('writes skos:hasTopConcept beside topConceptOf for a top concept (STORY-445)', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		await connector().applyImportPlan(CORE, writes({ concepts: [{ iri: `${VOCAB}#Top`, mode: 'insert', draft: draft({ topConcept: true }), broader: [], related: [], mappings: [] }] }));
		expect(m.updates[0]).toContain(`<${SKOS.topConceptOf}> <${SCHEME}>`);
		expect(m.updates[0]).toContain(`<${SCHEME}> <${SKOS.hasTopConcept}> <${VOCAB}#Top> .`);
		const up = mockFetch();
		vi.stubGlobal('fetch', up.fn);
		await connector().applyImportPlan(CORE, writes({ concepts: [{ iri: `${VOCAB}#Top`, mode: 'update', draft: draft({ topConcept: true }), broader: [], related: [], mappings: [] }] }));
		expect(up.updates[0]).toContain(`?s <${SKOS.hasTopConcept}> <${VOCAB}#Top>`);
		expect(up.updates[0]).toContain(`<${SCHEME}> <${SKOS.hasTopConcept}> <${VOCAB}#Top> .`);
	});

	it('an update replaces the concept fields and keeps its created date, adding only the new relations', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		await connector().applyImportPlan(CORE, writes({ concepts: [{ iri: `${VOCAB}#Alpha`, mode: 'update', draft: draft({ status: 'active' }), broader: [], related: [`${VOCAB}#Beta`], mappings: [] }] }));
		const u = m.updates[0];
		expect(u).toContain('FILTER(?p NOT IN (');
		expect(u).toContain('created');
		expect(u).toContain(`<${VOCAB}#Alpha> <${SKOS.related}> <${VOCAB}#Beta>`);
		expect(u).not.toContain('"proposed"');
	});

	it('refuses when the namespace is not the marked vocabulary namespace, and writes nothing', async () => {
		const other = mockFetch('http://example.org/elsewhere');
		vi.stubGlobal('fetch', other.fn);
		await expect(connector().applyImportPlan(CORE, writes({ concepts: [{ iri: `${VOCAB}#A`, mode: 'insert', draft: draft(), broader: [], related: [], mappings: [] }] }))).rejects.toThrow(/vocabulary namespace/i);
		const none = mockFetch(null);
		vi.stubGlobal('fetch', none.fn);
		await expect(connector().applyImportPlan(CORE, writes({ concepts: [{ iri: `${VOCAB}#A`, mode: 'insert', draft: draft(), broader: [], related: [], mappings: [] }] }))).rejects.toThrow(/vocabulary namespace/i);
		expect(other.updates.length + none.updates.length).toBe(0);
	});

	it('refuses an unsafe IRI before sending anything', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		await expect(
			connector().applyImportPlan(CORE, writes({ concepts: [{ iri: `${VOCAB}#A`, mode: 'insert', draft: draft(), broader: ['http://x/> } DROP'], related: [], mappings: [] }] }))
		).rejects.toThrow(/Invalid/);
		expect(m.updates).toHaveLength(0);
	});

	it('sends nothing for an empty selection', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		await connector().applyImportPlan(CORE, writes());
		expect(m.updates).toHaveLength(0);
	});
});
