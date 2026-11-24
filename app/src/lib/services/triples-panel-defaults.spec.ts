import { describe, it, expect } from 'vitest';
import { triplesDefaultsForPath } from './triples-panel-defaults';

const VOCAB = 'http://example.org/core';

describe('triplesDefaultsForPath (triples-tabs STORY-604)', () => {
	it.each([
		['/', 'schema'],
		['/identities', 'instances'],
		['/validation', 'shapes'],
		['/issues', 'shapes'],
		['/pipeline', 'schema'],
		['/workbench', 'instances'],
		['/reports/abc', 'instances'],
		['/questions', 'instances'],
		['/vocabulary', 'vocab'],
		['/taxonomy', 'vocab'],
		['/governance', 'schema']
	])('%s opens on %s when a vocabulary namespace exists', (path, tab) => {
		const d = triplesDefaultsForPath(path, VOCAB);
		expect(d.initialTab).toBe(tab);
		expect(d.scope).toEqual({ kind: 'all' });
	});

	it('Vocabulary and Taxonomy select the vocabulary namespace', () => {
		expect(triplesDefaultsForPath('/vocabulary', VOCAB).namespaceBaseIri).toBe(VOCAB);
		expect(triplesDefaultsForPath('/taxonomy', VOCAB).namespaceBaseIri).toBe(VOCAB);
	});

	it('falls back to Schema without a vocabulary namespace', () => {
		expect(triplesDefaultsForPath('/vocabulary', null).initialTab).toBe('schema');
		expect(triplesDefaultsForPath('/taxonomy', null).initialTab).toBe('schema');
		expect(triplesDefaultsForPath('/vocabulary', null).namespaceBaseIri).toBeUndefined();
	});

	it('opens Identities on Instances without a vocabulary namespace', () => {
		expect(triplesDefaultsForPath('/identities', null).initialTab).toBe('instances');
	});
});
