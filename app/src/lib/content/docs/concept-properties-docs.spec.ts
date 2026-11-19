import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { docSections } from './manifest';

/** concept-valued-properties STORY-441: the "Concept properties" section exists, names real screens and is linked. */
const content = (id: string) => docSections.find((s) => s.id === id)?.content ?? '';
const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

describe('Concept properties docs', () => {
	const guide = content('pipeline-guide');

	it('has a section covering placement, the limit, deprecation and the skos:Concept hazard', () => {
		expect(guide).toContain('## Concept properties');
		expect(guide).toContain('+ Add concept property');
		expect(guide).toContain('1000');
		expect(guide).toMatch(/deprecated|retired/i);
		expect(guide).toContain('skos:Concept');
	});

	it('names fields and buttons that exist in the components', () => {
		const form = source('lib/components/ConceptPropertyForm.svelte');
		for (const text of ['Name', 'Scheme', 'Required', 'Repeatable']) expect(form).toContain(text);
		expect(source('lib/components/EntityNode.svelte')).toContain('+ Add concept property');
		expect(source('lib/content/docs/gate-report.md')).toContain('Relation to skos:Concept');
	});

	it.each(['guide-vocabulary', 'guide-ontology', 'terms-and-classes'])('%s points to the section', (id) => {
		const c = content(id);
		expect(c).toContain('(pipeline-guide)');
		expect(c).toMatch(/concept propert/i);
	});
});
