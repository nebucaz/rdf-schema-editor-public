/**
 * Thesaurus gates (ontology-pipeline STORY-329; book pp. 137, 154-155). They run over the vocabulary's
 * concepts from `GateOptions.concepts` and stay silent without them. Both findings are about the concept
 * that states the relation, and link to it.
 */
import { conceptTitle, type Concept } from '../skos-concept';
import { ancestorsOf } from '../taxonomy-tree';
import type { Gate, GateFinding, GateSeverity } from './types';

const finding = (gateId: string, severity: GateSeverity, c: Concept, message: string): GateFinding => ({
	gateId,
	stage: 'thesaurus',
	severity,
	elementIri: c.iri,
	message
});

export const mappingWithinSchemeGate: Gate = {
	id: 'mapping-within-scheme',
	stage: 'thesaurus',
	run: (_schema, options) => {
		const concepts = options.concepts ?? [];
		const byIri = new Map(concepts.map((c) => [c.iri, c]));
		return concepts.flatMap((c) =>
			(c.mappings ?? []).flatMap((m) => {
				const target = byIri.get(m.target);
				if (!target || !c.schemeIri || target.schemeIri !== c.schemeIri) return [];
				return [
					finding(
						'mapping-within-scheme',
						'warning',
						c,
						`"${conceptTitle(c)}" has a ${m.kind} mapping to "${conceptTitle(target)}", which is in the same scheme. Mappings are for concepts of other schemes.`
					)
				];
			})
		);
	}
};

export const relatedWithinChainGate: Gate = {
	id: 'related-within-chain',
	stage: 'thesaurus',
	run: (_schema, options) => {
		const concepts = options.concepts ?? [];
		const byIri = new Map(concepts.map((c) => [c.iri, c]));
		return concepts.flatMap((c) =>
			(c.related ?? []).flatMap((targetIri) => {
				const target = byIri.get(targetIri);
				if (!target) return [];
				const upwards = ancestorsOf(concepts, c.iri).has(targetIri);
				const downwards = ancestorsOf(concepts, targetIri).has(c.iri);
				if (!upwards && !downwards) return [];
				const [lower, higher] = upwards ? [c, target] : [target, c];
				return [
					finding(
						'related-within-chain',
						'info',
						c,
						`"${conceptTitle(c)}" is related to "${conceptTitle(target)}", but "${conceptTitle(higher)}" is already above "${conceptTitle(lower)}" in the hierarchy. Related is for concepts on different branches (for human judgement).`
					)
				];
			})
		);
	}
};

export const THESAURUS_GATES: Gate[] = [mappingWithinSchemeGate, relatedWithinChainGate];
