/**
 * Registry of every in-app documentation section, rendered by `DocumentationPanel` (STORY-139).
 * Content is authored as Markdown files in this same directory and pulled in via Vite's `?raw`
 * import (through `import.meta.glob`) — adding a section is: write the `.md` file, add one entry
 * to `sectionMetas` below pointing at its filename.
 */

export type DocCategory = 'Canvas Nodes' | 'Canvas Edges' | 'Forms' | 'Panels & Views' | 'Toggles & Concepts';

export interface DocSectionMeta {
	/** Stable slug — used as the TOC/search anchor and cross-section link target. Never reused. */
	id: string;
	title: string;
	category: DocCategory;
	/** Sort position within `category`, ascending. Gaps are fine — left room to insert between entries. */
	order: number;
	/** Filename of this section's Markdown source, relative to this directory. */
	file: string;
}

export interface DocSection extends DocSectionMeta {
	/** Raw Markdown source, resolved from `file` at build time. */
	content: string;
}

// `eager: true` bundles every section's content directly (no code-splitting) — the whole
// documentation set is small text and is only ever needed once the Documentation panel opens.
const rawContent = import.meta.glob('./*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

const sectionMetas: DocSectionMeta[] = [
	// Canvas Nodes
	{ id: 'entity-node', title: 'Entity Node', category: 'Canvas Nodes', order: 10, file: 'entity-node.md' },
	{
		id: 'external-class-node',
		title: 'External Class Node',
		category: 'Canvas Nodes',
		order: 20,
		file: 'external-class-node.md'
	},
	{ id: 'individual-node', title: 'Individual Node', category: 'Canvas Nodes', order: 30, file: 'individual-node.md' },
	{ id: 'note-node', title: 'Note Node', category: 'Canvas Nodes', order: 40, file: 'note-node.md' },

	// Canvas Edges
	{ id: 'relation-edge', title: 'Relation Edge', category: 'Canvas Edges', order: 10, file: 'relation-edge.md' },
	{
		id: 'attributed-link-edge',
		title: 'Attributed Link Edge',
		category: 'Canvas Edges',
		order: 20,
		file: 'attributed-link-edge.md'
	},
	{
		id: 'inheritance-edge',
		title: 'Inheritance Edge',
		category: 'Canvas Edges',
		order: 30,
		file: 'inheritance-edge.md'
	},
	{
		id: 'is-master-for-edge',
		title: 'Is-Master-For Edge',
		category: 'Canvas Edges',
		order: 40,
		file: 'is-master-for-edge.md'
	},
	{
		id: 'instance-of-edge',
		title: 'Instance-Of Edge',
		category: 'Canvas Edges',
		order: 50,
		file: 'instance-of-edge.md'
	},
	{ id: 'note-link-edge', title: 'Note Link Edge', category: 'Canvas Edges', order: 60, file: 'note-link-edge.md' },

	// Forms
	{ id: 'entity-form', title: 'Entity Form', category: 'Forms', order: 10, file: 'entity-form.md' },
	{ id: 'attribute-form', title: 'Attribute Form', category: 'Forms', order: 20, file: 'attribute-form.md' },
	{ id: 'relation-form', title: 'Relation Form', category: 'Forms', order: 30, file: 'relation-form.md' },
	{
		id: 'individual-relation-form',
		title: 'Individual Relation Form',
		category: 'Forms',
		order: 40,
		file: 'individual-relation-form.md'
	},
	{
		id: 'association-form',
		title: 'Association Form / Association Edit Form',
		category: 'Forms',
		order: 50,
		file: 'association-form.md'
	},
	{
		id: 'external-class-form',
		title: 'External Class Form',
		category: 'Forms',
		order: 60,
		file: 'external-class-form.md'
	},
	{ id: 'member-form', title: 'Member Form', category: 'Forms', order: 70, file: 'member-form.md' },
	{ id: 'namespace-form', title: 'Namespace Form', category: 'Forms', order: 80, file: 'namespace-form.md' },
	{
		id: 'external-vocabulary-form',
		title: 'External Vocabulary Form',
		category: 'Forms',
		order: 90,
		file: 'external-vocabulary-form.md'
	},
	{
		id: 'catalog-metadata-form',
		title: 'Catalog Metadata Form',
		category: 'Forms',
		order: 100,
		file: 'catalog-metadata-form.md'
	},

	// Panels & Views
	{ id: 'triples-panel', title: 'Triples Panel', category: 'Panels & Views', order: 10, file: 'triples-panel.md' },
	{
		id: 'namespace-management-view',
		title: 'Namespace Management View',
		category: 'Panels & Views',
		order: 20,
		file: 'namespace-management-view.md'
	},
	{
		id: 'workspace-management-view',
		title: 'Workspace Management View',
		category: 'Panels & Views',
		order: 30,
		file: 'workspace-management-view.md'
	},
	{
		id: 'external-vocabulary-management-view',
		title: 'External Vocabulary Management View',
		category: 'Panels & Views',
		order: 40,
		file: 'external-vocabulary-management-view.md'
	},
	{
		id: 'manage-members-modal',
		title: 'Manage Members Modal',
		category: 'Panels & Views',
		order: 50,
		file: 'manage-members-modal.md'
	},
	{
		id: 'query-console-view',
		title: 'Query Console View',
		category: 'Panels & Views',
		order: 60,
		file: 'query-console-view.md'
	},
	{
		id: 'missing-concepts-panel',
		title: 'Missing Concepts Panel',
		category: 'Panels & Views',
		order: 70,
		file: 'missing-concepts-panel.md'
	},
	{ id: 'settings-view', title: 'Settings View', category: 'Panels & Views', order: 80, file: 'settings-view.md' },
	{
		id: 'provenance-report-view',
		title: 'Provenance Report View',
		category: 'Panels & Views',
		order: 90,
		file: 'provenance-report-view.md'
	},
	{
		id: 'validation-report-view',
		title: 'Validation Report View',
		category: 'Panels & Views',
		order: 100,
		file: 'validation-report-view.md'
	},
	{
		id: 'identities-area',
		title: 'The /identities Area',
		category: 'Panels & Views',
		order: 110,
		file: 'identities-area.md'
	},

	// (Panels & Views continues)
	{
		id: 'query-workbench',
		title: 'Query Workbench',
		category: 'Panels & Views',
		order: 120,
		file: 'query-workbench.md'
	},
	{
		id: 'spl-unsupported',
		title: 'SPL in the Workbench',
		category: 'Panels & Views',
		order: 125,
		file: 'spl-unsupported.md'
	},
	{
		id: 'soc-demo',
		title: 'SOC Demo',
		category: 'Panels & Views',
		order: 130,
		file: 'soc-demo.md'
	},

	// Toggles & Concepts
	{
		id: 'view-mode-toggle',
		title: 'View Mode Toggle',
		category: 'Toggles & Concepts',
		order: 10,
		file: 'view-mode-toggle.md'
	},
	{
		id: 'namespace-filter',
		title: 'Namespace Filter',
		category: 'Toggles & Concepts',
		order: 20,
		file: 'namespace-filter.md'
	},
	{
		id: 'visibility-toggles',
		title: 'Description / Inherited Attributes / Reverse Relations Toggles',
		category: 'Toggles & Concepts',
		order: 30,
		file: 'visibility-toggles.md'
	},
	{
		id: 'theme-toggle',
		title: 'Theme Toggle',
		category: 'Toggles & Concepts',
		order: 40,
		file: 'theme-toggle.md'
	},
	{
		id: 'node-menu',
		title: 'Node Menu',
		category: 'Toggles & Concepts',
		order: 50,
		file: 'node-menu.md'
	},
	{
		id: 'color-swatch-picker',
		title: 'Color Swatch Picker',
		category: 'Toggles & Concepts',
		order: 60,
		file: 'color-swatch-picker.md'
	},
	{
		id: 'shacl-validation',
		title: 'SHACL/Structural Validation',
		category: 'Toggles & Concepts',
		order: 70,
		file: 'shacl-validation.md'
	},
	{
		id: 'namespace-model',
		title: 'The Namespace & Named-Graph Model',
		category: 'Toggles & Concepts',
		order: 80,
		file: 'namespace-model.md'
	},
	{
		id: 'backstage-catalog-sync',
		title: 'Backstage Catalog Sync',
		category: 'Toggles & Concepts',
		order: 90,
		file: 'backstage-catalog-sync.md'
	},
	{
		id: 'import-export',
		title: 'Import / Export',
		category: 'Toggles & Concepts',
		order: 100,
		file: 'import-export.md'
	},
	{
		id: 'layout-color-persistence',
		title: 'Layout & Color Persistence',
		category: 'Toggles & Concepts',
		order: 110,
		file: 'layout-color-persistence.md'
	}
];

function resolveContent(meta: DocSectionMeta): string {
	const content = rawContent[`./${meta.file}`];
	if (!content) {
		throw new Error(`Documentation content missing for section "${meta.id}": expected ./${meta.file}`);
	}
	return content;
}

export const docSections: DocSection[] = sectionMetas.map((meta) => ({
	...meta,
	content: resolveContent(meta)
}));
