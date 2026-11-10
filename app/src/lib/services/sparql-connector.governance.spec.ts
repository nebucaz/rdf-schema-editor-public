import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '#lib/config.js';
import {
	NAMESPACE_AUTHORITY_PREDICATE_IRI,
	NAMESPACE_MATURITY_PREDICATE_IRI,
	NAMESPACE_STEWARD_PREDICATE_IRI,
	OWL_VERSION_INFO_IRI
} from '#lib/utils/iri.js';

const CORE = 'http://example.org/core';
const SCHEMA = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI).schema;

type Row = Record<string, { value: string } | undefined>;
function mockFetch(select: (q: string) => Row[] = () => []) {
	const updates: string[] = [];
	const fn = vi.fn(async (_u: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response('{}', { status: 200 });
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: select(body.query) } }), { status: 200 });
	});
	return { fn, updates };
}
const connector = () => new SparqlConnector('/api/sparql');
afterEach(() => vi.unstubAllGlobals());

describe('SparqlConnector governance (STORY-331)', () => {
	it('reads the four settings of a namespace', async () => {
		const { fn } = mockFetch(() => [
			{ p: { value: NAMESPACE_STEWARD_PREDICATE_IRI }, o: { value: 'Ann' } },
			{ p: { value: NAMESPACE_AUTHORITY_PREDICATE_IRI }, o: { value: 'Data Office' } },
			{ p: { value: NAMESPACE_MATURITY_PREDICATE_IRI }, o: { value: 'pilot' } },
			{ p: { value: OWL_VERSION_INFO_IRI }, o: { value: '1.2.0' } }
		]);
		vi.stubGlobal('fetch', fn);
		expect(await connector().fetchNamespaceGovernance(CORE)).toEqual({ steward: 'Ann', authority: 'Data Office', maturity: 'pilot', version: '1.2.0' });
	});

	it('reads empty settings for a namespace that has none', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		expect(await connector().fetchNamespaceGovernance(CORE)).toEqual({ steward: '', authority: '', maturity: '', version: '' });
	});

	it('replaces the settings in one request, in the default schema graph, escaping text', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().updateNamespaceGovernance(CORE, { steward: 'Ann "A"', authority: '', maturity: 'pilot', version: '1.0.0' });
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${SCHEMA}>`);
		expect(u).toContain(`<${CORE}> <${NAMESPACE_STEWARD_PREDICATE_IRI}> ?old`);
		expect(u).toContain('"Ann \\"A\\""');
		expect(u).toContain(`<${OWL_VERSION_INFO_IRI}> "1.0.0"`);
		expect(u).not.toContain(`<${NAMESPACE_AUTHORITY_PREDICATE_IRI}> ""`);
	});

	it('refuses an invalid version and an unsafe IRI', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().updateNamespaceGovernance(CORE, { steward: '', authority: '', maturity: '', version: 'x' })).rejects.toThrow(/version/i);
		await expect(connector().updateNamespaceGovernance('http://x/> }', { steward: '', authority: '', maturity: '', version: '' })).rejects.toThrow();
	});
});
