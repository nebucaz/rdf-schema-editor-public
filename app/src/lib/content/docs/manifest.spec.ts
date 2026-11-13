import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import SvelteMarkdown from '@humanspeak/svelte-markdown';
import { docSections } from './manifest';

describe('docSections manifest', () => {
	it('has unique, non-empty ids across every section', () => {
		expect(docSections.length).toBeGreaterThan(0);
		const ids = docSections.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id.length).toBeGreaterThan(0);
	});

	it('resolves non-empty Markdown content for every registered section', () => {
		for (const section of docSections) {
			expect(section.content.trim().length).toBeGreaterThan(0);
			expect(section.title.length).toBeGreaterThan(0);
		}
	});

	it('includes the STORY-134 sample section for EntityNode', () => {
		const entityNode = docSections.find((s) => s.id === 'entity-node');
		expect(entityNode).toBeDefined();
		expect(entityNode?.category).toBe('Canvas Nodes');
		expect(entityNode?.content).toContain('Entity Node');
	});
});

describe('STORY-135: canvas node & edge sections', () => {
	const expectedCanvasNodeIds = ['entity-node', 'external-class-node', 'individual-node', 'note-node'];
	const expectedCanvasEdgeIds = [
		'relation-edge',
		'attributed-link-edge',
		'inheritance-edge',
		'is-master-for-edge',
		'instance-of-edge',
		'note-link-edge'
	];

	it('registers all four Canvas Nodes sections with non-empty content', () => {
		for (const id of expectedCanvasNodeIds) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Canvas Nodes');
			expect(section?.content.trim().length).toBeGreaterThan(0);
		}
	});

	it('registers all six Canvas Edges sections with non-empty content', () => {
		for (const id of expectedCanvasEdgeIds) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Canvas Edges');
			expect(section?.content.trim().length).toBeGreaterThan(0);
		}
	});
});

describe('STORY-136: entry/edit form sections', () => {
	const expectedFormIds = [
		'entity-form',
		'attribute-form',
		'relation-form',
		'individual-relation-form',
		'association-form',
		'external-class-form',
		'member-form',
		'namespace-form',
		'external-vocabulary-form',
		'catalog-metadata-form'
	];

	it('registers all ten Forms sections with non-empty content', () => {
		for (const id of expectedFormIds) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Forms');
			expect(section?.content.trim().length).toBeGreaterThan(0);
		}
	});
});

describe('STORY-137: panels, management views & Identities sections', () => {
	const expectedPanelIds = [
		'triples-panel',
		'namespace-management-view',
		'workspace-management-view',
		'external-vocabulary-management-view',
		'manage-members-modal',
		'query-console-view',
		'missing-concepts-panel',
		'settings-view',
		'provenance-report-view',
		'validation-report-view',
		'identities-area'
	];

	it('registers all eleven Panels & Views sections with non-empty content', () => {
		for (const id of expectedPanelIds) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Panels & Views');
			expect(section?.content.trim().length).toBeGreaterThan(0);
		}
	});
});

describe('STORY-202: Query Workbench section', () => {
	it('registers a non-empty Query Workbench section under Panels & Views', () => {
		const section = docSections.find((s) => s.id === 'query-workbench');
		expect(section).toBeDefined();
		expect(section?.category).toBe('Panels & Views');
		for (const topic of ['Annotations', 'Reports', 'CSV', 'Power BI', 'Result link']) expect(section?.content).toContain(topic);
	});
});

describe('STORY-210: SOC demo section', () => {
	const section = docSections.find((s) => s.id === 'soc-demo');
	const repoFile = (rel: string) => fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url));

	it('registers a non-empty SOC demo section under Panels & Views', () => {
		expect(section).toBeDefined();
		expect(section?.category).toBe('Panels & Views');
		expect(section?.content.trim().length).toBeGreaterThan(0);
	});

	it('states the import order and points at the runbook', () => {
		const text = section?.content ?? '';
		const schema = text.indexOf('soc-schema.ttl');
		const shapes = text.indexOf('soc-shapes.ttl');
		const data = text.indexOf('soc-data.ttl');
		expect(schema).toBeGreaterThan(-1);
		expect(shapes).toBeGreaterThan(schema);
		expect(data).toBeGreaterThan(shapes);
		expect(text).toContain('examples/soc/RUNBOOK.md');
		expect(existsSync(repoFile('examples/soc/RUNBOOK.md'))).toBe(true);
	});

	it('describes SPL input and lists only the remaining limits (STORY-223)', () => {
		const text = section?.content ?? '';
		expect(text).toContain('SPL');
		expect(text).not.toContain('takes free text, not SPL');
		expect(text).not.toMatch(/cannot yet show inverse traversal/);
		expect(text).toMatch(/\(a AND b\) OR c/);
		expect(text).toMatch(/NOT/);
		expect(text).toMatch(/snap/);
		expect(text).toMatch(/backwards hop/);
		const wb = docSections.find((s) => s.id === 'query-workbench')?.content ?? '';
		expect(wb).not.toContain('The SPL view is read-only.\n');
		expect(wb).toContain('SPL** mode');
	});

	it('has an examples README listing the soc sample', () => {
		const readme = repoFile('examples/README.md');
		expect(existsSync(readme)).toBe(true);
		expect(readFileSync(readme, 'utf8')).toContain('soc/');
	});
});

