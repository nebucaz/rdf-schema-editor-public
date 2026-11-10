import { describe, it, expect } from 'vitest';
import { resolveRouteView } from './route-views';

describe('resolveRouteView', () => {
	it('treats / as the canvas', () => {
		expect(resolveRouteView('/')).toEqual({
			isIdentitiesView: false,
			isValidationView: false,
			isWorkbenchView: false,
			isReportView: false,
			isQuestionsView: false,
			isPipelineView: false,
			isVocabularyView: false,
			isTaxonomyView: false,
			isGovernanceView: false,
			isPipelineArea: false,
			isReviewView: false,
			isCanvasView: true
		});
	});

	it('flags /workbench and nested paths as the workbench, not the canvas', () => {
		for (const p of ['/workbench', '/workbench/anything']) {
			const v = resolveRouteView(p);
			expect(v.isWorkbenchView).toBe(true);
			expect(v.isCanvasView).toBe(false);
			expect(v.isIdentitiesView).toBe(false);
		}
	});

	it('flags /reports/<id> as the report view, not the canvas', () => {
		const v = resolveRouteView('/reports/ProdAppsSavedQuery');
		expect(v.isReportView).toBe(true);
		expect(v.isCanvasView).toBe(false);
		expect(v.isWorkbenchView).toBe(false);
	});

	it('keeps identities and validation off the canvas', () => {
		expect(resolveRouteView('/identities').isCanvasView).toBe(false);
		expect(resolveRouteView('/validation').isCanvasView).toBe(false);
		expect(resolveRouteView('/identities').isIdentitiesView).toBe(true);
		expect(resolveRouteView('/validation').isValidationView).toBe(true);
	});

	it('flags /pipeline as its own view, not the canvas', () => {
		const v = resolveRouteView('/pipeline');
		expect(v.isPipelineView).toBe(true);
		expect(v.isCanvasView).toBe(false);
	});

	it('flags /questions as its own view, not the canvas', () => {
		const v = resolveRouteView('/questions');
		expect(v.isQuestionsView).toBe(true);
		expect(v.isCanvasView).toBe(false);
	});

	it('flags /vocabulary as its own view, not the canvas', () => {
		const v = resolveRouteView('/vocabulary');
		expect(v.isVocabularyView).toBe(true);
		expect(v.isCanvasView).toBe(false);
	});
});

describe('resolveRouteView /taxonomy (STORY-328)', () => {
	it('flags /taxonomy as its own view, not the canvas', () => {
		const v = resolveRouteView('/taxonomy');
		expect(v.isTaxonomyView).toBe(true);
		expect(v.isCanvasView).toBe(false);
		expect(resolveRouteView('/').isTaxonomyView).toBe(false);
	});
});

describe('resolveRouteView /governance (STORY-331)', () => {
	it('flags /governance as its own view, not the canvas', () => {
		const v = resolveRouteView('/governance');
		expect(v.isGovernanceView).toBe(true);
		expect(v.isCanvasView).toBe(false);
	});
});

describe('resolveRouteView /review (STORY-335)', () => {
	it('flags /review pages as the review view, not the canvas', () => {
		for (const p of ['/review', '/review/questions', '/review/concept']) {
			const v = resolveRouteView(p);
			expect(v.isReviewView).toBe(true);
			expect(v.isCanvasView).toBe(false);
		}
		expect(resolveRouteView('/reviewer-notes').isCanvasView).toBe(false);
	});

	it('groups the pipeline pages into one area', () => {
		for (const p of ['/pipeline', '/questions', '/vocabulary', '/taxonomy', '/governance']) {
			expect(resolveRouteView(p).isPipelineArea).toBe(true);
		}
		for (const p of ['/', '/identities', '/workbench', '/review/pipeline']) {
			expect(resolveRouteView(p).isPipelineArea).toBe(false);
		}
	});
});
