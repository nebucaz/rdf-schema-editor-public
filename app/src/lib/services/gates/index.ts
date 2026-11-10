import type { FetchedSchema } from '../sparql-connector';
import { GOVERNANCE_GATES } from './governance';
import { LINK_CONSISTENCY_GATES } from './link-consistency';
import { LINK_GATES } from './link';
import { ONTOLOGY_GATES } from './ontology-gates';
import { QUESTION_REVIEW_GATES } from './question-review';
import { TAXONOMY_GATES } from './taxonomy';
import { THESAURUS_GATES } from './thesaurus';
import { VOCABULARY_GATES } from './vocabulary';
import { PIPELINE_STAGES, type Gate, type GateFinding, type GateOptions } from './types';

export * from './types';

/** Every registered gate. A stage with no gate simply contributes nothing. */
export const GATES: Gate[] = [...VOCABULARY_GATES, ...ONTOLOGY_GATES, ...LINK_GATES, ...THESAURUS_GATES, ...TAXONOMY_GATES, ...LINK_CONSISTENCY_GATES, ...GOVERNANCE_GATES, ...QUESTION_REVIEW_GATES];

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
