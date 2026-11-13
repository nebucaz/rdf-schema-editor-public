/** Which in-app guide each stage box of the Pipeline page opens (process-description STORY-346). The Pipeline page has
 *  no metadata box, so the metadata guide hangs off the vocabulary box; validation and application share the
 *  knowledge-graph guide. A spec fails when a section id is missing from the documentation manifest. */
import type { StageId } from './pipeline-summary.js';

export interface StageGuide {
	/** Id of the documentation section (`content/docs/manifest.ts`). */
	sectionId: string;
	/** Visible text of the link. */
	label: string;
}

const OPEN = 'Open in guide';

export const STAGE_GUIDES: Record<StageId, StageGuide[]> = {
	vocabulary: [
		{ sectionId: 'guide-vocabulary', label: OPEN },
		{ sectionId: 'guide-metadata', label: 'Metadata guide' }
	],
	taxonomy: [{ sectionId: 'guide-taxonomy', label: OPEN }],
	thesaurus: [{ sectionId: 'guide-thesaurus', label: OPEN }],
	ontology: [{ sectionId: 'guide-ontology', label: OPEN }],
	validation: [{ sectionId: 'guide-knowledge-graph', label: OPEN }],
	application: [{ sectionId: 'guide-knowledge-graph', label: OPEN }]
};
