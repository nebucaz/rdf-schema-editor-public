/**
 * Hygiene of concept-valued properties (spec/concept-valued-properties STORY-440), ontology stage. Prompts only:
 *  1. a concept property whose scheme is gone or has no concepts,
 *  2. an individual whose value is a deprecated or retired concept (the replacement is named when there is one),
 *  3. a value that is not a concept of the scheme (also reported by Validation; kept out of the semantic debt),
 *  4. a relation to the external class `skos:Concept`, which the validation engine cannot evaluate.
 * Silent without the vocabulary's concepts. Findings 2 and 3 read the individuals' values, which only the `full`
 * schema carries: on a schema loaded without individuals they are skipped silently.
 */
import { SKOS } from '#lib/utils/iri.js';
import { conceptTitle } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import type { Gate, GateFinding } from './types';

const finding = (gateId: string, severity: GateFinding['severity'], elementIri: string, message: string): GateFinding => ({
	gateId, stage: 'ontology', severity, elementIri, message
});

const localName = (iri: string) => iri.split(/[#/]/).pop() ?? iri;

export const conceptPropertyGate: Gate = {
	id: 'concept-property-hygiene',
	stage: 'ontology',
	run: (schema: FetchedSchema, options) => {
		if (!options.concepts) return [];
		const concepts = new Map(options.concepts.map((c) => [c.iri, c]));
		const found: GateFinding[] = [];
		const properties = schema.conceptProperties ?? [];

		for (const p of properties) {
			if (options.concepts.some((c) => c.schemeIri === p.valueSchemeIri)) continue;
			const schemeKnown = options.schemes?.some((s) => s.iri === p.valueSchemeIri);
			const what = schemeKnown === false ? 'no longer exists' : schemeKnown ? 'has no concepts' : 'has no concepts or no longer exists';
			found.push(finding('concept-property-empty-scheme', 'warning', p.iri, `Concept property "${p.label}": its scheme ${localName(p.valueSchemeIri)} ${what}, so no value can be valid.`));
		}

		if (properties.length > 0 && schema.individuals.length > 0) {
			const byPredicate = new Map(properties.map((p) => [p.iri, p]));
			for (const r of schema.individualIndividualRelations) {
				const p = byPredicate.get(r.predicateIri);
				if (!p) continue;
				const value = concepts.get(r.targetIndividualIri);
				if (value && value.schemeIri === p.valueSchemeIri) {
					if (value.status !== 'deprecated' && value.status !== 'retired') continue;
					const replacement = value.replacedBy ? concepts.get(value.replacedBy) : undefined;
					const hint = replacement ? ` It is replaced by "${conceptTitle(replacement)}".` : '';
					found.push(finding('concept-property-retired-value', 'warning', r.individualIri, `"${p.label}" holds the ${value.status} concept "${conceptTitle(value)}".${hint}`));
				} else {
					found.push(finding('concept-property-foreign-value', 'info', r.individualIri, `"${p.label}" holds ${value ? `"${conceptTitle(value)}", a concept of another scheme` : `${localName(r.targetIndividualIri)}, which is not a concept`}; also reported by Validation.`));
				}
			}
		}

		for (const r of schema.objectProperties) {
			if (r.range !== SKOS.Concept) continue;
			found.push(finding('relation-to-skos-concept', 'warning', r.iri, `Relation "${r.label}" points at the external class skos:Concept, which the validation cannot check. Use a concept property with a scheme instead.`));
		}
		return found;
	}
};

export const CONCEPT_PROPERTY_GATES: Gate[] = [conceptPropertyGate];
