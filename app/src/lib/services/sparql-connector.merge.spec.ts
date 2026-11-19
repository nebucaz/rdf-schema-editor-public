import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { planMerge } from './concept-merge';
import { namespaceGraphs } from '#lib/config.js';
import { CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI, CONCEPT_REPLACED_BY_PREDICATE_IRI, CONCEPT_STATUS_PREDICATE_IRI, SKOS } from '#lib/utils/iri.js';
import type { Concept } from './skos-concept';

const CORE = 'http://example.org/core';
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;
const iri = (id: string) => `${VOCAB}#${id}`;
const c = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: iri(id), prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definition: '', scopeNote: '', disambiguation: '',
	schemeIri: iri('Scheme'), topConcept: false, status: 'active', source: '', authority: '', replacedBy: '', deprecationReason: '', created: '',
	modified: '', deprecatedOn: '', ...over
});

function mockFetch(exists = true) {
	const updates: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		return new Response(JSON.stringify({ head: {}, boolean: exists }), { status: 200 });
	});
	return { fn, updates };
}

describe('SparqlConnector.mergeConcepts (STORY-423)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const plan = () =>
		planMerge({
			concepts: [
				c('S', { definition: 'Surviving.' }),
				c('D', { broader: [iri('P')], related: [iri('R')], mappings: [{ kind: 'exactMatch', target: 'http://o.example/1' }], altLabels: [{ text: 'Dee', lang: 'en' }] }),
				c('P', { topConcept: true }),
				c('R'),
				c('Child', { broader: [iri('D')] })
			],
			collections: [{ iri: iri('Col'), prefLabels: [], ordered: false, members: [iri('D')] }, { iri: iri('Ord'), prefLabels: [], ordered: true, members: [iri('X'), iri('D')] }],
			classLinks: [{ classIri: 'http://e#K', label: 'K' }],
			survivor: iri('S'),
			duplicate: iri('D')
		});

	it('applies everything in a single update', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		await new SparqlConnector('/api/sparql').mergeConcepts(CORE, plan());
		expect(m.updates).toHaveLength(1);
		const u = m.updates[0];
		// the duplicate no longer is a top concept; the survivor's inverse is replaced with its draft
		expect(u).toContain(`DELETE WHERE { GRAPH <${VOCAB}> { ?s <${SKOS.hasTopConcept}> <${iri('D')}> . } }`);
		expect(u).toContain(`<${iri('S')}> <${SKOS.broader}> <${iri('P')}>`);
		expect(u).toContain(`<${iri('S')}> <${SKOS.related}> <${iri('R')}>`);
		expect(u).toContain(`<${iri('S')}> <${SKOS.exactMatch}> <http://o.example/1>`);
		expect(u).toContain('"Dee"@en');
		// incoming broader retargeted
		expect(u).toContain(`DELETE DATA { GRAPH <${VOCAB}> { <${iri('Child')}> <${SKOS.broader}> <${iri('D')}> . } }`);
		expect(u).toContain(`<${iri('Child')}> <${SKOS.broader}> <${iri('S')}>`);
		// collections
		expect(u).toContain(`<${iri('Col')}> <${SKOS.member}> <${iri('S')}>`);
		expect(u).toContain(`<${iri('Ord')}> <${SKOS.memberList}> ( <${iri('X')}> <${iri('S')}> )`);
		// classes
		expect(u).toContain(`<${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> <${iri('S')}>`);
		// tombstone
		expect(u).toContain(`<${iri('D')}> <${CONCEPT_STATUS_PREDICATE_IRI}> "retired"`);
		expect(u).toContain(`<${iri('D')}> <${CONCEPT_REPLACED_BY_PREDICATE_IRI}> <${iri('S')}>`);
		expect(u).not.toMatch(/DELETE WHERE \{[^}]*\{ <[^>]*#D> \?p \?o/);
	});

	it('refuses an invalid plan, undecided conflicts and missing concepts, writing nothing', async () => {
		const m = mockFetch(false);
		vi.stubGlobal('fetch', m.fn);
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.mergeConcepts(CORE, { ...plan(), error: 'nope' })).rejects.toThrow('nope');
		await expect(
			connector.mergeConcepts(CORE, { ...plan(), conflicts: [{ field: 'definition', survivor: 'a', duplicate: 'b', resolved: false }] })
		).rejects.toThrow(/conflicts/);
		await expect(connector.mergeConcepts(CORE, plan())).rejects.toThrow(/not found/);
		expect(m.updates).toHaveLength(0);
	});

	it('rejects an unsafe IRI before sending anything', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		const bad = { ...plan(), addBroader: ['http://x> } ; DROP ALL ; <'] };
		await expect(new SparqlConnector('/api/sparql').mergeConcepts(CORE, bad)).rejects.toThrow();
		expect(m.updates).toHaveLength(0);
	});
});
