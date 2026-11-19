import { describe, expect, it } from 'vitest';
import { docSections } from './manifest';

/** concept-valued-properties STORY-431: one rule, stated the same way in the pipeline guide and in the terms section. */
const RULE = 'Classes provide inheritance; concepts identify state.';

describe('class-vs-concept rule in the docs', () => {
	for (const id of ['pipeline-guide', 'terms-and-classes']) {
		describe(id, () => {
			const content = docSections.find((s) => s.id === id)?.content ?? '';

			it('states the rule sentence', () => {
				expect(content).toContain(RULE);
			});

			it('gives the lifecycleStage / Lifecycle example', () => {
				expect(content).toContain('lifecycleStage');
				expect(content).toContain('Lifecycle');
			});

			it('says mirroring a concept hierarchy as classes is optional', () => {
				expect(content).toMatch(/mirror[^.]*optional|optional[^.]*mirror/i);
			});

			it('warns against a relation to skos:Concept and names the concept property', () => {
				expect(content).toContain('skos:Concept');
				expect(content).toContain('Add concept property');
			});

			it('does not call concepts individuals', () => {
				expect(content).not.toMatch(/concepts? (is|are) (an? )?individuals?/i);
			});
		});
	}
});
