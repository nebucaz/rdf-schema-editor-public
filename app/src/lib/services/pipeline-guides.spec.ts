import { describe, expect, it } from 'vitest';
import { docSections } from '#lib/content/docs/manifest.js';
import { STAGE_IDS } from './pipeline-summary.js';
import { STAGE_GUIDES } from './pipeline-guides.js';

describe('STAGE_GUIDES (process-description STORY-346)', () => {
	it('gives every pipeline stage at least one guide', () => {
		for (const stage of STAGE_IDS) expect(STAGE_GUIDES[stage].length, stage).toBeGreaterThan(0);
	});

	it('points every guide at a section that exists in the manifest', () => {
		for (const stage of STAGE_IDS) {
			for (const guide of STAGE_GUIDES[stage]) {
				expect(docSections.some((s) => s.id === guide.sectionId), `${stage} -> ${guide.sectionId}`).toBe(true);
			}
		}
	});

	it('maps the stages as decided: metadata hangs off the vocabulary box, validation and application share the last guide', () => {
		expect(STAGE_GUIDES.vocabulary.map((g) => g.sectionId)).toEqual(['guide-vocabulary', 'guide-metadata']);
		expect(STAGE_GUIDES.taxonomy.map((g) => g.sectionId)).toEqual(['guide-taxonomy']);
		expect(STAGE_GUIDES.thesaurus.map((g) => g.sectionId)).toEqual(['guide-thesaurus']);
		expect(STAGE_GUIDES.ontology.map((g) => g.sectionId)).toEqual(['guide-ontology']);
		expect(STAGE_GUIDES.validation.map((g) => g.sectionId)).toEqual(['guide-knowledge-graph']);
		expect(STAGE_GUIDES.application.map((g) => g.sectionId)).toEqual(['guide-knowledge-graph']);
	});

	it('labels the first link of every stage "Open in guide" and the metadata link as the metadata guide', () => {
		for (const stage of STAGE_IDS) expect(STAGE_GUIDES[stage][0].label).toBe('Open in guide');
		expect(STAGE_GUIDES.vocabulary[1].label).toBe('Metadata guide');
	});
});