describe('STORY-138: toggles/controls & cross-cutting concept sections', () => {
	const expectedToggleConceptIds = [
		'view-mode-toggle',
		'namespace-filter',
		'visibility-toggles',
		'theme-toggle',
		'node-menu',
		'color-swatch-picker',
		'shacl-validation',
		'namespace-model',
		'backstage-catalog-sync',
		'import-export',
		'layout-color-persistence'
	];

	it('registers all eleven Toggles & Concepts sections with non-empty content', () => {
		for (const id of expectedToggleConceptIds) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Toggles & Concepts');
			expect(section?.content.trim().length).toBeGreaterThan(0);
		}
	});
});

describe('svelte-markdown rendering', () => {
	it('renders every section source to non-empty HTML with no throw', () => {
		for (const section of docSections) {
			const { body } = render(SvelteMarkdown, { props: { source: section.content } });
			expect(body.length).toBeGreaterThan(0);
		}
	});

	it('renders the sample section heading and a body paragraph', () => {
		const entityNode = docSections.find((s) => s.id === 'entity-node')!;
		const { body } = render(SvelteMarkdown, { props: { source: entityNode.content } });
		expect(body).toContain('Entity Node');
		expect(body).toContain('owl:Class');
	});

	it('registers the app header section', () => {
		const header = docSections.find((s) => s.id === 'app-header');
		expect(header).toBeDefined();
		for (const term of ['navigation strip', 'Settings menu', 'user menu', 'Profile']) {
			expect(header?.content).toContain(term);
		}
	});

	it('no section refers to the retired hamburger menu', () => {
		for (const section of docSections) expect(section.content.toLowerCase()).not.toContain('hamburger');
	});
});

describe('loading-spinner STORY-277: bulk add and loading sections', () => {
	it('registers the Add Entities from Namespace and Loading Indicators sections', () => {
		const bulk = docSections.find((s) => s.id === 'add-entities-from-namespace');
		const loading = docSections.find((s) => s.id === 'loading-indicators');
		expect(bulk?.category).toBe('Forms');
		expect(loading?.category).toBe('Toggles & Concepts');
		expect(bulk?.content).toContain('Add entities from namespace');
		expect(loading?.content).toContain('Activity indicator');
	});

	it('only links to sections that exist', () => {
		const ids = new Set(docSections.map((s) => s.id));
		for (const id of ['add-entities-from-namespace', 'loading-indicators']) {
			const content = docSections.find((s) => s.id === id)!.content;
			for (const [, target] of content.matchAll(/\]\(([a-z-]+)\)/g)) expect(ids.has(target), `${id} -> ${target}`).toBe(true);
		}
	});
});

describe('ontology-pipeline STORY-336: pipeline guide sections', () => {
	const guide = ['pipeline-guide', 'terms-and-classes', 'changes-and-releases'];

	it('registers the three guide sections under Ontology Pipeline', () => {
		for (const id of guide) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Ontology Pipeline');
			expect(section?.content.trim().length).toBeGreaterThan(200);
		}
	});

	it('covers stages, gates, the class and concept link, homonyms, deprecation and release', () => {
		const text = guide.map((id) => docSections.find((s) => s.id === id)!.content.toLowerCase()).join('\n');
		for (const topic of ['stage', 'gate', 'definedbyconcept', 'disambiguation', 'deprecat', 'release', 'semantic version']) {
			expect(text, topic).toContain(topic);
		}
	});

	it('presents the method as a recommended order, not a rule', () => {
		expect(docSections.find((s) => s.id === 'pipeline-guide')!.content).toMatch(/recommended order/i);
	});

	it('only links to sections that exist', () => {
		const ids = new Set(docSections.map((s) => s.id));
		for (const id of guide) {
			for (const [, target] of docSections.find((s) => s.id === id)!.content.matchAll(/\]\(([a-z-]+)\)/g)) {
				expect(ids.has(target), `${id} -> ${target}`).toBe(true);
			}
		}
	});

	it('refers to the book by page numbers only, with no long quotation', () => {
		for (const id of guide) {
			const content = docSections.find((s) => s.id === id)!.content;
			expect(content, id).not.toMatch(/^>\s/m);
			expect(content, id).not.toMatch(/"[^"]{200,}"/);
			for (const [, ref] of content.matchAll(/\bpp?\.\s*([^\s)]+)/g)) expect(ref, id).toMatch(/^\d/);
		}
	});
});

