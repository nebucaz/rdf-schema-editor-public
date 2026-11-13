import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { docSections } from './manifest';

/** process-description STORY-340 to STORY-345: every stage guide follows the template of STORY-337, sits in
 *  reading order, and names screens and fields that really exist in the component source. */
const HEADINGS = [
	'What this stage is for',
	'Before you start',
	'Steps',
	'Done when',
	'Watch out for',
	'What the app does not do',
	'Governance for this stage',
	'Next stage'
];

interface UiName {
	/** Text the guide uses for a button, field or heading. */
	text: string;
	/** Source file (relative to `app/src`) that must contain the same text. */
	file: string;
	/** What to look for in the source when the label is built at run time (for example `Mark {status}`). */
	inSource?: string;
}

interface Guide {
	id: string;
	order: number;
	title: string;
	ui: UiName[];
	links: string[];
}

const GUIDES: Guide[] = [
	{
		id: 'guide-vocabulary',
		order: 50,
		title: 'Stage Guide: Vocabulary',
		ui: [
			{ text: 'Use as vocabulary namespace', file: 'lib/components/VocabularyNamespacePicker.svelte' },
			{ text: 'Add scheme', file: 'routes/vocabulary/+page.svelte' },
			{ text: 'Add concept', file: 'routes/vocabulary/+page.svelte' },
			{ text: 'Preferred label', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Add as alternative label', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Alternative labels', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Hidden labels', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Definition', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Disambiguation', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Scope note', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Source', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Authority', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Purpose', file: 'lib/components/SchemeScopeForm.svelte' },
			{ text: 'Decisions supported', file: 'lib/components/SchemeScopeForm.svelte' },
			{ text: 'Out of scope', file: 'lib/components/SchemeScopeForm.svelte' },
			{ text: 'Stakeholders', file: 'lib/components/SchemeScopeForm.svelte' },
			{ text: 'Mark approved', file: 'routes/vocabulary/+page.svelte', inSource: 'Mark {nextStatuses' },
			{ text: 'Deprecate', file: 'routes/vocabulary/+page.svelte' }
		],
		links: ['vocabulary', 'gate-report', 'terms-and-classes', 'pipeline-governance', 'pipeline-example']
	},
	{
		id: 'guide-metadata',
		order: 60,
		title: 'Stage Guide: Metadata',
		ui: [
			{ text: 'Steward', file: 'lib/components/GovernanceSettingsForm.svelte' },
			{ text: 'Authority', file: 'lib/components/GovernanceSettingsForm.svelte' },
			{ text: 'Maturity', file: 'lib/components/GovernanceSettingsForm.svelte' },
			{ text: 'Version', file: 'lib/components/GovernanceSettingsForm.svelte' },
			{ text: 'Source', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Authority', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Add attribute', file: 'lib/components/EntityNode.svelte' },
			{ text: 'Required', file: 'lib/components/AttributeForm.svelte' },
			{ text: 'Repeatable', file: 'lib/components/AttributeForm.svelte' },
			{ text: 'Datatype', file: 'lib/components/AttributeForm.svelte' },
			{ text: 'Publisher override', file: 'lib/components/CatalogMetadataForm.svelte' }
		],
		links: ['pipeline-governance', 'pipeline-example', 'vocabulary', 'attribute-form', 'catalog-metadata-form', 'changes-and-releases']
	},
	{
		id: 'guide-taxonomy',
		order: 70,
		title: 'Stage Guide: Taxonomy',
		ui: [
			{ text: 'Concepts (skos:broader)', file: 'lib/components/TaxonomyOutline.svelte' },
			{ text: 'Classes (rdfs:subClassOf)', file: 'lib/components/TaxonomyOutline.svelte' },
			{ text: 'Drop here to remove the broader concept', file: 'lib/components/TaxonomyOutline.svelte' },
			{ text: 'Top concept', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Defined by concept', file: 'lib/components/ConceptPicker.svelte' },
			{ text: 'Promote to class', file: 'routes/vocabulary/+page.svelte' },
			{ text: 'Gate report', file: 'routes/validation/+page.svelte' },
			{ text: 'Deprecate', file: 'routes/vocabulary/+page.svelte' }
		],
		links: ['terms-and-classes', 'gate-report', 'vocabulary', 'pipeline-governance', 'pipeline-example']
	},
	{
		id: 'guide-thesaurus',
		order: 80,
		title: 'Stage Guide: Thesaurus',
		ui: [
			{ text: 'Related and mapped', file: 'lib/components/ConceptRelations.svelte' },
			{ text: 'Add relation', file: 'lib/components/ConceptRelations.svelte' },
			{ text: 'skos:related', file: 'lib/components/ConceptRelations.svelte' },
			{ text: '(enter a full IRI)', file: 'lib/components/ConceptRelations.svelte' },
			{ text: 'External Vocabularies', file: 'routes/+layout.svelte' },
			{ text: 'Gate report', file: 'routes/validation/+page.svelte' },
			{ text: 'Alternative labels', file: 'lib/components/ConceptForm.svelte' },
			{ text: 'Hidden labels', file: 'lib/components/ConceptForm.svelte' }
		],
		links: ['terms-and-classes', 'gate-report', 'external-vocabulary-management-view', 'pipeline-governance', 'pipeline-example']
	},
	{
		id: 'guide-ontology',
		order: 90,
		title: 'Stage Guide: Ontology',
		ui: [
			{ text: 'Add question', file: 'routes/questions/+page.svelte' },
			{ text: 'Linked classes and properties', file: 'lib/components/CompetencyQuestionForm.svelte' },
			{ text: 'Owner', file: 'lib/components/CompetencyQuestionForm.svelte' },
			{ text: 'Last reviewed', file: 'lib/components/CompetencyQuestionForm.svelte' },
			{ text: 'Run all', file: 'lib/components/CompetencyQuestionReport.svelte' },
			{ text: 'Regression', file: 'lib/components/CompetencyQuestionReport.svelte' },
			{ text: '+ Add Entity', file: 'routes/+page.svelte' },
			{ text: 'Add attribute', file: 'lib/components/EntityNode.svelte' },
			{ text: 'Defined by concept', file: 'lib/components/ConceptPicker.svelte' },
			{ text: 'Promote to class', file: 'routes/vocabulary/+page.svelte' },
			{ text: 'New request', file: 'routes/governance/+page.svelte' },
			{ text: 'Start review', file: 'lib/components/ChangeRequestList.svelte' },
			{ text: 'Assess impact', file: 'lib/components/ChangeRequestList.svelte' },
			{ text: 'Approve', file: 'lib/components/ChangeRequestList.svelte' },
			{ text: 'Release', file: 'routes/governance/+page.svelte' },
			{ text: 'Steward', file: 'lib/components/GovernanceSettingsForm.svelte' }
		],
		links: ['competency-questions', 'changes-and-releases', 'gate-report', 'relation-form', 'attribute-form', 'entity-form', 'terms-and-classes', 'pipeline-governance', 'pipeline-example']
	},
	{
		id: 'guide-knowledge-graph',
		order: 100,
		title: 'Stage Guide: Validation and Knowledge Graph',
		ui: [
			{ text: 'Run Validation', file: 'lib/components/ValidationReportView.svelte' },
			{ text: 'Gate report', file: 'routes/validation/+page.svelte' },
			{ text: 'Semantic debt', file: 'routes/pipeline/+page.svelte' },
			{ text: 'Run all', file: 'lib/components/CompetencyQuestionReport.svelte' },
			{ text: 'Unclassified (no class)', file: 'lib/components/IdentitySearchBar.svelte' },
			{ text: '+ Add', file: 'lib/components/ManageMembersModal.svelte' },
			{ text: 'Maturity', file: 'lib/components/GovernanceSettingsForm.svelte' },
			{ text: 'Last reviewed', file: 'lib/components/CompetencyQuestionForm.svelte' }
		],
		links: ['shacl-validation', 'validation-report-view', 'gate-report', 'pipeline-view', 'identities-area', 'backstage-catalog-sync', 'changes-and-releases', 'pipeline-governance', 'pipeline-example']
	}
];

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');

/** The text of the `## heading` blocks of a section, in order. */
function blocks(content: string): { heading: string; body: string }[] {
	const parts = content.split(/^## /m).slice(1);
	return parts.map((p) => {
		const nl = p.indexOf('\n');
		return { heading: p.slice(0, nl).trim(), body: p.slice(nl + 1) };
	});
}

describe.each(GUIDES)('stage guide $id', (guide) => {
	const section = docSections.find((s) => s.id === guide.id);
	const content = section?.content ?? '';

	it('is registered in the Ontology Pipeline category, in reading order after the worked example', () => {
		expect(section).toBeDefined();
		expect(section?.category).toBe('Ontology Pipeline');
		expect(section?.order).toBe(guide.order);
		expect(section?.title).toBe(guide.title);
		expect(section!.order).toBeGreaterThan(docSections.find((s) => s.id === 'pipeline-example')!.order);
	});

	it('has the eight template headings in order', () => {
		expect(blocks(content).map((b) => b.heading)).toEqual(HEADINGS);
	});

	it('has numbered steps, a tick list for done-when, and three or four pitfalls', () => {
		const get = (h: string) => blocks(content).find((b) => b.heading === h)!.body;
		expect(get('Steps').match(/^\d+\. /gm)?.length).toBeGreaterThanOrEqual(8);
		expect(get('Done when')).toMatch(/^- \[ \] /m);
		const pitfalls = get('Watch out for').match(/^- /gm)?.length ?? 0;
		expect(pitfalls).toBeGreaterThanOrEqual(3);
		expect(pitfalls).toBeLessThanOrEqual(4);
		expect(get('What the app does not do').match(/^- /gm)?.length ?? 0).toBeGreaterThanOrEqual(1);
	});

	it('names screens and fields that exist in the component source', () => {
		for (const { text, file, inSource } of guide.ui) {
			expect(content, `guide mentions "${text}"`).toContain(text);
			expect(src(file), `${file} contains "${inSource ?? text}"`).toContain(inSource ?? text);
		}
	});

	it('links to the reference pages and the worked example', () => {
		for (const id of guide.links) expect(content).toContain(`](${id})`);
	});

	it('presents the method as a recommended order and uses the worked example', () => {
		expect(content).toMatch(/recommended|you can|nothing (here )?blocks/i);
		expect(content).toMatch(/IT landscape/i);
	});
});

describe('stage guides in sequence', () => {
	it('each guide ends by linking to the next one, and the last one is not a dead end', () => {
		const ids = GUIDES.map((g) => g.id);
		ids.slice(0, -1).forEach((id, i) => {
			const next = blocks(docSections.find((s) => s.id === id)!.content).find((b) => b.heading === 'Next stage')!.body;
			expect(next, `${id} -> ${ids[i + 1]}`).toContain(`](${ids[i + 1]})`);
		});
		const last = blocks(docSections.find((s) => s.id === ids.at(-1))!.content).find((b) => b.heading === 'Next stage')!.body;
		expect(last.trim().length).toBeGreaterThan(0);
	});

	it('are listed in the order of the book: vocabulary, metadata, taxonomy, thesaurus, ontology, knowledge graph', () => {
		expect(GUIDES.map((g) => g.id)).toEqual([
			'guide-vocabulary',
			'guide-metadata',
			'guide-taxonomy',
			'guide-thesaurus',
			'guide-ontology',
			'guide-knowledge-graph'
		]);
		expect(GUIDES.map((g) => g.order)).toEqual([50, 60, 70, 80, 90, 100]);
	});
});
