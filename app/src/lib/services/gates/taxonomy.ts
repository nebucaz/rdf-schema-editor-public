/**
 * Taxonomy gates (ontology-pipeline STORY-330; book pp. 104-106, 115, 135, 137). They run over the vocabulary's
 * live concepts from `GateOptions.concepts` and stay silent without them. The structural checks are warnings;
 * the review prompts (depth, sibling overlap) are info and say so: they ask a person to look, they do not
 * claim an error. The two definition checks belong to the vocabulary stage.
 */
import { conceptTitle, normaliseLabel, type Concept } from '../skos-concept';
import { branchDepth, broaderCycleMembers, buildTaxonomy } from '../taxonomy-tree';
import type { Gate, GateFinding, GateSeverity, PipelineStage } from './types';

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];
const live = (concepts: Concept[] | undefined) => (concepts ?? []).filter((c) => LIVE.includes(c.status));

const finding = (gateId: string, stage: PipelineStage, severity: GateSeverity, c: Concept, message: string): GateFinding => ({
	gateId,
	stage,
	severity,
	elementIri: c.iri,
	message
});

const FOR_JUDGEMENT = '(for human judgement)';

export const taxonomyCycleGate: Gate = {
	id: 'taxonomy-cycle',
	stage: 'taxonomy',
	run: (_schema, options) => {
		const concepts = live(options.concepts);
		const onCycle = broaderCycleMembers(concepts);
		return concepts
			.filter((c) => onCycle.has(c.iri))
			.map((c) => finding('taxonomy-cycle', 'taxonomy', 'warning', c, `"${conceptTitle(c)}" is on a cycle of skos:broader links: it is, through its broader concepts, broader than itself.`));
	}
};

export const topConceptWithBroaderGate: Gate = {
	id: 'top-concept-with-broader',
	stage: 'taxonomy',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => c.topConcept && (c.broader?.length ?? 0) > 0)
			.map((c) => finding('top-concept-with-broader', 'taxonomy', 'warning', c, `"${conceptTitle(c)}" is a top concept but also has a broader concept.`))
};

export const conceptWithoutSchemeGate: Gate = {
	id: 'concept-without-scheme',
	stage: 'taxonomy',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => !c.schemeIri.trim())
			.map((c) => finding('concept-without-scheme', 'taxonomy', 'warning', c, `"${conceptTitle(c)}" is in no scheme, so it appears in no taxonomy.`))
};

export const depthInconsistentGate: Gate = {
	id: 'depth-inconsistent',
	stage: 'taxonomy',
	run: (_schema, options) => {
		const concepts = live(options.concepts);
		const byIri = new Map(concepts.map((c) => [c.iri, c]));
		const schemes = [...new Set(concepts.map((c) => c.schemeIri))].filter(Boolean);
		return schemes.flatMap((scheme) => {
			const branches = buildTaxonomy(concepts, scheme)
				.filter((n) => byIri.get(n.iri)?.topConcept && !n.markers.includes('cycle'))
				.map((n) => ({ node: n, depth: branchDepth(n) }));
			if (branches.length < 2) return [];
			const deepest = Math.max(...branches.map((b) => b.depth));
			return branches
				.filter((b) => deepest - b.depth >= 3)
				.map((b) =>
					finding(
						'depth-inconsistent',
						'taxonomy',
						'info',
						byIri.get(b.node.iri)!,
						`The branch of "${b.node.label}" is ${b.depth} level${b.depth === 1 ? '' : 's'} deep while another branch of the scheme is ${deepest} deep. Check that both are split to a similar degree ${FOR_JUDGEMENT}.`
					)
				);
		});
	}
};

/** Plain-language words of a text, without the short ones that say nothing about the meaning. */
const significantWords = (text: string) => new Set(normaliseLabel(text).split(' ').filter((w) => w.length > 3));
const MIN_OVERLAP_WORDS = 4;
const OVERLAP_THRESHOLD = 0.7;

export const siblingOverlapGate: Gate = {
	id: 'sibling-overlap',
	stage: 'taxonomy',
	run: (_schema, options) => {
		const concepts = live(options.concepts);
		const seen = new Set<string>();
		const found: GateFinding[] = [];
		const byParent = new Map<string, Concept[]>();
		for (const c of concepts) for (const p of c.broader ?? []) byParent.set(p, [...(byParent.get(p) ?? []), c]);
		for (const siblings of byParent.values()) {
			const sorted = [...siblings].sort((a, b) => (a.iri < b.iri ? -1 : 1));
			for (let i = 0; i < sorted.length; i++) {
				for (let j = i + 1; j < sorted.length; j++) {
					const [a, b] = [sorted[i], sorted[j]];
					const key = `${a.iri}|${b.iri}`;
					if (seen.has(key)) continue;
					const wa = significantWords(a.definition);
					const wb = significantWords(b.definition);
					if (wa.size < MIN_OVERLAP_WORDS || wb.size < MIN_OVERLAP_WORDS) continue;
					const shared = [...wa].filter((w) => wb.has(w)).length;
					if (shared / (wa.size + wb.size - shared) < OVERLAP_THRESHOLD) continue;
					seen.add(key);
					found.push(
						finding(
							'sibling-overlap',
							'taxonomy',
							'info',
							a,
							`"${conceptTitle(a)}" and "${conceptTitle(b)}" share a broader concept and nearly the same definition. Are they one concept, or do the definitions need to tell them apart ${FOR_JUDGEMENT}?`
						)
					);
				}
			}
		}
		return found;
	}
};

export const definitionCircularGate: Gate = {
	id: 'definition-circular',
	stage: 'vocabulary',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => {
				const def = ` ${normaliseLabel(c.definition)} `;
				return c.definition.trim() !== '' && c.prefLabels.some((l) => normaliseLabel(l.text) !== '' && def.includes(` ${normaliseLabel(l.text)} `));
			})
			.map((c) => finding('definition-circular', 'vocabulary', 'warning', c, `The definition of "${conceptTitle(c)}" uses the term itself; define it with other words.`))
};

const MAX_SENTENCES = 2;
/** A sentence ends at . ! or ? followed by a space and a capital or digit, so "e.g. per" and "3.5" do not split. */
const sentenceCount = (text: string) => text.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(])/u).filter((s) => s.trim()).length;

export const definitionLengthGate: Gate = {
	id: 'definition-length',
	stage: 'vocabulary',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => sentenceCount(c.definition) > MAX_SENTENCES)
			.map((c) => finding('definition-length', 'vocabulary', 'warning', c, `The definition of "${conceptTitle(c)}" has more than ${MAX_SENTENCES} sentences; keep it short and move the rest to the scope note.`))
};

export const TAXONOMY_GATES: Gate[] = [
	taxonomyCycleGate,
	topConceptWithBroaderGate,
	conceptWithoutSchemeGate,
	depthInconsistentGate,
	siblingOverlapGate,
	definitionCircularGate,
	definitionLengthGate
];
