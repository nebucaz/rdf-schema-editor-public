/**
 * The standalone practitioner guide (process-description STORY-347): the governance sheet, the worked example and the
 * six stage guides joined into one Markdown file, ending with a printable checklist. It is built from the in-app
 * sources, never edited by hand: `practitioner-guide.spec.ts` fails when the committed file differs, and
 * `bun run docs:guide` (in `app/`) writes it. Pure and file-system free; the caller supplies the reader.
 */

export interface PractitionerPart {
	/** Documentation section id (`manifest.ts`). */
	id: string;
	/** Markdown file of that section, relative to this directory. */
	file: string;
}

/** Reading order of the file. A spec checks every entry against the manifest. */
export const PRACTITIONER_PARTS: PractitionerPart[] = [
	{ id: 'pipeline-governance', file: 'pipeline-governance.md' },
	{ id: 'pipeline-example', file: 'pipeline-example.md' },
	{ id: 'guide-vocabulary', file: 'guide-vocabulary.md' },
	{ id: 'guide-metadata', file: 'guide-metadata.md' },
	{ id: 'guide-taxonomy', file: 'guide-taxonomy.md' },
	{ id: 'guide-thesaurus', file: 'guide-thesaurus.md' },
	{ id: 'guide-ontology', file: 'guide-ontology.md' },
	{ id: 'guide-knowledge-graph', file: 'guide-knowledge-graph.md' }
];

/** Repo-relative path of the generated file. */
export const PRACTITIONER_GUIDE_PATH = 'docs/ontology-pipeline-practitioner-guide.md';

/** Heading text for each guide's done-when list in the printable checklist. */
const CHECKLIST_HEADINGS: Record<string, string> = {
	'guide-vocabulary': 'Vocabulary',
	'guide-metadata': 'Metadata',
	'guide-taxonomy': 'Taxonomy',
	'guide-thesaurus': 'Thesaurus',
	'guide-ontology': 'Ontology',
	'guide-knowledge-graph': 'Validation and knowledge graph'
};

/** The anchor a Markdown renderer gives a heading: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.replace(/\s/g, '-');
}

const titleOf = (content: string) => content.split('\n')[0].replace(/^# /, '').trim();

/** The lines of the `## heading` block, up to the next `## ` heading. */
function block(content: string, heading: string): string[] {
	const lines = content.split('\n');
	const start = lines.findIndex((l) => l === `## ${heading}`);
	if (start < 0) return [];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => l.startsWith('## '));
	return end < 0 ? rest : rest.slice(0, end);
}

/** One level down, so every part's title becomes a `##` heading under the file's own title. */
const demote = (content: string) => content.replace(/^(#{1,5}) /gm, '#$1 ');

export function buildPractitionerGuide(read: (file: string) => string): string {
	const parts = PRACTITIONER_PARTS.map((p) => {
		const content = read(p.file);
		return { ...p, content, title: titleOf(content) };
	});
	const included = new Map(parts.map((p) => [p.id, p.title]));

	/** A link to an included part becomes an in-file anchor; any other in-app link becomes its plain text. */
	const relink = (text: string) =>
		text.replace(/\[([^\]]+)\]\(([a-z0-9-]+)\)/g, (_m, label: string, id: string) =>
			included.has(id) ? `[${label}](#${slug(included.get(id)!)})` : label
		);

	const out: string[] = [];
	out.push('# Ontology Pipeline: Practitioner Guide', '');
	out.push(
		'<!-- Generated from the in-app documentation by `bun run docs:guide` (run in `app/`). Do not edit by hand: change the in-app section and regenerate. -->',
		''
	);
	out.push(
		'A governance sheet and a step-by-step guide for each stage of the ontology pipeline, for the people who run the RDF Schema Editor. It summarises the book *The Ontology Pipeline* in our own words and cites it by page; the book itself is not included. The same text is available in the app under Documentation, in the Ontology Pipeline category. The method is a recommended order, not a rule.',
		''
	);
	out.push('## Contents', '');
	for (const p of parts) out.push(`- [${p.title}](#${slug(p.title)})`);
	out.push('- [Printable checklist](#printable-checklist)', '', '---', '');

	for (const p of parts) out.push(relink(demote(p.content)).trimEnd(), '', '---', '');

	out.push('<div style="page-break-before: always"></div>', '');
	out.push('## Printable checklist', '');
	out.push('Tick the boxes on paper. Each list is copied from the section it belongs to.', '');
	const governance = parts.find((p) => p.id === 'pipeline-governance')!;
	const steward = block(governance.content, 'Steward checklist').filter((l) => !l.startsWith('Print this') && !l.startsWith('See '));
	out.push('### Steward checklist', '', ...trimBlank(steward), '');
	for (const p of parts) {
		const heading = CHECKLIST_HEADINGS[p.id];
		if (!heading) continue;
		out.push(`### ${heading}`, '', ...trimBlank(block(p.content, 'Done when')), '');
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function trimBlank(lines: string[]): string[] {
	let a = 0;
	let b = lines.length;
	while (a < b && !lines[a].trim()) a++;
	while (b > a && !lines[b - 1].trim()) b--;
	return lines.slice(a, b);
}
