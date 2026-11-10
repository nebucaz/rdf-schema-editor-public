/**
 * Quality gates (ontology-pipeline STORY-319). A gate is a pure function over the loaded schema that
 * returns findings. Gates only report: they never block a save or disable anything.
 */
import type { CompetencyQuestion } from '../competency-question';
import type { Governance } from '../governance';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';

export const PIPELINE_STAGES = [
	'vocabulary',
	'metadata',
	'taxonomy',
	'thesaurus',
	'ontology',
	'knowledgeGraph',
	'governance'
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type GateSeverity = 'warning' | 'info';

/** A change the report can offer for a finding; applying it is the caller's decision. */
export interface GateFix {
	kind: 'retarget-concept';
	classIri: string;
	namespaceBaseIri: string;
	/** The concept the class should point to instead. */
	conceptIri: string;
	conceptLabel: string;
}

export interface GateFinding {
	gateId: string;
	stage: PipelineStage;
	severity: GateSeverity;
	/** The class, property, shape or individual the finding is about; the report links to it. */
	elementIri: string;
	message: string;
	fix?: GateFix;
}

export interface GateOptions {
	/** Only run gates of these stages. Names that are no stage are ignored. */
	stages?: string[];
	/** The core vocabulary's concepts, for the vocabulary gates; without them those gates report nothing. */
	concepts?: Concept[];
	/** The core namespace's governance settings; without them the governance gate reports nothing. */
	governance?: (Governance & { namespaceIri: string }) | null;
	/** The competency questions, for the question review gate; without them it reports nothing. */
	questions?: CompetencyQuestion[];
	/** Months between question reviews; defaults to a quarter. */
	reviewPeriodMonths?: number;
	/** The date to measure review ages from; defaults to now. */
	now?: Date;
}

export interface Gate {
	id: string;
	stage: PipelineStage;
	run(schema: FetchedSchema, options: GateOptions): GateFinding[];
}
