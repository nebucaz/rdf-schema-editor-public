import { describe, expect, it } from 'vitest';
import { parseOntologyTab, withOntologyTab } from './ontology-tabs.js';

describe('ontology tabs (STORY-466)', () => {
	it('defaults to overview and accepts only known values', () => {
		expect(parseOntologyTab(new URLSearchParams(''))).toBe('overview');
		expect(parseOntologyTab(new URLSearchParams('tab=checks'))).toBe('checks');
		expect(parseOntologyTab(new URLSearchParams('tab=overview'))).toBe('overview');
		expect(parseOntologyTab(new URLSearchParams('tab=nope'))).toBe('overview');
	});

	it('writes the tab and drops the check filters when going back to overview', () => {
		expect(withOntologyTab(new URLSearchParams('stage=ontology&q=a'), 'checks').toString()).toBe('stage=ontology&q=a&tab=checks');
		expect(withOntologyTab(new URLSearchParams('tab=checks&stage=ontology&q=a&page=2'), 'overview').toString()).toBe('');
	});
});
