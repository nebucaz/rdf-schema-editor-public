import { describe, expect, it } from 'vitest';
import { Parser, Writer } from 'n3';
import {
	addMember,
	collectionIri,
	collectionsFromQuads,
	collectionsOfConcept,
	collectionToQuads,
	moveMember,
	removeMember,
	validateCollectionDraft,
	wouldCreateCycle,
	type SkosCollection
} from './skos-collection';

const CORE = 'http://example.org/core';
const coll = (id: string, over: Partial<SkosCollection> = {}): SkosCollection => ({
	iri: `urn:coll:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	ordered: false,
	members: [],
	...over
});

describe('collection drafts (STORY-409)', () => {
	it('needs a preferred label and allows one per language', () => {
		expect(validateCollectionDraft({ prefLabels: [], ordered: false })).toContain('A preferred label is required');
		expect(
			validateCollectionDraft({ prefLabels: [{ text: 'Regions', lang: 'en' }, { text: 'Gebiete', lang: 'de' }], ordered: true })
		).toEqual([]);
		expect(
			validateCollectionDraft({ prefLabels: [{ text: 'A', lang: 'en' }, { text: 'B', lang: 'en' }], ordered: false })
		).toContain('Only one preferred label per language (en)');
	});

	it('mints from the label in the vocab graph, apart from concept IRIs by its Collection suffix', () => {
		expect(collectionIri('Facet: region', CORE)).toBe('http://example.org/core/vocab#FacetRegionCollection');
	});
});

describe('members (STORY-409)', () => {
	it('adds a member once and keeps the order of an ordered collection', () => {
		const c = coll('A', { ordered: true });
		const next = addMember(addMember(addMember(c, 'urn:c:1', [c]), 'urn:c:2', [c]), 'urn:c:1', [c]);
		expect(next.members).toEqual(['urn:c:1', 'urn:c:2']);
	});

	it('refuses itself as a member', () => {
		const c = coll('A');
		expect(() => addMember(c, c.iri, [c])).toThrow(/itself/i);
	});

	it('refuses a membership cycle through other collections', () => {
		const a = coll('A', { members: ['urn:coll:B'] });
		const b = coll('B', { members: ['urn:coll:C'] });
		const c = coll('C');
		expect(wouldCreateCycle([a, b, c], 'urn:coll:C', 'urn:coll:A')).toBe(true);
		expect(wouldCreateCycle([a, b, c], 'urn:coll:A', 'urn:coll:C')).toBe(false);
		expect(() => addMember(c, 'urn:coll:A', [a, b, c])).toThrow(/cycle/i);
	});

	it('removes a member and moves one within the order, leaving the rest alone', () => {
		const c = coll('A', { ordered: true, members: ['x', 'y', 'z'] });
		expect(removeMember(c, 'y').members).toEqual(['x', 'z']);
		expect(moveMember(c, 2, 0).members).toEqual(['z', 'x', 'y']);
		expect(moveMember(c, 0, 5).members).toEqual(['y', 'z', 'x']);
		expect(moveMember(c, -1, 1).members).toEqual(['x', 'y', 'z']);
	});

	it('refuses to reorder an unordered collection', () => {
		expect(() => moveMember(coll('A', { members: ['x', 'y'] }), 0, 1)).toThrow(/ordered/i);
	});
});

describe('Turtle round trip of collections (STORY-409)', () => {
	it('an ordered collection keeps its member order and an unordered one its set, through n3', async () => {
		const ordered = coll('Steps', { ordered: true, members: ['urn:c:3', 'urn:c:1', 'urn:c:2'] });
		const plain = coll('Region', { members: ['urn:c:1', 'urn:coll:Steps'] });
		const quads = [...collectionToQuads(ordered), ...collectionToQuads(plain)];
		const turtle = await new Promise<string>((resolve, reject) => {
			const w = new Writer({ prefixes: { skos: 'http://www.w3.org/2004/02/skos/core#' } });
			w.addQuads(quads);
			w.end((e, r) => (e ? reject(e) : resolve(r)));
		});
		expect(turtle).toContain('memberList');
		const parsed = collectionsFromQuads(new Parser().parse(turtle));
		const byIri = new Map(parsed.map((c) => [c.iri, c]));
		expect(byIri.get(ordered.iri)).toEqual(ordered);
		const p = byIri.get(plain.iri)!;
		expect(p.ordered).toBe(false);
		expect([...p.members].sort()).toEqual([...plain.members].sort());
	});
});

describe('collectionsOfConcept (STORY-410)', () => {
	it('lists the collections that hold a concept, directly', () => {
		const all = [coll('A', { members: ['urn:c:1'] }), coll('B', { members: ['urn:coll:A'] }), coll('C', { ordered: true, members: ['urn:c:1', 'urn:c:2'] })];
		expect(collectionsOfConcept(all, 'urn:c:1').map((c) => c.iri)).toEqual(['urn:coll:A', 'urn:coll:C']);
		expect(collectionsOfConcept(all, 'urn:c:9')).toEqual([]);
	});
});
