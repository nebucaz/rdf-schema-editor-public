import type { FetchedSchema } from '../sparql-connector';
import { CONCEPT_PROPERTY_GATES } from './concept-properties';
import { GOVERNANCE_GATES } from './governance';
import { LABELS_NOTATION_TYPES_GATES } from './labels-notation-types';
import { LINK_CONSISTENCY_GATES } from './link-consistency';
import { LINK_GATES } from './link';
import { ONTOLOGY_GATES } from './ontology-gates';
import { QUESTION_COVERAGE_GATES } from './question-coverage';
import { QUESTION_REVIEW_GATES } from './question-review';
import { STALE_CONCEPT_GATES } from './stale-concept';
import { TAXONOMY_GATES } from './taxonomy';
import { SCHEME_HEALTH_GATES } from './scheme-health';
import { STRUCTURE_MAPPING_GATES } from './structure-mappings';
import { THESAURUS_GATES } from './thesaurus';
import { VOCABULARY_GATES } from './vocabulary';
import { PIPELINE_STAGES, type Gate, type GateFinding, type GateOptions } from './types';

export * from './types';

/** Every registered gate. A stage with no gate simply contributes nothing. */
export const GATES: Gate[] = [...VOCABULARY_GATES, ...ONTOLOGY_GATES, ...CONCEPT_PROPERTY_GATES, ...LINK_GATES, ...THESAURUS_GATES, ...STRUCTURE_MAPPING_GATES, ...LABELS_NOTATION_TYPES_GATES, ...TAXONOMY_GATES, ...LINK_CONSISTENCY_GATES, ...GOVERNANCE_GATES, ...QUESTION_REVIEW_GATES, ...SCHEME_HEALTH_GATES, ...STALE_CONCEPT_GATES, ...QUESTION_COVERAGE_GATES];

/** Runs the gates over a loaded schema. Never throws: a gate that fails is skipped, so one broken check
 *  cannot hide the others. */
export function runGates(schema: FetchedSchema, options: GateOptions = {}, gates: Gate[] = GATES): GateFinding[] {
	const wanted = options.stages?.filter((s) => (PIPELINE_STAGES as readonly string[]).includes(s));
	const selected = options.stages ? gates.filter((g) => wanted!.includes(g.stage)) : gates;
	return selected.flatMap((gate) => {
		try {
			return gate.run(schema, options);
		} catch {
			return [];
		}
	});
}
