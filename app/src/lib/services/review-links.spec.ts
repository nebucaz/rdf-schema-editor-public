import { describe, expect, it } from 'vitest';
import { reviewConceptUrl, reviewSchemeUrl, reviewPipelineUrl, reviewQuestionsUrl } from './review-links';

describe('review links (STORY-335)', () => {
	it('points at the read-only variants', () => {
		expect(reviewQuestionsUrl()).toBe('/review/questions');
		expect(reviewPipelineUrl()).toBe('/review/pipeline');
	});

	it('carries a concept IRI as an encoded query parameter, never in the path', () => {
		expect(reviewConceptUrl('http://e/core/vocab#Bank')).toBe('/review/concept?iri=http%3A%2F%2Fe%2Fcore%2Fvocab%23Bank');
	});

	it('carries a scheme id as an encoded query parameter', () => {
		expect(reviewSchemeUrl('~aHR0cDovL2U')).toBe('/review/scheme?scheme=~aHR0cDovL2U');
	});
});
