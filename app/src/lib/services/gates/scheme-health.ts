/**
 * Scheme health gates (ontology-dashboard STORY-459): the defects `analyseSchemeHealth` finds, as gate findings, so
 * the Model checks list is the one place that shows them. Without `GateOptions.concepts` they report nothing.
 * Each finding is about a concept, which the report opens in the vocabulary (`links.ts`).
 */
import { analyseSchemeHealth, schemeHealthDebt, type SchemeHealthDebtKind } from '../scheme-health';
import { conceptTitle } from '../skos-concept';
import type { Gate } from './types';

const gateOf = (kind: SchemeHealthDebtKind): Gate => ({
	id: kind,
	stage: 'taxonomy',
	run: (_schema, options) => {
		const concepts = options.concepts ?? [];
		const titles = new Map(concepts.map((c) => [c.iri, conceptTitle(c)]));
		return schemeHealthDebt(analyseSchemeHealth(concepts), (iri) => titles.get(iri) ?? iri)
			.filter((d) => d.kind === kind)
			.map((d) => ({ gateId: kind, stage: 'taxonomy' as const, severity: 'warning' as const, elementIri: d.concept, message: d.detail }));
	}
});

export const SCHEME_HEALTH_GATES: Gate[] = [gateOf('orphan-concept'), gateOf('disconnected-cluster'), gateOf('undefined-reference')];
