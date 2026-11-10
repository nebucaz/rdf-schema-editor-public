import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { namespaceGraphs } from '#lib/config.js';
import { SKOS } from '#lib/utils/iri.js';

const CORE = 'http://example.org/core';
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;
const SCHEME = `${VOCAB}#Scheme`;
const child = `${VOCAB}#Dog`;
const parent = `${VOCAB}#Animal`;
const other = `${VOCAB}#Pet`;

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

describe('SparqlConnector taxonomy writes (STORY-328)', () => {
	it('setBroader moves a concept from one parent to another in one request', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().setBroader(CORE, child, { from: parent, to: other });
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${VOCAB}>`);
		expect(u).toContain(`DELETE DATA`);
		expect(u).toContain(`<${child}> <${SKOS.broader}> <${parent}>`);
		expect(u).toContain(`INSERT DATA`);
		expect(u).toContain(`<${child}> <${SKOS.broader}> <${other}>`);
	});

	it('setBroader with only a target adds it, with only a source removes it', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().setBroader(CORE, child, { from: null, to: parent });
		await connector().setBroader(CORE, child, { from: parent, to: null });
		expect(updates[0]).not.toContain('DELETE DATA');
		expect(updates[0]).toContain('INSERT DATA');
		expect(updates[1]).toContain('DELETE DATA');
		expect(updates[1]).not.toContain('INSERT DATA');
	});

	it('setBroader refuses a unsafe IRI', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().setBroader(CORE, child, { from: null, to: 'http://x/> } DROP' })).rejects.toThrow();
	});

	it('setTopConcept marks the concept and drops its broader links', async () => {
		const { fn, updates } = mockFetch((q) => (q.includes('inScheme') ? [{ s: { value: SCHEME } }] : []));
		vi.stubGlobal('fetch', fn);
		await connector().setTopConcept(CORE, child, true);
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`<${child}> <${SKOS.broader}> ?old`);
		expect(u).toContain(`<${child}> <${SKOS.topConceptOf}> <${SCHEME}>`);
	});

	it('setTopConcept refuses a concept without a scheme', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().setTopConcept(CORE, child, true)).rejects.toThrow(/scheme/i);
	});

	it('setTopConcept false only removes the mark', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().setTopConcept(CORE, child, false);
		expect(updates[0]).toContain(`<${child}> <${SKOS.topConceptOf}> ?s`);
		expect(updates[0]).not.toContain('INSERT DATA');
	});

	it('fetchConcepts reads skos:broader', async () => {
		const { fn } = mockFetch(() => [
			{ c: { value: child }, p: { value: SKOS.broader }, o: { value: parent } },
			{ c: { value: child }, p: { value: SKOS.broader }, o: { value: other } }
		]);
		vi.stubGlobal('fetch', fn);
		const { concepts } = await connector().fetchConcepts(CORE);
		expect(concepts[0].broader).toEqual([parent, other]);
	});

	it('updateConcept keeps broader links, except when it makes the concept a top concept', async () => {
		const draft = {
			prefLabels: [{ text: 'Dog', lang: 'en' }], altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '',
			disambiguation: '', schemeIri: SCHEME, topConcept: false, status: 'proposed' as const, source: '',
			authority: '', replacedBy: '', deprecationReason: ''
		};
		const kept = mockFetch();
		vi.stubGlobal('fetch', vi.fn(async (u: string, o: { body: string }) => {
			const b = JSON.parse(o.body);
			return b.query?.includes('ASK') ? new Response(JSON.stringify({ boolean: true }), { status: 200 }) : kept.fn(u, o);
		}));
		await connector().updateConcept(CORE, child, draft);
		expect(kept.updates[0]).toContain(SKOS.broader);

		const dropped = mockFetch();
		vi.stubGlobal('fetch', vi.fn(async (u: string, o: { body: string }) => {
			const b = JSON.parse(o.body);
			return b.query?.includes('ASK') ? new Response(JSON.stringify({ boolean: true }), { status: 200 }) : dropped.fn(u, o);
		}));
		await connector().updateConcept(CORE, child, { ...draft, topConcept: true });
		expect(dropped.updates[0]).not.toContain(`<${SKOS.broader}>`);
	});
});
