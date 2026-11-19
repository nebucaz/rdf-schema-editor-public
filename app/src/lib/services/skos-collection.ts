/**
 * SKOS collections of the core vocabulary (skos-support STORY-409): a `skos:Collection` groups concepts (or other
 * collections) for navigation and facets without implying a hierarchy; a `skos:OrderedCollection` keeps its members
 * in an `rdf:List`. Pure; storage is in `SparqlConnector`. Which nodes may be members is our convention, not a W3C rule.
 */
import { DataFactory, type Quad } from 'n3';
import { SKOS, collectionIri } from '#lib/utils/iri.js';
import type { LangText } from './skos-concept';

export { collectionIri };

const { namedNode, literal, blankNode, quad } = DataFactory;
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDF_TYPE = `${RDF_NS}type`;
const RDF_FIRST = `${RDF_NS}first`;
const RDF_REST = `${RDF_NS}rest`;
const RDF_NIL = `${RDF_NS}nil`;

export interface CollectionDraft {
	prefLabels: LangText[];
	ordered: boolean;
}

export interface SkosCollection extends CollectionDraft {
	iri: string;
	/** Concept or collection IRIs; the list order for an ordered collection, otherwise a set. */
	members: string[];
}

export function validateCollectionDraft(d: CollectionDraft): string[] {
	const errors: string[] = [];
	const prefs = d.prefLabels.filter((l) => l.text.trim());
	if (prefs.length === 0) errors.push('A preferred label is required');
	const seen = new Set<string>();
	for (const p of prefs) {
		const lang = p.lang.trim().toLowerCase();
		if (seen.has(lang)) {
			const msg = `Only one preferred label per language (${lang || 'none'})`;
			if (!errors.includes(msg)) errors.push(msg);
		}
		seen.add(lang);
	}
	return errors;
}

/** True when making `member` a member of `parent` would let `parent` contain itself, directly or through other collections. */
export function wouldCreateCycle(collections: SkosCollection[], parent: string, member: string): boolean {
	if (parent === member) return true;
	const byIri = new Map(collections.map((c) => [c.iri, c]));
	const seen = new Set<string>();
	const stack = [member];
	while (stack.length) {
		const next = stack.pop()!;
		if (next === parent) return true;
		if (seen.has(next)) continue;
		seen.add(next);
		stack.push(...(byIri.get(next)?.members ?? []));
	}
	return false;
}

export function addMember(collection: SkosCollection, member: string, all: SkosCollection[]): SkosCollection {
	if (member === collection.iri) throw new Error('A collection cannot be a member of itself');
	if (wouldCreateCycle(all, collection.iri, member)) throw new Error('That would make the collection contain itself (a membership cycle)');
	return collection.members.includes(member) ? collection : { ...collection, members: [...collection.members, member] };
}

export function removeMember(collection: SkosCollection, member: string): SkosCollection {
	return { ...collection, members: collection.members.filter((m) => m !== member) };
}

/** Moves a member of an ordered collection; an index past the end moves it last, a bad `from` changes nothing. */
export function moveMember(collection: SkosCollection, from: number, to: number): SkosCollection {
	if (!collection.ordered) throw new Error('Only an ordered collection has an order');
	if (from < 0 || from >= collection.members.length) return collection;
	const members = [...collection.members];
	const [item] = members.splice(from, 1);
	members.splice(Math.max(0, Math.min(to, members.length)), 0, item);
	return { ...collection, members };
}

/** The collections that directly hold the concept. */
export function collectionsOfConcept(collections: SkosCollection[], conceptIri: string): SkosCollection[] {
	return collections.filter((c) => c.members.includes(conceptIri));
}

/** The collection as RDF: unordered members as `skos:member`, ordered ones as an `rdf:List` in `skos:memberList`. */
export function collectionToQuads(c: SkosCollection, nodeId?: (index: number) => string): Quad[] {
	const s = namedNode(c.iri);
	const quads: Quad[] = [quad(s, namedNode(RDF_TYPE), namedNode(c.ordered ? SKOS.OrderedCollection : SKOS.Collection))];
	for (const l of c.prefLabels.filter((x) => x.text.trim())) {
		quads.push(quad(s, namedNode(SKOS.prefLabel), l.lang ? literal(l.text, l.lang) : literal(l.text)));
	}
	if (!c.ordered) {
		for (const m of c.members) quads.push(quad(s, namedNode(SKOS.member), namedNode(m)));
		return quads;
	}
	const nodes = c.members.map((_, i) => (nodeId ? blankNode(nodeId(i)) : blankNode()));
	quads.push(quad(s, namedNode(SKOS.memberList), nodes[0] ?? namedNode(RDF_NIL)));
	c.members.forEach((m, i) => {
		quads.push(quad(nodes[i], namedNode(RDF_FIRST), namedNode(m)));
		quads.push(quad(nodes[i], namedNode(RDF_REST), nodes[i + 1] ?? namedNode(RDF_NIL)));
	});
	return quads;
}

/** Reads collections back from parsed Turtle; the inverse of `collectionToQuads`. */
export function collectionsFromQuads(quads: Quad[]): SkosCollection[] {
	const out = new Map<string, SkosCollection>();
	const objectsOf = (subject: string, predicate: string) =>
		quads.filter((q) => q.subject.value === subject && q.predicate.value === predicate).map((q) => q.object);
	for (const q of quads) {
		if (q.predicate.value !== RDF_TYPE) continue;
		if (q.object.value !== SKOS.Collection && q.object.value !== SKOS.OrderedCollection) continue;
		const iri = q.subject.value;
		const ordered = q.object.value === SKOS.OrderedCollection;
		const prefLabels = objectsOf(iri, SKOS.prefLabel).map((o) => ({ text: o.value, lang: 'language' in o ? (o.language as string) : '' }));
		const members: string[] = [];
		if (ordered) {
			let node = objectsOf(iri, SKOS.memberList)[0]?.value;
			const guard = new Set<string>();
			while (node && node !== RDF_NIL && !guard.has(node)) {
				guard.add(node);
				const first = objectsOf(node, RDF_FIRST)[0];
				if (first) members.push(first.value);
				node = objectsOf(node, RDF_REST)[0]?.value;
			}
		} else {
			members.push(...objectsOf(iri, SKOS.member).map((o) => o.value));
		}
		out.set(iri, { iri, prefLabels, ordered, members });
	}
	return [...out.values()];
}