describe('process-description STORY-337: Ontology Pipeline category', () => {
	const pipelineIds = [
		'pipeline-quick-start',
		'pipeline-guide',
		'vocabulary',
		'competency-questions',
		'gate-report',
		'pipeline-view',
		'terms-and-classes',
		'changes-and-releases'
	];

	it('holds the eight existing pipeline sections under their unchanged ids', () => {
		for (const id of pipelineIds) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Ontology Pipeline');
		}
	});

	it('keeps the sections in reading order: quick start, then guide, then the reference pages', () => {
		const ordered = docSections.filter((s) => s.category === 'Ontology Pipeline').sort((a, b) => a.order - b.order);
		expect(ordered[0].id).toBe('pipeline-quick-start');
		expect(ordered[1].id).toBe('pipeline-guide');
	});

	it('uses a distinct order for every section of the category', () => {
		const orders = docSections.filter((s) => s.category === 'Ontology Pipeline').map((s) => s.order);
		expect(new Set(orders).size).toBe(orders.length);
	});
});

describe('process-description STORY-337: internal links', () => {
	it('every bare-id link in every section points at a section that exists', () => {
		const ids = new Set(docSections.map((s) => s.id));
		for (const section of docSections) {
			for (const [, target] of section.content.matchAll(/\]\(([a-z0-9-]+)\)/g)) {
				expect(ids.has(target), `${section.id} -> ${target}`).toBe(true);
			}
		}
	});
});

describe('process-description STORY-338: governance sheet', () => {
	const section = docSections.find((s) => s.id === 'pipeline-governance');
	const text = section?.content ?? '';

	it('is registered in the Ontology Pipeline category after the pipeline guide', () => {
		expect(section).toBeDefined();
		expect(section?.category).toBe('Ontology Pipeline');
		const guide = docSections.find((s) => s.id === 'pipeline-guide')!;
		expect(section!.order).toBeGreaterThan(guide.order);
	});

	it('has a per-stage table covering all six stages with book page references', () => {
		for (const stage of ['Vocabulary', 'Metadata', 'Taxonomy', 'Thesaurus', 'Ontology', 'Knowledge graph']) {
			expect(text, stage).toMatch(new RegExp(`\\|\\s*\\*\\*${stage}\\*\\*`));
		}
		expect(text).toMatch(/pp?\.\s?\d+/);
	});

	it('has a roles and cadence table with the four roles and the key actions', () => {
		for (const role of ['Steward', 'Authority', 'Domain expert', 'Modeller']) expect(text, role).toContain(role);
		for (const action of ['Request a change', 'Assess impact', 'Approve', 'Release', 'Review the competency questions']) {
			expect(text, action).toContain(action);
		}
		expect(text).toMatch(/one person may hold both/i);
	});

	it('names the smallest set of governance to start with', () => {
		expect(text).toMatch(/minimum/i);
		for (const item of ['steward', 'authority', 'change log', 'version', 'quarterly']) expect(text.toLowerCase(), item).toContain(item);
	});

	it('separates model changes from data changes', () => {
		expect(text).toMatch(/model change/i);
		expect(text).toMatch(/data change/i);
	});

	it('lists what the app does not do', () => {
		expect(text).toMatch(/does not do/i);
		for (const gap of ['committee', 'decision matrix', 'acceptance evidence', 'approval scope', 'reasoner', 'history of instance data']) {
			expect(text.toLowerCase(), gap).toContain(gap);
		}
	});

	it('ends with a steward checklist as a task list and points to the standalone file for printing', () => {
		expect(text).toMatch(/^- \[ \] /m);
		expect(text).toMatch(/standalone/i);
	});

	it('presents the method as a recommended practice that the app records but does not enforce', () => {
		expect(text).toMatch(/recommended/i);
		expect(text).toMatch(/not enforce|does not enforce|never enforced/i);
	});

	it('links to the reference pages instead of repeating them', () => {
		for (const id of ['changes-and-releases', 'competency-questions', 'gate-report']) expect(text).toContain(`](${id})`);
	});
});

describe('process-description STORY-348: older pipeline pages point at the new guides', () => {
	const GUIDE_IDS = ['guide-vocabulary', 'guide-metadata', 'guide-taxonomy', 'guide-thesaurus', 'guide-ontology', 'guide-knowledge-graph'];
	const quickStart = docSections.find((s) => s.id === 'pipeline-quick-start')!.content;
	const guide = docSections.find((s) => s.id === 'pipeline-guide')!.content;

	it('the quick start links to the governance sheet and every stage guide', () => {
		for (const id of ['pipeline-governance', ...GUIDE_IDS]) expect(quickStart, id).toContain(`](${id})`);
	});

	it('the pipeline guide links to the governance sheet, the example and every stage guide', () => {
		for (const id of ['pipeline-governance', 'pipeline-example', ...GUIDE_IDS]) expect(guide, id).toContain(`](${id})`);
	});

	it('the pipeline guide says how the Pipeline page groups the six stages of the book', () => {
		expect(guide).toMatch(/no metadata (box|stage)/i);
		expect(guide).toMatch(/validation and application/i);
	});

	it('the governance sheet and the pipeline guide each own their rules: roles table once, governance checklist once', () => {
		const governance = docSections.find((s) => s.id === 'pipeline-governance')!.content;
		expect(guide.match(/\| Role \| What they do \|/g)?.length ?? 0).toBe(1);
		expect(governance).toContain('](pipeline-guide)');
		expect(governance.match(/\| Role \| What they do \|/g)?.length ?? 0).toBe(0);
	});
});
