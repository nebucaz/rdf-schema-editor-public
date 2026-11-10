import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { namespaceGraphs } from '#lib/config.js';
import { SKOS } from '#lib/utils/iri.js';

const CORE = 'http://example.org/core';
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;
const bank = `${VOCAB}#Bank`;
const lender = `${VOCAB}#Lender`;

type Row = Record<string, { type?: string; value: string } | undefined>;
function mockFetch(select: (q: string) => Row[] = () => []) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: select(body.query) } }), { status: 200 });
	});
	return { fn, updates };
}
const connector = () => new SparqlConnector('/api/sparql');
afterEach(() => vi.unstubAllGlobals());

describe('SparqlConnector concept relations (STORY-329)', () => {
	it('writes each relation as one triple in the vocab graph', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().addConceptRelation(CORE, bank, 'related', lender);
		await connector().addConceptRelation(CORE, bank, 'exactMatch', 'http://xmlns.com/foaf/0.1/Organization');
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`GRAPH <${VOCAB}>`);
		expect(updates[0]).toContain(`<${bank}> <${SKOS.related}> <${lender}>`);
		expect(updates[1]).toContain(`<${bank}> <${SKOS.exactMatch}> <http://xmlns.com/foaf/0.1/Organization>`);
		expect(updates[0]).toContain('INSERT DATA');
	});

	it('removes a relation with DELETE DATA', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().removeConceptRelation(CORE, bank, 'broadMatch', 'http://schema.org/Thing');
		expect(updates[0]).toContain('DELETE DATA');
		expect(updates[0]).toContain(`<${bank}> <${SKOS.broadMatch}> <http://schema.org/Thing>`);
	});

	it('refuses an unsafe IRI or an unknown relation', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().addConceptRelation(CORE, bank, 'related', 'http://x/> } DROP')).rejects.toThrow();
		await expect(connector().addConceptRelation(CORE, bank, 'nope' as never, lender)).rejects.toThrow(/relation/i);
	});

	it('fetchConcepts reads related and the mapping properties', async () => {
		const { fn } = mockFetch(() => [
			{ c: { value: bank }, p: { value: SKOS.related }, o: { value: lender } },
			{ c: { value: bank }, p: { value: SKOS.narrowMatch }, o: { value: 'http://x/N' } }
		]);
		vi.stubGlobal('fetch', fn);
		const { concepts } = await connector().fetchConcepts(CORE);
		expect(concepts[0].related).toEqual([lender]);
		expect(concepts[0].mappings).toEqual([{ kind: 'narrowMatch', target: 'http://x/N' }]);
	});

	it('updateConcept keeps the relations', async () => {
		const draft = {
			prefLabels: [{ text: 'Bank', lang: 'en' }], altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '',
			disambiguation: '', schemeIri: '', topConcept: false, status: 'proposed' as const, source: '',
			authority: '', replacedBy: '', deprecationReason: ''
		};
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', vi.fn(async (u: string, o: { body: string }) =>
			JSON.parse(o.body).query?.includes('ASK') ? new Response(JSON.stringify({ boolean: true }), { status: 200 }) : fn(u, o)));
		await connector().updateConcept(CORE, bank, draft);
		for (const p of [SKOS.related, SKOS.exactMatch, SKOS.closeMatch, SKOS.relatedMatch, SKOS.broadMatch, SKOS.narrowMatch]) {
			expect(updates[0]).toContain(`<${p}>`);
		}
	});
});
