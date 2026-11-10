/**
 * Consistency between the class hierarchy and the concept hierarchy (ontology-pipeline STORY-330; book p. 198).
 * If class A is a subclass of B and both are defined by a concept, A's concept must be transitively narrower than
 * B's. The finding is about the subclass, links to it, and spells out both chains. Classes sharing one concept
 * are left alone: that is an alias, not a contradiction. Silent without the vocabulary's concepts.
 */
import { conceptTitle, type Concept } from '../skos-concept';
import type { FetchedClass, FetchedSchema } from '../sparql-connector';
import { ancestorsOf } from '../taxonomy-tree';
import type { Gate, GateFinding } from './types';

const MAX_CHAIN = 8;

function classChain(start: FetchedClass, schema: FetchedSchema, byIri: Map<string, FetchedClass>): string {
	const names = [start.label];
	const seen = new Set([start.iri]);
	let current = start.iri;
	while (names.length < MAX_CHAIN) {
		const up = schema.subClassOf.find((s) => s.sub === current && byIri.has(s.super) && !seen.has(s.super));
		if (!up) break;
		seen.add(up.super);
		current = up.super;
		names.push(byIri.get(up.super)!.label);
	}
	return names.join(' → ');
}

function conceptChain(start: Concept, concepts: Map<string, Concept>): string {
	const names = [conceptTitle(start)];
	const seen = new Set([start.iri]);
	let current = start;
	while (names.length < MAX_CHAIN) {
		const next = (current.broader ?? []).map((b) => concepts.get(b)).find((c): c is Concept => !!c && !seen.has(c.iri));
		if (!next) break;
		seen.add(next.iri);
		current = next;
		names.push(conceptTitle(next));
	}
	return names.join(' → ');
}

export const classConceptHierarchyGate: Gate = {
	id: 'class-concept-hierarchy',
	stage: 'taxonomy',
	run: (schema, options) => {
		if (!options.concepts) return [];
		const concepts = new Map(options.concepts.map((c) => [c.iri, c]));
		const classes = new Map(schema.classes.map((c) => [c.iri, c]));
		const found: GateFinding[] = [];
		for (const { sub, super: sup } of schema.subClassOf) {
			const a = classes.get(sub);
			const b = classes.get(sup);
			const ca = a?.definedByConcept ? concepts.get(a.definedByConcept) : undefined;
			const cb = b?.definedByConcept ? concepts.get(b.definedByConcept) : undefined;
			if (!a || !b || !ca || !cb || ca.iri === cb.iri) continue;
			if (ancestorsOf(options.concepts, ca.iri).has(cb.iri)) continue;
			found.push({
				gateId: 'class-concept-hierarchy',
				stage: 'taxonomy',
				severity: 'warning',
				elementIri: a.iri,
				message:
					`"${a.label}" is a subclass of "${b.label}", but its concept "${conceptTitle(ca)}" is not narrower than "${conceptTitle(cb)}", the concept of "${b.label}". ` +
					`Class chain: ${classChain(a, schema, classes)}. Concept chains: ${conceptChain(ca, concepts)}; ${conceptChain(cb, concepts)}.`
			});
		}
		return found;
	}
};

export const LINK_CONSISTENCY_GATES: Gate[] = [classConceptHierarchyGate];
