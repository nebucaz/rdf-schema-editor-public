import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { docSections } from './manifest';
import { PRACTITIONER_PARTS, buildPractitionerGuide, slug, PRACTITIONER_GUIDE_PATH } from './practitioner-guide';

/** process-description STORY-347: the standalone file is generated from the in-app sources, so the two cannot drift. */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const readDoc = (file: string) => readFileSync(here(`./${file}`), 'utf8');
const built = buildPractitionerGuide(readDoc);
const REGENERATE = 'The standalone guide is out of date. Run `bun run docs:guide` in app/ and commit docs/ontology-pipeline-practitioner-guide.md.';

describe('practitioner guide: the generated file', () => {
	it('is committed and matches what the in-app sources produce', () => {
		const path = here(`../../../../../${PRACTITIONER_GUIDE_PATH}`);
		expect(existsSync(path), REGENERATE).toBe(true);
		expect(readFileSync(path, 'utf8'), REGENERATE).toBe(built);
	});
});

describe('practitioner guide: parts', () => {
	it('lists the governance sheet, the example and the six guides, in reading order', () => {
		expect(PRACTITIONER_PARTS.map((p) => p.id)).toEqual([
			'pipeline-governance',
			'pipeline-example',
			'guide-vocabulary',
			'guide-metadata',
			'guide-taxonomy',
			'guide-thesaurus',
			'guide-ontology',
			'guide-knowledge-graph'
		]);
	});

	it('points every part at the file the manifest registers for that id', () => {
		for (const part of PRACTITIONER_PARTS) {
			const section = docSections.find((s) => s.id === part.id);
			expect(section, part.id).toBeDefined();
			expect(section!.file).toBe(part.file);
		}
	});

	it('contains every part under its own title', () => {
		for (const part of PRACTITIONER_PARTS) {
			const title = docSections.find((s) => s.id === part.id)!.content.split('\n')[0].replace(/^# /, '');
			expect(built).toContain(`\n## ${title}\n`);
		}
	});
});

describe('practitioner guide: links', () => {
	it('keeps no link to an in-app section id', () => {
		for (const [, target] of built.matchAll(/\]\(([^)]+)\)/g)) {
			expect(target.startsWith('#') || target.startsWith('http'), `link target "${target}"`).toBe(true);
		}
	});

	it('points every in-file link at a heading that exists', () => {
		const anchors = new Set([...built.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
		const links = [...built.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
		expect(links.length).toBeGreaterThan(10);
		for (const link of links) expect(anchors.has(link), `#${link}`).toBe(true);
	});

	it('turns a link to a page that is not in the file into plain text', () => {
		expect(built).not.toMatch(/\[Gate Report\]\(/);
		expect(built).toContain('Gate Report');
	});
});

describe('practitioner guide: printable checklist', () => {
	const checklist = built.slice(built.indexOf('\n## Printable checklist'));

	it('closes the file with the steward checklist and one done-when list per stage', () => {
		expect(built.indexOf('\n## Printable checklist')).toBeGreaterThan(0);
		expect(built.trimEnd().endsWith('- [ ]') || /- \[ \] .+$/.test(built.trimEnd())).toBe(true);
		for (const heading of ['Steward checklist', 'Vocabulary', 'Metadata', 'Taxonomy', 'Thesaurus', 'Ontology', 'Validation and knowledge graph']) {
			expect(checklist, heading).toContain(`### ${heading}\n`);
		}
		expect(checklist.match(/^- \[ \] /gm)!.length).toBeGreaterThan(30);
	});

	it('has no checkbox that is already ticked', () => {
		expect(built).not.toMatch(/- \[x\]/i);
	});
});

describe('practitioner guide: header', () => {
	it('names itself, says it is generated, and cites the book by page only', () => {
		expect(built.startsWith('# Ontology Pipeline: Practitioner Guide\n')).toBe(true);
		expect(built).toMatch(/generated/i);
		expect(built).toContain('bun run docs:guide');
		expect(built).toMatch(/cites? (it|the book) by page/i);
	});

	it('lists every part in a contents list', () => {
		const contents = built.slice(built.indexOf('## Contents'), built.indexOf('\n---', built.indexOf('## Contents')));
		expect((contents.match(/^- \[/gm) ?? []).length).toBe(PRACTITIONER_PARTS.length + 1);
	});
});
