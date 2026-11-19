import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { namespaceGraphs } from '#lib/config.js';

const NS = 'http://example.org/hr';
const graphs = namespaceGraphs(NS);

function mockFetch(classExists = false) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		return new Response(JSON.stringify({ head: {}, boolean: classExists }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector.insertEnumeratedClass (STORY-424)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('writes the class and every member in one update, with labels only and no concept link', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		const result = await new SparqlConnector('/api/sparql').insertEnumeratedClass(NS, 'Priority', ['High', 'Low "x"']);
		expect(m.updates).toHaveLength(1);
		const u = m.updates[0];
		expect(result.iri).toBe(`${graphs.schema}#Priority`);
		expect(result.members).toHaveLength(2);
		expect(u).toContain(`GRAPH <${graphs.schema}>`);
		expect(u).toContain(`<${graphs.schema}#Priority> a owl:Class ; rdfs:label "Priority"`);
		expect(u).toContain(`GRAPH <${graphs.instances}>`);
		expect(u).toContain(`rdfs:label "High"`);
		expect(u).toContain(`rdfs:label "Low \\"x\\""`);
		expect(u).not.toContain('definedByConcept');
		expect(u).not.toContain('exactMatch');
	});

	it('refuses an empty list and an existing class, writing nothing', async () => {
		const m = mockFetch(true);
		vi.stubGlobal('fetch', m.fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.insertEnumeratedClass(NS, 'Priority', [])).rejects.toThrow(/no members/i);
		await expect(connector.insertEnumeratedClass(NS, 'Priority', ['High'])).rejects.toThrow(/already exists/);
		expect(m.updates).toHaveLength(0);
	});
});
