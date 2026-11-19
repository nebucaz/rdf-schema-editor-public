/**
 * Structure and mapping gates (skos-support STORY-420; W3C SKOS S46, qSKOS). They run over the vocabulary's
 * concepts from `GateOptions.concepts` and stay silent without them. Collections are not concepts, so they never appear here.
 */
import { conceptTitle, type Concept } from '../skos-concept';
import { ancestorsOf } from '../taxonomy-tree';
import type { Gate, GateFinding, GateSeverity } from './types';

const finding = (gateId: string, stage: 'taxonomy' | 'thesaurus', severity: GateSeverity, iri: string, message: string): GateFinding => ({
	gateId,
	stage,
	severity,
	elementIri: iri,
	message
});

const CLASHING = new Set(['broadMatch', 'relatedMatch', 'narrowMatch']);

export const mappingClashGate: Gate = {
	id: 'mapping-clash',
	stage: 'thesaurus',
	run: (_schema, options) => {
		const concepts = options.concepts ?? [];
		const kinds = new Map<string, Set<string>>();
		// Both directions land on one key, so a clash split over two concepts is still found.
		for (const c of concepts)
			for (const m of c.mappings ?? []) {
				const key = [c.iri, m.target].sort().join('\n');
				kinds.set(key, (kinds.get(key) ?? new Set()).add(m.kind));
			}
		const byIri = new Map(concepts.map((c) => [c.iri, c]));
		return concepts.flatMap((c) =>
			(c.mappings ?? []).flatMap((m) => {
				if (m.kind !== 'exactMatch') return [];
				const [a, b] = [c.iri, m.target].sort();
				const set = kinds.get(`${a}\n${b}`)!;
				if (![...set].some((k) => CLASHING.has(k))) return [];
				const other = byIri.get(m.target);
				return [
					finding('mapping-clash', 'thesaurus', 'warning', c.iri,
						`"${conceptTitle(c)}" has an exact match with ${other ? `"${conceptTitle(other)}"` : m.target} and also a broad, related or narrow match to the same concept. SKOS forbids this combination (S46).`)
				];
			})
		);
	}
};

export const relatedBetweenSiblingsGate: Gate = {
	id: 'related-between-siblings',
	stage: 'thesaurus',
	run: (_schema, options) => {
		const concepts = options.concepts ?? [];
		const byIri = new Map(concepts.map((c) => [c.iri, c]));
		const seen = new Set<string>();
		return concepts.flatMap((c) =>
			(c.related ?? []).flatMap((targetIri) => {
				const target = byIri.get(targetIri);
				if (!target || target.iri === c.iri) return [];
				const key = [c.iri, target.iri].sort().join('\n');
				if (seen.has(key)) return [];
				const shared = (c.broader ?? []).filter((p) => (target.broader ?? []).includes(p));
				if (!shared.length) return [];
				seen.add(key);
				const parent = byIri.get(shared[0]);
				return [
					finding('related-between-siblings', 'thesaurus', 'info', c.iri,
						`"${conceptTitle(c)}" is related to "${conceptTitle(target)}", but both sit under ${parent ? `"${conceptTitle(parent)}"` : shared[0]}. A related link between siblings adds nothing (qSKOS: valueless associative relation).`)
				];
			})
		);
	}
};

export const hierarchicalRedundancyGate: Gate = {
	id: 'hierarchical-redundancy',
	stage: 'taxonomy',
	run: (_schema, options) => {
		const concepts = options.concepts ?? [];
		const byIri = new Map(concepts.map((c) => [c.iri, c]));
		return concepts.flatMap((c) =>
			(c.broader ?? []).flatMap((parentIri) => {
				const via = (c.broader ?? []).find((o) => o !== parentIri && ancestorsOf(concepts, o).has(parentIri));
				if (!via) return [];
				const parent = byIri.get(parentIri);
				return [
					finding('hierarchical-redundancy', 'taxonomy', 'info', c.iri,
						`"${conceptTitle(c)}" is broader-linked to ${parent ? `"${conceptTitle(parent)}"` : parentIri}, which is already implied through "${conceptTitle(byIri.get(via) ?? c)}". The direct link is redundant.`)
				];
			})
		);
	}
};

export const reflexiveRelationGate: Gate = {
	id: 'reflexive-relation',
	stage: 'thesaurus',
	run: (_schema, options) =>
		(options.concepts ?? []).flatMap((c) => {
			const kinds = [
				...((c.broader ?? []).includes(c.iri) ? ['broader'] : []),
				...((c.related ?? []).includes(c.iri) ? ['related'] : []),
				...(c.mappings ?? []).filter((m) => m.target === c.iri).map((m) => m.kind)
			];
			return kinds.length
				? [finding('reflexive-relation', 'thesaurus', 'warning', c.iri, `"${conceptTitle(c)}" has a ${kinds.join(', ')} link to itself.`)]
				: [];
		})
};

export const omittedTopConceptGate: Gate = {
	id: 'omitted-top-concept',
	stage: 'taxonomy',
	run: (_schema, options) => {
		const bySchemes = new Map<string, Concept[]>();
		for (const c of options.concepts ?? []) if (c.schemeIri) bySchemes.set(c.schemeIri, [...(bySchemes.get(c.schemeIri) ?? []), c]);
		return [...bySchemes].flatMap(([scheme, cs]) =>
			cs.some((c) => c.topConcept)
				? []
				: [finding('omitted-top-concept', 'taxonomy', 'warning', scheme, `The scheme has ${cs.length} concept${cs.length === 1 ? '' : 's'} but no top concept. Mark the entry points (qSKOS: omitted top concept).`)]
		);
	}
};

export const mappingWithoutSchemeGate: Gate = {
	id: 'mapping-without-scheme',
	stage: 'thesaurus',
	run: (_schema, options) =>
		(options.concepts ?? [])
			.filter((c) => !c.schemeIri && (c.mappings?.length ?? 0) > 0)
			.map((c) => finding('mapping-without-scheme', 'thesaurus', 'info', c.iri, `"${conceptTitle(c)}" has mappings but belongs to no scheme, so they cannot be told apart from links inside it.`))
};

export const STRUCTURE_MAPPING_GATES: Gate[] = [
	mappingClashGate,
	relatedBetweenSiblingsGate,
	hierarchicalRedundancyGate,
	reflexiveRelationGate,
	omittedTopConceptGate,
	mappingWithoutSchemeGate
];
