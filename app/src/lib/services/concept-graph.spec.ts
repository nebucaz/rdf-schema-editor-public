import { describe, expect, it } from 'vitest';
import { schemeDisplayName } from './skos-concept';
import { buildNeighborhood, buildSchemeGraph } from './concept-graph';
import type { Concept, ConceptScheme } from './skos-concept';

const SCHEME = 'urn:scheme:a';
const schemes: ConceptScheme[] = [{ iri: SCHEME, name: 'A', description: '', scope: {} } as unknown as ConceptScheme];

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [], disambiguation: '',
	schemeIri: SCHEME, topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [],
	...over
});
const top = (id: string) => concept(id, { topConcept: true });
const under = (id: string, ...parents: string[]) => concept(id, { broader: parents.map((p) => `urn:c:${p}`) });
const build = (cs: Concept[], opts: Partial<Parameters<typeof buildSchemeGraph>[2]> = {}) =>
	buildSchemeGraph(cs, schemes, { schemeIri: SCHEME, ...opts });

describe('buildSchemeGraph', () => {
	it('gives a three-level scheme the right nodes, links and depths', () => {
		const g = build([top('Animal'), under('Dog', 'Animal'), under('Puppy', 'Dog')]);
		expect(g.nodes.map((n) => `${n.depth}:${n.label}`).sort()).toEqual(['0:Animal', '1:Dog', '2:Puppy']);
		const label = (id: string) => g.nodes.find((n) => n.id === id)!.label;
		expect(g.links.map((l) => `${label(l.from)}>${label(l.to)}:${l.kind}`).sort()).toEqual([
			'Animal>Dog:broader',
			'Dog>Puppy:broader'
		]);
		expect(g.truncated).toBe(false);
		// Laid out top-down: a child sits below its parent.
		const y = (l: string) => g.nodes.find((n) => n.label === l)!.y;
		expect(y('Animal')).toBeLessThan(y('Dog'));
		expect(y('Dog')).toBeLessThan(y('Puppy'));
	});

	it('draws a concept with two broader concepts under each parent and marks the duplicate', () => {
		const g = build([top('Pet'), top('Wild'), under('Fox', 'Pet', 'Wild')]);
		const foxes = g.nodes.filter((n) => n.label === 'Fox');
		expect(foxes).toHaveLength(2);
		expect(new Set(foxes.map((f) => f.id)).size).toBe(2);
		const dup = foxes.filter((f) => f.duplicateOf);
		expect(dup).toHaveLength(1);
		expect(dup[0].duplicateOf).toBe(foxes.find((f) => !f.duplicateOf)!.id);
		expect(g.links.filter((l) => l.kind === 'duplicate-of')).toEqual([{ from: dup[0].id, to: dup[0].duplicateOf, kind: 'duplicate-of' }]);
	});

	it('keeps the orphan and cycle markers of buildTaxonomy and never loops', () => {
		const g = build([top('Root'), concept('Loose'), under('A', 'B'), under('B', 'A')]);
		expect(g.nodes.find((n) => n.label === 'Loose')!.markers).toContain('orphan');
		const cyclic = g.nodes.filter((n) => n.markers.includes('cycle')).map((n) => n.label).sort();
		expect(cyclic).toEqual(['A', 'B']);
	});

	it('truncates over maxNodes, collapses the deepest levels and expands one level at a time', () => {
		const cs = [top('R'), under('K1', 'R'), under('K2', 'R'), under('G1', 'K1'), under('G2', 'K1'), under('G3', 'K2'), under('H1', 'G1')];
		const g = build(cs, { maxNodes: 4 });
		expect(g.truncated).toBe(true);
		expect(g.nodes.map((n) => n.label).sort()).toEqual(['K1', 'K2', 'R']);
		expect(g.nodes.find((n) => n.label === 'K1')!.hiddenChildren).toBe(2);
		expect(g.nodes.find((n) => n.label === 'R')!.hiddenChildren).toBe(0);

		const next = g.expand('urn:c:K1');
		expect(next.nodes.map((n) => n.label).sort()).toEqual(['G1', 'G2', 'K1', 'K2', 'R']);
		expect(next.nodes.find((n) => n.label === 'G1')!.hiddenChildren).toBe(1);
		expect(next.truncated).toBe(true);

		const all = next.expand('urn:c:K2').expand('urn:c:G1');
		expect(all.nodes.map((n) => n.label).sort()).toEqual(['G1', 'G2', 'G3', 'H1', 'K1', 'K2', 'R']);
		expect(all.truncated).toBe(false);
	});

	it('stays under the cap for a 1000-concept scheme', () => {
		const cs = [top('R')];
		for (let i = 0; i < 999; i++) cs.push(under(`C${i}`, i < 20 ? 'R' : `C${i % 20}`));
		const g = build(cs);
		expect(g.nodes.length).toBeLessThanOrEqual(300);
		expect(g.truncated).toBe(true);
		const flat = [top('R'), ...Array.from({ length: 999 }, (_, i) => top(`T${i}`))];
		expect(build(flat).nodes.length).toBeLessThanOrEqual(300);
	});

	it('adds related and mapping links only when the layers are switched on', () => {
		const cs = [
			top('A'),
			top('B'),
			concept('C', { topConcept: true, related: ['urn:c:A'], mappings: [{ kind: 'exactMatch', target: 'urn:c:B' }] }),
			concept('D', { topConcept: true, related: ['urn:c:A'] })
		];
		const kinds = (g: ReturnType<typeof build>) => g.links.map((l) => l.kind).sort();
		expect(kinds(build(cs))).toEqual([]);
		expect(kinds(build(cs, { layers: { related: true } }))).toEqual(['related', 'related']);
		expect(kinds(build(cs, { layers: { mappings: true } }))).toEqual(['exactMatch']);
		// A mapping to a concept that is not drawn adds nothing.
		const away = [concept('E', { topConcept: true, mappings: [{ kind: 'closeMatch', target: 'urn:other' }] })];
		expect(kinds(build(away, { layers: { mappings: true } }))).toEqual([]);
	});

	it('can lay the tree out radially', () => {
		const g = build([top('Animal'), under('Dog', 'Animal'), under('Cat', 'Animal')], { layout: 'radial' });
		const dist = (l: string) => {
			const n = g.nodes.find((x) => x.label === l)!;
			return Math.hypot(n.x, n.y);
		};
		expect(dist('Animal')).toBeLessThan(dist('Dog'));
		expect(dist('Dog')).toBeCloseTo(dist('Cat'));
	});
});

