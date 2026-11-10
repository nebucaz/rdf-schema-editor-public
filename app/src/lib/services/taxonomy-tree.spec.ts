import { describe, expect, it } from 'vitest';
import { buildClassTree, buildTaxonomy, validateReparent, type TaxonomyNode } from './taxonomy-tree';
import type { Concept } from './skos-concept';
import type { FetchedSchema } from './sparql-connector';

const SCHEME = 'urn:scheme:a';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: SCHEME, topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [],
	...over
});
const top = (id: string) => concept(id, { topConcept: true });
const under = (id: string, ...parents: string[]) => concept(id, { broader: parents.map((p) => `urn:c:${p}`) });

const flat = (nodes: TaxonomyNode[]): string[] =>
	nodes.flatMap((n) => [`${n.depth}:${n.label}`, ...flat(n.children)]);

describe('buildTaxonomy', () => {
	it('nests concepts under their broader concept with a depth', () => {
		const tree = buildTaxonomy([top('Animal'), under('Dog', 'Animal'), under('Puppy', 'Dog')], SCHEME);
		expect(flat(tree)).toEqual(['0:Animal', '1:Dog', '2:Puppy']);
		expect(tree[0].markers).toEqual([]);
	});

	it('marks a concept with no broader concept that is not a top concept as an orphan', () => {
		const tree = buildTaxonomy([top('Animal'), concept('Loose')], SCHEME);
		const loose = tree.find((n) => n.label === 'Loose')!;
		expect(loose.markers).toContain('orphan');
		expect(tree.find((n) => n.label === 'Animal')!.markers).not.toContain('orphan');
	});

	it('only draws the concepts of the requested scheme', () => {
		const other = concept('Other', { schemeIri: 'urn:scheme:b', topConcept: true });
		expect(flat(buildTaxonomy([top('Animal'), other], SCHEME))).toEqual(['0:Animal']);
	});

	it('shows a polyhierarchy under every parent and marks it', () => {
		const tree = buildTaxonomy([top('Pet'), top('Wild'), under('Fox', 'Pet', 'Wild')], SCHEME);
		const foxes = tree.flatMap((n) => n.children);
		expect(foxes.map((f) => f.label)).toEqual(['Fox', 'Fox']);
		expect(foxes.every((f) => f.markers.includes('multiple-parents'))).toBe(true);
	});

	it('does not loop on a cycle and marks every concept caught in it', () => {
		const tree = buildTaxonomy([top('Root'), under('A', 'B'), under('B', 'A')], SCHEME);
		const labels = flat(tree).map((l) => l.split(':')[1]);
		expect(labels).toContain('A');
		expect(labels).toContain('B');
		const all = (ns: TaxonomyNode[]): TaxonomyNode[] => ns.flatMap((n) => [n, ...all(n.children)]);
		const cyclic = all(tree).filter((n) => n.markers.includes('cycle'));
		expect(cyclic.map((n) => n.label).sort()).toEqual(['A', 'B']);
	});

	it('marks a top concept that still has a broader concept', () => {
		const odd = concept('Odd', { topConcept: true, broader: ['urn:c:Animal'] });
		const tree = buildTaxonomy([top('Animal'), odd], SCHEME);
		const nodes = flat(tree);
		expect(nodes).toContain('0:Animal');
		const all = (ns: TaxonomyNode[]): TaxonomyNode[] => ns.flatMap((n) => [n, ...all(n.children)]);
		expect(all(tree).find((n) => n.label === 'Odd')!.markers).toContain('top-with-broader');
	});

	it('treats a broader concept outside the scheme as absent', () => {
		const far = concept('Far', { broader: ['urn:c:Elsewhere'] });
		expect(buildTaxonomy([far], SCHEME)[0].markers).toContain('orphan');
	});
});

describe('validateReparent', () => {
	const concepts = [top('Animal'), under('Dog', 'Animal'), under('Puppy', 'Dog'), top('Plant')];

	it('allows a move to another parent', () => {
		expect(validateReparent(concepts, 'urn:c:Dog', 'urn:c:Plant')).toBeNull();
	});

	it('refuses a concept as its own parent', () => {
		expect(validateReparent(concepts, 'urn:c:Dog', 'urn:c:Dog')).toMatch(/itself/i);
	});

	it('refuses a drop below one of its own descendants as a cycle', () => {
		expect(validateReparent(concepts, 'urn:c:Dog', 'urn:c:Puppy')).toMatch(/cycle/i);
	});

	it('refuses a parent in another scheme', () => {
		const foreign = concept('Foreign', { schemeIri: 'urn:scheme:b' });
		expect(validateReparent([...concepts, foreign], 'urn:c:Dog', 'urn:c:Foreign')).toMatch(/scheme/i);
	});

	it('refuses to give a top concept a broader concept', () => {
		expect(validateReparent(concepts, 'urn:c:Animal', 'urn:c:Plant')).toMatch(/top concept/i);
	});
});

describe('buildClassTree', () => {
	const NS = 'http://example.org/ns';
	const cls = (id: string, ns = NS) => ({ iri: `${ns}#${id}`, label: id, comment: null, namespaceBaseIri: ns });
	const schema = {
		classes: [cls('Animal'), cls('Dog'), cls('Puppy'), cls('Tool', 'http://example.org/other')],
		subClassOf: [
			{ sub: `${NS}#Dog`, super: `${NS}#Animal`, namespaceBaseIri: NS },
			{ sub: `${NS}#Puppy`, super: `${NS}#Dog`, namespaceBaseIri: NS }
		]
	} as unknown as FetchedSchema;

	it('shows rdfs:subClassOf for the selected namespace only', () => {
		const tree = buildClassTree(schema, NS);
		expect(tree.map((n) => n.label)).toEqual(['Animal']);
		expect(flat(tree)).toEqual(['0:Animal', '1:Dog', '2:Puppy']);
	});

	it('keeps a class with an out-of-namespace superclass as a root', () => {
		const s = {
			...schema,
			subClassOf: [{ sub: `${NS}#Dog`, super: 'http://example.org/other#Thing', namespaceBaseIri: NS }]
		} as unknown as FetchedSchema;
		expect(buildClassTree(s, NS).map((n) => n.label).sort()).toEqual(['Animal', 'Dog', 'Puppy']);
	});
});
