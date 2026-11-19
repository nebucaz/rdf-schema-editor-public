/**
 * Stale concept gate (ontology-dashboard STORY-460, ported from the semantic debt list): a live concept untouched
 * for `GateOptions.staleAfterMonths` or longer, from its modified date, else its created date. Silent without
 * concepts or without the threshold.
 */
import { monthsAgo } from '../debt-settings';
import { conceptTitle } from '../skos-concept';
import type { Gate, GateFinding } from './types';

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];

export const staleConceptGate: Gate = {
	id: 'stale-concept',
	stage: 'vocabulary',
	run: (_schema, options) => {
		const threshold = options.staleAfterMonths;
		if (!options.concepts || threshold === undefined) return [];
		const now = options.now ?? new Date();
		return options.concepts.flatMap((c): GateFinding[] => {
			if (!LIVE.includes(c.status)) return [];
			const age = monthsAgo(c.modified || c.created, now);
			if (age === null || age < threshold) return [];
			return [
				{
					gateId: 'stale-concept',
					stage: 'vocabulary',
					severity: 'warning',
					elementIri: c.iri,
					message: `"${conceptTitle(c)}" has not been touched for ${age} months (threshold ${threshold}).`
				}
			];
		});
	}
};

export const STALE_CONCEPT_GATES: Gate[] = [staleConceptGate];
