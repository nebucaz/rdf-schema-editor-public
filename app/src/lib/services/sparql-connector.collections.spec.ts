import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { namespaceGraphs } from '#lib/config.js';
import { SKOS } from '#lib/utils/iri.js';

const CORE = 'http://example.org/core';
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

type Row = Record<string, { type?: string; value: string } | undefined>;

function mockFetch(fixture: { exists?: boolean | ((q: string) => boolean); select?: (q: string) => Row[] } = {}) {
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
			const e = typeof fixture.exists === 'function' ? fixture.exists(q) : (fixture.exists ?? false);
			return new Response(JSON.stringify({ head: {}, boolean: e }), { status: 200 });
		}
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: fixture.select?.(q) ?? [] } }), { status: 200 });
	});
	return { fn, updates, queries };
}

const connector = () => new SparqlConnector('/api/sparql');
const A = `${VOCAB}#RegionCollection`;
const B = `${VOCAB}#EuropeCollection`;

describe('SparqlConnector — collections (STORY-409)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertCollection types the node only as a collection, with escaped labels, in the vocab graph', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const iri = await connector().insertCollection(CORE, { prefLabels: [{ text: 'Region "set"', lang: 'en' }], ordered: false });
		expect(iri).toBe(A.replace('Region', 'RegionSet'));
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${VOCAB}>`);
		expect(updates[0]).toContain(`<${iri}> a <${SKOS.Collection}>`);
		expect(updates[0]).toContain('"Region \\"set\\""@en');
		expect(updates[0]).not.toContain(SKOS.Concept);
		expect(updates[0]).not.toContain(SKOS.ConceptScheme);
	});

	it('insertCollection types an ordered one as OrderedCollection', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const iri = await connector().insertCollection(CORE, { prefLabels: [{ text: 'Steps', lang: 'en' }], ordered: true });
		expect(updates[0]).toContain(`<${iri}> a <${SKOS.OrderedCollection}>`);
	});

	it('insertCollection refuses a taken IRI (which could be a concept) and an invalid draft, writing nothing', async () => {
		const taken = mockFetch({ exists: true });
		vi.stubGlobal('fetch', taken.fn);
		await expect(connector().insertCollection(CORE, { prefLabels: [{ text: 'Steps', lang: 'en' }], ordered: false })).rejects.toThrow(/already exists/);
		await expect(connector().insertCollection(CORE, { prefLabels: [], ordered: false })).rejects.toThrow(/preferred label/i);
		expect(taken.updates).toHaveLength(0);
	});

	it('an unordered member is one skos:member triple; the member must exist in the vocab graph', async () => {
		const { fn, updates, queries } = mockFetch({ exists: true });
		vi.stubGlobal('fetch', fn);
		await connector().addCollectionMember(CORE, A, `${VOCAB}#Berlin`);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${A}> <${SKOS.member}> <${VOCAB}#Berlin>`);
		expect(queries.some((q) => q.includes(`FROM <${VOCAB}>`) && q.includes(`${VOCAB}#Berlin`))).toBe(true);

		vi.stubGlobal('fetch', mockFetch({ exists: (q) => !q.includes('#Ghost') }).fn);
		await expect(connector().addCollectionMember(CORE, A, `${VOCAB}#Ghost`)).rejects.toThrow(/not found/i);
	});

	it('refuses itself, an unsafe IRI and a cycle as a member', async () => {
		const m = mockFetch({
			exists: true,
			select: (q) => (q.includes('memberList') ? [] : [
				{ c: { value: B }, p: { value: RDF_TYPE }, o: { value: SKOS.Collection } },
				{ c: { value: B }, p: { value: SKOS.member }, o: { value: A } }
			])
		});
		vi.stubGlobal('fetch', m.fn);
		await expect(connector().addCollectionMember(CORE, A, A)).rejects.toThrow(/itself/i);
		await expect(connector().addCollectionMember(CORE, A, 'http://x/> } DROP')).rejects.toThrow();
		await expect(connector().addCollectionMember(CORE, A, B)).rejects.toThrow(/cycle/i);
		expect(m.updates).toHaveLength(0);
	});

	it('an ordered member is appended to the rdf:List, rewritten whole in one update', async () => {
		const m = mockFetch({
			exists: true,
			select: (q) =>
				q.includes('memberList')
					? [
							{ c: { value: A }, m: { value: `${VOCAB}#One` }, pos: { value: '1' } },
							{ c: { value: A }, m: { value: `${VOCAB}#Two` }, pos: { value: '2' } }
						]
					: [{ c: { value: A }, p: { value: RDF_TYPE }, o: { value: SKOS.OrderedCollection } }]
		});
		vi.stubGlobal('fetch', m.fn);
		await connector().addCollectionMember(CORE, A, `${VOCAB}#Three`);
		expect(m.updates).toHaveLength(1);
		expect(m.updates[0]).toContain(`<${A}> <${SKOS.memberList}> ( <${VOCAB}#One> <${VOCAB}#Two> <${VOCAB}#Three> )`);
		expect(m.updates[0]).toContain('rdf:rest*');
		expect(m.updates[0]).not.toContain(`<${SKOS.member}>`);
	});

	it('reorderCollection rewrites the list in one request and refuses a different member set', async () => {
		const m = mockFetch({
			exists: true,
			select: (q) =>
				q.includes('memberList')
					? [
							{ c: { value: A }, m: { value: 'urn:x:1' }, pos: { value: '1' } },
							{ c: { value: A }, m: { value: 'urn:x:2' }, pos: { value: '2' } }
						]
					: [{ c: { value: A }, p: { value: RDF_TYPE }, o: { value: SKOS.OrderedCollection } }]
		});
		vi.stubGlobal('fetch', m.fn);
		await connector().reorderCollection(CORE, A, ['urn:x:2', 'urn:x:1']);
		expect(m.updates).toHaveLength(1);
		expect(m.updates[0]).toContain('( <urn:x:2> <urn:x:1> )');
		await expect(connector().reorderCollection(CORE, A, ['urn:x:2'])).rejects.toThrow(/same members/i);
	});

	it('removing a member deletes only the membership, never the concept', async () => {
		const m = mockFetch({
			exists: true,
			select: (q) => (q.includes('memberList') ? [] : [{ c: { value: A }, p: { value: RDF_TYPE }, o: { value: SKOS.Collection } }])
		});
		vi.stubGlobal('fetch', m.fn);
		await connector().removeCollectionMember(CORE, A, `${VOCAB}#Berlin`);
		expect(m.updates[0]).toContain(`DELETE DATA`);
		expect(m.updates[0]).toContain(`<${A}> <${SKOS.member}> <${VOCAB}#Berlin>`);
		expect(m.updates[0]).not.toMatch(/DELETE WHERE[^;]*Berlin> \?p/);
	});

	it('deleteCollection refuses while it has members, then deletes the collection and its list nodes only on force', async () => {
		const rows = (q: string): Row[] =>
			q.includes('memberList')
				? [{ c: { value: A }, m: { value: 'urn:x:1' }, pos: { value: '1' } }]
				: [{ c: { value: A }, p: { value: RDF_TYPE }, o: { value: SKOS.OrderedCollection } }];
		const refused = mockFetch({ exists: true, select: rows });
		vi.stubGlobal('fetch', refused.fn);
		expect(await connector().deleteCollection(CORE, A)).toEqual({ deleted: false, members: ['urn:x:1'] });
		expect(refused.updates).toHaveLength(0);

		const forced = mockFetch({ exists: true, select: rows });
		vi.stubGlobal('fetch', forced.fn);
		expect(await connector().deleteCollection(CORE, A, { force: true })).toEqual({ deleted: true, members: ['urn:x:1'] });
		expect(forced.updates).toHaveLength(1);
		expect(forced.updates[0]).toContain('rdf:rest*');
		expect(forced.updates[0]).toContain(`<${A}> ?p ?o`);
		expect(forced.updates[0]).not.toMatch(/<urn:x:1> \?p/);
	});

	it('fetchCollections reads labels, kind and members with their order in two queries', async () => {
		const m = mockFetch({
			select: (q) =>
				q.includes('memberList')
					? [
							{ c: { value: B }, m: { value: 'urn:x:b' }, pos: { value: '2' } },
							{ c: { value: B }, m: { value: 'urn:x:a' }, pos: { value: '1' } }
						]
					: [
							{ c: { value: A }, p: { value: RDF_TYPE }, o: { value: SKOS.Collection } },
							{ c: { value: A }, p: { value: SKOS.prefLabel }, o: { value: 'Region' }, lang: { value: 'en' } },
							{ c: { value: A }, p: { value: SKOS.member }, o: { value: 'urn:x:1' } },
							{ c: { value: B }, p: { value: RDF_TYPE }, o: { value: SKOS.OrderedCollection } },
							{ c: { value: B }, p: { value: SKOS.prefLabel }, o: { value: 'Europe' }, lang: { value: 'en' } }
						]
		});
		vi.stubGlobal('fetch', m.fn);
		const result = await connector().fetchCollections(CORE);
		expect(m.queries).toHaveLength(2);
		expect(m.queries.every((q) => q.includes(`FROM <${VOCAB}>`))).toBe(true);
		expect(result).toEqual([
			{ iri: B, prefLabels: [{ text: 'Europe', lang: 'en' }], ordered: true, members: ['urn:x:a', 'urn:x:b'] },
			{ iri: A, prefLabels: [{ text: 'Region', lang: 'en' }], ordered: false, members: ['urn:x:1'] }
		]);
	});

	it('deleting or force-deleting a concept reports and then removes its collection memberships, not the collections', async () => {
		const concept = `${VOCAB}#Berlin`;
		const select = (q: string): Row[] => {
			if (q.includes('definedByConcept') || q.includes('broader')) return [];
			if (q.includes('memberList'))
				return [
					{ c: { value: B }, m: { value: concept }, pos: { value: '1' } },
					{ c: { value: B }, m: { value: 'urn:x:other' }, pos: { value: '2' } }
				];
			return [
				{ c: { value: A }, p: { value: RDF_TYPE }, o: { value: SKOS.Collection } },
				{ c: { value: A }, p: { value: SKOS.member }, o: { value: concept } },
				{ c: { value: B }, p: { value: RDF_TYPE }, o: { value: SKOS.OrderedCollection } }
			];
		};
		const refused = mockFetch({ select });
		vi.stubGlobal('fetch', refused.fn);
		const r = await connector().deleteConcept(CORE, concept);
		expect(r.deleted).toBe(false);
		expect(r.collections.sort()).toEqual([A, B].sort());
		expect(refused.updates).toHaveLength(0);

		const forced = mockFetch({ select });
		vi.stubGlobal('fetch', forced.fn);
		const done = await connector().deleteConcept(CORE, concept, { force: true });
		expect(done.deleted).toBe(true);
		expect(forced.updates).toHaveLength(1);
		const u = forced.updates[0];
		expect(u).toContain(`<${A}> <${SKOS.member}> <${concept}>`);
		expect(u).toContain(`<${B}> <${SKOS.memberList}> ( <urn:x:other> )`);
		expect(u).not.toMatch(/DELETE[^;]*<[^>]*#RegionCollection> \?p/);
	});

	it('deleteConceptScheme refuses while the scheme has concepts, then removes scheme, concepts, links and memberships in one update', async () => {
		const scheme = `${VOCAB}#Glossary`;
		const concept = `${VOCAB}#Berlin`;
		const select = (q: string): Row[] => {
			if (q.includes('inScheme') && q.includes('SELECT DISTINCT ?c ')) return [{ c: { value: concept } }];
			if (q.includes('definedByConcept')) return [{ cls: { value: 'urn:x:City' } }];
			if (q.includes('valueScheme') || q.includes('memberList')) return [];
			return [
				{ c: { value: A }, p: { value: RDF_TYPE }, o: { value: SKOS.Collection } },
				{ c: { value: A }, p: { value: SKOS.member }, o: { value: concept } }
			];
		};
		const exists = (q: string) => q.includes('ConceptScheme');
		const refused = mockFetch({ select, exists });
		vi.stubGlobal('fetch', refused.fn);
		const r = await connector().deleteConceptScheme(CORE, scheme);
		expect(r).toMatchObject({ deleted: false, concepts: [concept], linkedClasses: ['urn:x:City'], collections: [A] });
		expect(refused.updates).toHaveLength(0);

		const forced = mockFetch({ select, exists });
		vi.stubGlobal('fetch', forced.fn);
		const done = await connector().deleteConceptScheme(CORE, scheme, { force: true });
		expect(done.deleted).toBe(true);
		expect(forced.updates).toHaveLength(1);
		const u = forced.updates[0];
		expect(u).toContain(`<${A}> <${SKOS.member}> <${concept}>`);
		expect(u).toContain('definedByConcept');
		expect(u).toContain(`<${scheme}> ?p ?o`);
		expect(u.indexOf('?x ?p ?c')).toBeLessThan(u.indexOf('?c ?p ?o'));
		expect(u).toContain(`GRAPH <${VOCAB}>`);
	});

	it('deleteConceptScheme deletes an empty, unreferenced scheme without force and rejects an unknown one', async () => {
		const m = mockFetch({ exists: (q) => q.includes('ConceptScheme') });
		vi.stubGlobal('fetch', m.fn);
		expect((await connector().deleteConceptScheme(CORE, `${VOCAB}#Empty`)).deleted).toBe(true);
		expect(m.updates).toHaveLength(1);
		vi.stubGlobal('fetch', mockFetch({ exists: false }).fn);
		await expect(connector().deleteConceptScheme(CORE, `${VOCAB}#Nope`)).rejects.toThrow('Scheme not found');
	});
});
