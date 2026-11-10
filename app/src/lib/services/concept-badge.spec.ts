import { describe, expect, it } from 'vitest';
import { showNoConceptBadge } from './concept-badge';

describe('showNoConceptBadge (STORY-325)', () => {
	const base = { enabled: true, vocabularyExists: true, definedByConcept: '' };

	it('shows for a class without a concept when the badge is on and a vocabulary exists', () => {
		expect(showNoConceptBadge(base)).toBe(true);
		expect(showNoConceptBadge({ ...base, definedByConcept: undefined })).toBe(true);
	});

	it('does not show for a linked class', () => {
		expect(showNoConceptBadge({ ...base, definedByConcept: 'http://e/core/vocab#Customer' })).toBe(false);
	});

	it('is off when the user turned it off', () => {
		expect(showNoConceptBadge({ ...base, enabled: false })).toBe(false);
	});

	it('is off when no namespace is marked as the vocabulary namespace', () => {
		expect(showNoConceptBadge({ ...base, vocabularyExists: false })).toBe(false);
	});
});
