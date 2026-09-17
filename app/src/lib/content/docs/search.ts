/**
 * Pure, case-insensitive substring search over registered documentation sections (STORY-141) —
 * matches a query against `title` or `content`. Kept as a standalone function (not inlined in
 * `DocumentationPanel.svelte`) so it's unit-testable without a component-testing project, mirroring
 * `canvas-model.ts`'s "pure function, tested directly" pattern.
 */

import type { DocSection } from './manifest';

export function searchDocSections(sections: DocSection[], query: string): DocSection[] {
	const q = query.trim().toLowerCase();
	if (!q) return sections;
	return sections.filter(
		(section) => section.title.toLowerCase().includes(q) || section.content.toLowerCase().includes(q)
	);
}
