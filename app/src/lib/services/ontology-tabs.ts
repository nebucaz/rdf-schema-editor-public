/** The tabs of the Ontology page (`/pipeline?tab=overview|checks`, spec/ontology-dashboard STORY-466). Overview is the default and has no parameter. */
import { MODEL_CHECKS_KEYS } from './model-checks-model.js';

export const ONTOLOGY_TABS = ['overview', 'checks'] as const;
export type OntologyTab = (typeof ONTOLOGY_TABS)[number];

export function parseOntologyTab(params: { get(name: string): string | null }): OntologyTab {
	return params.get('tab') === 'checks' ? 'checks' : 'overview';
}

/** A copy of `params` with `tab` set; Overview removes it together with the Model checks filters, which only belong to that tab. */
export function withOntologyTab(params: { toString(): string }, tab: OntologyTab): URLSearchParams {
	const next = new URLSearchParams(params.toString());
	if (tab === 'overview') {
		next.delete('tab');
		for (const key of MODEL_CHECKS_KEYS) next.delete(key);
	} else {
		next.set('tab', 'checks');
	}
	return next;
}
