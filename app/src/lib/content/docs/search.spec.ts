import { describe, expect, it } from 'vitest';
import { searchDocSections } from './search';
import { docSections } from './manifest';
import type { DocSection } from './manifest';

const makeSection = (overrides: Partial<DocSection> = {}): DocSection => ({
	id: 'sample',
	title: 'Sample Section',
	category: 'Canvas Nodes',
	order: 10,
	file: 'sample.md',
	content: 'Some body text about entities and relations.',
	...overrides
});

describe('searchDocSections', () => {
	it('returns every section unchanged for an empty or whitespace-only query', () => {
		const sections = [makeSection()];
		expect(searchDocSections(sections, '')).toEqual(sections);
		expect(searchDocSections(sections, '   ')).toEqual(sections);
	});

	it('matches case-insensitively against the title', () => {
		const sections = [makeSection({ id: 'assoc', title: 'Association Class' })];
		expect(searchDocSections(sections, 'ASSOCIATION')).toHaveLength(1);
	});

	it('matches case-insensitively against the body content', () => {
		const sections = [makeSection({ content: 'Explains the Namespace Filter control.' })];
		expect(searchDocSections(sections, 'namespace filter')).toHaveLength(1);
	});

	it('excludes sections matching neither title nor content', () => {
		const sections = [makeSection({ title: 'Entity Node', content: 'Nothing relevant here.' })];
		expect(searchDocSections(sections, 'backstage')).toHaveLength(0);
	});

	it('returns an empty array when nothing matches, not undefined or a throw', () => {
		expect(searchDocSections([makeSection()], 'zzz-no-match-zzz')).toEqual([]);
	});

	it('finds real registered sections by a term only in their body, not their title', () => {
		// "represents-predicate" appears in backstage-catalog-sync.md's body but not its title.
		const results = searchDocSections(docSections, 'represents-predicate');
		expect(results.some((s) => s.id === 'backstage-catalog-sync')).toBe(true);
	});
});
