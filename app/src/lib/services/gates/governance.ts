/**
 * Governance gate (ontology-pipeline STORY-331): the core namespace must name a steward, an authority and a
 * version. Silent when there is no core namespace (`GateOptions.governance` absent or null).
 */
import { missingGovernance } from '../governance';
import type { Gate } from './types';

export const governanceIncompleteGate: Gate = {
	id: 'governance-incomplete',
	stage: 'governance',
	run: (_schema, options) => {
		const g = options.governance;
		if (!g) return [];
		const missing = missingGovernance(g);
		if (missing.length === 0) return [];
		return [
			{
				gateId: 'governance-incomplete',
				stage: 'governance',
				severity: 'warning',
				elementIri: g.namespaceIri,
				message: `The core namespace has no ${missing.join(', ')}. Name them in Governance so changes are accountable.`
			}
		];
	}
};

export const GOVERNANCE_GATES: Gate[] = [governanceIncompleteGate];