describe('buildNeighborhood', () => {
	it('returns broader, narrower and related concepts without duplicates', () => {
		const cs = [
			top('Animal'),
			concept('Dog', { broader: ['urn:c:Animal', 'urn:c:Animal'], related: ['urn:c:Wolf'] }),
			under('Puppy', 'Dog'),
			under('Pup', 'Dog'),
			concept('Wolf'),
			concept('Fox', { related: ['urn:c:Dog', 'urn:c:Wolf'] })
		];
		const n = buildNeighborhood(cs, 'urn:c:Dog');
		expect(n.center?.label).toBe('Dog');
		expect(n.broader.map((c) => c.label)).toEqual(['Animal']);
		expect(n.narrower.map((c) => c.label)).toEqual(['Pup', 'Puppy']);
		expect(n.related.map((c) => c.label)).toEqual(['Fox', 'Wolf']);
	});

	it('is empty for an unknown concept', () => {
		expect(buildNeighborhood([top('A')], 'urn:c:none').center).toBeNull();
	});
});

describe('buildNeighborhood scheme node', () => {
	const schemes = [{ iri: SCHEME, name: 'Lifecycle', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }];

	it('names the scheme for a concept with no broader concept', () => {
		const n = buildNeighborhood([top('Draft'), concept('Active')], 'urn:c:Active', schemes);
		expect(n.scheme).toEqual({ iri: SCHEME, label: 'Lifecycle' });
		expect(buildNeighborhood([top('Draft')], 'urn:c:Draft', schemes).scheme?.label).toBe('Lifecycle');
	});

	it('leaves the scheme out when a broader concept already leads to it', () => {
		expect(buildNeighborhood([top('Animal'), under('Dog', 'Animal')], 'urn:c:Dog', schemes).scheme).toBeNull();
	});

	it('has no scheme node for a concept in no scheme, or when no schemes are given', () => {
		expect(buildNeighborhood([concept('Loose', { schemeIri: '' })], 'urn:c:Loose', schemes).scheme).toBeNull();
		expect(buildNeighborhood([top('A')], 'urn:c:A').scheme).toBeNull();
	});

	it('falls back to the last part of the scheme IRI when the scheme has no name', () => {
		const unnamed = [{ ...schemes[0], name: '' }];
		expect(buildNeighborhood([top('A')], 'urn:c:A', unnamed).scheme?.label).toBe(schemeDisplayName(unnamed[0]));
	});
});
