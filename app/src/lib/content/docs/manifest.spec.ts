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

	it('registers the three guide sections under Panels & Views', () => {
		for (const id of guide) {
			const section = docSections.find((s) => s.id === id);
			expect(section, `missing section "${id}"`).toBeDefined();
			expect(section?.category).toBe('Panels & Views');
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
